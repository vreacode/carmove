#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/home/nvidia/Desktop/wheeltec_ros2/shijue/Nano_Deploy"
LOG_DIR="${ROOT_DIR}/dashboard_platform/runtime/logs"
PID_DIR="${ROOT_DIR}/dashboard_platform/runtime/pids"
PID_FILE="${PID_DIR}/mapping_integrated.pids"
SLAM_TOOLBOX_CONFIG="/home/nvidia/Desktop/wheeltec_ros2/config/slam_toolbox_balanced.yaml"
RUNTIME_SLAM_CONFIG="/tmp/slam_toolbox_balanced_runtime.yaml"

mkdir -p "${LOG_DIR}" "${PID_DIR}"

cleanup() {
  if [[ -f "${PID_FILE}" ]]; then
    while IFS=: read -r _ pid; do
      [[ -n "${pid:-}" ]] || continue
      kill -INT "${pid}" 2>/dev/null || true
    done < "${PID_FILE}"
    rm -f "${PID_FILE}"
  fi
}

run_cmd() {
  local name="$1"
  local cmd="$2"
  bash -lc "${cmd}" >"${LOG_DIR}/${name}.log" 2>&1 &
  local pid=$!
  echo "${name}:${pid}" >> "${PID_FILE}"
}

wait_for_ready() {
  local label="$1"
  local script="$2"
  local timeout_secs="$3"
  local deadline=$((SECONDS + timeout_secs))
  until bash -lc "${script}" >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then
      echo "${label} not ready" >&2
      return 1
    fi
    sleep 1
  done
}

if [[ "${1:-}" == "stop" ]]; then
  cleanup
  echo "Mapping processes stopped."
  exit 0
fi

cleanup

wait_for_ready "wheeltec_robot" "source /opt/ros/humble/setup.bash && source /home/nvidia/Desktop/wheeltec_ros2/install/setup.bash && ROS2CLI_NO_DAEMON=1 ros2 node list | grep -q '^/wheeltec_robot$'" 12
wait_for_ready "/odom" "source /opt/ros/humble/setup.bash && source /home/nvidia/Desktop/wheeltec_ros2/install/setup.bash && ROS2CLI_NO_DAEMON=1 ros2 topic info /odom -v | grep -q 'Publisher count: 1'" 12
wait_for_ready "/c16/lslidar_point_cloud" "source /opt/ros/humble/setup.bash && source /home/nvidia/fastlio2_ws/install/setup.bash && ROS2CLI_NO_DAEMON=1 ros2 topic info /c16/lslidar_point_cloud -v | grep -q 'Publisher count:'" 12

sed 's/^    map_file_name:.*$/    map_file_name: ""/' "${SLAM_TOOLBOX_CONFIG}" > "${RUNTIME_SLAM_CONFIG}"

run_cmd "mapping_pcl2scan" \
  "source /opt/ros/humble/setup.bash && \
   source /home/nvidia/Desktop/wheeltec_ros2/install/setup.bash && \
   source /home/nvidia/fastlio2_ws/install/setup.bash && \
   ros2 run pointcloud_to_laserscan pointcloud_to_laserscan_node \
     --ros-args \
     --remap cloud_in:=/c16/lslidar_point_cloud \
     --remap scan:=/scan \
     -p target_frame:=laser_link \
     -p min_height:=-0.15 \
     -p max_height:=0.20 \
     -p range_min:=0.1 \
     -p range_max:=30.0 \
     -p scan_time:=0.1"

wait_for_ready "/scan" "source /opt/ros/humble/setup.bash && source /home/nvidia/Desktop/wheeltec_ros2/install/setup.bash && ROS2CLI_NO_DAEMON=1 ros2 topic info /scan -v | grep -q 'Publisher count: 1'" 12

run_cmd "slam_toolbox_integrated" \
  "source /opt/ros/humble/setup.bash && \
   source /home/nvidia/Desktop/wheeltec_ros2/install/setup.bash && \
   ros2 run slam_toolbox sync_slam_toolbox_node \
     --ros-args --params-file ${RUNTIME_SLAM_CONFIG}"

trap cleanup INT TERM
wait
