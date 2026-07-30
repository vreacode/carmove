#!/usr/bin/env python3
"""Summarize TUM trajectories without requiring a ground-truth system."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any


def load_tum(path: Path) -> list[tuple[float, ...]]:
    poses: list[tuple[float, ...]] = []
    if not path.is_file():
        return poses
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        fields = line.split()
        if len(fields) < 8:
            continue
        values = tuple(float(value) for value in fields[:8])
        if all(math.isfinite(value) for value in values):
            poses.append(values)
    return poses


def distance(left: tuple[float, ...], right: tuple[float, ...]) -> float:
    return math.sqrt(sum((right[index] - left[index]) ** 2 for index in range(1, 4)))


def quaternion_delta_degrees(left: tuple[float, ...], right: tuple[float, ...]) -> float:
    dot = abs(sum(left[index] * right[index] for index in range(4, 8)))
    dot = max(0.0, min(1.0, dot))
    return math.degrees(2.0 * math.acos(dot))


def summarize(label: str, path: Path) -> dict[str, Any]:
    poses = load_tum(path)
    result: dict[str, Any] = {
        "label": label,
        "path": str(path),
        "poses": len(poses),
        "valid": len(poses) >= 2,
    }
    if len(poses) < 2:
        return result

    duration = max(0.0, poses[-1][0] - poses[0][0])
    path_length = sum(distance(left, right) for left, right in zip(poses, poses[1:]))
    closure_error = distance(poses[0], poses[-1])
    result.update(
        {
            "duration_s": duration,
            "path_length_m": path_length,
            "closure_translation_m": closure_error,
            "closure_rotation_deg": quaternion_delta_degrees(poses[0], poses[-1]),
            "closure_ratio_percent": (
                100.0 * closure_error / path_length if path_length > 1e-6 else None
            ),
            "mean_speed_mps": path_length / duration if duration > 1e-6 else None,
        }
    )
    return result


def format_value(value: Any, digits: int = 3) -> str:
    if value is None:
        return "—"
    if isinstance(value, float):
        return f"{value:.{digits}f}"
    return str(value)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--trajectory",
        action="append",
        default=[],
        metavar="LABEL=PATH",
        help="May be supplied more than once.",
    )
    parser.add_argument("--json", type=Path, required=True)
    parser.add_argument("--markdown", type=Path, required=True)
    args = parser.parse_args()

    summaries: list[dict[str, Any]] = []
    for item in args.trajectory:
        if "=" not in item:
            parser.error(f"invalid trajectory: {item}")
        label, raw_path = item.split("=", 1)
        summaries.append(summarize(label, Path(raw_path)))

    args.json.parent.mkdir(parents=True, exist_ok=True)
    args.json.write_text(
        json.dumps({"trajectories": summaries}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    lines = [
        "# Outdoor mapping A/B summary",
        "",
        "| Backend trajectory | Poses | Duration (s) | Path (m) | Closure (m) | Closure (%) | Heading delta (deg) |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for item in summaries:
        lines.append(
            "| {label} | {poses} | {duration} | {length} | {closure} | {ratio} | {rotation} |".format(
                label=item["label"],
                poses=item["poses"],
                duration=format_value(item.get("duration_s"), 1),
                length=format_value(item.get("path_length_m")),
                closure=format_value(item.get("closure_translation_m")),
                ratio=format_value(item.get("closure_ratio_percent"), 2),
                rotation=format_value(item.get("closure_rotation_deg"), 2),
            )
        )
    lines.extend(
        [
            "",
            "Closure metrics are only meaningful when the vehicle returns near its starting pose.",
            "They are comparison indicators, not absolute accuracy without ground truth.",
        ]
    )
    args.markdown.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(args.markdown.read_text(encoding="utf-8"))


if __name__ == "__main__":
    main()
