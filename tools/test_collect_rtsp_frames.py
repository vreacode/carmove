import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from tools.collect_rtsp_frames import show_preview, storage_reserve_available


class FakeFrame:
    shape = (480, 640, 3)

    def copy(self):
        return self


class FakeCv2:
    FONT_HERSHEY_SIMPLEX = 0
    LINE_AA = 0

    def __init__(self, key: int):
        self.key = key
        self.imshow_calls = 0

    def rectangle(self, *_args):
        return None

    def putText(self, *_args):
        return None

    def imshow(self, *_args):
        self.imshow_calls += 1

    def waitKey(self, _delay):
        return self.key


class CapturePreviewTests(unittest.TestCase):
    def test_preview_returns_true_for_q(self):
        cv2 = FakeCv2(ord("q"))
        args = SimpleNamespace(scene="gate_a_day", interval=1.0, duration=0.0)
        self.assertTrue(show_preview(cv2, FakeFrame(), args, saved=3, next_save_at=time.monotonic()))
        self.assertEqual(cv2.imshow_calls, 1)

    def test_preview_continues_for_other_key(self):
        cv2 = FakeCv2(-1)
        args = SimpleNamespace(scene="gate_a_day", interval=1.0, duration=0.0)
        self.assertFalse(show_preview(cv2, FakeFrame(), args, saved=0, next_save_at=time.monotonic() + 1))


class CaptureStorageTests(unittest.TestCase):
    @patch("tools.collect_rtsp_frames.shutil.disk_usage")
    def test_storage_reserve_stops_before_disk_is_exhausted(self, disk_usage):
        disk_usage.return_value = SimpleNamespace(free=4 * 1024**3)

        available, free_gb = storage_reserve_available(Path("/capture"), 5.0)

        self.assertFalse(available)
        self.assertEqual(free_gb, 4.0)

    @patch("tools.collect_rtsp_frames.shutil.disk_usage")
    def test_disabled_storage_reserve_allows_capture(self, disk_usage):
        disk_usage.return_value = SimpleNamespace(free=0)

        available, _ = storage_reserve_available(Path("/capture"), 0.0)

        self.assertTrue(available)


if __name__ == "__main__":
    unittest.main()
