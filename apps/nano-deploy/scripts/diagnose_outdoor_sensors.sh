#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPORT_DIR="${ROOT_DIR}/dashboard_platform/runtime/diagnostics"
STAMP="$(date '+%Y%m%d_%H%M%S')"
REPORT="${REPORT_DIR}/outdoor_sensors_${STAMP}.log"

mkdir -p "${REPORT_DIR}"

ros_env() {
  set +u
  source /opt/ros/humble/setup.bash
  [[ -f /home/nvidia/ros2_ws/install/setup.bash ]] && source /home/nvidia/ros2_ws/install/setup.bash
  [[ -f /home/nvidia/serial-ros2/install/setup.bash ]] && source /home/nvidia/serial-ros2/install/setup.bash
  [[ -f "/home/nvidia/imu-driver/ROS2 SDK/yesense_ros2/install/setup.bash" ]] &&
    source "/home/nvidia/imu-driver/ROS2 SDK/yesense_ros2/install/setup.bash"
  [[ -f /home/nvidia/fastlio2_ws/install/setup.bash ]] && source /home/nvidia/fastlio2_ws/install/setup.bash
  set -u
}

section() {
  printf '\n[%s]\n' "$1"
}

{
  echo "CarMove outdoor sensor diagnostic"
  echo "timestamp=$(date --iso-8601=seconds)"
  echo "host=$(hostname)"

  ros_env

  section "devices"
  readlink -f /dev/wheeltec_IMU 2>/dev/null || echo "wheeltec_IMU=missing"
  readlink -f /dev/wheeltec_controller 2>/dev/null || echo "wheeltec_controller=missing"

  section "nodes"
  ros2 node list --no-daemon 2>&1 | sort

  section "topics"
  ros2 topic list -t --no-daemon 2>&1 | sort

  section "lidar_info"
  ros2 topic info /lidar_points -v --no-daemon 2>&1
  timeout 7 ros2 topic hz /lidar_points 2>&1 || true
  timeout 5 ros2 topic echo /lidar_points --once --field header 2>&1 || true
  timeout 5 ros2 topic echo /lidar_points --once --field fields 2>&1 || true

  section "imu_info"
  ros2 topic info /imu/data_raw -v --no-daemon 2>&1
  timeout 7 ros2 topic hz /imu/data_raw 2>&1 || true
  timeout 5 ros2 topic echo /imu/data_raw --once 2>&1 || true

  section "gnss_info"
  timeout 5 ros2 topic echo /nav_all --once 2>&1 || true

  section "adapter_info"
  ros2 topic info /lidar_points_fastlio -v --no-daemon 2>&1
  timeout 5 ros2 topic echo /lidar_points_fastlio --once --field fields 2>&1 || true

  section "lio_info"
  ros2 topic info /Odometry -v --no-daemon 2>&1
  timeout 5 ros2 topic echo /Odometry --once 2>&1 || true
} | tee "${REPORT}"

echo "Diagnostic report: ${REPORT}"
