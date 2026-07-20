import unittest

from .battery import BatteryManager


class BatteryConversionTests(unittest.TestCase):
    def test_percentage_is_not_invented_without_calibration(self):
        self.assertIsNone(BatteryManager.percentage(24.0, 0.0, 0.0))

    def test_percentage_is_clamped_after_calibration(self):
        self.assertEqual(BatteryManager.percentage(20.0, 20.0, 24.0), 0.0)
        self.assertEqual(BatteryManager.percentage(22.0, 20.0, 24.0), 50.0)
        self.assertEqual(BatteryManager.percentage(26.0, 20.0, 24.0), 100.0)


if __name__ == "__main__":
    unittest.main()
