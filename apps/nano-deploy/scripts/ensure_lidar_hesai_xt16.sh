#!/usr/bin/env bash
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOG_DIR="${ROOT_DIR}/dashboard_platform/runtime/logs"
PID_DIR="${ROOT_DIR}/dashboard_platform/runtime/pids"
PID_FILE="${PID_DIR}/lidar_hesai_xt16.pid"
LOG_FILE="${LOG_DIR}/lidar_hesai_xt16.log"

HESAI_PREFIX="${HESAI_DRIVER_PREFIX:-/home/nvidia/ros2_ws/install/hesai_ros_driver}"
HESAI_SETUP="${HESAI_SETUP_BASH:-/home/nvidia/ros2_ws/install/setup.bash}"
HESAI_BIN="${HESAI_DRIVER_BIN:-${HESAI_PREFIX}/lib/hesai_ros_driver/hesai_ros_driver_node}"
CONFIG_FILE="${HESAI_LIDAR_CONFIG:-${ROOT_DIR}/config/lidar/hesai_xt16.yaml}"
TOPIC="${LIDAR_POINT_TOPIC:-/lidar_points}"

mkdir -p "${LOG_DIR}" "${PID_DIR}"

topic_ready() {
  # Avoid ros2 | grep -q with pipefail: grep can close the pipe early and
  # turn a healthy ROS graph into a false negative through SIGPIPE.
  local topic_info
  topic_info="$(
    source /opt/ros/humble/setup.bash
    source "${HESAI_SETUP}"
    ROS2CLI_NO_DAEMON=1 ros2 topic info "${TOPIC}" -v 2>/dev/null || true
  )"
  grep -Eq 'Publisher count: [1-9][0-9]*' <<<"${topic_info}"
}

pid_is_hesai() {
  local pid="${1:-}"
  [[ -n "${pid}" && -r "/proc/${pid}/cmdline" ]] || return 1
  tr '\0' ' ' < "/proc/${pid}/cmdline" | grep -q 'hesai_ros_driver_node'
}

read_pid() {
  [[ -f "${PID_FILE}" ]] || return 1
  local pid
  pid="$(<"${PID_FILE}")"
  pid_is_hesai "${pid}" || return 1
  printf '%s\n' "${pid}"
}

stop_driver() {
  if systemctl --user is-active --quiet nano-hesai-xt16.service 2>/dev/null; then
    systemctl --user stop nano-hesai-xt16.service
  fi
  local pid
  pid="$(read_pid 2>/dev/null || true)"
  if [[ -n "${pid}" ]]; then
    kill -INT "${pid}" 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      kill -0 "${pid}" 2>/dev/null || break
      sleep 0.4
    done
    kill -KILL "${pid}" 2>/dev/null || true
  fi
  rm -f "${PID_FILE}"
}

stop_legacy_c16() {
  local legacy="${ROOT_DIR}/scripts/ensure_lidar_c16.sh"
  [[ -x "${legacy}" ]] || return 0
  "${legacy}" stop >/dev/null 2>&1 || true
}

start_driver() {
  [[ -f "${CONFIG_FILE}" ]] || {
    echo "Hesai XT-16 config not found: ${CONFIG_FILE}" >&2
    return 1
  }
  [[ -x "${HESAI_BIN}" ]] || {
    echo "Hesai XT-16 executable not found: ${HESAI_BIN}" >&2
    echo "Build HesaiLidar_ROS_2.0 and source its install/setup.bash first." >&2
    return 1
  }
  [[ -f "${HESAI_SETUP}" ]] || {
    echo "Hesai ROS2 setup file not found: ${HESAI_SETUP}" >&2
    return 1
  }

  if read_pid >/dev/null 2>&1; then
    echo "Hesai XT-16 driver already running."
    return 0
  fi
  if topic_ready; then
    echo "Hesai XT-16 topic already has a publisher."
    return 0
  fi

  stop_legacy_c16
  if systemctl --user cat nano-hesai-xt16.service >/dev/null 2>&1; then
    systemctl --user start nano-hesai-xt16.service
    local service_deadline=$((SECONDS + 12))
    until topic_ready; do
      if ! systemctl --user is-active --quiet nano-hesai-xt16.service; then
        echo "Hesai XT-16 service exited; inspect: journalctl --user -u nano-hesai-xt16.service" >&2
        return 1
      fi
      if (( SECONDS >= service_deadline )); then
        echo "Hesai XT-16 topic not ready after 12 seconds." >&2
        return 1
      fi
      sleep 0.5
    done
    echo "Hesai XT-16 service ready on ${TOPIC}."
    return 0
  fi

  rm -f "${PID_FILE}"
  # Keep the node in an independent session after this helper returns.
  setsid bash -lc "
    source /opt/ros/humble/setup.bash &&
    source '${HESAI_SETUP}' &&
    exec '${HESAI_BIN}' --ros-args -p config_path:='${CONFIG_FILE}'
  " >"${LOG_FILE}" 2>&1 &
  local pid=$!
  printf '%s\n' "${pid}" > "${PID_FILE}"

  local deadline=$((SECONDS + 20))
  until topic_ready; do
    if ! pid_is_hesai "${pid}"; then
      echo "Hesai XT-16 driver exited; see ${LOG_FILE}" >&2
      rm -f "${PID_FILE}"
      return 1
    fi
    if (( SECONDS >= deadline )); then
      echo "Hesai XT-16 topic not ready after 20 seconds; see ${LOG_FILE}" >&2
      stop_driver
      return 1
    fi
    sleep 1
  done
  echo "Hesai XT-16 ready on ${TOPIC}."
}

case "${1:-start}" in
  start) start_driver ;;
  stop) stop_driver; echo "Hesai XT-16 stopped." ;;
  status)
    if read_pid >/dev/null 2>&1 || topic_ready; then
      echo "Hesai XT-16 running."
    else
      echo "Hesai XT-16 stopped."
    fi
    ;;
  *) echo "Usage: $0 {start|stop|status}" >&2; exit 2 ;;
esac
