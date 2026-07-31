#!/usr/bin/env python3
"""Project an optimized 3D PLY map into a conservative Nav2 occupancy map."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

import numpy as np


PLY_TYPES = {
    "char": "i1",
    "uchar": "u1",
    "int8": "i1",
    "uint8": "u1",
    "short": "<i2",
    "ushort": "<u2",
    "int16": "<i2",
    "uint16": "<u2",
    "int": "<i4",
    "uint": "<u4",
    "int32": "<i4",
    "uint32": "<u4",
    "float": "<f4",
    "float32": "<f4",
    "double": "<f8",
    "float64": "<f8",
}


def read_ply_xyz(path: Path) -> np.ndarray:
    with path.open("rb") as stream:
        first = stream.readline()
        if first != b"ply\n":
            raise ValueError("not a PLY file")
        fmt = ""
        vertex_count = 0
        in_vertex = False
        properties: list[tuple[str, str]] = []
        while True:
            raw = stream.readline()
            if not raw:
                raise ValueError("truncated PLY header")
            line = raw.decode("ascii").strip()
            fields = line.split()
            if fields[:1] == ["format"]:
                fmt = fields[1]
            elif fields[:2] == ["element", "vertex"]:
                vertex_count = int(fields[2])
                in_vertex = True
            elif fields[:1] == ["element"]:
                in_vertex = False
            elif fields[:1] == ["property"] and in_vertex:
                if fields[1] == "list":
                    raise ValueError("list properties are unsupported for vertices")
                properties.append((fields[2], fields[1]))
            elif line == "end_header":
                break

        names = {name for name, _ in properties}
        if not {"x", "y", "z"}.issubset(names):
            raise ValueError("PLY vertices do not contain x/y/z")
        if fmt == "binary_little_endian":
            try:
                dtype = np.dtype([(name, PLY_TYPES[kind]) for name, kind in properties])
            except KeyError as exc:
                raise ValueError(f"unsupported PLY scalar type: {exc.args[0]}") from exc
            vertices = np.fromfile(stream, dtype=dtype, count=vertex_count)
            if len(vertices) != vertex_count:
                raise ValueError("truncated PLY vertex data")
            return np.column_stack((vertices["x"], vertices["y"], vertices["z"])).astype(
                np.float64, copy=False
            )
        if fmt == "ascii":
            rows = np.loadtxt(stream, max_rows=vertex_count, ndmin=2)
            indices = [next(i for i, item in enumerate(properties) if item[0] == axis) for axis in "xyz"]
            return rows[:, indices].astype(np.float64, copy=False)
        raise ValueError(f"unsupported PLY format: {fmt}")


def fit_ground_plane(
    points: np.ndarray,
    tolerance: float,
    max_slope_degrees: float,
    iterations: int = 400,
) -> tuple[np.ndarray, float, int]:
    """Return upward normal, plane offset and number of supporting points."""
    if len(points) < 3:
        raise ValueError("at least three points are required")
    low_limit = float(np.percentile(points[:, 2], 40.0))
    candidates = points[points[:, 2] <= low_limit]
    if len(candidates) < 3:
        candidates = points
    rng = np.random.default_rng(20260731)
    minimum_vertical = math.cos(math.radians(max_slope_degrees))
    best_mask: np.ndarray | None = None
    best_count = 0
    for _ in range(iterations):
        sample = candidates[rng.choice(len(candidates), size=3, replace=False)]
        normal = np.cross(sample[1] - sample[0], sample[2] - sample[0])
        length = float(np.linalg.norm(normal))
        if length < 1e-9:
            continue
        normal /= length
        if normal[2] < 0.0:
            normal = -normal
        if normal[2] < minimum_vertical:
            continue
        offset = -float(np.dot(normal, sample[0]))
        mask = np.abs(candidates @ normal + offset) <= tolerance
        count = int(np.count_nonzero(mask))
        if count > best_count:
            best_count = count
            best_mask = mask
    if best_mask is None or best_count < 3:
        normal = np.array([0.0, 0.0, 1.0])
        offset = -float(np.percentile(points[:, 2], 10.0))
        return normal, offset, 0

    inliers = candidates[best_mask]
    center = np.mean(inliers, axis=0)
    _, _, vectors = np.linalg.svd(inliers - center, full_matrices=False)
    normal = vectors[-1]
    if normal[2] < 0.0:
        normal = -normal
    if normal[2] < minimum_vertical:
        normal = np.array([0.0, 0.0, 1.0])
    offset = -float(np.dot(normal, center))
    support = int(np.count_nonzero(np.abs(points @ normal + offset) <= tolerance))
    return normal, offset, support


def dilate(mask: np.ndarray, radius: int) -> np.ndarray:
    if radius <= 0:
        return mask.copy()
    result = np.zeros_like(mask)
    height, width = mask.shape
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            if dx * dx + dy * dy > radius * radius:
                continue
            src_y0, src_y1 = max(0, -dy), min(height, height - dy)
            src_x0, src_x1 = max(0, -dx), min(width, width - dx)
            dst_y0, dst_y1 = src_y0 + dy, src_y1 + dy
            dst_x0, dst_x1 = src_x0 + dx, src_x1 + dx
            result[dst_y0:dst_y1, dst_x0:dst_x1] |= mask[src_y0:src_y1, src_x0:src_x1]
    return result


def write_pgm(path: Path, pixels: np.ndarray) -> None:
    with path.open("wb") as stream:
        stream.write(f"P5\n{pixels.shape[1]} {pixels.shape[0]}\n255\n".encode("ascii"))
        stream.write(np.ascontiguousarray(pixels, dtype=np.uint8).tobytes())


def project(args: argparse.Namespace) -> dict[str, Any]:
    points = read_ply_xyz(args.input)
    finite = np.all(np.isfinite(points), axis=1)
    points = points[finite]
    if len(points) < args.minimum_points:
        raise ValueError(f"only {len(points)} finite points; need at least {args.minimum_points}")

    normal, offset, support = fit_ground_plane(
        points, args.ground_tolerance, args.max_ground_slope
    )
    heights = points @ normal + offset
    ground = np.abs(heights) <= args.ground_tolerance
    obstacles = (heights >= args.min_obstacle_height) & (heights <= args.max_obstacle_height)
    relevant = ground | obstacles
    selected = points[relevant]
    if not np.any(relevant):
        raise ValueError("no ground or obstacle points survived projection thresholds")

    min_xy = np.floor((np.min(selected[:, :2], axis=0) - args.padding) / args.resolution) * args.resolution
    max_xy = np.ceil((np.max(selected[:, :2], axis=0) + args.padding) / args.resolution) * args.resolution
    width, height = np.ceil((max_xy - min_xy) / args.resolution).astype(int) + 1
    if width <= 0 or height <= 0 or width * height > args.max_cells:
        raise ValueError(f"unreasonable map dimensions: {width}x{height}")

    ground_counts = np.zeros((height, width), dtype=np.uint16)
    obstacle_counts = np.zeros((height, width), dtype=np.uint16)
    indices = np.floor((points[:, :2] - min_xy) / args.resolution).astype(int)
    valid_indices = (
        (indices[:, 0] >= 0)
        & (indices[:, 0] < width)
        & (indices[:, 1] >= 0)
        & (indices[:, 1] < height)
    )
    for target, mask in ((ground_counts, ground), (obstacle_counts, obstacles)):
        chosen = indices[valid_indices & mask]
        if len(chosen):
            np.add.at(target, (chosen[:, 1], chosen[:, 0]), 1)

    free = ground_counts >= args.min_ground_points
    occupied = obstacle_counts >= args.min_obstacle_points
    free = dilate(free, int(math.ceil(args.free_fill_radius / args.resolution)))
    free &= ~occupied

    # ROS map_server expects row zero of the image to represent the top (+Y).
    pixels = np.full((height, width), 205, dtype=np.uint8)
    pixels[free] = 254
    pixels[occupied] = 0
    pixels = np.flipud(pixels)

    args.output_dir.mkdir(parents=True, exist_ok=True)
    pgm_path = args.output_dir / f"{args.map_name}.pgm"
    yaml_path = args.output_dir / f"{args.map_name}.yaml"
    report_path = args.output_dir / f"{args.map_name}.projection.json"
    write_pgm(pgm_path, pixels)
    yaml_path.write_text(
        "\n".join(
            [
                f"image: {pgm_path.name}",
                f"resolution: {args.resolution:.6f}",
                f"origin: [{min_xy[0]:.6f}, {min_xy[1]:.6f}, 0.0]",
                "negate: 0",
                "occupied_thresh: 0.65",
                "free_thresh: 0.25",
                "mode: trinary",
                "",
            ]
        ),
        encoding="utf-8",
    )

    free_cells = int(np.count_nonzero(free))
    occupied_cells = int(np.count_nonzero(occupied))
    known_area = (free_cells + occupied_cells) * args.resolution * args.resolution
    quality = "READY_FOR_REVIEW"
    reasons: list[str] = []
    if len(points) < 10_000:
        reasons.append("point cloud is too small for a field map")
    if known_area < 10.0:
        reasons.append("known projected area is below 10 m^2")
    if free_cells < 100:
        reasons.append("too few connected ground cells")
    if reasons:
        quality = "PROTOTYPE_ONLY"
    report: dict[str, Any] = {
        "quality": quality,
        "reasons": reasons,
        "input": str(args.input),
        "outputs": {"image": str(pgm_path), "yaml": str(yaml_path)},
        "points": {
            "finite": int(len(points)),
            "ground": int(np.count_nonzero(ground)),
            "obstacle": int(np.count_nonzero(obstacles)),
            "ground_plane_support": support,
        },
        "ground_plane": {
            "normal": [float(value) for value in normal],
            "offset": offset,
            "slope_degrees": math.degrees(math.acos(float(np.clip(normal[2], -1.0, 1.0)))),
        },
        "map": {
            "resolution": args.resolution,
            "origin": [float(min_xy[0]), float(min_xy[1]), 0.0],
            "width": int(width),
            "height": int(height),
            "free_cells": free_cells,
            "occupied_cells": occupied_cells,
            "known_area_m2": known_area,
        },
        "thresholds": {
            "ground_tolerance": args.ground_tolerance,
            "min_obstacle_height": args.min_obstacle_height,
            "max_obstacle_height": args.max_obstacle_height,
            "max_ground_slope": args.max_ground_slope,
            "free_fill_radius": args.free_fill_radius,
        },
        "warning": "This projection must be visually reviewed and field-validated before autonomous motion.",
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--map-name", default="glim_nav2_map")
    parser.add_argument("--resolution", type=float, default=0.10)
    parser.add_argument("--padding", type=float, default=1.0)
    parser.add_argument("--ground-tolerance", type=float, default=0.15)
    parser.add_argument("--max-ground-slope", type=float, default=25.0)
    parser.add_argument("--min-obstacle-height", type=float, default=0.20)
    parser.add_argument("--max-obstacle-height", type=float, default=2.00)
    parser.add_argument("--free-fill-radius", type=float, default=0.20)
    parser.add_argument("--min-ground-points", type=int, default=1)
    parser.add_argument("--min-obstacle-points", type=int, default=1)
    parser.add_argument("--minimum-points", type=int, default=100)
    parser.add_argument("--max-cells", type=int, default=20_000_000)
    args = parser.parse_args()
    if args.resolution <= 0 or args.padding < 0:
        parser.error("resolution must be positive and padding non-negative")
    if not 0 < args.ground_tolerance < args.min_obstacle_height < args.max_obstacle_height:
        parser.error("height thresholds must satisfy ground < min obstacle < max obstacle")
    return args


def main() -> None:
    args = parse_args()
    report = project(args)
    print(
        "quality={quality} points={points} ground={ground} obstacle={obstacle} "
        "map={width}x{height} known_area_m2={area:.2f}".format(
            quality=report["quality"],
            points=report["points"]["finite"],
            ground=report["points"]["ground"],
            obstacle=report["points"]["obstacle"],
            width=report["map"]["width"],
            height=report["map"]["height"],
            area=report["map"]["known_area_m2"],
        )
    )


if __name__ == "__main__":
    main()
