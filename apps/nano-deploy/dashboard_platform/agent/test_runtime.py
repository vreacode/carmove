import asyncio
import tempfile
import unittest
from pathlib import Path

from .config import AgentSettings
from .logs import LogBuffer
from .runtime import BaseBringupManager, MapManager, ModelProcessManager, StatusCollector
from .schemas import ModelStartRequest


class ModelPreflightTests(unittest.TestCase):
    def test_relative_weight_resolves_under_model_workdir(self):
        with tempfile.TemporaryDirectory() as directory:
            workdir = Path(directory)
            settings = AgentSettings(model_workdir=workdir)
            manager = ModelProcessManager(settings, LogBuffer(20))
            self.assertEqual(manager.resolve_model_weight("weights/model.pt"), (workdir / "weights/model.pt").resolve())

    def test_start_rejects_missing_local_weight_before_spawning(self):
        with tempfile.TemporaryDirectory() as directory:
            workdir = Path(directory)
            settings = AgentSettings(
                model_workdir=workdir,
                available_models='[{"id":"test","label":"Test","weight":"missing.pt"}]',
                camera_rtsp_visible_url="rtsp://test/video1",
            )
            manager = ModelProcessManager(settings, LogBuffer(20))
            with self.assertRaisesRegex(RuntimeError, "not available locally"):
                asyncio.run(manager.start(ModelStartRequest(model_id="test")))
            self.assertIsNone(manager.process)


class RosCliIsolationTests(unittest.TestCase):
    def test_base_status_probes_never_spawn_ros2_daemon(self):
        self.assertEqual(BaseBringupManager._node_list_command(), "ros2 node list --no-daemon")
        self.assertEqual(
            BaseBringupManager._topic_info_command("/cmd vel"),
            "ros2 topic info '/cmd vel' -v --no-daemon",
        )


class MapManagerTests(unittest.TestCase):
    def test_delete_map_removes_yaml_image_and_sidecars(self):
        with tempfile.TemporaryDirectory() as directory:
            maps_directory = Path(directory)
            (maps_directory / "map_20260729_170000.yaml").write_text(
                "image: custom-image.pgm\nresolution: 0.05\n",
                encoding="utf-8",
            )
            (maps_directory / "custom-image.pgm").write_bytes(b"P5\n1 1\n255\n\x00")
            (maps_directory / "map_20260729_170000.posegraph").write_bytes(b"posegraph")
            manager = MapManager(AgentSettings(maps_directory=maps_directory))

            deleted = manager.delete_map("map_20260729_170000")

            self.assertEqual(
                deleted,
                ["custom-image.pgm", "map_20260729_170000.posegraph", "map_20260729_170000.yaml"],
            )
            self.assertEqual(list(maps_directory.iterdir()), [])

    def test_delete_map_rejects_path_traversal(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = MapManager(AgentSettings(maps_directory=Path(directory)))
            with self.assertRaisesRegex(ValueError, "invalid map name"):
                manager.delete_map("../outside")


class WorkflowStatusTests(unittest.TestCase):
    def test_outdoor_mapping_mode_and_name_come_from_runtime_state(self):
        with tempfile.TemporaryDirectory() as directory:
            workdir = Path(directory)
            runtime_directory = workdir / "dashboard_platform/runtime"
            runtime_directory.mkdir(parents=True)
            (runtime_directory / "outdoor_mapping.state").write_text(
                "map_name=outdoor_20260730_093000\n"
                "map_path=/tmp/outdoor_20260730_093000.pcd\n",
                encoding="utf-8",
            )
            collector = StatusCollector.__new__(StatusCollector)
            collector.settings = AgentSettings(
                model_workdir=workdir,
                maps_directory=workdir / "maps",
            )
            collector._find_processes = (
                lambda *patterns: [object()] if "fastlio_mapping" in patterns else []
            )

            (
                mapping_running,
                mapping_mode,
                mapping_backend,
                navigation_running,
                _rviz_available,
                rviz_running,
                current_map_name,
            ) = collector._workflow_status()

            self.assertTrue(mapping_running)
            self.assertEqual(mapping_mode, "outdoor_3d")
            self.assertEqual(mapping_backend, "fastlio2")
            self.assertFalse(navigation_running)
            self.assertFalse(rviz_running)
            self.assertEqual(current_map_name, "outdoor_20260730_093000")

    def test_glim_mapping_and_recording_state_are_reported(self):
        with tempfile.TemporaryDirectory() as directory:
            workdir = Path(directory)
            runtime_directory = workdir / "dashboard_platform/runtime"
            runtime_directory.mkdir(parents=True)
            (runtime_directory / "glim_mapping.state").write_text(
                "map_name=outdoor_20260730_110000\n"
                "map_path=/tmp/glim/outdoor_20260730_110000\n",
                encoding="utf-8",
            )
            (runtime_directory / "outdoor_bag.state").write_text(
                "bag_name=outdoor_data_20260730_105500\n"
                "bag_path=/tmp/outdoor_data_20260730_105500\n"
                "phase=recording\n"
                "started_at=2026-07-30T10:55:10+08:00\n"
                "lidar_hz=10.0\n"
                "imu_hz=200.0\n",
                encoding="utf-8",
            )
            collector = StatusCollector.__new__(StatusCollector)
            collector.settings = AgentSettings(
                model_workdir=workdir,
                maps_directory=workdir / "maps",
            )
            collector._find_processes = lambda *patterns: (
                [object()]
                if "glim_rosnode" in patterns or "ros2 bag record" in patterns
                else []
            )

            (
                mapping_running,
                mapping_mode,
                mapping_backend,
                _navigation_running,
                _rviz_available,
                _rviz_running,
                current_map_name,
            ) = collector._workflow_status()
            (
                recording,
                recording_state,
                recording_name,
                recording_started_at,
                _recording_size,
                lidar_hz,
                imu_hz,
                recording_error,
            ) = collector._outdoor_recording_status()

            self.assertTrue(mapping_running)
            self.assertEqual(mapping_mode, "outdoor_3d")
            self.assertEqual(mapping_backend, "glim")
            self.assertEqual(current_map_name, "outdoor_20260730_110000")
            self.assertTrue(recording)
            self.assertEqual(recording_state, "recording")
            self.assertEqual(recording_name, "outdoor_data_20260730_105500")
            self.assertEqual(recording_started_at, "2026-07-30T10:55:10+08:00")
            self.assertEqual(lidar_hz, 10.0)
            self.assertEqual(imu_hz, 200.0)
            self.assertIsNone(recording_error)


if __name__ == "__main__":
    unittest.main()
