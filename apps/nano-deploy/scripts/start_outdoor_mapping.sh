#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOG_DIR="${ROOT_DIR}/dashboard_platform/runtime/logs"
PID_DIR="${ROOT_DIR}/dashboard_platform/runtime/pids"
PID_FILE="${PID_DIR}/outdoor_mapping.pids"
LAUNCHER_PID_FILE="${PID_DIR}/outdoor_mapping.launcher.pid"
STATE_FILE="${ROOT_DIR}/dashboard_platform/runtime/outdoor_mapping.state"
CONFIG_FILE="${ROOT_DIR}/config/outdoor/fastlio_hesai_xt16.yaml"
RVIZ_CONFIG="${ROOT_DIR}/config/outdoor/fastlio_outdoor.rviz"
LIDAR_SCRIPT="${ROOT_DIR}/scripts/ensure_lidar_hesai_xt16.sh"
FASTLIO_SETUP="${FASTLIO_SETUP:-/home/nvidia/fastlio2_ws/install/setup.bash}"
OUTDOOR_MAP_DIR="${OUTDOOR_MAP_DIR:-/home/nvidia/Desktop/wheeltec_ros2/maps/outdoor}"
OUTDOOR_RVIZ_ENABLED="${OUTDOOR_RVIZ_ENABLED:-true}"

mkdir -p "${LOG_DIR}" "${PID_DIR}" "${OUTDOOR_MAP_DIR}"

ros_env() {
  set +u
  source /opt/ros/humble/setup.bash
  [[ -f /home/nvidia/ros2_ws/install/setup.bash ]] && source /home/nvidia/ros2_ws/install/setup.bash
  [[ -f /home/nvidia/serial-ros2/install/setup.bash ]] && source /home/nvidia/serial-ros2/install/setup.bash
  [[ -f "/home/nvidia/imu-driver/ROS2 SDK/yesense_ros2/install/setup.bash" ]] &&
    source "/home/nvidia/imu-driver/ROS2 SDK/yesense_ros2/install/setup.bash"
  source "${FASTLIO_SETUP}"
  set -u
}

read_state_value() {
  local key="$1"
  [[ -f "${STATE_FILE}" ]] || return 1
  sed -n "s/^${key}=//p" "${STATE_FILE}" | head -n 1
}

run_cmd() {
  local name="$1"
  local command="$2"
  setsid bash -lc "${command}" >"${LOG_DIR}/${name}.log" 2>&1 &
  local pid=$!
  echo "${name}:${pid}" >> "${PID_FILE}"
}

topic_has_publisher() {
  local topic="$1"
  local output
  output="$(
    ros_env
    ros2 topic info "${topic}" -v --no-daemon 2>/dev/null || true
  )"
  grep -Eq 'Publisher count: [1-9][0-9]*' <<<"${output}"
}

wait_for_topic() {
  local topic="$1"
  local timeout_secs="$2"
  local deadline=$((SECONDS + timeout_secs))
  until topic_has_publisher "${topic}"; do
    if (( SECONDS >= deadline )); then
      echo "${topic} did not become ready within ${timeout_secs}s" >&2
      return 1
    fi
    sleep 0.5
  done
}

cleanup_children() {
  if [[ -f "${PID_FILE}" ]]; then
    while IFS=: read -r _ pid; do
      [[ -n "${pid:-}" ]] || continue
      kill -INT -- "-${pid}" 2>/dev/null || kill -INT "${pid}" 2>/dev/null || true
      for _ in 1 2 3 4 5 6 7 8 9 10; do
        kill -0 -- "-${pid}" 2>/dev/null || break
        sleep 0.2
      done
      kill -TERM -- "-${pid}" 2>/dev/null || true
      sleep 0.2
      kill -KILL -- "-${pid}" 2>/dev/null || true
    done < "${PID_FILE}"
    rm -f "${PID_FILE}"
  fi
  rm -f "${LAUNCHER_PID_FILE}"
}

launcher_pid() {
  [[ -f "${LAUNCHER_PID_FILE}" ]] || return 1
  local pid
  pid="$(<"${LAUNCHER_PID_FILE}")"
  [[ -n "${pid}" && -r "/proc/${pid}/cmdline" ]] || return 1
  tr '\0' ' ' < "/proc/${pid}/cmdline" | grep -q 'start_outdoor_mapping.sh' || return 1
  printf '%s\n' "${pid}"
}

save_current_map() {
  local map_path
  map_path="$(read_state_value map_path 2>/dev/null || true)"
  if ! topic_has_publisher /Odometry; then
    echo "Outdoor LIO is not running; no active map to save." >&2
    return 1
  fi
  ros_env
  timeout 90 ros2 service call /map_save std_srvs/srv/Trigger "{}"
  if [[ -n "${map_path}" && -s "${map_path}" ]]; then
    echo "Outdoor PCD saved: ${map_path}"
  else
    echo "FAST-LIO reported save completion, but the PCD is not present yet: ${map_path}" >&2
    return 1
  fi
}

stop_running() {
  local pid
  pid="$(launcher_pid 2>/dev/null || true)"
  if [[ -n "${pid}" && "${pid}" != "$$" ]]; then
    kill -TERM "${pid}" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 "${pid}" 2>/dev/null || break
      sleep 0.2
    done
  fi
  cleanup_children
}

preflight() {
  [[ -f "${CONFIG_FILE}" ]] || { echo "Missing FAST-LIO config: ${CONFIG_FILE}" >&2; return 1; }
  [[ -f "${RVIZ_CONFIG}" ]] || { echo "Missing outdoor RViz config: ${RVIZ_CONFIG}" >&2; return 1; }
  [[ -f "${FASTLIO_SETUP}" ]] || { echo "Missing FAST-LIO workspace setup: ${FASTLIO_SETUP}" >&2; return 1; }
  [[ -x "${LIDAR_SCRIPT}" ]] || { echo "Missing Hesai startup helper: ${LIDAR_SCRIPT}" >&2; return 1; }

  ros_env
  local fastlio_executables adapter_executables
  fastlio_executables="$(ros2 pkg executables fast_lio)"
  grep -q 'fastlio_mapping' <<<"${fastlio_executables}" ||
    { echo "FAST-LIO2 is not built. Run scripts/build_outdoor_mapping.sh." >&2; return 1; }
  adapter_executables="$(ros2 pkg executables hesai_fastlio_adapter)"
  grep -q 'hesai_fastlio_adapter_node' <<<"${adapter_executables}" ||
    { echo "XT-16 adapter is not built. Run scripts/build_outdoor_mapping.sh." >&2; return 1; }

  if pgrep -af 'start_mapping_integrated.sh|async_slam_toolbox_node|start_navigation_integrated.sh|start_glim_mapping.sh|glim_rosnode|record_outdoor_sensors.sh|ros2 bag record' |
    grep -v 'pgrep -af' >/dev/null
  then
    echo "Another mapping, navigation, or neutral recording workflow is active. Stop it before starting FAST-LIO2." >&2
    return 1
  fi
}

ACTION="${1:-start}"
case "${ACTION}" in
  save)
    save_current_map
    exit 0
    ;;
  stop)
    save_current_map || true
    stop_running
    echo "Outdoor mapping stopped."
    exit 0
    ;;
  status)
    if launcher_pid >/dev/null 2>&1 && topic_has_publisher /Odometry; then
      echo "Outdoor mapping running: $(read_state_value map_name 2>/dev/null || echo unknown)"
      exit 0
    fi
    echo "Outdoor mapping stopped."
    exit 1
    ;;
  check)
    preflight
    echo "Outdoor mapping software preflight passed."
    exit 0
    ;;
  start) ;;
  *)
    echo "Usage: $0 {start [map_name]|save|stop|status|check}" >&2
    exit 2
    ;;
esac

MAP_NAME="${2:-outdoor_$(date '+%Y%m%d_%H%M%S')}"
[[ "${MAP_NAME}" =~ ^[A-Za-z0-9_-]+$ ]] || {
  echo "Map name may only contain letters, numbers, underscore and hyphen." >&2
  exit 2
}
MAP_PATH="${OUTDOOR_MAP_DIR}/${MAP_NAME}.pcd"

preflight
stop_running
rm -f "${MAP_PATH}"
printf 'map_name=%s\nmap_path=%s\nstarted_at=%s\n' \
  "${MAP_NAME}" "${MAP_PATH}" "$(date --iso-8601=seconds)" > "${STATE_FILE}"
printf '%s\n' "$$" > "${LAUNCHER_PID_FILE}"
trap cleanup_children EXIT INT TERM

exec >>"${LOG_DIR}/outdoor_mapping_launcher.log" 2>&1
echo "[$(date '+%F %T')] starting outdoor mapping name=${MAP_NAME} launcher=$$"

"${LIDAR_SCRIPT}" start
wait_for_topic /lidar_points 25

run_cmd "outdoor_yesense" \
  "source /opt/ros/humble/setup.bash && \
   source /home/nvidia/serial-ros2/install/setup.bash && \
   source '/home/nvidia/imu-driver/ROS2 SDK/yesense_ros2/install/setup.bash' && \
   exec ros2 launch yesense_std_ros2 yesense_node.launch.py"
wait_for_topic /imu/data_raw 15

run_cmd "outdoor_hesai_adapter" \
  "source /opt/ros/humble/setup.bash && \
   source '${FASTLIO_SETUP}' && \
   exec ros2 run hesai_fastlio_adapter hesai_fastlio_adapter_node"
wait_for_topic /lidar_points_fastlio 15

run_cmd "outdoor_fastlio" \
  "source /opt/ros/humble/setup.bash && \
   source '${FASTLIO_SETUP}' && \
   exec ros2 run fast_lio fastlio_mapping --ros-args \
     --params-file '${CONFIG_FILE}' \
     -p map_file_path:='${MAP_PATH}'"
wait_for_topic /Odometry 30

if [[ "${OUTDOOR_RVIZ_ENABLED,,}" == "true" ]] &&
  { [[ -n "${DISPLAY:-}" ]] || [[ -S /tmp/.X11-unix/X0 ]]; }
then
  run_cmd "outdoor_rviz" \
    "export DISPLAY='${DISPLAY:-:0}' && \
     export XAUTHORITY='${XAUTHORITY:-/home/nvidia/.Xauthority}' && \
     source /opt/ros/humble/setup.bash && \
     source '${FASTLIO_SETUP}' && \
     exec rviz2 -d '${RVIZ_CONFIG}'"
fi

echo "[$(date '+%F %T')] outdoor mapping ready, output=${MAP_PATH}"
wait
