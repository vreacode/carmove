#!/usr/bin/env python3
"""Capture sparse RTSP frames for local roadside dataset construction.

This tool only reads a video stream and writes image files plus a CSV manifest.
It never starts ROS nodes and never sends vehicle-control commands.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import sys
import time
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, help="RTSP URL, camera index, or video file")
    parser.add_argument(
        "--output",
        default="datasets/local/roadside_v1/images",
        help="directory for captured frames",
    )
    parser.add_argument(
        "--manifest",
        default="",
        help="CSV path; defaults to dataset root/manifest.csv",
    )
    parser.add_argument("--interval", type=float, default=1.0, help="seconds between saved frames")
    parser.add_argument("--max-frames", type=int, default=0, help="0 means run until Ctrl+C")
    parser.add_argument("--jpeg-quality", type=int, default=95, help="JPEG quality 1-100")
    parser.add_argument("--scene", default="", help="scene identifier, for example gate_a_day")
    parser.add_argument("--note", default="", help="free-form capture note")
    parser.add_argument("--preview", action="store_true", help="show preview; press q to stop")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        import cv2
    except ImportError:
        print("OpenCV is required in the active environment.", file=sys.stderr)
        return 2

    if args.interval <= 0:
        print("--interval must be greater than zero", file=sys.stderr)
        return 2
    if not 1 <= args.jpeg_quality <= 100:
        print("--jpeg-quality must be between 1 and 100", file=sys.stderr)
        return 2

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = Path(args.manifest) if args.manifest else output_dir.parent / "manifest.csv"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_exists = manifest_path.exists() and manifest_path.stat().st_size > 0

    source: int | str
    source = int(args.source) if args.source.isdigit() else args.source
    capture = cv2.VideoCapture(source)
    if not capture.isOpened():
        print(f"Unable to open video source: {args.source}", file=sys.stderr)
        return 1

    saved = 0
    next_save_at = 0.0
    writer = manifest_path.open("a", newline="", encoding="utf-8")
    manifest = csv.writer(writer)
    if not manifest_exists:
        manifest.writerow(["frame_path", "captured_at", "scene", "source", "note"])

    print(f"capturing from {args.source}")
    print(f"frames: {output_dir}")
    print(f"manifest: {manifest_path}")
    print("stop with Ctrl+C" + (" or q in the preview window" if args.preview else ""))

    try:
        while args.max_frames <= 0 or saved < args.max_frames:
            ok, frame = capture.read()
            if not ok:
                print("stream read failed; stopping", file=sys.stderr)
                break

            now = time.monotonic()
            if now < next_save_at:
                if args.preview:
                    cv2.imshow("RTSP capture", frame)
                    if cv2.waitKey(1) & 0xFF == ord("q"):
                        break
                continue

            captured_at = dt.datetime.now().astimezone()
            filename = captured_at.strftime("%Y%m%d_%H%M%S_%f")[:-3] + ".jpg"
            frame_path = output_dir / filename
            ok = cv2.imwrite(
                str(frame_path),
                frame,
                [int(cv2.IMWRITE_JPEG_QUALITY), args.jpeg_quality],
            )
            if not ok:
                print(f"failed to write {frame_path}", file=sys.stderr)
                break

            manifest.writerow(
                [
                    str(frame_path),
                    captured_at.isoformat(timespec="seconds"),
                    args.scene,
                    args.source,
                    args.note,
                ]
            )
            writer.flush()
            saved += 1
            next_save_at = now + args.interval
            print(f"saved {saved}: {frame_path}")

            if args.preview:
                cv2.imshow("RTSP capture", frame)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break
    except KeyboardInterrupt:
        print("\ninterrupted by user")
    finally:
        capture.release()
        writer.close()
        if args.preview:
            cv2.destroyAllWindows()

    print(f"capture complete: {saved} frame(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
