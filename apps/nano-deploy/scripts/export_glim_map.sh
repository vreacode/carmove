#!/usr/bin/env bash
set -euo pipefail

# Export an optimized GLIM dump as a standard PLY point cloud.  The GLIM
# offline viewer currently keeps its GUI process alive after writing the file,
# so this wrapper detects a stable PLY and then terminates the process group.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
GLIM_SETUP="${ROOT_DIR}/config/outdoor/glim_local_setup.bash"
GLIM_OVERLAY_SETUP="${GLIM_OVERLAY_SETUP:-/home/nvidia/glim_ws/overlay_install/setup.bash}"
GLIM_CONFIG="${GLIM_CONFIG:-${ROOT_DIR}/config/outdoor/glim}"
EXPORT_TIMEOUT="${GLIM_EXPORT_TIMEOUT:-120}"

usage() {
  echo "Usage: $0 <glim_map_directory> [output.ply]" >&2
}

[[ $# -ge 1 && $# -le 2 ]] || {
  usage
  exit 2
}

MAP_DIR="$(realpath "$1")"
OUTPUT_PATH="${2:-$(dirname "${MAP_DIR}")/optimized_map.ply}"
OUTPUT_PATH="$(realpath -m "${OUTPUT_PATH}")"
LOG_PATH="${OUTPUT_PATH%.ply}.export.log"

[[ -s "${MAP_DIR}/graph.bin" || -s "${MAP_DIR}/traj_lidar.txt" ]] || {
  echo "Not a GLIM map dump: ${MAP_DIR}" >&2
  exit 1
}
[[ "${OUTPUT_PATH}" == *.ply ]] || {
  echo "Output path must end in .ply: ${OUTPUT_PATH}" >&2
  exit 1
}
[[ ! -e "${OUTPUT_PATH}" ]] || {
  echo "Refusing to overwrite existing output: ${OUTPUT_PATH}" >&2
  exit 1
}
[[ -f "${GLIM_OVERLAY_SETUP}" ]] || {
  echo "GLIM export overlay is missing: ${GLIM_OVERLAY_SETUP}" >&2
  exit 1
}

set +u
source /opt/ros/humble/setup.bash
source "${GLIM_SETUP}"
source "${GLIM_OVERLAY_SETUP}"
set -u

offline_help="$(ros2 run glim_ros offline_viewer --help 2>&1 || true)"
if ! grep -q -- '--export_path' <<<"${offline_help}"; then
  echo "The active GLIM offline viewer does not support --export_path." >&2
  exit 1
fi

mkdir -p "$(dirname "${OUTPUT_PATH}")"
export DISPLAY="${DISPLAY:-:0}"
viewer_temp="$(mktemp -d)"
(
  cd "${viewer_temp}"
  exec setsid ros2 run glim_ros offline_viewer \
    --map_path "${MAP_DIR}" \
    --config_path "${GLIM_CONFIG}" \
    --export_path "${OUTPUT_PATH}" \
    >"${LOG_PATH}" 2>&1
) &
export_pid=$!

cleanup() {
  if [[ -r "/proc/${export_pid}/cmdline" ]]; then
    kill -INT -- "-${export_pid}" 2>/dev/null || kill -INT "${export_pid}" 2>/dev/null || true
    for _ in {1..20}; do
      [[ -r "/proc/${export_pid}/cmdline" ]] || break
      sleep 0.1
    done
    [[ ! -r "/proc/${export_pid}/cmdline" ]] ||
      kill -TERM -- "-${export_pid}" 2>/dev/null || true
  fi
  wait "${export_pid}" 2>/dev/null || true
  rm -f "${viewer_temp}/imgui.ini"
  rmdir "${viewer_temp}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

deadline=$((SECONDS + EXPORT_TIMEOUT))
last_size=-1
stable_checks=0
while ((SECONDS < deadline)); do
  if [[ -s "${OUTPUT_PATH}" ]]; then
    current_size="$(stat -c '%s' "${OUTPUT_PATH}")"
    if [[ "${current_size}" == "${last_size}" ]]; then
      stable_checks=$((stable_checks + 1))
    else
      stable_checks=0
      last_size="${current_size}"
    fi
    if ((stable_checks >= 2)); then
      break
    fi
  elif [[ ! -r "/proc/${export_pid}/cmdline" ]]; then
    echo "GLIM exporter exited before producing a point cloud. See ${LOG_PATH}" >&2
    exit 1
  fi
  sleep 1
done

[[ -s "${OUTPUT_PATH}" ]] || {
  echo "Timed out waiting for GLIM export. See ${LOG_PATH}" >&2
  exit 1
}
head -c 3 "${OUTPUT_PATH}" | grep -q '^ply$' || {
  echo "Exported file is not a PLY point cloud: ${OUTPUT_PATH}" >&2
  exit 1
}

cleanup
trap - EXIT INT TERM
echo "GLIM point cloud exported: ${OUTPUT_PATH} ($(stat -c '%s' "${OUTPUT_PATH}") bytes)"
echo "Log: ${LOG_PATH}"
