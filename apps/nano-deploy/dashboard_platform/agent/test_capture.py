import asyncio
import csv
import tempfile
import unittest
from pathlib import Path

from .capture import CaptureManager
from .config import AgentSettings
from .logs import LogBuffer
from .schemas import CaptureStatus


class CaptureGalleryTests(unittest.TestCase):
    def write_manifest(self, root: Path, name: str, rows: list[list[str]]) -> None:
        manifest_dir = root / "manifests"
        manifest_dir.mkdir(parents=True, exist_ok=True)
        with (manifest_dir / name).open("w", newline="", encoding="utf-8") as handle:
            writer = csv.writer(handle)
            writer.writerow(["frame_path", "captured_at", "scene", "source", "note"])
            writer.writerows(rows)

    def test_lists_completed_sessions_without_absolute_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first_frame = root / "images" / "gate_2026-07-20" / "first.jpg"
            second_frame = root / "images" / "gate_2026-07-20" / "second.jpg"
            ir_frame = root / "images" / "road_2026-07-21" / "first.jpg"
            for frame in (first_frame, second_frame, ir_frame):
                frame.parent.mkdir(parents=True, exist_ok=True)
                frame.write_bytes(b"fixture")
            self.write_manifest(
                root,
                "gate_2026-07-20.csv",
                [
                    [str(first_frame), "2026-07-20T09:00:00+08:00", "gate_a_day", "rtsp://camera/video1", "入口白天"],
                    [str(second_frame), "2026-07-20T09:00:01+08:00", "gate_a_day", "rtsp://camera/video1", "入口白天"],
                ],
            )
            self.write_manifest(
                root,
                "road_2026-07-21.csv",
                [[str(ir_frame), "2026-07-21T20:00:00+08:00", "road_b_night", "rtsp://camera/video2", "夜间红外"]],
            )

            settings = AgentSettings(
                _env_file=None,
                capture_output_root=root,
                capture_workdir=root,
                capture_script=root / "collect.py",
            )
            items = CaptureManager(settings, LogBuffer(20)).list_gallery()

            self.assertEqual([item.group for item in items], ["road_2026-07-21", "gate_2026-07-20"])
            self.assertEqual(items[0].stream_mode, "ir_raw")
            self.assertEqual(items[0].frames_saved, 1)
            self.assertEqual(items[0].manifest_frames, 1)
            self.assertEqual(items[0].missing_frames, 0)
            self.assertTrue(items[0].integrity_ok)
            self.assertEqual(items[0].total_size_bytes, len(b"fixture"))
            self.assertEqual(items[0].latest_frame_name, "first.jpg")
            self.assertEqual(items[1].scene, "gate_a_day")
            self.assertEqual(items[1].frames_saved, 2)
            self.assertNotIn(str(root), items[1].manifest_name)
            manager = CaptureManager(settings, LogBuffer(20))
            self.assertEqual(manager.gallery_latest_frame_path("gate_2026-07-20"), second_frame.resolve())
            self.assertEqual([frame.name for frame in manager.gallery_frames("gate_2026-07-20")], ["first.jpg", "second.jpg"])
            self.assertEqual(manager.gallery_frames("gate_2026-07-20")[0].size_bytes, len(b"fixture"))
            self.assertEqual(manager.gallery_frame_path("gate_2026-07-20", "second.jpg"), second_frame.resolve())
            with self.assertRaises(ValueError):
                manager.gallery_latest_frame_path("../outside")
            with self.assertRaises(ValueError):
                manager.gallery_frame_path("gate_2026-07-20", "../outside.jpg")

    def test_reports_missing_or_cross_group_manifest_frames(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            other_group_frame = root / "images" / "other_group" / "frame.jpg"
            other_group_frame.parent.mkdir(parents=True)
            other_group_frame.write_bytes(b"must-not-leak")
            missing_frame = root / "images" / "field_group" / "missing.jpg"
            self.write_manifest(
                root,
                "field_group.csv",
                [
                    [str(other_group_frame), "2026-07-30T11:00:00+08:00", "field_group", "rtsp://camera/video1", ""],
                    [str(missing_frame), "2026-07-30T11:00:01+08:00", "field_group", "rtsp://camera/video1", ""],
                ],
            )
            manager = CaptureManager(AgentSettings(_env_file=None, capture_output_root=root), LogBuffer(20))

            item = manager.list_gallery()[0]

            self.assertEqual(item.manifest_frames, 2)
            self.assertEqual(item.frames_saved, 0)
            self.assertEqual(item.missing_frames, 2)
            self.assertFalse(item.integrity_ok)
            self.assertIsNone(item.latest_frame_name)
            self.assertEqual(manager.gallery_frames("field_group"), [])
            self.assertIsNone(manager.gallery_frame_path("field_group", "frame.jpg"))

    def test_paginates_and_skips_empty_manifests(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for index in range(3):
                frame = root / "images" / f"scene_{index}" / "frame.jpg"
                frame.parent.mkdir(parents=True, exist_ok=True)
                frame.write_bytes(b"fixture")
                self.write_manifest(
                    root,
                    f"scene_{index}.csv",
                    [[str(frame), f"2026-07-2{index}T10:00:00+08:00", f"scene_{index}", "rtsp://camera/video1", ""]],
                )
            (root / "manifests" / "empty.csv").write_text("frame_path,captured_at,scene,source,note\n", encoding="utf-8")
            settings = AgentSettings(_env_file=None, capture_output_root=root)
            manager = CaptureManager(settings, LogBuffer(20))

            self.assertEqual(len(manager.list_gallery(page=1, page_size=2)), 2)
            self.assertEqual(len(manager.list_gallery(page=2, page_size=2)), 1)
            self.assertEqual(manager.list_gallery(page=3, page_size=2), [])

    def test_deletes_only_selected_capture_group(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            selected_frame = root / "images" / "capture_20260729_191500" / "frame.jpg"
            retained_frame = root / "images" / "capture_20260729_191600" / "frame.jpg"
            for frame in (selected_frame, retained_frame):
                frame.parent.mkdir(parents=True, exist_ok=True)
                frame.write_bytes(b"fixture")
            self.write_manifest(
                root,
                "capture_20260729_191500.csv",
                [[str(selected_frame), "2026-07-29T19:15:00+08:00", "capture_20260729_191500", "rtsp://camera/video1", ""]],
            )
            self.write_manifest(
                root,
                "capture_20260729_191600.csv",
                [[str(retained_frame), "2026-07-29T19:16:00+08:00", "capture_20260729_191600", "rtsp://camera/video1", ""]],
            )
            manager = CaptureManager(AgentSettings(_env_file=None, capture_output_root=root), LogBuffer(20))

            result = manager.delete_gallery("capture_20260729_191500")

            self.assertEqual(result["frames_deleted"], 1)
            self.assertFalse(selected_frame.exists())
            self.assertFalse((root / "manifests" / "capture_20260729_191500.csv").exists())
            self.assertTrue(retained_frame.exists())
            self.assertTrue((root / "manifests" / "capture_20260729_191600.csv").exists())

    def test_delete_rejects_capture_group_path_traversal(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = CaptureManager(AgentSettings(_env_file=None, capture_output_root=Path(directory)), LogBuffer(20))
            with self.assertRaises(ValueError):
                manager.delete_gallery("../outside")

    def test_first_saved_frame_marks_capture_ready_and_tracks_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output_dir = root / "images" / "field_test"
            output_dir.mkdir(parents=True)
            frame = output_dir / "frame.jpg"
            frame.write_bytes(b"valid-frame")
            manager = CaptureManager(AgentSettings(_env_file=None, capture_output_root=root), LogBuffer(20))
            manager._status = CaptureStatus(
                running=True,
                phase="starting",
                output_dir=str(output_dir),
                started_at="2026-07-30T10:00:00+08:00",
            )
            stream = asyncio.StreamReader()
            stream.feed_data(f"stream ready: 1920x1080\nsaved 1: {frame}\n".encode())
            stream.feed_eof()

            asyncio.run(manager._read_stdout(stream))

            self.assertTrue(manager._status.ready)
            self.assertEqual(manager._status.phase, "recording")
            self.assertEqual(manager._status.frames_saved, 1)
            self.assertEqual(manager._status.frame_width, 1920)
            self.assertEqual(manager._status.frame_height, 1080)
            self.assertEqual(manager._status.bytes_saved, len(b"valid-frame"))
            self.assertIsNotNone(manager._status.first_frame_at)


if __name__ == "__main__":
    unittest.main()
