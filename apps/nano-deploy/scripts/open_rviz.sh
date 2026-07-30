#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/home/nvidia/Desktop/wheeltec_ros2/shijue/Nano_Deploy"
DEFAULT_CONFIG="/opt/ros/humble/share/nav2_bringup/rviz/nav2_default_view.rviz"
MAPPING_CONFIG="${ROOT_DIR}/config/navigation/slam_mapping.rviz"
LIDAR_CONFIG="${ROOT_DIR}/config/navigation/hesai_xt16_lidar.rviz"
MODE="${1:-auto}"

# ROS 2 environment hooks legitimately probe optional, unset variables.
set +u
source /opt/ros/humble/setup.bash
set -u

# The normal Nav2 view expects /scan, /map and TF.  Before mapping starts,
# switch automatically to a sensor-only view so the XT-16 cloud is visible.
has_pub() {
  local topic="$1"
  ros2 topic info "${topic}" -v --no-daemon 2>/dev/null | grep -Eq 'Publisher count: [1-9][0-9]*'
}

if [[ "${MODE}" == "mapping" ]]; then
  CONFIG="${MAPPING_CONFIG}"
elif [[ "${MODE}" == "nav" ]]; then
  CONFIG="${DEFAULT_CONFIG}"
elif pgrep -f 'async_slam_toolbox_node' >/dev/null 2>&1; then
  CONFIG="${MAPPING_CONFIG}"
elif has_pub /scan && has_pub /map; then
  CONFIG="${DEFAULT_CONFIG}"
else
  CONFIG="${LIDAR_CONFIG}"
fi

if pgrep -f "rviz2 -d ${CONFIG}" >/dev/null 2>&1; then
  exit 0
fi
for other_config in "${DEFAULT_CONFIG}" "${MAPPING_CONFIG}" "${LIDAR_CONFIG}"; do
  [[ "${other_config}" == "${CONFIG}" ]] && continue
  pkill -TERM -f "rviz2 -d ${other_config}" 2>/dev/null || true
done
sleep 0.5

exec rviz2 -d "${CONFIG}"
