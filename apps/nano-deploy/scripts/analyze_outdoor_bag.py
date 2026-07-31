#!/usr/bin/env python3
"""Generate a field-quality report for a CarMove outdoor ROS 2 bag."""

from __future__ import annotations

import argparse
import json
import math
import sqlite3
import statistics
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from rclpy.serialization import deserialize_message
from rosidl_runtime_py.utilities import get_message


@dataclass(frozen=True)
class TopicRef:
    database: Path
    topic_id: int
    type_name: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bag", type=Path, help="ROS 2 sqlite3 bag directory")
    parser.add_argument("--json", type=Path, dest="json_path")
    parser.add_argument("--markdown", type=Path, dest="markdown_path")
    parser.add_argument("--samples-per-db", type=int, default=101)
    parser.add_argument("--min-duration", type=float, default=120.0)
    parser.add_argument("--min-path", type=float, default=15.0)
    parser.add_argument("--min-turn", type=float, default=45.0)
    return parser.parse_args()


def discover_topics(databases: list[Path]) -> dict[str, list[TopicRef]]:
    topics: dict[str, list[TopicRef]] = {}
    for database in databases:
        with sqlite3.connect(database) as connection:
            for topic_id, name, type_name in connection.execute(
                "SELECT id, name, type FROM topics"
            ):
                topics.setdefault(name, []).append(
                    TopicRef(database, int(topic_id), str(type_name))
                )
    return topics


def topic_rows(refs: Iterable[TopicRef]) -> Iterable[tuple[int, Any]]:
    for ref in refs:
        message_type = get_message(ref.type_name)
        with sqlite3.connect(ref.database) as connection:
            cursor = connection.execute(
                "SELECT timestamp, data FROM messages WHERE topic_id=? ORDER BY timestamp",
                (ref.topic_id,),
            )
            for timestamp, payload in cursor:
                yield int(timestamp), deserialize_message(payload, message_type)


def sampled_rows(refs: Iterable[TopicRef], samples_per_db: int) -> list[tuple[int, Any]]:
    rows: list[tuple[int, Any]] = []
    for ref in refs:
        message_type = get_message(ref.type_name)
        with sqlite3.connect(ref.database) as connection:
            bounds = connection.execute(
                "SELECT MIN(id), MAX(id), COUNT(*) FROM messages WHERE topic_id=?",
                (ref.topic_id,),
            ).fetchone()
            if not bounds or not bounds[2]:
                continue
            min_id, max_id, count = map(int, bounds)
            wanted = min(samples_per_db, count)
            targets = {
                round(min_id + (max_id - min_id) * index / max(1, wanted - 1))
                for index in range(wanted)
            }
            for target in sorted(targets):
                row = connection.execute(
                    "SELECT timestamp, data FROM messages "
                    "WHERE topic_id=? AND id>=? ORDER BY id LIMIT 1",
                    (ref.topic_id, target),
                ).fetchone()
                if row:
                    rows.append((int(row[0]), deserialize_message(row[1], message_type)))
    rows.sort(key=lambda item: item[0])
    return rows


def topic_stats(refs: Iterable[TopicRef]) -> dict[str, float | int]:
    count = 0
    first: int | None = None
    last: int | None = None
    for ref in refs:
        with sqlite3.connect(ref.database) as connection:
            row = connection.execute(
                "SELECT COUNT(*), MIN(timestamp), MAX(timestamp) "
                "FROM messages WHERE topic_id=?",
                (ref.topic_id,),
            ).fetchone()
        if not row or not row[0]:
            continue
        count += int(row[0])
        first = int(row[1]) if first is None else min(first, int(row[1]))
        last = int(row[2]) if last is None else max(last, int(row[2]))
    duration = max(0.0, ((last or 0) - (first or 0)) / 1e9)
    rate = (count - 1) / duration if count > 1 and duration > 0.0 else 0.0
    return {"count": count, "duration_s": duration, "rate_hz": rate}


def stamp_ns(message: Any) -> int:
    return int(message.header.stamp.sec) * 1_000_000_000 + int(message.header.stamp.nanosec)


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[round((len(ordered) - 1) * fraction)]


def stream_details(rows: list[tuple[int, Any]], lidar: bool) -> dict[str, Any]:
    if not rows:
        return {}
    stamps = [stamp_ns(message) for _, message in rows]
    offsets = [(stamp - receive) / 1e6 for (receive, _), stamp in zip(rows, stamps)]
    result: dict[str, Any] = {
        "frame_id": rows[-1][1].header.frame_id,
        "sample_count": len(rows),
        "sampled_stamp_backwards": sum(
            current < previous for previous, current in zip(stamps, stamps[1:])
        ),
        "header_minus_bag_ms": {
            "p01": percentile(offsets, 0.01),
            "median": statistics.median(offsets),
            "p99": percentile(offsets, 0.99),
        },
    }
    if lidar:
        point_counts = [int(message.width) * int(message.height) for _, message in rows]
        fields = sorted({field.name for _, message in rows for field in message.fields})
        result.update(
            {
                "point_count_min": min(point_counts),
                "point_count_max": max(point_counts),
                "fields": fields,
            }
        )
    return result


def yaw_from_quaternion(quaternion: Any) -> float:
    return math.atan2(
        2.0 * (quaternion.w * quaternion.z + quaternion.x * quaternion.y),
        1.0 - 2.0 * (quaternion.y**2 + quaternion.z**2),
    )


def angle_delta(current: float, previous: float) -> float:
    return math.atan2(math.sin(current - previous), math.cos(current - previous))


def odom_details(rows: list[tuple[int, Any]]) -> dict[str, Any]:
    if not rows:
        return {}
    positions = [message.pose.pose.position for _, message in rows]
    yaws = [yaw_from_quaternion(message.pose.pose.orientation) for _, message in rows]
    speeds = [
        math.hypot(message.twist.twist.linear.x, message.twist.twist.linear.y)
        for _, message in rows
    ]
    path = sum(
        math.hypot(current.x - previous.x, current.y - previous.y)
        for previous, current in zip(positions, positions[1:])
    )
    displacement = math.hypot(
        positions[-1].x - positions[0].x,
        positions[-1].y - positions[0].y,
    )
    turn = sum(abs(angle_delta(current, previous)) for previous, current in zip(yaws, yaws[1:]))
    active = [index for index, speed in enumerate(speeds) if speed > 0.02]
    start_ns, end_ns = rows[0][0], rows[-1][0]
    pre_stationary = 0.0
    post_stationary = 0.0
    if active:
        pre_stationary = (rows[active[0]][0] - start_ns) / 1e9
        post_stationary = (end_ns - rows[active[-1]][0]) / 1e9
    return {
        "frame_id": rows[0][1].header.frame_id,
        "child_frame_id": rows[0][1].child_frame_id,
        "path_m": path,
        "displacement_m": displacement,
        "accumulated_turn_deg": math.degrees(turn),
        "heading_delta_deg": math.degrees(angle_delta(yaws[-1], yaws[0])),
        "max_speed_mps": max(speeds),
        "pre_stationary_s": pre_stationary,
        "post_stationary_s": post_stationary,
    }


def packet_loss_details(rows: list[tuple[int, Any]]) -> dict[str, Any]:
    if not rows:
        return {}
    first = rows[0][1]
    last = rows[-1][1]
    return {
        "packet_count_delta": int(last.total_packet_count) - int(first.total_packet_count),
        "packet_loss_delta": int(last.total_packet_loss_count)
        - int(first.total_packet_loss_count),
        "packet_loss_first": int(first.total_packet_loss_count),
        "packet_loss_last": int(last.total_packet_loss_count),
    }


def fmt(value: Any, digits: int = 2) -> str:
    return f"{value:.{digits}f}" if isinstance(value, float) else str(value)


def render_markdown(report: dict[str, Any]) -> str:
    lidar = report["streams"]["lidar"]
    imu = report["streams"]["imu"]
    odom = report.get("odometry", {})
    loss = report.get("packet_loss", {})
    lines = [
        "# Outdoor bag quality report",
        "",
        f"- Overall: **{report['overall']}**",
        f"- Sensor integrity: **{'PASS' if report['sensor_integrity'] else 'FAIL'}**",
        f"- Mapping coverage: **{'PASS' if report['mapping_coverage'] else 'INSUFFICIENT'}**",
        f"- Bag: `{report['bag']}`",
        "",
        "| Stream | Messages | Rate | Frame |",
        "|---|---:|---:|---|",
        f"| XT-16 | {lidar['count']} | {fmt(lidar['rate_hz'])} Hz | {lidar.get('frame_id', '')} |",
        f"| H30 | {imu['count']} | {fmt(imu['rate_hz'])} Hz | {imu.get('frame_id', '')} |",
    ]
    if odom:
        lines.extend(
            [
                "",
                "## Motion coverage",
                "",
                f"- Path: {fmt(odom['path_m'])} m",
                f"- Displacement: {fmt(odom['displacement_m'])} m",
                f"- Accumulated turn: {fmt(odom['accumulated_turn_deg'])}°",
                f"- Initial/final stationary: {fmt(odom['pre_stationary_s'])} s / {fmt(odom['post_stationary_s'])} s",
            ]
        )
    if loss:
        lines.append(f"- XT-16 packet-loss delta: {loss['packet_loss_delta']}")
    for title, key in (("Errors", "errors"), ("Warnings", "warnings")):
        values = report[key]
        lines.extend(["", f"## {title}", ""])
        lines.extend(f"- {value}" for value in values) if values else lines.append("- None")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    bag = args.bag.resolve()
    databases = sorted(bag.glob("*.db3"))
    if not databases:
        raise SystemExit(f"No sqlite3 rosbag files found in {bag}")
    topics = discover_topics(databases)
    required = ("/lidar_points", "/imu/data_raw")
    missing = [name for name in required if name not in topics]
    if missing:
        raise SystemExit(f"Missing required topics: {', '.join(missing)}")

    lidar_samples = sampled_rows(topics["/lidar_points"], args.samples_per_db)
    imu_samples = sampled_rows(topics["/imu/data_raw"], args.samples_per_db)
    lidar = topic_stats(topics["/lidar_points"])
    lidar.update(stream_details(lidar_samples, lidar=True))
    imu = topic_stats(topics["/imu/data_raw"])
    imu.update(stream_details(imu_samples, lidar=False))
    odom_rows = list(topic_rows(topics.get("/odom", [])))
    odom = odom_details(odom_rows)
    loss_rows = list(topic_rows(topics.get("/lidar_packets_loss", [])))
    packet_loss = packet_loss_details(loss_rows)

    errors: list[str] = []
    warnings: list[str] = []
    if lidar["rate_hz"] < 8.0:
        errors.append(f"XT-16 rate is too low: {lidar['rate_hz']:.1f} Hz")
    if imu["rate_hz"] < 150.0:
        errors.append(f"H30 rate is too low: {imu['rate_hz']:.1f} Hz")
    if lidar.get("frame_id") != "laser":
        errors.append(f"Unexpected LiDAR frame: {lidar.get('frame_id')!r}")
    if imu.get("frame_id") != "gyro_link":
        errors.append(f"Unexpected H30 frame: {imu.get('frame_id')!r}")
    if lidar.get("sampled_stamp_backwards"):
        errors.append("Sampled XT-16 header timestamps moved backwards")
    if imu.get("sampled_stamp_backwards"):
        errors.append("Sampled H30 header timestamps moved backwards")
    required_fields = {"x", "y", "z", "intensity", "ring", "timestamp"}
    missing_fields = required_fields - set(lidar.get("fields", []))
    if missing_fields:
        errors.append("XT-16 fields missing: " + ", ".join(sorted(missing_fields)))
    if lidar.get("point_count_min", 0) < 10_000:
        errors.append("XT-16 sampled frames contain too few points")
    if packet_loss.get("packet_loss_delta", 0) > 0:
        errors.append(f"XT-16 lost {packet_loss['packet_loss_delta']} packets during recording")
    if not odom:
        warnings.append("No /odom data; motion coverage cannot be confirmed")

    duration = max(float(lidar["duration_s"]), float(imu["duration_s"]))
    coverage_checks = {
        "duration": duration >= args.min_duration,
        "path": bool(odom) and odom["path_m"] >= args.min_path,
        "turn": bool(odom) and odom["accumulated_turn_deg"] >= args.min_turn,
        "initial_stationary": bool(odom) and odom["pre_stationary_s"] >= 5.0,
        "final_stationary": bool(odom) and odom["post_stationary_s"] >= 5.0,
    }
    coverage_labels = {
        "duration": f"duration below {args.min_duration:.0f} s",
        "path": f"path below {args.min_path:.0f} m",
        "turn": f"accumulated turn below {args.min_turn:.0f}°",
        "initial_stationary": "initial stationary period below 5 s",
        "final_stationary": "final stationary period below 5 s",
    }
    warnings.extend(coverage_labels[key] for key, passed in coverage_checks.items() if not passed)
    sensor_integrity = not errors
    mapping_coverage = all(coverage_checks.values())
    overall = "PASS" if sensor_integrity and mapping_coverage else "SENSOR_ONLY" if sensor_integrity else "FAIL"

    report = {
        "bag": str(bag),
        "overall": overall,
        "sensor_integrity": sensor_integrity,
        "mapping_coverage": mapping_coverage,
        "coverage_checks": coverage_checks,
        "streams": {"lidar": lidar, "imu": imu},
        "odometry": odom,
        "packet_loss": packet_loss,
        "errors": errors,
        "warnings": warnings,
    }
    json_path = args.json_path or bag / "quality_report.json"
    markdown_path = args.markdown_path or bag / "quality_report.md"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    markdown_path.write_text(render_markdown(report), encoding="utf-8")
    print(
        f"quality={overall} sensor_integrity={'pass' if sensor_integrity else 'fail'} "
        f"mapping_coverage={'pass' if mapping_coverage else 'insufficient'} "
        f"lidar_hz={lidar['rate_hz']:.1f} imu_hz={imu['rate_hz']:.1f} "
        f"packet_loss_delta={packet_loss.get('packet_loss_delta', 'unknown')} "
        f"path_m={odom.get('path_m', 0.0):.2f} turn_deg={odom.get('accumulated_turn_deg', 0.0):.1f}"
    )
    print(f"report={markdown_path}")
    return 0 if sensor_integrity else 1


if __name__ == "__main__":
    raise SystemExit(main())
