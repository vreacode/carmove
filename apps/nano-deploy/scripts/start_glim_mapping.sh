#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOG_DIR="${ROOT_DIR}/dashboard_platform/runtime/logs"
PID_DIR="${ROOT_DIR}/dashboard_platform/runtime/pids"
PID_FILE="${PID_DIR}/glim_mapping.pids"
LAUNCHER_PID_FILE="${PID_DIR}/glim_mapping.launcher.pid"
STATE_FILE="${ROOT_DIR}/dashboard_platform/runtime/glim_mapping.state"
CONFIG_DIR="${ROOT_DIR}/config/outdoor/glim"
SETUP_FILE="${ROOT_DIR}/config/outdoor/glim_local_setup.bash"
RVIZ_CONFIG="${ROOT_DIR}/config/outdoor/glim_outdoor.rviz"
LIDAR_SCRIPT="${ROOT_DIR}/scripts/ensure_lidar_hesai_xt16.sh"
OUTDOOR_MAP_DIR="${OUTDOOR_MAP_DIR:-/home/nvidia/Desktop/wheeltec_ros2/maps/outdoor}"
GLIM_RVIZ_ENABLED="${GLIM_RVIZ_ENABLED:-true}"

mkdir -p "${LOG_DIR}" "${PID_DIR}" "${OUTDOOR_MAP_DIR}/glim"

ros_env() {
  set +u
  source /opt/ros/humble/setup.bash
  [[ -f /home/nvidia/ros2_ws/install/setup.bash ]] && source /home/nvidia/ros2_ws/install/setup.bash
  [[ -f /home/nvidia/serial-ros2/install/setup.bash ]] && source /home/nvidia/serial-ros2/install/setup.bash
  [[ -f "/home/nvidia/imu-driver/ROS2 SDK/yesense_ros2/install/setup.bash" ]] &&
    source "/home/nvidia/imu-driver/ROS2 SDK/yesense_ros2/install/setup.bash"
  source "${SETUP_FILE}"
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
  printf '%s:%s\n' "${name}" "${pid}" >>"${PID_FILE}"
}

topic_has_publisher() {
  local topic="$1"
  local output
  output="$(
    ros_env
    ROS2CLI_NO_DAEMON=1 ros2 topic info "${topic}" -v 2>/dev/null || true
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

process_matches() {
  local name="$1"
  local pid="$2"
  [[ -n "${pid}" && -r "/proc/${pid}/cmdline" ]] || return 1
  local command
  command="$(tr '\0' ' ' <"/proc/${pid}/cmdline")"
  case "${name}" in
    glim) grep -q 'glim_rosnode' <<<"${command}" ;;
    yesense) grep -Eq 'yesense|yesense_node' <<<"${command}" ;;
    rviz) grep -q 'rviz2' <<<"${command}" ;;
    *) return 1 ;;
  esac
}

stop_child() {
  local name="$1"
  local pid="$2"
  process_matches "${name}" "${pid}" || return 0

  kill -INT -- "-${pid}" 2>/dev/null || kill -INT "${pid}" 2>/dev/null || true
  local wait_steps=20
  [[ "${name}" == "glim" ]] && wait_steps=120
  for ((step = 0; step < wait_steps; step++)); do
    process_matches "${name}" "${pid}" || return 0
    sleep 0.5
  done
  kill -TERM -- "-${pid}" 2>/dev/null || kill -TERM "${pid}" 2>/dev/null || true
  sleep 0.5
  process_matches "${name}" "${pid}" || return 0
  kill -KILL -- "-${pid}" 2>/dev/null || kill -KILL "${pid}" 2>/dev/null || true
}

cleanup_children() {
  if [[ -f "${PID_FILE}" ]]; then
    # Stop GLIM first and give it time to write the graph and trajectories.
    while IFS=: read -r name pid; do
      [[ "${name}" == "glim" ]] || continue
      stop_child "${name}" "${pid}"
    done <"${PID_FILE}"
    while IFS=: read -r name pid; do
      [[ "${name}" != "glim" ]] || continue
      stop_child "${name}" "${pid}"
    done <"${PID_FILE}"
    rm -f "${PID_FILE}"
  fi
  rm -f "${LAUNCHER_PID_FILE}"
}

launcher_pid() {
  [[ -f "${LAUNCHER_PID_FILE}" ]] || return 1
  local pid
  pid="$(<"${LAUNCHER_PID_FILE}")"
  [[ -n "${pid}" && -r "/proc/${pid}/cmdline" ]] || return 1
  tr '\0' ' ' <"/proc/${pid}/cmdline" | grep -q 'start_glim_mapping.sh' || return 1
  printf '%s\n' "${pid}"
}

stop_running() {
  local pid
  pid="$(launcher_pid 2>/dev/null || true)"
  if [[ -n "${pid}" && "${pid}" != "$$" ]]; then
    kill -TERM "${pid}" 2>/dev/null || true
    for _ in {1..140}; do
      kill -0 "${pid}" 2>/dev/null || break
      sleep 0.5
    done
    if kill -0 "${pid}" 2>/dev/null; then
      kill -KILL "${pid}" 2>/dev/null || true
    fi
  else
    cleanup_children
  fi
}

report_saved_map() {
  local map_path
  map_path="$(read_state_value map_path 2>/dev/null || true)"
  if [[ -n "${map_path}" && -s "${map_path}/traj_lidar.txt" ]]; then
    echo "GLIM map saved: ${map_path}"
    return 0
  fi
  echo "GLIM stopped, but no trajectory was saved yet: ${map_path:-unknown}" >&2
  return 1
}

preflight() {
  [[ -f "${CONFIG_DIR}/config.json" ]] || {
    echo "Missing GLIM config directory: ${CONFIG_DIR}" >&2
    return 1
  }
  [[ -f "${SETUP_FILE}" ]] || { echo "Missing GLIM setup: ${SETUP_FILE}" >&2; return 1; }
  [[ -f "${RVIZ_CONFIG}" ]] || { echo "Missing GLIM RViz config: ${RVIZ_CONFIG}" >&2; return 1; }
  [[ -x "${LIDAR_SCRIPT}" ]] || { echo "Missing Hesai startup helper: ${LIDAR_SCRIPT}" >&2; return 1; }

  ros_env
  local glim_executables
  glim_executables="$(ros2 pkg executables glim_ros)"
  grep -q 'glim_rosnode' <<<"${glim_executables}" || {
    echo "GLIM is not ready. Run scripts/install_glim_local.sh." >&2
    return 1
  }

  if pgrep -af 'fastlio_mapping|async_slam_toolbox_node|start_navigation_integrated.sh|record_outdoor_sensors.sh|ros2 bag record' |
    grep -v 'pgrep -af' >/dev/null
  then
    echo "Another mapping, navigation, or neutral recording workflow is active. Stop it before starting GLIM." >&2
    return 1
  fi
}

ACTION="${1:-start}"
case "${ACTION}" in
  save | stop)
    stop_running
    report_saved_map
    exit $?
    ;;
  status)
    if launcher_pid >/dev/null 2>&1 && topic_has_publisher /glim_ros/odom; then
      echo "GLIM mapping running: $(read_state_value map_name 2>/dev/null || echo unknown)"
      exit 0
    fi
    echo "GLIM mapping stopped."
    exit 1
    ;;
  check)
    preflight
    echo "GLIM mapping software preflight passed."
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
MAP_PATH="${OUTDOOR_MAP_DIR}/glim/${MAP_NAME}"
[[ ! -e "${MAP_PATH}" ]] || {
  echo "GLIM map already exists; choose another name: ${MAP_PATH}" >&2
  exit 1
}

preflight
stop_running
printf 'backend=glim\nmap_name=%s\nmap_path=%s\nstarted_at=%s\n' \
  "${MAP_NAME}" "${MAP_PATH}" "$(date --iso-8601=seconds)" >"${STATE_FILE}"
printf '%s\n' "$$" >"${LAUNCHER_PID_FILE}"
rm -f "${PID_FILE}"
trap cleanup_children EXIT INT TERM

exec >>"${LOG_DIR}/glim_mapping_launcher.log" 2>&1
echo "[$(date '+%F %T')] starting GLIM mapping name=${MAP_NAME} launcher=$$"

"${LIDAR_SCRIPT}" start
wait_for_topic /lidar_points 25

if ! topic_has_publisher /imu/data_raw; then
  run_cmd "yesense" \
    "source /opt/ros/humble/setup.bash && \
     source /home/nvidia/serial-ros2/install/setup.bash && \
     source '/home/nvidia/imu-driver/ROS2 SDK/yesense_ros2/install/setup.bash' && \
     exec ros2 launch yesense_std_ros2 yesense_node.launch.py"
  wait_for_topic /imu/data_raw 15
fi

run_cmd "glim" \
  "source /opt/ros/humble/setup.bash && \
   source '${SETUP_FILE}' && \
   exec ros2 run glim_ros glim_rosnode --ros-args \
     -p config_path:='${CONFIG_DIR}' \
     -p dump_path:='${MAP_PATH}'"
wait_for_topic /glim_ros/odom 45

if [[ "${GLIM_RVIZ_ENABLED,,}" == "true" ]] &&
  { [[ -n "${DISPLAY:-}" ]] || [[ -S /tmp/.X11-unix/X0 ]]; }
then
  run_cmd "rviz" \
    "export DISPLAY='${DISPLAY:-:0}' && \
     export XAUTHORITY='${XAUTHORITY:-/home/nvidia/.Xauthority}' && \
     source /opt/ros/humble/setup.bash && \
     source '${SETUP_FILE}' && \
     exec rviz2 -d '${RVIZ_CONFIG}'"
fi

echo "[$(date '+%F %T')] GLIM mapping ready, output=${MAP_PATH}"
wait
