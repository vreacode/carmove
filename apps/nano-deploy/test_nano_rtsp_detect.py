import tempfile
import unittest
import zipfile
from pathlib import Path

from nano_rtsp_detect import detect_model_backend


class ModelBackendDetectionTests(unittest.TestCase):
    def test_detects_ultralytics_checkpoint(self):
        with tempfile.TemporaryDirectory() as raw_dir:
            path = Path(raw_dir) / "model.pt"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("model/data.pkl", b"ultralytics.nn.tasks DetectionModel")
            self.assertEqual(detect_model_backend(path), "ultralytics")

    def test_defaults_to_yolov5_for_legacy_or_missing_file(self):
        with tempfile.TemporaryDirectory() as raw_dir:
            path = Path(raw_dir) / "legacy.pt"
            path.write_bytes(b"legacy checkpoint")
            self.assertEqual(detect_model_backend(path), "yolov5")
            self.assertEqual(detect_model_backend(path, "ultralytics"), "ultralytics")


if __name__ == "__main__":
    unittest.main()
