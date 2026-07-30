from __future__ import annotations

import asyncio
import csv
import os
import re
import shutil
import signal
import time
from contextlib import suppress
from datetime import datetime
from pathlib import Path

from .config import AgentSettings
from .logs import LogBuffer
from .schemas import CaptureFrameItem, CaptureGalleryItem, CaptureStartRequest, CaptureStatus


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

    def _storage_free_gb(self) -> float | None:
        path = self.settings.capture_output_root.expanduser().resolve()
        while not path.exists() and path != path.parent:
            path = path.parent
        try:
            return round(shutil.disk_usage(path).free / (1024**3), 2)
        except OSError:
            return None

    def _elapsed_seconds(self) -> float:
        if not self._status.started_at:
            return 0.0
        try:
            started_at = datetime.fromisoformat(self._status.started_at)
            return max(0.0, (datetime.now().astimezone() - started_at).total_seconds())
        except ValueError:
            return 0.0

    @staticmethod
    def slug_scene(scene: str) -> str:
        value = re.sub(r"[^0-9A-Za-z\u4e00-\u9fff_-]+", "_", scene.strip())
        value = value.strip("._-")
        if not value:
            raise ValueError("scene must contain letters, numbers, Chinese characters, '_' or '-'")
        return value[:64]

    @staticmethod
    def validate_group(group: str) -> str:
        if not re.fullmatch(r"[0-9A-Za-z\u4e00-\u9fff_-]{1,160}", group):
            raise ValueError("invalid capture group")
        return group

    def status(self) -> CaptureStatus:
        running = bool(self.process and self.process.returncode is None)
        latest = str(self._latest_frame) if self._latest_frame and self._latest_frame.is_file() else None
        phase = self._status.phase
        if running:
            phase = "recording" if self._status.ready else "starting"
        return self._status.model_copy(
            update={
                "running": running,
                "phase": phase,
                "pid": self.process.pid if running and self.process else None,
                "latest_frame": latest,
                "elapsed_seconds": self._elapsed_seconds(),
                "storage_free_gb": self._storage_free_gb(),
            }
        )

    def latest_frame_path(self) -> Path | None:
        if self._latest_frame and self._latest_frame.is_file():
            return self._latest_frame
        return None

    @staticmethod
    def _stream_mode(source: str) -> str:
        value = source.lower()
        if "video2" in value or "infrared" in value or "ir_raw" in value:
            return "ir_raw"
        if "video1" in value or "visible" in value:
            return "visible_raw"
        return "unknown"

    @staticmethod
    def _is_transient_decoder_warning(line: str) -> bool:
        return bool(re.search(r"(?:hevc|h264).*Could not find ref with POC|Could not find ref with POC", line, re.IGNORECASE))

    @staticmethod
    def _manifest_frame_path(root: Path, group: str, raw_path: str) -> Path | None:
        expected_directory = (root / "images" / group).resolve()
        frame_path = Path(raw_path).expanduser().resolve()
        if expected_directory not in frame_path.parents or not frame_path.is_file():
            return None
        return frame_path

    def list_gallery(self, page: int = 1, page_size: int = 20) -> list[CaptureGalleryItem]:
        """Read completed capture sessions without exposing absolute filesystem paths."""
        if page < 1 or page_size < 1:
            raise ValueError("page and page_size must be positive")
        manifest_root = (self.settings.capture_output_root.expanduser().resolve() / "manifests").resolve()
        root = self.settings.capture_output_root.expanduser().resolve()
        if root not in manifest_root.parents:
            raise RuntimeError("capture manifest path must stay inside capture_output_root")

        items: list[CaptureGalleryItem] = []
        for manifest_path in sorted(manifest_root.glob("*.csv"), key=lambda path: path.stat().st_mtime, reverse=True):
            try:
                group = self.validate_group(manifest_path.stem)
            except ValueError:
                self.log_buffer.add("capture", "warning", f"skip invalid manifest name {manifest_path.name}")
                continue
            rows: list[dict[str, str]] = []
            try:
                with manifest_path.open("r", newline="", encoding="utf-8") as handle:
                    rows = [row for row in csv.DictReader(handle) if row.get("frame_path")]
            except (OSError, UnicodeError, csv.Error) as exc:
                self.log_buffer.add("capture", "warning", f"skip invalid manifest {manifest_path.name}: {exc}")
                continue
            if not rows:
                continue

            timestamps: list[str] = []
            latest_frame_name: str | None = None
            latest_timestamp = ""
            stream_modes: set[str] = set()
            valid_frames = 0
            total_size_bytes = 0
            for row in rows:
                source = row.get("source", "")
                stream_modes.add(self._stream_mode(source))
                frame_path = self._manifest_frame_path(root, group, row["frame_path"])
                if frame_path is None:
                    continue
                valid_frames += 1
                total_size_bytes += frame_path.stat().st_size
                captured_at = row.get("captured_at", "").strip()
                if captured_at:
                    timestamps.append(captured_at)
                if not latest_frame_name or captured_at >= latest_timestamp:
                    latest_frame_name = frame_path.name
                    latest_timestamp = captured_at

            timestamps.sort()
            missing_frames = len(rows) - valid_frames
            scene = next((row.get("scene", "").strip() for row in rows if row.get("scene", "").strip()), manifest_path.stem)
            modes = stream_modes - {"unknown"}
            stream_mode = next(iter(modes)) if len(modes) == 1 else "unknown"
            items.append(
                CaptureGalleryItem(
                    group=group,
                    scene=scene,
                    stream_mode=stream_mode,
                    frames_saved=valid_frames,
                    manifest_frames=len(rows),
                    missing_frames=missing_frames,
                    total_size_bytes=total_size_bytes,
                    integrity_ok=missing_frames == 0,
                    first_captured_at=timestamps[0] if timestamps else None,
                    last_captured_at=timestamps[-1] if timestamps else None,
                    note=next((row.get("note", "").strip() for row in rows if row.get("note", "").strip()), ""),
                    manifest_name=manifest_path.name,
                    latest_frame_name=latest_frame_name,
                )
            )

        items.sort(key=lambda item: item.last_captured_at or "", reverse=True)
        start = (page - 1) * page_size
        return items[start : start + page_size]

    def gallery_latest_frame_path(self, group: str) -> Path | None:
        group = self.validate_group(group)
        root = self.settings.capture_output_root.expanduser().resolve()
        manifest_path = root / "manifests" / f"{group}.csv"
        if not manifest_path.is_file():
            return None
        try:
            with manifest_path.open("r", newline="", encoding="utf-8") as handle:
                rows = [row for row in csv.DictReader(handle) if row.get("frame_path")]
        except (OSError, UnicodeError, csv.Error) as exc:
            raise RuntimeError(f"unable to read capture manifest: {manifest_path.name}") from exc

        candidates: list[tuple[str, Path]] = []
        for row in rows:
            frame_path = self._manifest_frame_path(root, group, row["frame_path"])
            if frame_path is not None:
                candidates.append((row.get("captured_at", ""), frame_path))
        if not candidates:
            return None
        return max(candidates, key=lambda item: item[0])[1]

    def gallery_frames(self, group: str) -> list[CaptureFrameItem]:
        """Return the readable frames in one manifest, in capture order."""
        group = self.validate_group(group)
        root = self.settings.capture_output_root.expanduser().resolve()
        manifest_path = root / "manifests" / f"{group}.csv"
        if not manifest_path.is_file():
            return []
        try:
            with manifest_path.open("r", newline="", encoding="utf-8") as handle:
                rows = [row for row in csv.DictReader(handle) if row.get("frame_path")]
        except (OSError, UnicodeError, csv.Error) as exc:
            raise RuntimeError(f"unable to read capture manifest: {manifest_path.name}") from exc

        frames: list[CaptureFrameItem] = []
        for row in rows:
            frame_path = self._manifest_frame_path(root, group, row["frame_path"])
            if frame_path is None:
                continue
            frames.append(
                CaptureFrameItem(
                    name=frame_path.name,
                    captured_at=row.get("captured_at", "") or None,
                    stream_mode=self._stream_mode(row.get("source", "")),
                    size_bytes=frame_path.stat().st_size,
                )
            )
        return frames

    def gallery_frame_path(self, group: str, frame_name: str) -> Path | None:
        group = self.validate_group(group)
        if not re.fullmatch(r"[0-9A-Za-z\u4e00-\u9fff_.-]{1,200}", frame_name):
            raise ValueError("invalid capture frame")
        root = self.settings.capture_output_root.expanduser().resolve()
        manifest_path = root / "manifests" / f"{group}.csv"
        if not manifest_path.is_file():
            return None
        try:
            with manifest_path.open("r", newline="", encoding="utf-8") as handle:
                rows = [row for row in csv.DictReader(handle) if row.get("frame_path")]
        except (OSError, UnicodeError, csv.Error) as exc:
            raise RuntimeError(f"unable to read capture manifest: {manifest_path.name}") from exc
        for row in rows:
            frame_path = self._manifest_frame_path(root, group, row["frame_path"])
            if frame_path is not None and frame_path.name == frame_name:
                return frame_path
        return None

    def delete_gallery(self, group: str) -> dict[str, object]:
        group = self.validate_group(group)
        root = self.settings.capture_output_root.expanduser().resolve()
        manifest_path = (root / "manifests" / f"{group}.csv").resolve()
        image_directory = (root / "images" / group).resolve()
        if root not in manifest_path.parents or root not in image_directory.parents:
            raise RuntimeError("capture paths must stay inside capture_output_root")
        if not manifest_path.is_file():
            raise FileNotFoundError(group)
        if self.process and self.process.returncode is None and Path(self._status.manifest_path).stem == group:
            raise RuntimeError("cannot delete an active capture group")

        frames_deleted = sum(1 for path in image_directory.rglob("*") if path.is_file()) if image_directory.is_dir() else 0
        if image_directory.is_dir():
            shutil.rmtree(image_directory)
        manifest_path.unlink()
        self.log_buffer.add("capture", "info", f"deleted capture group '{group}' frames={frames_deleted}")
        return {"status": "deleted", "group": group, "frames_deleted": frames_deleted}

    async def _read_stdout(self, stream: asyncio.StreamReader | None) -> None:
        if stream is None:
            return
        async for raw in stream:
            line = raw.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            self._status = self._status.model_copy(update={"last_line": line})
            ready_match = re.match(r"stream ready:\s*(\d+)x(\d+)", line)
            if ready_match:
                self._status = self._status.model_copy(
                    update={
                        "frame_width": int(ready_match.group(1)),
                        "frame_height": int(ready_match.group(2)),
                    }
                )
            match = re.match(r"saved\s+(\d+):\s+(.+)$", line)
            if match:
                path = Path(match.group(2).strip()).resolve()
                output_dir = Path(self._status.output_dir).resolve() if self._status.output_dir else None
                if not (
                    output_dir
                    and output_dir == path.parent
                    and path.suffix.lower() == ".jpg"
                    and path.is_file()
                ):
                    self.log_buffer.add("capture", "warning", f"ignored invalid saved-frame path: {path}")
                    continue
                self._latest_frame = path
                captured_at = datetime.now().astimezone().isoformat(timespec="seconds")
                frame_size = path.stat().st_size
                self._status = self._status.model_copy(
                    update={
                        "running": True,
                        "phase": "recording",
                        "ready": True,
                        "frames_saved": int(match.group(1)),
                        "first_frame_at": self._status.first_frame_at or captured_at,
                        "last_frame_at": captured_at,
                        "bytes_saved": self._status.bytes_saved + frame_size,
                        "last_error": None,
                    }
                )
            self.log_buffer.add("capture", "info", line)

    async def _read_stderr(self, stream: asyncio.StreamReader | None) -> None:
        if stream is None:
            return
        async for raw in stream:
            line = raw.decode("utf-8", errors="replace").strip()
            if line:
                if self._is_transient_decoder_warning(line):
                    self._status = self._status.model_copy(
                        update={
                            "last_line": line,
                            "decoder_warnings": self._status.decoder_warnings + 1,
                        }
                    )
                    self.log_buffer.add("capture", "warning", line)
                    continue
                self._status = self._status.model_copy(update={"last_error": line, "last_line": line})
                self.log_buffer.add("capture", "error", line)

    async def _wait_for_exit(self, process: asyncio.subprocess.Process) -> None:
        code = await process.wait()
        last_error = self._status.last_error
        phase = "completed" if code == 0 and self._status.frames_saved > 0 else "failed"
        if phase == "failed" and not last_error:
            last_error = f"capture process exited with code {code}" if code != 0 else "capture produced no valid frames"
        self.log_buffer.add("capture", "info", f"capture process exited with code {code}")
        if self.process is process:
            self.process = None
            self._status = self._status.model_copy(
                update={
                    "running": False,
                    "phase": phase,
                    "ready": self._status.frames_saved > 0,
                    "pid": None,
                    "last_error": last_error,
                }
            )

    def _cleanup_empty_session(self, output_dir: Path, manifest_path: Path) -> None:
        if self._status.frames_saved > 0:
            return
        with suppress(OSError):
            manifest_path.unlink()
        with suppress(OSError):
            if output_dir.is_dir() and not any(output_dir.iterdir()):
                output_dir.rmdir()

    async def start(self, request: CaptureStartRequest) -> CaptureStatus:
        async with self._lock:
            if self.process and self.process.returncode is None:
                raise RuntimeError("capture is already running")
            if self._wait_task and not self._wait_task.done():
                await self._wait_task
            script = self.settings.capture_script.expanduser().resolve()
            if not script.is_file():
                raise RuntimeError(f"capture script not found: {script}")

            source = self.settings.ir_rtsp_url if request.stream_mode == "ir_raw" else self.settings.visible_rtsp_url
            if not source:
                raise RuntimeError(f"{request.stream_mode} source is not configured")

            scene = self.slug_scene(request.scene)
            session_tag = datetime.now().astimezone().strftime("%Y-%m-%d_%H%M%S_%f")[:-3]
            group = f"{scene}_{session_tag}"
            output_dir = (self.settings.capture_output_root / "images" / group).resolve()
            manifest_path = (self.settings.capture_output_root / "manifests" / f"{group}.csv").resolve()
            root = self.settings.capture_output_root.expanduser().resolve()
            if root not in output_dir.parents or root not in manifest_path.parents:
                raise RuntimeError("capture paths must stay inside capture_output_root")
            root.mkdir(parents=True, exist_ok=True)
            free_gb = self._storage_free_gb()
            if free_gb is None:
                raise RuntimeError("capture storage is unavailable")
            if free_gb < self.settings.capture_min_free_gb:
                raise RuntimeError(
                    f"capture storage is low: {free_gb:.1f} GiB free; "
                    f"{self.settings.capture_min_free_gb:.1f} GiB required"
                )
            output_dir.mkdir(parents=True, exist_ok=False)
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
                "--warmup-seconds",
                str(self.settings.capture_warmup_seconds),
                "--warmup-valid-frames",
                str(self.settings.capture_warmup_valid_frames),
                "--rtsp-transport",
                self.settings.capture_rtsp_transport,
                "--scene",
                scene,
                "--note",
                request.note,
                "--jpeg-quality",
                str(request.jpeg_quality),
                "--min-free-gb",
                str(self.settings.capture_min_free_gb),
            ]
            if request.duration_seconds:
                command.extend(["--duration", str(request.duration_seconds)])
            if request.max_frames:
                command.extend(["--max-frames", str(request.max_frames)])

            try:
                process = await asyncio.create_subprocess_exec(
                    *command,
                    cwd=str(self.settings.capture_workdir),
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    env={**os.environ, "PYTHONUNBUFFERED": "1"},
                    start_new_session=True,
                )
            except OSError as exc:
                self._cleanup_empty_session(output_dir, manifest_path)
                raise RuntimeError(f"unable to launch capture process: {exc}") from exc
            self.process = process
            self._latest_frame = None
            self._status = CaptureStatus(
                running=True,
                phase="starting",
                ready=False,
                stream_mode=request.stream_mode,
                scene=scene,
                note=request.note,
                interval_seconds=request.interval_seconds,
                duration_seconds=request.duration_seconds,
                max_frames=request.max_frames,
                started_at=datetime.now().astimezone().isoformat(timespec="seconds"),
                pid=process.pid,
                output_dir=str(output_dir),
                manifest_path=str(manifest_path),
                storage_free_gb=free_gb,
                command=command,
            )
            self._stdout_task = asyncio.create_task(self._read_stdout(process.stdout))
            self._stderr_task = asyncio.create_task(self._read_stderr(process.stderr))
            self._wait_task = asyncio.create_task(self._wait_for_exit(process))
            self.log_buffer.add("capture", "info", f"capture preparing scene={scene} mode={request.stream_mode}")

            deadline = time.monotonic() + self.settings.capture_ready_timeout_seconds
            while time.monotonic() < deadline:
                if self._status.ready:
                    self.log_buffer.add("capture", "info", f"capture ready scene={scene} mode={request.stream_mode}")
                    return self.status()
                if process.returncode is not None or self.process is None:
                    break
                await asyncio.sleep(0.1)

            failure = self._status.last_error or (
                f"capture did not produce a valid frame within "
                f"{self.settings.capture_ready_timeout_seconds:.0f}s"
            )
            if process.returncode is None:
                with suppress(ProcessLookupError):
                    process.send_signal(signal.SIGINT)
                try:
                    await asyncio.wait_for(process.wait(), timeout=3)
                except asyncio.TimeoutError:
                    with suppress(ProcessLookupError):
                        process.kill()
                    await process.wait()
            self._status = self._status.model_copy(
                update={"running": False, "phase": "failed", "ready": False, "last_error": failure}
            )
            self._cleanup_empty_session(output_dir, manifest_path)
            raise RuntimeError(failure)

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
            await asyncio.sleep(0)
            return self.status()
