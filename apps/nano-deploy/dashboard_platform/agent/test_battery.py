import unittest
import time

from .battery import BatteryManager
from .config import AgentSettings
from .logs import LogBuffer


class BatteryConversionTests(unittest.TestCase):
    def test_low_voltage_uses_hardware_warning_line(self):
        settings = AgentSettings(_env_file=None, battery_low_voltage=20.0, battery_stale_seconds=10.0)
        manager = BatteryManager(settings, LogBuffer(10))

        manager.state = manager.state.model_copy(update={"voltage": 19.9, "updated_at_epoch": time.time()})
        self.assertTrue(manager.status().low)

        manager.state = manager.state.model_copy(update={"voltage": 20.1, "updated_at_epoch": time.time()})
        self.assertFalse(manager.status().low)

    def test_percentage_is_not_invented_without_calibration(self):
        self.assertIsNone(BatteryManager.percentage(24.0, 0.0, 0.0))

    def test_percentage_is_clamped_after_calibration(self):
        self.assertEqual(BatteryManager.percentage(20.0, 20.0, 24.0), 0.0)
        self.assertEqual(BatteryManager.percentage(22.0, 20.0, 24.0), 50.0)
        self.assertEqual(BatteryManager.percentage(26.0, 20.0, 24.0), 100.0)


if __name__ == "__main__":
    unittest.main()
