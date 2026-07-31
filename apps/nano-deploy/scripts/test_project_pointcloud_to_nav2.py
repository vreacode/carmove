import argparse
import importlib.util
import json
import struct
import tempfile
import unittest
from pathlib import Path

import numpy as np


MODULE_PATH = Path(__file__).with_name("project_pointcloud_to_nav2.py")
SPEC = importlib.util.spec_from_file_location("pointcloud_projection", MODULE_PATH)
assert SPEC and SPEC.loader
projection = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(projection)


def write_binary_ply(path: Path, points: list[tuple[float, float, float, float]]) -> None:
    header = (
        "ply\nformat binary_little_endian 1.0\n"
        f"element vertex {len(points)}\n"
        "property float x\nproperty float y\nproperty float z\n"
        "property float intensity\nend_header\n"
    )
    with path.open("wb") as stream:
        stream.write(header.encode("ascii"))
        for point in points:
            stream.write(struct.pack("<ffff", *point))


class PointCloudProjectionTests(unittest.TestCase):
    def test_binary_ply_and_nav2_projection(self) -> None:
        ground = [(x / 10, y / 10, 0.001 * x, 10.0) for x in range(20) for y in range(20)]
        obstacle = [(1.0, y / 10, z / 10, 50.0) for y in range(5, 15) for z in range(3, 11)]
        with tempfile.TemporaryDirectory() as raw_dir:
            root = Path(raw_dir)
            ply = root / "map.ply"
            write_binary_ply(ply, ground + obstacle)
            points = projection.read_ply_xyz(ply)
            self.assertEqual(points.shape, (480, 3))
            args = argparse.Namespace(
                input=ply,
                output_dir=root / "nav2",
                map_name="test_map",
                resolution=0.1,
                padding=0.2,
                ground_tolerance=0.15,
                max_ground_slope=25.0,
                min_obstacle_height=0.2,
                max_obstacle_height=2.0,
                free_fill_radius=0.1,
                min_ground_points=1,
                min_obstacle_points=1,
                minimum_points=100,
                max_cells=1_000_000,
            )
            report = projection.project(args)
            self.assertGreater(report["points"]["ground"], 300)
            self.assertGreater(report["points"]["obstacle"], 30)
            self.assertLess(report["ground_plane"]["slope_degrees"], 2.0)
            self.assertTrue((root / "nav2/test_map.pgm").is_file())
            self.assertIn("image: test_map.pgm", (root / "nav2/test_map.yaml").read_text())
            stored = json.loads((root / "nav2/test_map.projection.json").read_text())
            self.assertEqual(stored["map"]["width"], report["map"]["width"])

    def test_dilate_does_not_wrap_edges(self) -> None:
        mask = np.zeros((3, 4), dtype=bool)
        mask[0, 0] = True
        result = projection.dilate(mask, 1)
        self.assertTrue(result[0, 1])
        self.assertTrue(result[1, 0])
        self.assertFalse(result[0, -1])
        self.assertEqual(int(np.count_nonzero(result)), 3)


if __name__ == "__main__":
    unittest.main()
