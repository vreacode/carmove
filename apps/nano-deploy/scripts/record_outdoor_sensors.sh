#!/usr/bin/env bash
set -euo pipefail

# Record one algorithm-neutral outdoor LiDAR/IMU dataset. The same bag can be
# replayed through GLIM and FAST-LIO2, so field tests only need one drive.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOG_DIR="${ROOT_DIR}/dashboard_platform/runtime/logs"
PID_DIR="${ROOT_DIR}/dashboard_platform/runtime/pids"
PID_FILE="${PID_DIR}/outdoor_bag.pids"
LAUNCHER_PID_FILE="${PID_DIR}/outdoor_bag.launcher.pid"
STATE_FILE="${ROOT_DIR}/dashboard_platform/runtime/outdoor_bag.state"
LIDAR_SCRIPT="${ROOT_DIR}/scripts/ensure_lidar_hesai_xt16.sh"
STREAM_CHECK_SCRIPT="${ROOT_DIR}/scripts/verify_outdoor_streams.py"
OUTDOOR_BAG_DIR="${OUTDOOR_BAG_DIR:-/home/nvidia/Desktop/wheeltec_ros2/bags/outdoor}"

# Core mapping streams plus optional chassis/GNSS diagnostics. Regex discovery
# allows odom/GNSS topics to appear after recording has already started.
TOPIC_REGEX='^/(lidar_points|lidar_imu|lidar_packets_loss|imu/data_raw|imu/data|imu_data|euler_only|pos_only|nav_min|nav_min_utc|nav_all|pose_geo|odom|wheel_odom|tf|tf_static|cmd_vel|cmd_vel_safe|PowerVoltage)$'

mkdir -p "${LOG_DIR}" "${PID_DIR}" "${OUTDOOR_BAG_DIR}"

ros_env() {
  set +u
  source /opt/ros/humble/setup.bash
  [[ -f /home/nvidia/ros2_ws/install/setup.bash ]] && source /home/nvidia/ros2_ws/install/setup.bash
  [[ -f /home/nvidia/serial-ros2/install/setup.bash ]] && source /home/nvidia/serial-ros2/install/setup.bash
  [[ -f "/home/nvidia/imu-driver/ROS2 SDK/yesense_ros2/install/setup.bash" ]] &&
    source "/home/nvidia/imu-driver/ROS2 SDK/yesense_ros2/install/setup.bash"
  set -u
}

run_cmd() {
  local name="$1"
  local command="$2"
  setsid bash -lc "${command}" >"${LOG_DIR}/${name}.log" 2>&1 &
  printf '%s:%s\n' "${name}" "$!" >>"${PID_FILE}"
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

process_matches() {
  local name="$1"
  local pid="$2"
  [[ -n "${pid}" && -r "/proc/${pid}/cmdline" ]] || return 1
  local command
  command="$(tr '\0' ' ' <"/proc/${pid}/cmdline")"
  case "${name}" in
    recorder) grep -q 'ros2 bag record' <<<"${command}" ;;
    yesense) grep -Eq 'yesense|yesense_node' <<<"${command}" ;;
    *) return 1 ;;
  esac
}

stop_child() {
  local name="$1"
  local pid="$2"
  process_matches "${name}" "${pid}" || return 0
  kill -INT -- "-${pid}" 2>/dev/null || kill -INT "${pid}" 2>/dev/null || true
  local wait_steps=20
  [[ "${name}" == "recorder" ]] && wait_steps=60
  for ((step = 0; step < wait_steps; step++)); do
    process_matches "${name}" "${pid}" || return 0
    sleep 0.5
  done
  kill -TERM -- "-${pid}" 2>/dev/null || kill -TERM "${pid}" 2>/dev/null || true
}

cleanup_children() {
  if [[ -f "${PID_FILE}" ]]; then
    # Flush rosbag metadata before stopping a Yesense process started here.
    while IFS=: read -r name pid; do
      [[ "${name}" == "recorder" ]] || continue
      stop_child "${name}" "${pid}"
    done <"${PID_FILE}"
    while IFS=: read -r name pid; do
      [[ "${name}" != "recorder" ]] || continue
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
  tr '\0' ' ' <"/proc/${pid}/cmdline" | grep -q 'record_outdoor_sensors.sh' || return 1
  printf '%s\n' "${pid}"
}

child_pid() {
  local wanted_name="$1"
  [[ -f "${PID_FILE}" ]] || return 1
  local name pid
  while IFS=: read -r name pid; do
    [[ "${name}" == "${wanted_name}" ]] || continue
    process_matches "${name}" "${pid}" || continue
    printf '%s\n' "${pid}"
    return 0
  done <"${PID_FILE}"
  return 1
}

read_state_value() {
  local key="$1"
  [[ -f "${STATE_FILE}" ]] || return 1
  sed -n "s/^${key}=//p" "${STATE_FILE}" | head -n 1
}

write_state() {
  local temporary_state="${STATE_FILE}.tmp.$$"
  {
    printf 'bag_name=%s\n' "${BAG_NAME:-}"
    printf 'bag_path=%s\n' "${BAG_PATH:-}"
    printf 'phase=%s\n' "${PHASE:-starting}"
    printf 'requested_at=%s\n' "${REQUESTED_AT:-}"
    printf 'started_at=%s\n' "${STARTED_AT:-}"
    printf 'ready_at=%s\n' "${READY_AT:-}"
    printf 'lidar_hz=%s\n' "${LIDAR_HZ:-}"
    printf 'imu_hz=%s\n' "${IMU_HZ:-}"
    printf 'lidar_frame=%s\n' "${LIDAR_FRAME:-}"
    printf 'imu_frame=%s\n' "${IMU_FRAME:-}"
    printf 'point_count=%s\n' "${POINT_COUNT:-}"
    printf 'last_error=%s\n' "${LAST_ERROR:-}"
  } >"${temporary_state}"
  mv "${temporary_state}" "${STATE_FILE}"
}

load_state() {
  BAG_NAME="$(read_state_value bag_name 2>/dev/null || true)"
  BAG_PATH="$(read_state_value bag_path 2>/dev/null || true)"
  PHASE="$(read_state_value phase 2>/dev/null || true)"
  REQUESTED_AT="$(read_state_value requested_at 2>/dev/null || true)"
  STARTED_AT="$(read_state_value started_at 2>/dev/null || true)"
  READY_AT="$(read_state_value ready_at 2>/dev/null || true)"
  LIDAR_HZ="$(read_state_value lidar_hz 2>/dev/null || true)"
  IMU_HZ="$(read_state_value imu_hz 2>/dev/null || true)"
  LIDAR_FRAME="$(read_state_value lidar_frame 2>/dev/null || true)"
  IMU_FRAME="$(read_state_value imu_frame 2>/dev/null || true)"
  POINT_COUNT="$(read_state_value point_count 2>/dev/null || true)"
  LAST_ERROR="$(read_state_value last_error 2>/dev/null || true)"
}

stream_metric() {
  local report="$1"
  local key="$2"
  sed -n "s/.* ${key}=\\([^ ]*\\).*/\\1/p" <<<"${report}" | tail -n 1
}

bag_has_payload() {
  local payload_file
  payload_file="$(
    find "${BAG_PATH}" -maxdepth 1 -type f \( -name '*.db3' -o -name '*.mcap' \) -size +4096c -print -quit 2>/dev/null ||
      true
  )"
  [[ -n "${payload_file}" ]]
}

stop_running() {
  local pid
  pid="$(launcher_pid 2>/dev/null || true)"
  if [[ -n "${pid}" && "${pid}" != "$$" ]]; then
    kill -TERM "${pid}" 2>/dev/null || true
    for _ in {1..80}; do
      kill -0 "${pid}" 2>/dev/null || break
      sleep 0.5
    done
    kill -0 "${pid}" 2>/dev/null && kill -KILL "${pid}" 2>/dev/null || true
  else
    cleanup_children
  fi
}

report_bag() {
  local bag_path
  bag_path="$(read_state_value bag_path 2>/dev/null || true)"
  [[ -n "${bag_path}" && -s "${bag_path}/metadata.yaml" ]] || {
    echo "Recording stopped, but rosbag metadata is missing: ${bag_path:-unknown}" >&2
    return 1
  }
  ros_env
  ros2 bag info "${bag_path}"
}

preflight() {
  [[ -x "${LIDAR_SCRIPT}" ]] || {
    echo "Missing Hesai startup helper: ${LIDAR_SCRIPT}" >&2
    return 1
  }
  [[ -x "${STREAM_CHECK_SCRIPT}" ]] || {
    echo "Missing outdoor stream verifier: ${STREAM_CHECK_SCRIPT}" >&2
    return 1
  }
  if pgrep -af 'fastlio_mapping|glim_rosnode|glim_rosbag|async_slam_toolbox_node' |
    grep -v 'pgrep -af' >/dev/null
  then
    echo "Stop active mapping backends before recording the neutral benchmark bag." >&2
    return 1
  fi
  local available_kb
  available_kb="$(df -Pk "${OUTDOOR_BAG_DIR}" | awk 'NR==2 {print $4}')"
  if [[ -z "${available_kb}" || "${available_kb}" -lt 10485760 ]]; then
    echo "At least 10 GiB of free disk space is required for an outdoor bag." >&2
    return 1
  fi
}

ACTION="${1:-start}"
case "${ACTION}" in
  stop)
    load_state
    PREVIOUS_PHASE="${PHASE}"
    stop_running
    if [[ "${PREVIOUS_PHASE}" == "recording" ]]; then
      if report_bag; then
        STOP_RESULT=0
      else
        STOP_RESULT=$?
      fi
    else
      echo "Outdoor recording startup cancelled before the bag became ready."
      STOP_RESULT=0
    fi
    PHASE="stopped"
    LAST_ERROR=""
    write_state
    exit "${STOP_RESULT}"
    ;;
  status)
    CURRENT_PHASE="$(read_state_value phase 2>/dev/null || true)"
    if launcher_pid >/dev/null 2>&1 && child_pid recorder >/dev/null 2>&1 && [[ "${CURRENT_PHASE}" == "recording" ]]; then
      echo "Outdoor sensor recording running: $(read_state_value bag_name 2>/dev/null || echo unknown)"
      exit 0
    fi
    if launcher_pid >/dev/null 2>&1; then
      echo "Outdoor sensor recording is starting."
      exit 2
    fi
    echo "Outdoor sensor recording stopped."
    exit 1
    ;;
  check)
    preflight
    echo "Outdoor sensor recording preflight passed."
    exit 0
    ;;
  start) ;;
  *)
    echo "Usage: $0 {start [bag_name]|stop|status|check}" >&2
    exit 2
    ;;
esac

BAG_NAME="${2:-outdoor_$(date '+%Y%m%d_%H%M%S')}"
[[ "${BAG_NAME}" =~ ^[A-Za-z0-9_-]+$ ]] || {
  echo "Bag name may only contain letters, numbers, underscore and hyphen." >&2
  exit 2
}
BAG_PATH="${OUTDOOR_BAG_DIR}/${BAG_NAME}"
[[ ! -e "${BAG_PATH}" ]] || {
  echo "Bag already exists; choose another name: ${BAG_PATH}" >&2
  exit 1
}

preflight
stop_running
rm -f "${PID_FILE}"
PHASE="starting"
REQUESTED_AT="$(date --iso-8601=seconds)"
STARTED_AT=""
READY_AT=""
LIDAR_HZ=""
IMU_HZ=""
LIDAR_FRAME=""
IMU_FRAME=""
POINT_COUNT=""
LAST_ERROR=""
write_state
printf '%s\n' "$$" >"${LAUNCHER_PID_FILE}"

on_exit() {
  local result="$1"
  cleanup_children
  if [[ "${result}" -ne 0 && "${PHASE:-}" != "stopped" ]]; then
    PHASE="failed"
    LAST_ERROR="${LAST_ERROR:-Outdoor recording setup failed; inspect outdoor_bag_launcher.log}"
    write_state || true
  fi
}
trap 'on_exit $?' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

exec >>"${LOG_DIR}/outdoor_bag_launcher.log" 2>&1
echo "[$(date '+%F %T')] starting outdoor rosbag name=${BAG_NAME} launcher=$$"

"${LIDAR_SCRIPT}" start || {
  LAST_ERROR="Hesai XT-16 failed to start"
  exit 1
}

if ! topic_has_publisher /imu/data_raw; then
  run_cmd "yesense" \
    "source /opt/ros/humble/setup.bash && \
     source /home/nvidia/serial-ros2/install/setup.bash && \
     source '/home/nvidia/imu-driver/ROS2 SDK/yesense_ros2/install/setup.bash' && \
     exec ros2 launch yesense_std_ros2 yesense_node.launch.py"
fi

PHASE="validating"
write_state
STREAM_REPORT="$(
  ros_env
  ROS2CLI_NO_DAEMON=1 python3 "${STREAM_CHECK_SCRIPT}" \
    --lidar-topic /lidar_points \
    --imu-topic /imu/data_raw \
    --sample-seconds 4.0 \
    --ready-timeout 12.0
)" || {
  LAST_ERROR="LiDAR/IMU live data validation failed"
  exit 1
}
echo "${STREAM_REPORT}"
LIDAR_HZ="$(stream_metric "${STREAM_REPORT}" lidar_hz)"
IMU_HZ="$(stream_metric "${STREAM_REPORT}" imu_hz)"
LIDAR_FRAME="$(stream_metric "${STREAM_REPORT}" lidar_frame)"
IMU_FRAME="$(stream_metric "${STREAM_REPORT}" imu_frame)"
POINT_COUNT="$(stream_metric "${STREAM_REPORT}" point_count)"

run_cmd "recorder" \
  "source /opt/ros/humble/setup.bash && \
   source /home/nvidia/ros2_ws/install/setup.bash && \
   source '/home/nvidia/imu-driver/ROS2 SDK/yesense_ros2/install/setup.bash' && \
   exec ros2 bag record \
     --regex '${TOPIC_REGEX}' \
     --output '${BAG_PATH}' \
     --max-bag-duration 300 \
     --max-cache-size 67108864"

for _ in {1..30}; do
  if child_pid recorder >/dev/null 2>&1 && bag_has_payload; then
    break
  fi
  sleep 0.5
done
if ! child_pid recorder >/dev/null 2>&1 || ! bag_has_payload; then
  LAST_ERROR="rosbag recorder did not begin writing data"
  echo "${LAST_ERROR}: ${BAG_PATH}; inspect ${LOG_DIR}/recorder.log" >&2
  exit 1
fi

PHASE="recording"
STARTED_AT="$(date --iso-8601=seconds)"
READY_AT="${STARTED_AT}"
LAST_ERROR=""
write_state

echo "[$(date '+%F %T')] outdoor recording ready, output=${BAG_PATH}"
echo "Keep the first 10 seconds stationary, then drive a loop and return near the start."
wait
