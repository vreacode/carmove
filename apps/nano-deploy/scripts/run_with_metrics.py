#!/usr/bin/env python3
"""Run a command while sampling aggregate CPU and RSS for its process tree."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

import psutil


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command
    if command and command[0] == "--":
        command = command[1:]
    if not command:
        parser.error("a command is required after --")

    args.json.parent.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)

    started = time.monotonic()
    max_rss = 0
    max_user = 0.0
    max_system = 0.0
    forwarded_signal: int | None = None

    with args.output.open("w", encoding="utf-8") as output:
        child = subprocess.Popen(
            command,
            stdout=output,
            stderr=subprocess.STDOUT,
            start_new_session=True,
            text=True,
        )
        root = psutil.Process(child.pid)

        def forward(signum: int, _frame: object) -> None:
            nonlocal forwarded_signal
            forwarded_signal = signum
            try:
                os.killpg(child.pid, signum)
            except ProcessLookupError:
                pass

        signal.signal(signal.SIGINT, forward)
        signal.signal(signal.SIGTERM, forward)

        while child.poll() is None:
            try:
                processes = [root, *root.children(recursive=True)]
            except psutil.Error:
                processes = []
            rss = 0
            user = 0.0
            system = 0.0
            for process in processes:
                try:
                    rss += process.memory_info().rss
                    cpu = process.cpu_times()
                    user += cpu.user
                    system += cpu.system
                except psutil.Error:
                    continue
            max_rss = max(max_rss, rss)
            max_user = max(max_user, user)
            max_system = max(max_system, system)
            time.sleep(0.2)

        return_code = child.wait()

    elapsed = time.monotonic() - started
    metrics = {
        "command": command,
        "exit_code": return_code,
        "forwarded_signal": forwarded_signal,
        "wall_time_s": elapsed,
        "max_aggregate_rss_kib": max_rss / 1024.0,
        "sampled_user_cpu_s": max_user,
        "sampled_system_cpu_s": max_system,
    }
    args.json.write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    args.report.write_text(
        "\n".join(
            [
                f"Command: {' '.join(command)}",
                f"Exit status: {return_code}",
                f"Wall time (seconds): {elapsed:.3f}",
                f"Maximum aggregate RSS (KiB): {max_rss / 1024.0:.0f}",
                f"Sampled user CPU (seconds): {max_user:.3f}",
                f"Sampled system CPU (seconds): {max_system:.3f}",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    if return_code < 0:
        sys.exit(128 + abs(return_code))
    sys.exit(return_code)


if __name__ == "__main__":
    main()
