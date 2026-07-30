#!/usr/bin/env python3
"""Conservative frontier exploration controller for ROS 2 Humble + Nav2."""

from __future__ import annotations

import json
import math
import os
import subprocess
import time
from collections import deque
from pathlib import Path

import numpy as np
import rclpy
from action_msgs.msg import GoalStatus
from nav2_msgs.action import NavigateToPose
from nav_msgs.msg import OccupancyGrid
from rclpy.action import ActionClient
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, HistoryPolicy, QoSProfile, ReliabilityPolicy
from std_msgs.msg import String
from tf2_ros import Buffer, TransformException, TransformListener


def frontier_mask(grid: np.ndarray, free_threshold: int = 20) -> np.ndarray:
    free = (grid >= 0) & (grid <= free_threshold)
    unknown = grid < 0
    adjacent_unknown = np.zeros_like(unknown)
    adjacent_unknown[1:, :] |= unknown[:-1, :]
    adjacent_unknown[:-1, :] |= unknown[1:, :]
    adjacent_unknown[:, 1:] |= unknown[:, :-1]
    adjacent_unknown[:, :-1] |= unknown[:, 1:]
    return free & adjacent_unknown


def frontier_clusters(mask: np.ndarray, minimum_cells: int) -> list[list[tuple[int, int]]]:
    height, width = mask.shape
    remaining = set(zip(*np.nonzero(mask)))
    clusters: list[list[tuple[int, int]]] = []
    while remaining:
        seed = remaining.pop()
        queue = deque([seed])
        cluster = [seed]
        while queue:
            row, column = queue.popleft()
            for delta_row in (-1, 0, 1):
                for delta_column in (-1, 0, 1):
                    if delta_row == 0 and delta_column == 0:
                        continue
                    neighbor = (row + delta_row, column + delta_column)
                    if 0 <= neighbor[0] < height and 0 <= neighbor[1] < width and neighbor in remaining:
                        remaining.remove(neighbor)
                        queue.append(neighbor)
                        cluster.append(neighbor)
        if len(cluster) >= minimum_cells:
            clusters.append(cluster)
    return clusters


class FrontierExplorer(Node):
    def __init__(self) -> None:
        super().__init__("carmove_frontier_explorer")
        self.declare_parameter("map_topic", "/map")
        self.declare_parameter("global_frame", "map")
        self.declare_parameter("base_frame", "base_footprint")
        self.declare_parameter("free_threshold", 20)
        self.declare_parameter("occupied_threshold", 65)
        self.declare_parameter("minimum_frontier_cells", 8)
        self.declare_parameter("minimum_goal_distance", 1.0)
        self.declare_parameter("maximum_goal_distance", 15.0)
        self.declare_parameter("obstacle_clearance", 0.55)
        self.declare_parameter("goal_timeout_seconds", 120.0)
        self.declare_parameter("blacklist_radius", 0.8)
        self.declare_parameter("completion_checks", 15)
        self.declare_parameter("map_name", "autonomous_map")
        self.declare_parameter("save_on_complete", True)
        self.declare_parameter("save_script", "scripts/save_map.sh")
        self.declare_parameter("status_file", "dashboard_platform/runtime/frontier_status.json")

        self.global_frame = str(self.get_parameter("global_frame").value)
        self.base_frame = str(self.get_parameter("base_frame").value)
        self.map_message: OccupancyGrid | None = None
        self.goal_handle = None
        self.goal_started_at = 0.0
        self.blacklist: list[tuple[float, float]] = []
        self.empty_checks = 0
        self.last_frontier_clusters = 0
        self.completed = False
        self.save_process: subprocess.Popen | None = None

        qos = QoSProfile(
            reliability=ReliabilityPolicy.RELIABLE,
            durability=DurabilityPolicy.TRANSIENT_LOCAL,
            history=HistoryPolicy.KEEP_LAST,
            depth=1,
        )
        self.create_subscription(OccupancyGrid, str(self.get_parameter("map_topic").value), self._map_callback, qos)
        self.status_publisher = self.create_publisher(String, "/frontier_exploration/status", 10)
        self.tf_buffer = Buffer()
        self.tf_listener = TransformListener(self.tf_buffer, self)
        self.action_client = ActionClient(self, NavigateToPose, "/navigate_to_pose")
        self.create_timer(2.0, self._tick)
        self._publish_status("starting", "等待实时地图和 Nav2")

    def _map_callback(self, message: OccupancyGrid) -> None:
        self.map_message = message

    def _write_status(self, payload: dict) -> None:
        path = Path(str(self.get_parameter("status_file").value))
        if not path.is_absolute():
            path = Path.cwd() / path
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        os.replace(temporary, path)

    def _publish_status(self, state: str, detail: str, **extra) -> None:
        payload = {
            "state": state,
            "detail": detail,
            "map_name": str(self.get_parameter("map_name").value),
            "blacklisted_goals": len(self.blacklist),
            "timestamp": time.time(),
            **extra,
        }
        self.status_publisher.publish(String(data=json.dumps(payload, ensure_ascii=False)))
        self._write_status(payload)
        self.get_logger().info(f"{state}: {detail}")

    def _robot_position(self) -> tuple[float, float] | None:
        try:
            transform = self.tf_buffer.lookup_transform(self.global_frame, self.base_frame, rclpy.time.Time())
        except TransformException as exc:
            self.get_logger().warning(f"TF {self.global_frame}->{self.base_frame} unavailable: {exc}")
            return None
        return transform.transform.translation.x, transform.transform.translation.y

    def _cell_to_world(self, row: int, column: int, message: OccupancyGrid) -> tuple[float, float]:
        resolution = message.info.resolution
        origin = message.info.origin
        local_x = (column + 0.5) * resolution
        local_y = (row + 0.5) * resolution
        yaw = 2.0 * math.atan2(origin.orientation.z, origin.orientation.w)
        cosine, sine = math.cos(yaw), math.sin(yaw)
        return (
            origin.position.x + cosine * local_x - sine * local_y,
            origin.position.y + sine * local_x + cosine * local_y,
        )

    def _is_clear(self, grid: np.ndarray, row: int, column: int, radius_cells: int) -> bool:
        row_min, row_max = max(0, row - radius_cells), min(grid.shape[0], row + radius_cells + 1)
        col_min, col_max = max(0, column - radius_cells), min(grid.shape[1], column + radius_cells + 1)
        window = grid[row_min:row_max, col_min:col_max]
        occupied_threshold = int(self.get_parameter("occupied_threshold").value)
        return window.size > 0 and not np.any(window >= occupied_threshold)

    def _select_goal(self) -> tuple[float, float, float, int] | None:
        message = self.map_message
        robot = self._robot_position()
        if message is None or robot is None or message.info.width == 0 or message.info.height == 0:
            return None
        grid = np.asarray(message.data, dtype=np.int16).reshape((message.info.height, message.info.width))
        clusters = frontier_clusters(
            frontier_mask(grid, int(self.get_parameter("free_threshold").value)),
            int(self.get_parameter("minimum_frontier_cells").value),
        )
        self.last_frontier_clusters = len(clusters)
        resolution = message.info.resolution
        clearance_cells = max(1, math.ceil(float(self.get_parameter("obstacle_clearance").value) / resolution))
        minimum_distance = float(self.get_parameter("minimum_goal_distance").value)
        maximum_distance = float(self.get_parameter("maximum_goal_distance").value)
        blacklist_radius = float(self.get_parameter("blacklist_radius").value)
        candidates: list[tuple[float, float, float, float, int]] = []

        for cluster in clusters:
            mean_row = sum(cell[0] for cell in cluster) / len(cluster)
            mean_column = sum(cell[1] for cell in cluster) / len(cluster)
            ordered = sorted(cluster, key=lambda cell: (cell[0] - mean_row) ** 2 + (cell[1] - mean_column) ** 2)
            selected_cell = next((cell for cell in ordered if self._is_clear(grid, cell[0], cell[1], clearance_cells)), None)
            if selected_cell is None:
                continue
            x, y = self._cell_to_world(selected_cell[0], selected_cell[1], message)
            distance = math.hypot(x - robot[0], y - robot[1])
            if distance < minimum_distance or distance > maximum_distance:
                continue
            if any(math.hypot(x - blocked_x, y - blocked_y) < blacklist_radius for blocked_x, blocked_y in self.blacklist):
                continue
            information_gain = len(cluster) * resolution
            score = information_gain - 0.12 * distance
            yaw = math.atan2(y - robot[1], x - robot[0])
            candidates.append((score, x, y, yaw, len(cluster)))

        if not candidates:
            return None
        _, x, y, yaw, cells = max(candidates, key=lambda candidate: candidate[0])
        return x, y, yaw, cells

    def _tick(self) -> None:
        if self.completed:
            if self.save_process is not None and self.save_process.poll() is not None:
                if self.save_process.returncode == 0:
                    self._publish_status("complete", "探索结束，地图已自动保存")
                else:
                    self._publish_status("save_failed", f"探索结束，但地图保存失败（退出码 {self.save_process.returncode}）")
                self.save_process = None
            return

        if self.goal_handle is not None:
            timeout = float(self.get_parameter("goal_timeout_seconds").value)
            if time.monotonic() - self.goal_started_at > timeout:
                self._publish_status("cancelling", "当前探索点超时，正在取消")
                self.goal_handle.cancel_goal_async()
                self.goal_handle = None
            return

        if not self.action_client.server_is_ready():
            self.action_client.wait_for_server(timeout_sec=0.2)
            self._publish_status("waiting_nav2", "等待 Nav2 导航服务")
            return

        goal = self._select_goal()
        if goal is None:
            if self.map_message is None or self._robot_position() is None:
                self._publish_status("waiting_map", "等待地图或机器人位姿")
                return
            self.empty_checks += 1
            required_checks = int(self.get_parameter("completion_checks").value)
            if self.empty_checks < required_checks:
                state = "checking_complete" if self.last_frontier_clusters == 0 else "no_safe_goal"
                detail = "暂未发现未知区域边界" if self.last_frontier_clusters == 0 else f"剩余 {self.last_frontier_clusters} 个边界暂不可达"
                self._publish_status(state, f"{detail}（{self.empty_checks}/{required_checks}）")
                return
            self._finish_exploration("探索结束" if self.last_frontier_clusters == 0 else "可安全到达的区域已探索完成")
            return

        self.empty_checks = 0
        x, y, yaw, cells = goal
        request = NavigateToPose.Goal()
        request.pose.header.frame_id = self.global_frame
        request.pose.header.stamp = self.get_clock().now().to_msg()
        request.pose.pose.position.x = x
        request.pose.pose.position.y = y
        request.pose.pose.orientation.z = math.sin(yaw / 2.0)
        request.pose.pose.orientation.w = math.cos(yaw / 2.0)
        future = self.action_client.send_goal_async(request)
        future.add_done_callback(lambda done, candidate=(x, y), size=cells: self._goal_response(done, candidate, size))
        self._publish_status("sending_goal", f"发送探索点 x={x:.2f}, y={y:.2f}", goal={"x": x, "y": y}, frontier_cells=cells)

    def _goal_response(self, future, candidate: tuple[float, float], frontier_cells: int) -> None:
        try:
            handle = future.result()
        except Exception as exc:
            self.blacklist.append(candidate)
            self._publish_status("goal_error", f"探索点发送失败：{exc}")
            return
        if not handle.accepted:
            self.blacklist.append(candidate)
            self._publish_status("goal_rejected", "Nav2 拒绝探索点")
            return
        self.goal_handle = handle
        self.goal_started_at = time.monotonic()
        result_future = handle.get_result_async()
        result_future.add_done_callback(lambda done, point=candidate: self._goal_result(done, point))
        self._publish_status("navigating", f"正在前往探索点 x={candidate[0]:.2f}, y={candidate[1]:.2f}", frontier_cells=frontier_cells)

    def _goal_result(self, future, candidate: tuple[float, float]) -> None:
        self.goal_handle = None
        try:
            status = future.result().status
        except Exception as exc:
            self.blacklist.append(candidate)
            self._publish_status("goal_error", f"探索导航异常：{exc}")
            return
        if status == GoalStatus.STATUS_SUCCEEDED:
            self._publish_status("goal_reached", "已到达探索点，重新分析地图")
        else:
            self.blacklist.append(candidate)
            self._publish_status("goal_failed", f"探索点不可达，已加入避让列表（状态 {status}）")

    def _finish_exploration(self, detail: str) -> None:
        self.completed = True
        if not bool(self.get_parameter("save_on_complete").value):
            self._publish_status("complete", detail)
            return
        map_name = str(self.get_parameter("map_name").value)
        save_script = str(self.get_parameter("save_script").value)
        self._publish_status("saving", f"{detail}，正在保存地图 {map_name}")
        self.save_process = subprocess.Popen(
            ["bash", save_script, map_name],
            cwd=str(Path(__file__).resolve().parent.parent),
            start_new_session=True,
        )


def main() -> None:
    rclpy.init()
    node = FrontierExplorer()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
