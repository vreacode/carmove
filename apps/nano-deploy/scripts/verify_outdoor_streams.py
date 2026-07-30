#!/usr/bin/env python3
"""Verify live XT-16 and external IMU streams before a field rosbag starts."""

from __future__ import annotations

import argparse
import sys
import time

import rclpy
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, HistoryPolicy, QoSProfile, ReliabilityPolicy
from sensor_msgs.msg import Imu, PointCloud2


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lidar-topic", default="/lidar_points")
    parser.add_argument("--imu-topic", default="/imu/data_raw")
    parser.add_argument("--sample-seconds", type=float, default=4.0)
    parser.add_argument("--ready-timeout", type=float, default=12.0)
    parser.add_argument("--min-lidar-hz", type=float, default=5.0)
    parser.add_argument("--min-imu-hz", type=float, default=50.0)
    return parser.parse_args()


def stamp_ns(message: PointCloud2 | Imu) -> int:
    return int(message.header.stamp.sec) * 1_000_000_000 + int(message.header.stamp.nanosec)


def measured_hz(times: list[float]) -> float:
    if len(times) < 2:
        return 0.0
    duration = times[-1] - times[0]
    return (len(times) - 1) / duration if duration > 0.0 else 0.0


class StreamVerifier(Node):
    def __init__(self, args: argparse.Namespace) -> None:
        super().__init__("carmove_outdoor_stream_verifier")
        qos = QoSProfile(
            history=HistoryPolicy.KEEP_LAST,
            depth=1000,
            reliability=ReliabilityPolicy.RELIABLE,
            durability=DurabilityPolicy.VOLATILE,
        )
        self.lidar_times: list[float] = []
        self.imu_times: list[float] = []
        self.lidar_fields: set[str] = set()
        self.lidar_frame = ""
        self.imu_frame = ""
        self.max_points = 0
        self.lidar_stamp_backwards = 0
        self.imu_stamp_backwards = 0
        self._last_lidar_stamp: int | None = None
        self._last_imu_stamp: int | None = None
        self.create_subscription(PointCloud2, args.lidar_topic, self.on_lidar, qos)
        self.create_subscription(Imu, args.imu_topic, self.on_imu, qos)

    def on_lidar(self, message: PointCloud2) -> None:
        now = time.monotonic()
        self.lidar_times.append(now)
        self.lidar_fields.update(field.name for field in message.fields)
        self.lidar_frame = message.header.frame_id
        self.max_points = max(self.max_points, int(message.width) * int(message.height))
        current_stamp = stamp_ns(message)
        if self._last_lidar_stamp is not None and current_stamp < self._last_lidar_stamp:
            self.lidar_stamp_backwards += 1
        self._last_lidar_stamp = current_stamp

    def on_imu(self, message: Imu) -> None:
        now = time.monotonic()
        self.imu_times.append(now)
        self.imu_frame = message.header.frame_id
        current_stamp = stamp_ns(message)
        if self._last_imu_stamp is not None and current_stamp < self._last_imu_stamp:
            self.imu_stamp_backwards += 1
        self._last_imu_stamp = current_stamp


def main() -> int:
    args = parse_args()
    if args.sample_seconds < 1.0:
        print("--sample-seconds must be at least 1.0", file=sys.stderr)
        return 2

    rclpy.init()
    node = StreamVerifier(args)
    ready_deadline = time.monotonic() + args.ready_timeout
    try:
        while time.monotonic() < ready_deadline and (not node.lidar_times or not node.imu_times):
            rclpy.spin_once(node, timeout_sec=0.1)
        if not node.lidar_times or not node.imu_times:
            missing = []
            if not node.lidar_times:
                missing.append(args.lidar_topic)
            if not node.imu_times:
                missing.append(args.imu_topic)
            print(f"stream_check=failed no messages from {','.join(missing)}", file=sys.stderr)
            return 1
        sample_deadline = time.monotonic() + args.sample_seconds
        while time.monotonic() < sample_deadline:
            rclpy.spin_once(node, timeout_sec=0.1)
    finally:
        node.destroy_node()
        rclpy.shutdown()

    lidar_hz = measured_hz(node.lidar_times)
    imu_hz = measured_hz(node.imu_times)
    required_fields = {"x", "y", "z", "intensity", "ring", "timestamp"}
    missing_fields = sorted(required_fields - node.lidar_fields)
    errors: list[str] = []
    if len(node.lidar_times) < 8 or lidar_hz < args.min_lidar_hz:
        errors.append(f"LiDAR stream too slow ({len(node.lidar_times)} messages, {lidar_hz:.1f} Hz)")
    if len(node.imu_times) < 80 or imu_hz < args.min_imu_hz:
        errors.append(f"IMU stream too slow ({len(node.imu_times)} messages, {imu_hz:.1f} Hz)")
    if missing_fields:
        errors.append(f"LiDAR fields missing: {','.join(missing_fields)}")
    if not node.lidar_frame:
        errors.append("LiDAR frame_id is empty")
    if not node.imu_frame:
        errors.append("IMU frame_id is empty")
    if node.max_points <= 0:
        errors.append("LiDAR messages contain no points")
    if node.lidar_stamp_backwards:
        errors.append(f"LiDAR timestamp moved backwards {node.lidar_stamp_backwards} time(s)")
    if node.imu_stamp_backwards:
        errors.append(f"IMU timestamp moved backwards {node.imu_stamp_backwards} time(s)")

    if errors:
        print("stream_check=failed " + "; ".join(errors), file=sys.stderr)
        return 1

    print(
        "stream_check=ok"
        f" lidar_count={len(node.lidar_times)}"
        f" lidar_hz={lidar_hz:.1f}"
        f" lidar_frame={node.lidar_frame}"
        f" point_count={node.max_points}"
        f" imu_count={len(node.imu_times)}"
        f" imu_hz={imu_hz:.1f}"
        f" imu_frame={node.imu_frame}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
