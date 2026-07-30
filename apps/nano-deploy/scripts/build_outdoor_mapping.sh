#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
FASTLIO_WS="${FASTLIO_WS:-/home/nvidia/fastlio2_ws}"
FASTLIO_SOURCE="${FASTLIO_SOURCE:-${FASTLIO_WS}/src/FAST_LIO}"
ADAPTER_SOURCE="${HESAI_FASTLIO_ADAPTER_SOURCE:-${ROOT_DIR}/../../ros2/fastlio2/hesai_fastlio_adapter}"
if [[ ! -f "${ADAPTER_SOURCE}/package.xml" ]] &&
  [[ -f /home/nvidia/carmove/ros2/fastlio2/hesai_fastlio_adapter/package.xml ]]
then
  ADAPTER_SOURCE="/home/nvidia/carmove/ros2/fastlio2/hesai_fastlio_adapter"
fi

[[ -d "${FASTLIO_SOURCE}" ]] || {
  echo "FAST-LIO2 source not found: ${FASTLIO_SOURCE}" >&2
  exit 1
}
[[ -f "${ADAPTER_SOURCE}/package.xml" ]] || {
  echo "Hesai adapter source not found: ${ADAPTER_SOURCE}" >&2
  exit 1
}

set +u
source /opt/ros/humble/setup.bash
set -u
mkdir -p "${FASTLIO_WS}"
cd "${FASTLIO_WS}"

packages=(hesai_fastlio_adapter)
if [[ ! -x "${FASTLIO_WS}/install/fast_lio/lib/fast_lio/fastlio_mapping" ]]; then
  packages+=(fast_lio)
fi

colcon build \
  --symlink-install \
  --base-paths "${FASTLIO_SOURCE}" "${ADAPTER_SOURCE}" \
  --packages-select "${packages[@]}" \
  --cmake-args -DCMAKE_BUILD_TYPE=Release

set +u
source "${FASTLIO_WS}/install/setup.bash"
set -u
ros2 pkg executables hesai_fastlio_adapter | grep -q 'hesai_fastlio_adapter_node'
[[ -x "${FASTLIO_WS}/install/fast_lio/lib/fast_lio/fastlio_mapping" ]] || {
  echo "FAST-LIO2 executable is still missing after build." >&2
  exit 1
}

echo "Outdoor mapping build ready."
echo "  FAST-LIO2: ${FASTLIO_WS}/install/fast_lio/lib/fast_lio/fastlio_mapping"
echo "  XT-16 adapter: ${FASTLIO_WS}/install/hesai_fastlio_adapter/lib/hesai_fastlio_adapter/hesai_fastlio_adapter_node"
