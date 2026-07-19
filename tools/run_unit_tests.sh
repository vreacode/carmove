#!/usr/bin/env bash
set -euo pipefail

# Run only the project's dependency-light tests. This intentionally avoids
# recursive discovery from apps/nano-deploy, which also imports optional model
# logger packages that are not required for the core tests.
PYTHON_BIN="${PYTHON_BIN:-python3}"

"$PYTHON_BIN" -m unittest discover -s apps/nano-deploy/camera -p 'test_*.py'
"$PYTHON_BIN" -m unittest discover -s apps/nano-deploy/vision -p 'test_*.py'
"$PYTHON_BIN" -m unittest tools.test_dataset_tools
"$PYTHON_BIN" -m unittest tools.test_capture_manifest
"$PYTHON_BIN" -m unittest tools.test_collect_rtsp_frames
(
  cd apps/nano-deploy
  "$PYTHON_BIN" -m unittest dashboard_platform.agent.test_motion
)
