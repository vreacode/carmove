from __future__ import annotations

import asyncio
import json
import os
import shlex
import signal
import time
from collections import deque
from contextlib import suppress
from math import isfinite
from pathlib import Path
from statistics import median

from .config import AgentSettings
from .logs import LogBuffer
from .schemas import BatteryStatus


class BatteryManager:
    """Subscribe to Wheeltec's voltage/charging topics without publishing commands."""

    def __init__(self, settings: AgentSettings, log_buffer: LogBuffer) -> None:
        self.settings = settings
        self.log_buffer = log_buffer
        self.process: asyncio.subprocess.Process | None = None
        self._stdout_task: asyncio.Task[None] | None = None
        self._stderr_task: asyncio.Task[None] | None = None
        self._wait_task: asyncio.Task[None] | None = None
        self.state = BatteryStatus(source=self.settings.battery_voltage_topic)
        window = max(3, int(self.settings.battery_filter_window))
        self._voltage_samples: deque[float] = deque(maxlen=window)
        self._low_streak = 0
        self._normal_streak = 0
        self._low_state = False

    @staticmethod
    def percentage(voltage: float | None, empty_voltage: float, full_voltage: float) -> float | None:
        if voltage is None or full_voltage <= empty_voltage or voltage < 0:
            return None
        return round(max(0.0, min(100.0, (voltage - empty_voltage) / (full_voltage - empty_voltage) * 100.0)), 1)

    def _is_low_candidate(self, voltage: float) -> bool:
        percentage = self.percentage(
            voltage,
            self.settings.battery_empty_voltage,
            self.settings.battery_full_voltage,
        )
        return (
            (self.settings.battery_low_voltage > 0 and voltage <= self.settings.battery_low_voltage)
            or (percentage is not None and percentage <= self.settings.battery_low_percentage)
        )

    def _update_low_state(self, candidate: bool) -> None:
        confirm_samples = max(1, int(self.settings.battery_low_confirm_samples))
        if candidate:
            self._low_streak += 1
            self._normal_streak = 0
            if self._low_streak >= confirm_samples:
                self._low_state = True
        else:
            self._normal_streak += 1
            self._low_streak = 0
            if self._normal_streak >= confirm_samples:
                self._low_state = False

    def _record_voltage(self, raw_voltage: float, timestamp: float | None = None) -> None:
        if not isfinite(raw_voltage) or raw_voltage < 0:
            return
        self._voltage_samples.append(raw_voltage)
        filtered_voltage = round(float(median(self._voltage_samples)), 3)
        self._update_low_state(self._is_low_candidate(filtered_voltage))
        self.state = self.state.model_copy(update={
            "voltage": filtered_voltage,
            "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "updated_at_epoch": timestamp or time.time(),
            "error": None,
        })

    def status(self) -> BatteryStatus:
        state = self.state
        age = time.time() - state.updated_at_epoch if state.updated_at_epoch else float("inf")
        available = state.voltage is not None and age <= self.settings.battery_stale_seconds
        percentage = self.percentage(state.voltage, self.settings.battery_empty_voltage, self.settings.battery_full_voltage)
        low = available and self._low_state
        return state.model_copy(update={"available": available, "percentage": percentage, "low": low})

    def _command(self) -> list[str]:
        bridge_path = Path(__file__).with_name("battery_bridge.py")
        shell = " && ".join(
            [
                f"source {shlex.quote(self.settings.battery_ros_setup_bash)}",
                "export PYTHONUNBUFFERED=1",
                " ".join(
                    [
                        shlex.quote(self.settings.battery_python_bin),
                        shlex.quote(str(bridge_path)),
                        "--voltage-topic", shlex.quote(self.settings.battery_voltage_topic),
                        "--charging-topic", shlex.quote(self.settings.battery_charging_topic),
                        "--current-topic", shlex.quote(self.settings.battery_current_topic),
                    ]
                ),
            ]
        )
        return ["/bin/bash", "-lc", shell]

    async def start(self) -> None:
        if not self.settings.battery_enabled:
            self.log_buffer.add("system", "info", "battery monitor disabled by config")
            return
        if self.process and self.process.returncode is None:
            return
        self.process = await asyncio.create_subprocess_exec(
            *self._command(),
            cwd=str(self.settings.model_workdir),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ, "PYTHONUNBUFFERED": "1"},
            start_new_session=True,
        )
        self.state = self.state.model_copy(update={"error": None})
        self._stdout_task = asyncio.create_task(self._consume_stdout())
        self._stderr_task = asyncio.create_task(self._consume_stderr())
        self._wait_task = asyncio.create_task(self._wait())
        self.log_buffer.add("system", "info", f"battery monitor started pid={self.process.pid}")

    async def _consume_stdout(self) -> None:
        if not self.process or not self.process.stdout:
            return
        async for raw in self.process.stdout:
            try:
                payload = json.loads(raw.decode("utf-8", errors="ignore"))
            except json.JSONDecodeError:
                continue
            if payload.get("type") != "battery":
                continue
            raw_voltage = payload.get("voltage")
            if raw_voltage is not None:
                try:
                    self._record_voltage(float(raw_voltage), float(payload.get("timestamp") or time.time()))
                except (TypeError, ValueError):
                    continue
            self.state = self.state.model_copy(update={
                "charging": payload.get("charging"),
                "charging_current": payload.get("charging_current"),
            })

    async def _consume_stderr(self) -> None:
        if not self.process or not self.process.stderr:
            return
        async for raw in self.process.stderr:
            line = raw.decode("utf-8", errors="ignore").strip()
            if line:
                self.state = self.state.model_copy(update={"error": line})
                self.log_buffer.add("system", "warning", f"battery monitor: {line}")

    async def _wait(self) -> None:
        if not self.process:
            return
        code = await self.process.wait()
        if code != 0 and not self.state.error:
            self.state = self.state.model_copy(update={"error": f"battery monitor exited with code {code}"})
        self.process = None

    async def stop(self) -> None:
        process = self.process
        if not process or process.returncode is not None:
            return
        with suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGINT)
        try:
            await asyncio.wait_for(process.wait(), timeout=5)
        except asyncio.TimeoutError:
            with suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGTERM)
            try:
                await asyncio.wait_for(process.wait(), timeout=3)
            except asyncio.TimeoutError:
                with suppress(ProcessLookupError):
                    os.killpg(process.pid, signal.SIGKILL)
                await process.wait()
        self.process = None
