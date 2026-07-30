#!/usr/bin/env bash
set -uo pipefail

SAMPLE_SECONDS="${SAMPLE_SECONDS:-8}"
STAMP="$(date '+%Y%m%d_%H%M%S')"
OUTPUT_DIR="${1:-$(pwd)/diagnostics/slam_alignment_${STAMP}}"
mkdir -p "${OUTPUT_DIR}"

set +u
source /opt/ros/humble/setup.bash
for setup_file in \
  /home/nvidia/Desktop/wheeltec_ros2/install/setup.bash \
  /home/nvidia/ros2_ws/install/setup.bash \
  /home/nvidia/fastlio2_ws/install/setup.bash; do
  [[ -f "${setup_file}" ]] && source "${setup_file}"
done
set -u

capture() {
  local name="$1"
  shift
  {
    echo "# command: $*"
    echo "# captured: $(date --iso-8601=seconds)"
    timeout 20 "$@"
  } >"${OUTPUT_DIR}/${name}.txt" 2>&1 || true
}

capture_shell() {
  local name="$1"
  shift
  {
    echo "# command: $*"
    echo "# captured: $(date --iso-8601=seconds)"
    timeout 25 bash -lc "$*"
  } >"${OUTPUT_DIR}/${name}.txt" 2>&1 || true
}

capture nodes ros2 node list --no-daemon &
capture topics ros2 topic list -t --no-daemon &
capture map_info ros2 topic info /map -v --no-daemon &
capture map_header ros2 topic echo /map --once --field header &
capture map_metadata ros2 topic echo /map --once --field info &
capture tf_publishers ros2 topic info /tf -v --no-daemon &
capture tf_static_publishers ros2 topic info /tf_static -v --no-daemon &
wait

topic_for_type() {
  local preferred="$1"
  local type="$2"
  if grep -q "^${preferred} \\[${type}\\]$" "${OUTPUT_DIR}/topics.txt"; then
    printf '%s\n' "${preferred}"
  else
    awk -v type="[${type}]" '$NF == type {print $1; exit}' "${OUTPUT_DIR}/topics.txt"
  fi
}

SCAN_TOPIC="$(topic_for_type /scan sensor_msgs/msg/LaserScan)"
ODOM_TOPIC="$(topic_for_type /odom_combined nav_msgs/msg/Odometry)"
IMU_TOPIC="$(topic_for_type /imu/data sensor_msgs/msg/Imu)"

for entry in "scan:${SCAN_TOPIC}" "odom:${ODOM_TOPIC}" "imu:${IMU_TOPIC}"; do
  label="${entry%%:*}"
  topic="${entry#*:}"
  [[ -n "${topic}" ]] || continue
  capture "${label}_info" ros2 topic info "${topic}" -v --no-daemon &
  capture "${label}_header" ros2 topic echo "${topic}" --once --field header &
done
wait
for entry in "scan:${SCAN_TOPIC}" "odom:${ODOM_TOPIC}" "imu:${IMU_TOPIC}"; do
  label="${entry%%:*}"
  topic="${entry#*:}"
  [[ -n "${topic}" ]] || continue
  capture_shell "${label}_hz" "source /opt/ros/humble/setup.bash; timeout ${SAMPLE_SECONDS} ros2 topic hz '${topic}' --window 50"
done

if [[ -n "${ODOM_TOPIC}" ]]; then
  capture odom_child_frame ros2 topic echo "${ODOM_TOPIC}" --once --field child_frame_id
fi

MAP_FRAME="$(awk '/frame_id:/ {print $2; exit}' "${OUTPUT_DIR}/map_header.txt" 2>/dev/null)"
ODOM_FRAME="$(awk '/frame_id:/ {print $2; exit}' "${OUTPUT_DIR}/odom_header.txt" 2>/dev/null)"
BASE_FRAME="$(awk '/^[A-Za-z_][A-Za-z0-9_]*$/ {frame=$1} END {print frame}' "${OUTPUT_DIR}/odom_child_frame.txt" 2>/dev/null)"
LASER_FRAME="$(awk '/frame_id:/ {print $2; exit}' "${OUTPUT_DIR}/scan_header.txt" 2>/dev/null)"
MAP_FRAME="${MAP_FRAME:-map}"
ODOM_FRAME="${ODOM_FRAME:-odom}"
BASE_FRAME="${BASE_FRAME:-base_link}"
LASER_FRAME="${LASER_FRAME:-laser}"

capture_shell tf_map_odom "source /opt/ros/humble/setup.bash; timeout 5 ros2 run tf2_ros tf2_echo '${MAP_FRAME}' '${ODOM_FRAME}'" &
capture_shell tf_odom_base "source /opt/ros/humble/setup.bash; timeout 5 ros2 run tf2_ros tf2_echo '${ODOM_FRAME}' '${BASE_FRAME}'" &
capture_shell tf_base_laser "source /opt/ros/humble/setup.bash; timeout 5 ros2 run tf2_ros tf2_echo '${BASE_FRAME}' '${LASER_FRAME}'" &

(
  cd "${OUTPUT_DIR}" || exit 0
  timeout 10 ros2 run tf2_tools view_frames >view_frames.txt 2>&1 || true
) &
wait

python3 - "${OUTPUT_DIR}/view_frames.txt" "${OUTPUT_DIR}/frames.yaml" <<'PY'
import codecs
import re
import sys
text = open(sys.argv[1], encoding="utf-8", errors="ignore").read()
match = re.search(r'frame_yaml="(.*)"\)\s*$', text, re.S)
if match:
    decoded = codecs.decode(match.group(1), "unicode_escape")
    open(sys.argv[2], "w", encoding="utf-8").write(decoded)
PY

PARAM_DIR="${OUTPUT_DIR}/use_sim_time_parts"
mkdir -p "${PARAM_DIR}"
relevant_nodes=(
  /slam_toolbox
  /pointcloud_to_laserscan
  /ekf_filter_node
  /wheeltec_robot
  /imu_filter_madgwick
  /hesai_ros_driver_node
)
for node in "${relevant_nodes[@]}"; do
  grep -qx "${node}" "${OUTPUT_DIR}/nodes.txt" || continue
  safe_name="${node#/}"
  (
    result="$(timeout 5 ros2 param get "${node}" use_sim_time 2>&1 || true)"
    [[ -n "${result}" ]] || result="timeout_or_parameter_service_unavailable"
    printf '%s: %s\n' "${node}" "${result//$'\n'/ }" >"${PARAM_DIR}/${safe_name}.txt"
  ) &
done
wait
{
  echo "# relevant node use_sim_time values"
  for node in "${relevant_nodes[@]}"; do
    safe_name="${node#/}"
    [[ -f "${PARAM_DIR}/${safe_name}.txt" ]] && cat "${PARAM_DIR}/${safe_name}.txt"
  done
} >"${OUTPUT_DIR}/use_sim_time.txt"
find "${PARAM_DIR}" -maxdepth 1 -type f -name '*.txt' -delete
rmdir "${PARAM_DIR}" 2>/dev/null || true

python3 - "${OUTPUT_DIR}/map_metadata.txt" >"${OUTPUT_DIR}/map_origin_analysis.txt" <<'PY'
import math
import re
import sys
text = open(sys.argv[1], encoding="utf-8", errors="ignore").read()
def value(name):
    match = re.search(rf"^\s*{name}:\s*([-+0-9.eE]+)\s*$", text, re.M)
    return float(match.group(1)) if match else float("nan")
orientation = text.split("orientation:", 1)[-1]
def qvalue(name):
    match = re.search(rf"^\s*{name}:\s*([-+0-9.eE]+)\s*$", orientation, re.M)
    return float(match.group(1)) if match else float("nan")
x, y, z, w = (qvalue(k) for k in ("x", "y", "z", "w"))
yaw = math.atan2(2.0 * (w*z + x*y), 1.0 - 2.0 * (y*y + z*z))
print(f"orientation_xyzw={x},{y},{z},{w}")
print(f"origin_yaw_rad={yaw:.9f}")
print(f"origin_yaw_deg={math.degrees(yaw):.6f}")
print("grid_rotated_by_origin=" + ("yes" if abs(yaw) > math.radians(0.1) else "no"))
PY

{
  echo "SLAM alignment diagnostic summary"
  echo "output_dir=${OUTPUT_DIR}"
  echo "map_frame=${MAP_FRAME}"
  echo "odom_topic=${ODOM_TOPIC:-not_found}"
  echo "odom_frame=${ODOM_FRAME}"
  echo "base_frame=${BASE_FRAME}"
  echo "scan_topic=${SCAN_TOPIC:-not_found}"
  echo "laser_frame=${LASER_FRAME}"
  echo "imu_topic=${IMU_TOPIC:-not_found}"
  grep -E 'Publisher count|Node name' "${OUTPUT_DIR}/map_info.txt" 2>/dev/null || true
  cat "${OUTPUT_DIR}/map_origin_analysis.txt" 2>/dev/null || true
  echo "Review tf_publishers.txt, tf_static_publishers.txt and frames.yaml for duplicate parent-child transforms."
  echo "Review *_hz.txt and message headers for unstable rates or stale/non-monotonic timestamps."
} | tee "${OUTPUT_DIR}/SUMMARY.txt"
