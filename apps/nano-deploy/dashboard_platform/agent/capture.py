from __future__ import annotations

import asyncio
import os
import re
import signal
from contextlib import suppress
from datetime import datetime
from pathlib import Path

from .config import AgentSettings
from .logs import LogBuffer
from .schemas import CaptureStartRequest, CaptureStatus


class CaptureManager:
    """Own one bounded, manifest-producing RTSP capture process."""

    def __init__(self, settings: AgentSettings, log_buffer: LogBuffer) -> None:
        self.settings = settings
        self.log_buffer = log_buffer
        self.process: asyncio.subprocess.Process | None = None
        self._stdout_task: asyncio.Task[None] | None = None
        self._stderr_task: asyncio.Task[None] | None = None
        self._wait_task: asyncio.Task[None] | None = None
        self._lock = asyncio.Lock()
        self._status = CaptureStatus()
        self._latest_frame: Path | None = None

    @staticmethod
    def slug_scene(scene: str) -> str:
        value = re.sub(r"[^0-9A-Za-z\u4e00-\u9fff_-]+", "_", scene.strip())
        value = value.strip("._-")
        if not value:
            raise ValueError("scene must contain letters, numbers, Chinese characters, '_' or '-'")
        return value[:64]

    def status(self) -> CaptureStatus:
        running = bool(self.process and self.process.returncode is None)
        latest = str(self._latest_frame) if self._latest_frame and self._latest_frame.is_file() else None
        return self._status.model_copy(
            update={
                "running": running,
                "pid": self.process.pid if running and self.process else None,
                "latest_frame": latest,
            }
        )

    def latest_frame_path(self) -> Path | None:
        if self._latest_frame and self._latest_frame.is_file():
            return self._latest_frame
        return None

    async def _read_stdout(self, stream: asyncio.StreamReader | None) -> None:
        if stream is None:
            return
        async for raw in stream:
            line = raw.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            self._status = self._status.model_copy(update={"last_line": line})
            match = re.match(r"saved\s+(\d+):\s+(.+)$", line)
            if match:
                path = Path(match.group(2).strip()).resolve()
                output_dir = Path(self._status.output_dir).resolve() if self._status.output_dir else None
                if output_dir and output_dir == path.parent and path.suffix.lower() == ".jpg":
                    self._latest_frame = path
                self._status = self._status.model_copy(update={"frames_saved": int(match.group(1))})
            self.log_buffer.add("capture", "info", line)

    async def _read_stderr(self, stream: asyncio.StreamReader | None) -> None:
        if stream is None:
            return
        async for raw in stream:
            line = raw.decode("utf-8", errors="replace").strip()
            if line:
                self._status = self._status.model_copy(update={"last_error": line, "last_line": line})
                self.log_buffer.add("capture", "error", line)

    async def _wait_for_exit(self) -> None:
        if self.process is None:
            return
        code = await self.process.wait()
        if code != 0 and not self._status.last_error:
            self._status = self._status.model_copy(update={"last_error": f"capture process exited with code {code}"})
        self.log_buffer.add("capture", "info", f"capture process exited with code {code}")
        self.process = None
        self._status = self._status.model_copy(update={"running": False, "pid": None})

    async def start(self, request: CaptureStartRequest) -> CaptureStatus:
        async with self._lock:
            if self.process and self.process.returncode is None:
                raise RuntimeError("capture is already running")
            script = self.settings.capture_script.expanduser().resolve()
            if not script.is_file():
                raise RuntimeError(f"capture script not found: {script}")

            source = self.settings.ir_rtsp_url if request.stream_mode == "ir_raw" else self.settings.visible_rtsp_url
            if not source:
                raise RuntimeError(f"{request.stream_mode} source is not configured")

            scene = self.slug_scene(request.scene)
            date_tag = datetime.now().astimezone().date().isoformat()
            group = f"{scene}_{date_tag}"
            output_dir = (self.settings.capture_output_root / "images" / group).resolve()
            manifest_path = (self.settings.capture_output_root / "manifests" / f"{group}.csv").resolve()
            root = self.settings.capture_output_root.expanduser().resolve()
            if root not in output_dir.parents or root not in manifest_path.parents:
                raise RuntimeError("capture paths must stay inside capture_output_root")
            output_dir.mkdir(parents=True, exist_ok=True)
            manifest_path.parent.mkdir(parents=True, exist_ok=True)

            command = [
                self.settings.capture_python_bin or self.settings.python_bin,
                str(script),
                "--source",
                source,
                "--output",
                str(output_dir),
                "--manifest",
                str(manifest_path),
                "--interval",
                str(request.interval_seconds),
                "--scene",
                scene,
                "--note",
                request.note,
                "--jpeg-quality",
                str(request.jpeg_quality),
            ]
            if request.duration_seconds:
                command.extend(["--duration", str(request.duration_seconds)])
            if request.max_frames:
                command.extend(["--max-frames", str(request.max_frames)])

            self.process = await asyncio.create_subprocess_exec(
                *command,
                cwd=str(self.settings.capture_workdir),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env={**os.environ, "PYTHONUNBUFFERED": "1"},
                start_new_session=True,
            )
            self._latest_frame = None
            self._status = CaptureStatus(
                running=True,
                stream_mode=request.stream_mode,
                scene=scene,
                note=request.note,
                interval_seconds=request.interval_seconds,
                duration_seconds=request.duration_seconds,
                max_frames=request.max_frames,
                started_at=datetime.now().astimezone().isoformat(timespec="seconds"),
                pid=self.process.pid,
                output_dir=str(output_dir),
                manifest_path=str(manifest_path),
                command=command,
            )
            self._stdout_task = asyncio.create_task(self._read_stdout(self.process.stdout))
            self._stderr_task = asyncio.create_task(self._read_stderr(self.process.stderr))
            self._wait_task = asyncio.create_task(self._wait_for_exit())
            self.log_buffer.add("capture", "info", f"capture started scene={scene} mode={request.stream_mode}")
            return self.status()

    async def stop(self) -> CaptureStatus:
        async with self._lock:
            if not self.process or self.process.returncode is not None:
                return self.status()
            process = self.process
            with suppress(ProcessLookupError):
                process.send_signal(signal.SIGINT)
            try:
                await asyncio.wait_for(process.wait(), timeout=8)
            except asyncio.TimeoutError:
                with suppress(ProcessLookupError):
                    process.terminate()
                try:
                    await asyncio.wait_for(process.wait(), timeout=4)
                except asyncio.TimeoutError:
                    with suppress(ProcessLookupError):
                        process.kill()
                    await process.wait()
            return self.status()
