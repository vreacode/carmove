#!/usr/bin/env bash
set -eo pipefail

# Build the official Hesai ROS2 driver already used by this deployment.
# The driver source is intentionally kept outside CarMove because it is a
# vendor SDK; this script only verifies/builds the local ROS2 workspace.

ROS_WS="${HESAI_ROS2_WS:-/home/nvidia/ros2_ws}"
PACKAGE="hesai_ros_driver"
SOURCE_DIR="${ROS_WS}/src/HesaiLidar_ROS_2.0-master"
INSTALL_PATCH="$(cd "$(dirname "${BASH_SOURCE[0]}")/../patches" && pwd)/hesai_ros_driver_install_libs.patch"

[[ -d "${SOURCE_DIR}" ]] || {
  echo "Hesai source not found under ${ROS_WS}/src/HesaiLidar_ROS_2.0-master" >&2
  echo "Clone the official HesaiLidar_ROS_2.0 repository there first." >&2
  exit 1
}

if ! sed -n '/^set(LIB_TARGETS/,/^    )/p' "${SOURCE_DIR}/CMakeLists.txt" | grep -q 'ptcClient_lib'; then
  [[ -f "${INSTALL_PATCH}" ]] || {
    echo "Missing reproducibility patch: ${INSTALL_PATCH}" >&2
    exit 1
  }
  patch -d "${SOURCE_DIR}" -p1 --forward < "${INSTALL_PATCH}"
fi

source /opt/ros/humble/setup.bash
cd "${ROS_WS}"
colcon build --base-paths src --packages-select "${PACKAGE}" --cmake-args -DCMAKE_BUILD_TYPE=Release

PREFIX="${ROS_WS}/install/${PACKAGE}"
BIN="${PREFIX}/lib/${PACKAGE}/${PACKAGE}_node"
[[ -x "${BIN}" ]] || { echo "Hesai driver build did not produce ${BIN}" >&2; exit 1; }

for library in libptcClient_lib.so libserialClient_lib.so libsource_lib.so libplatutils_lib.so; do
  [[ -f "${PREFIX}/lib/${library}" ]] || {
    echo "Missing installed Hesai dependency ${PREFIX}/lib/${library}." >&2
    echo "The vendor CMake file must include the SDK sub-libraries in its ROS2 install target." >&2
    exit 1
  }
done

echo "Hesai XT-16 driver ready: ${BIN}"
