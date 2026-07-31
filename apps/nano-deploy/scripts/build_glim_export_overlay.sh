#!/usr/bin/env bash
set -euo pipefail

# Build a CPU-only GLIM overlay used exclusively by offline map export.  Live
# GLIM mapping continues to use the pinned CUDA binary installation.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
GLIM_WORKSPACE="${GLIM_WORKSPACE:-/home/nvidia/glim_ws}"
GLIM_SOURCE="${GLIM_SOURCE:-${GLIM_WORKSPACE}/src/glim}"
GLIM_ROS_SOURCE="${GLIM_ROS_SOURCE:-${GLIM_WORKSPACE}/src/glim_ros2}"
LOCAL_ROOT="${GLIM_LOCAL_ROOT:-${GLIM_WORKSPACE}/local_root}"
BUILD_BASE="${GLIM_WORKSPACE}/overlay_build"
INSTALL_BASE="${GLIM_WORKSPACE}/overlay_install"
LOG_BASE="${GLIM_WORKSPACE}/overlay_log"
COMPAT_PATCH="${ROOT_DIR}/config/outdoor/glim_export_overlay.patch"
LOCAL_SETUP="${ROOT_DIR}/config/outdoor/glim_local_setup.bash"

[[ -f "${GLIM_SOURCE}/package.xml" ]] || {
  echo "GLIM source is missing: ${GLIM_SOURCE}" >&2
  exit 1
}
[[ -f "${GLIM_ROS_SOURCE}/package.xml" ]] || {
  echo "GLIM ROS source is missing: ${GLIM_ROS_SOURCE}" >&2
  exit 1
}
grep -q 'export_path' "${GLIM_ROS_SOURCE}/src/offline_viewer.cpp" || {
  echo "GLIM ROS source does not contain the offline export entry point." >&2
  exit 1
}

if git -C "${GLIM_SOURCE}" apply --check "${COMPAT_PATCH}" 2>/dev/null; then
  git -C "${GLIM_SOURCE}" apply "${COMPAT_PATCH}"
elif git -C "${GLIM_SOURCE}" apply --reverse --check "${COMPAT_PATCH}" 2>/dev/null; then
  echo "GLIM viewer compatibility patch is already applied."
else
  echo "GLIM source does not match the pinned compatibility patch." >&2
  exit 1
fi

python3 - "${LOCAL_ROOT}" <<'PY'
from pathlib import Path
import shutil
import sys

root = Path(sys.argv[1])
files = {
    root / "usr/local/lib/cmake/GTSAM/GTSAM-exports.cmake": [
        (
            "/usr/lib/aarch64-linux-gnu/libmetis.so;metis",
            "/usr/lib/aarch64-linux-gnu/libmetis.so.5",
        ),
        (
            "/usr/lib/aarch64-linux-gnu/libmetis.so.5;metis",
            "/usr/lib/aarch64-linux-gnu/libmetis.so.5",
        ),
    ],
    root / "usr/local/lib/cmake/iridescence/iridescence-targets.cmake": [
        (
            ";glfw;",
            f";{root}/usr/lib/aarch64-linux-gnu/libglfw.so.3;",
        )
    ],
}
for path, replacements in files.items():
    if not path.is_file():
        raise SystemExit(f"missing local dependency config: {path}")
    original = path.read_text(encoding="utf-8")
    updated = original
    for old, new in replacements:
        updated = updated.replace(old, new)
    if updated != original:
        backup = path.with_suffix(path.suffix + ".bak")
        if not backup.exists():
            shutil.copy2(path, backup)
        path.write_text(updated, encoding="utf-8")
PY

export CMAKE_BUILD_PARALLEL_LEVEL=1
export MAKEFLAGS=-j1
set +u
source /opt/ros/humble/setup.bash
source "${LOCAL_SETUP}"
set -u

colcon --log-base "${LOG_BASE}" build \
  --symlink-install \
  --base-paths "${GLIM_SOURCE}" \
  --packages-select glim \
  --build-base "${BUILD_BASE}" \
  --install-base "${INSTALL_BASE}" \
  --executor sequential \
  --cmake-args \
    -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_WITH_OPENCV=OFF \
    -DBUILD_WITH_VIEWER=ON \
    -DBUILD_WITH_CUDA=OFF

colcon --log-base "${LOG_BASE}" build \
  --symlink-install \
  --base-paths "${GLIM_ROS_SOURCE}" \
  --packages-select glim_ros \
  --build-base "${BUILD_BASE}" \
  --install-base "${INSTALL_BASE}" \
  --executor sequential \
  --cmake-force-configure \
  --cmake-args \
    -DCMAKE_BUILD_TYPE=Release \
    -Dglim_DIR="${INSTALL_BASE}/glim/share/glim" \
    -DBUILD_WITH_CV_BRIDGE=OFF \
    -DBUILD_WITH_VIEWER=ON \
    -DBUILD_WITH_CUDA=OFF

set +u
source "${INSTALL_BASE}/setup.bash"
set -u
offline_help="$(ros2 run glim_ros offline_viewer --help 2>&1 || true)"
grep -q -- '--export_path' <<<"${offline_help}"

echo "GLIM offline export overlay is ready: ${INSTALL_BASE}"
echo "Live CUDA mapping installation was not replaced."
