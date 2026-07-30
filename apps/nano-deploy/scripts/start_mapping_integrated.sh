#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/home/nvidia/Desktop/wheeltec_ros2/shijue/Nano_Deploy"
LOG_DIR="${ROOT_DIR}/dashboard_platform/runtime/logs"
PID_DIR="${ROOT_DIR}/dashboard_platform/runtime/pids"
PID_FILE="${PID_DIR}/mapping_integrated.pids"
LAUNCHER_PID_FILE="${PID_DIR}/mapping_integrated.launcher.pid"
SLAM_TOOLBOX_CONFIG="${ROOT_DIR}/config/navigation/slam_toolbox_mapping.yaml"
RUNTIME_SLAM_CONFIG="/tmp/slam_toolbox_mapping_runtime.yaml"
LIDAR_SCRIPT="${ROOT_DIR}/scripts/ensure_lidar_hesai_xt16.sh"
LIDAR_TOPIC="${LIDAR_POINT_TOPIC:-/lidar_points}"

mkdir -p "${LOG_DIR}" "${PID_DIR}"
exec >>"${LOG_DIR}/mapping_launcher.log" 2>&1
echo "[$(date '+%F %T')] start mapping launcher pid=$$"

cleanup() {
  if [[ -f "${PID_FILE}" ]]; then
    while IFS=: read -r _ pid; do
      [[ -n "${pid:-}" ]] || continue
      # Each component is launched in its own session so the ros2 wrapper and
      # the actual executable are stopped together.
      kill -INT -- "-${pid}" 2>/dev/null || kill -INT "${pid}" 2>/dev/null || true
      for _ in 1 2 3 4 5 6 7 8 9 10; do
        kill -0 -- "-${pid}" 2>/dev/null || break
        sleep 0.2
      done
      kill -TERM -- "-${pid}" 2>/dev/null || true
      sleep 0.3
      kill -KILL -- "-${pid}" 2>/dev/null || true
    done < "${PID_FILE}"
    rm -f "${PID_FILE}"
  fi
  rm -f "${LAUNCHER_PID_FILE}"
}

stop_launcher() {
  [[ -f "${LAUNCHER_PID_FILE}" ]] || return 0
  local pid cmdline
  pid="$(cat "${LAUNCHER_PID_FILE}" 2>/dev/null || true)"
  if [[ -n "${pid}" && "${pid}" != "$$" && -r "/proc/${pid}/cmdline" ]]; then
    cmdline="$(tr '\0' ' ' < "/proc/${pid}/cmdline" 2>/dev/null || true)"
    if [[ "${cmdline}" == *"start_mapping_integrated.sh"* ]]; then
      kill -TERM "${pid}" 2>/dev/null || true
    fi
  fi
  rm -f "${LAUNCHER_PID_FILE}"
}

run_cmd() {
  local name="$1"
  local cmd="$2"
  setsid bash -lc "${cmd}" >"${LOG_DIR}/${name}.log" 2>&1 &
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
  stop_launcher
  cleanup
  echo "Mapping processes stopped."
  exit 0
fi

cleanup
printf '%s\n' "$$" > "${LAUNCHER_PID_FILE}"
trap cleanup EXIT INT TERM

run_cmd "mapping_rviz" \
  "export DISPLAY='${DISPLAY:-:0}' && \
   export XAUTHORITY='${XAUTHORITY:-/home/nvidia/.Xauthority}' && \
   bash ${ROOT_DIR}/scripts/open_rviz.sh mapping"

"${LIDAR_SCRIPT}" start
wait_for_ready "wheeltec_robot" "source /opt/ros/humble/setup.bash && source /home/nvidia/Desktop/wheeltec_ros2/install/setup.bash && ROS2CLI_NO_DAEMON=1 ros2 node list | grep -q '^/wheeltec_robot$'" 12
wait_for_ready "/odom" "source /opt/ros/humble/setup.bash && source /home/nvidia/Desktop/wheeltec_ros2/install/setup.bash && ROS2CLI_NO_DAEMON=1 ros2 topic info /odom -v | grep -q 'Publisher count: 1'" 12
wait_for_ready "${LIDAR_TOPIC}" "source /opt/ros/humble/setup.bash && source /home/nvidia/ros2_ws/install/setup.bash && ROS2CLI_NO_DAEMON=1 ros2 topic info ${LIDAR_TOPIC} -v | grep -q 'Publisher count: [1-9]'" 25

sed 's/^    map_file_name:.*$/    map_file_name: ""/' "${SLAM_TOOLBOX_CONFIG}" > "${RUNTIME_SLAM_CONFIG}"

run_cmd "mapping_pcl2scan" \
  "source /opt/ros/humble/setup.bash && \
   source /home/nvidia/Desktop/wheeltec_ros2/install/setup.bash && \
   source /home/nvidia/fastlio2_ws/install/setup.bash && \
   ros2 run pointcloud_to_laserscan pointcloud_to_laserscan_node \
     --ros-args \
     --remap cloud_in:=${LIDAR_TOPIC} \
     --remap scan:=/scan \
     -p target_frame:=laser \
     -p angle_increment:=0.008726646259971648 \
     -p min_height:=-0.05 \
     -p max_height:=0.15 \
     -p range_min:=0.1 \
     -p range_max:=30.0 \
     -p scan_time:=0.1"

wait_for_ready "/scan" "source /opt/ros/humble/setup.bash && source /home/nvidia/Desktop/wheeltec_ros2/install/setup.bash && ROS2CLI_NO_DAEMON=1 ros2 topic info /scan -v | grep -q 'Publisher count: 1'" 25

run_cmd "slam_toolbox_integrated" \
  "source /opt/ros/humble/setup.bash && \
   source /home/nvidia/Desktop/wheeltec_ros2/install/setup.bash && \
   ros2 run slam_toolbox async_slam_toolbox_node \
     --ros-args --params-file ${RUNTIME_SLAM_CONFIG}"

wait
