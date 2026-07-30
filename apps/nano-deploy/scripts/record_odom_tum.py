#!/usr/bin/env python3
"""Record nav_msgs/Odometry as a TUM trajectory for backend benchmarks."""

from __future__ import annotations

import argparse
from pathlib import Path

import rclpy
from nav_msgs.msg import Odometry
from rclpy.node import Node
from rclpy.qos import HistoryPolicy, QoSProfile, ReliabilityPolicy


class OdomTumRecorder(Node):
    def __init__(self, topic: str, output: Path) -> None:
        super().__init__("outdoor_odom_tum_recorder")
        output.parent.mkdir(parents=True, exist_ok=True)
        self._stream = output.open("w", encoding="utf-8")
        self._count = 0
        qos = QoSProfile(
            depth=200,
            history=HistoryPolicy.KEEP_LAST,
            reliability=ReliabilityPolicy.RELIABLE,
        )
        self.create_subscription(Odometry, topic, self._on_odom, qos)
        self.get_logger().info(f"recording {topic} to {output}")

    def _on_odom(self, message: Odometry) -> None:
        stamp = message.header.stamp.sec + message.header.stamp.nanosec * 1e-9
        position = message.pose.pose.position
        orientation = message.pose.pose.orientation
        self._stream.write(
            f"{stamp:.9f} "
            f"{position.x:.9f} {position.y:.9f} {position.z:.9f} "
            f"{orientation.x:.9f} {orientation.y:.9f} "
            f"{orientation.z:.9f} {orientation.w:.9f}\n"
        )
        self._count += 1
        if self._count % 20 == 0:
            self._stream.flush()

    def close(self) -> None:
        self._stream.flush()
        self._stream.close()
        self.get_logger().info(f"saved {self._count} poses")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--topic", default="/Odometry")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    rclpy.init()
    node = OdomTumRecorder(args.topic, args.output)
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.close()
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
