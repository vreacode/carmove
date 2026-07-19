import asyncio
import unittest

from .config import AgentSettings
from .logs import LogBuffer
from .motion import MotionControlManager


def make_manager() -> MotionControlManager:
    settings = AgentSettings(
        enable_motion_control=False,
        motion_control_mode="dry_run",
        require_manual_arm=True,
        max_linear_vel_safe=0.05,
        max_angular_vel_safe=0.2,
    )
    return MotionControlManager(settings, LogBuffer(50))


class MotionSafetyTests(unittest.TestCase):
    def test_default_manager_is_dry_run_and_locked(self):
        manager = make_manager()
        state = manager.snapshot(navigation_running=False)
        self.assertTrue(manager.dry_run)
        self.assertFalse(state.armed)
        self.assertFalse(state.real_publish_enabled)

    def test_unarmed_motion_is_rejected_without_ros_publisher(self):
        manager = make_manager()
        with self.assertRaisesRegex(RuntimeError, "arm it first"):
            asyncio.run(manager.send_control("forward", "low", navigation_running=False))
        self.assertIsNone(manager._publisher)

    def test_dry_run_command_records_bounded_twist(self):
        manager = make_manager()
        asyncio.run(manager.set_armed(True))
        state = asyncio.run(manager.send_control("left", "low", navigation_running=False))
        self.assertIsNotNone(state.last_command)
        assert state.last_command is not None
        self.assertTrue(state.last_command.dry_run)
        self.assertEqual(state.last_command.linear_x, 0.03)
        self.assertEqual(state.last_command.angular_z, 0.07)
        self.assertIsNone(manager._publisher)

    def test_navigation_lockout_rejects_manual_command(self):
        manager = make_manager()
        asyncio.run(manager.set_armed(True))
        with self.assertRaisesRegex(RuntimeError, "navigation is running"):
            asyncio.run(manager.send_control("forward", "low", navigation_running=True))

    def test_real_mode_requires_ready_base(self):
        manager = make_manager()
        with self.assertRaisesRegex(RuntimeError, "base is not ready"):
            asyncio.run(manager.set_mode("real", base_ready=False))
        self.assertTrue(manager.dry_run)


if __name__ == "__main__":
    unittest.main()
