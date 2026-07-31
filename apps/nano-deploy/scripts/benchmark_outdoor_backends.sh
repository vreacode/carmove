#!/usr/bin/env bash
set -euo pipefail

# Replay one neutral outdoor bag through GLIM and FAST-LIO2 sequentially.
# Backends are isolated in a dedicated ROS domain and never run together.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
GLIM_CONFIG="${ROOT_DIR}/config/outdoor/glim"
GLIM_SETUP="${ROOT_DIR}/config/outdoor/glim_local_setup.bash"
FASTLIO_CONFIG="${ROOT_DIR}/config/outdoor/fastlio_hesai_xt16.yaml"
FASTLIO_SETUP="${FASTLIO_SETUP:-/home/nvidia/fastlio2_ws/install/setup.bash}"
ODOM_RECORDER="${ROOT_DIR}/scripts/record_odom_tum.py"
SUMMARIZER="${ROOT_DIR}/scripts/summarize_outdoor_benchmark.py"
METRICS_RUNNER="${ROOT_DIR}/scripts/run_with_metrics.py"
GLIM_NAV2_EXPORTER="${ROOT_DIR}/scripts/export_glim_nav2_map.sh"
GLIM_EXPORT_NAV2="${GLIM_EXPORT_NAV2:-true}"
BENCHMARK_ROOT="${OUTDOOR_BENCHMARK_DIR:-/home/nvidia/Desktop/wheeltec_ros2/benchmarks/outdoor}"
ROS_DOMAIN_ID="${OUTDOOR_BENCHMARK_ROS_DOMAIN_ID:-77}"
export ROS_DOMAIN_ID

declare -a FASTLIO_PIDS=()

usage() {
  echo "Usage: $0 <rosbag_path> [both|glim|fastlio]" >&2
}

stop_group() {
  local pid="$1"
  [[ -n "${pid}" && -r "/proc/${pid}/cmdline" ]] || return 0
  kill -INT -- "-${pid}" 2>/dev/null || kill -INT "${pid}" 2>/dev/null || true
  for _ in {1..30}; do
    [[ -r "/proc/${pid}/cmdline" ]] || return 0
    sleep 0.2
  done
  kill -TERM -- "-${pid}" 2>/dev/null || kill -TERM "${pid}" 2>/dev/null || true
}

cleanup_fastlio() {
  local pid
  for pid in "${FASTLIO_PIDS[@]:-}"; do
    stop_group "${pid}"
  done
  FASTLIO_PIDS=()
}
trap cleanup_fastlio EXIT INT TERM

source_ros() {
  set +u
  source /opt/ros/humble/setup.bash
  [[ -f /home/nvidia/ros2_ws/install/setup.bash ]] && source /home/nvidia/ros2_ws/install/setup.bash
  [[ -f /home/nvidia/serial-ros2/install/setup.bash ]] && source /home/nvidia/serial-ros2/install/setup.bash
  [[ -f "/home/nvidia/imu-driver/ROS2 SDK/yesense_ros2/install/setup.bash" ]] &&
    source "/home/nvidia/imu-driver/ROS2 SDK/yesense_ros2/install/setup.bash"
  set -u
}

wait_for_service() {
  local service="$1"
  local deadline=$((SECONDS + 30))
  until ros2 service list 2>/dev/null | grep -Fxq "${service}"; do
    if ((SECONDS >= deadline)); then
      echo "Service did not become ready: ${service}" >&2
      return 1
    fi
    sleep 0.5
  done
}

run_glim() {
  local output_dir="$1"
  mkdir -p "${output_dir}"
  set +u
  source "${GLIM_SETUP}"
  set -u

  echo "Running GLIM offline benchmark..."
  python3 "${METRICS_RUNNER}" \
    --json "${output_dir}/resources.json" \
    --report "${output_dir}/resources.txt" \
    --output "${output_dir}/run.log" \
    -- ros2 run glim_ros glim_rosbag "${BAG_PATH}" --ros-args \
      -p config_path:="${GLIM_CONFIG}" \
      -p dump_path:="${output_dir}/map" \
      -p auto_quit:=true

  [[ -s "${output_dir}/map/traj_lidar.txt" ]] || {
    echo "GLIM did not produce traj_lidar.txt; inspect ${output_dir}/run.log" >&2
    return 1
  }

  if [[ "${GLIM_EXPORT_NAV2}" == "true" ]]; then
    if [[ -x "${GLIM_NAV2_EXPORTER}" && -f /home/nvidia/glim_ws/overlay_install/setup.bash ]]; then
      echo "Exporting optimized GLIM cloud and conservative Nav2 projection..."
      "${GLIM_NAV2_EXPORTER}" "${output_dir}/map" "${output_dir}/nav2_map" "glim_nav2_map"
    else
      echo "Skipping Nav2 projection: GLIM export overlay is not installed." >&2
    fi
  fi
}

run_fastlio() {
  local output_dir="$1"
  mkdir -p "${output_dir}"
  set +u
  source "${FASTLIO_SETUP}"
  set -u

  local fastlio_executables adapter_executables
  fastlio_executables="$(ros2 pkg executables fast_lio)"
  adapter_executables="$(ros2 pkg executables hesai_fastlio_adapter)"
  grep -q 'fastlio_mapping' <<<"${fastlio_executables}"
  grep -q 'hesai_fastlio_adapter_node' <<<"${adapter_executables}"

  echo "Running FAST-LIO2 real-time replay benchmark..."
  setsid ros2 run hesai_fastlio_adapter hesai_fastlio_adapter_node \
    >"${output_dir}/adapter.log" 2>&1 &
  FASTLIO_PIDS+=("$!")

  setsid python3 "${ODOM_RECORDER}" \
    --topic /Odometry \
    --output "${output_dir}/trajectory.txt" \
    >"${output_dir}/trajectory.log" 2>&1 &
  FASTLIO_PIDS+=("$!")

  setsid python3 "${METRICS_RUNNER}" \
    --json "${output_dir}/resources.json" \
    --report "${output_dir}/resources.txt" \
    --output "${output_dir}/run.log" \
    -- ros2 run fast_lio fastlio_mapping --ros-args \
      --params-file "${FASTLIO_CONFIG}" \
      -p publish.path_en:=false \
      -p publish.map_en:=false \
      -p publish.scan_publish_en:=false \
      -p publish.scan_bodyframe_pub_en:=false \
      -p pcd_save.pcd_save_en:=false &
  FASTLIO_PIDS+=("$!")

  wait_for_service /map_save
  sleep 2
  ros2 bag play "${BAG_PATH}" \
    --topics /lidar_points /imu/data_raw \
    --disable-keyboard-controls \
    --wait-for-all-acked 3000 \
    >"${output_dir}/play.log" 2>&1
  sleep 3
  cleanup_fastlio

  [[ -s "${output_dir}/trajectory.txt" ]] || {
    echo "FAST-LIO2 did not produce a trajectory; inspect ${output_dir}/run.log" >&2
    return 1
  }
}

[[ $# -ge 1 && $# -le 2 ]] || {
  usage
  exit 2
}
BAG_PATH="$(realpath "$1")"
MODE="${2:-both}"
[[ -s "${BAG_PATH}/metadata.yaml" ]] || {
  echo "Not a ROS 2 bag directory: ${BAG_PATH}" >&2
  exit 1
}
[[ "${MODE}" =~ ^(both|glim|fastlio)$ ]] || {
  usage
  exit 2
}
if pgrep -af 'fastlio_mapping|glim_rosnode|glim_rosbag|async_slam_toolbox_node' |
  grep -v 'pgrep -af' >/dev/null
then
  echo "Stop live mapping backends before running an offline benchmark." >&2
  exit 1
fi

source_ros
bag_info="$(ros2 bag info "${BAG_PATH}")"
grep -q '/lidar_points' <<<"${bag_info}" || {
  echo "Bag does not contain /lidar_points." >&2
  exit 1
}
grep -q '/imu/data_raw' <<<"${bag_info}" || {
  echo "Bag does not contain /imu/data_raw." >&2
  exit 1
}

BAG_NAME="$(basename "${BAG_PATH}")"
RUN_NAME="${BAG_NAME}_$(date '+%Y%m%d_%H%M%S')"
OUTPUT_DIR="${BENCHMARK_ROOT}/${RUN_NAME}"
mkdir -p "${OUTPUT_DIR}"
printf '%s\n' "${bag_info}" >"${OUTPUT_DIR}/bag_info.txt"

if [[ "${MODE}" == "both" || "${MODE}" == "glim" ]]; then
  run_glim "${OUTPUT_DIR}/glim"
fi
if [[ "${MODE}" == "both" || "${MODE}" == "fastlio" ]]; then
  run_fastlio "${OUTPUT_DIR}/fastlio"
fi

declare -a TRAJECTORIES=()
[[ -s "${OUTPUT_DIR}/glim/map/odom_lidar.txt" ]] &&
  TRAJECTORIES+=(--trajectory "GLIM odometry=${OUTPUT_DIR}/glim/map/odom_lidar.txt")
[[ -s "${OUTPUT_DIR}/glim/map/traj_lidar.txt" ]] &&
  TRAJECTORIES+=(--trajectory "GLIM loop-closed=${OUTPUT_DIR}/glim/map/traj_lidar.txt")
[[ -s "${OUTPUT_DIR}/fastlio/trajectory.txt" ]] &&
  TRAJECTORIES+=(--trajectory "FAST-LIO2=${OUTPUT_DIR}/fastlio/trajectory.txt")

python3 "${SUMMARIZER}" \
  "${TRAJECTORIES[@]}" \
  --json "${OUTPUT_DIR}/summary.json" \
  --markdown "${OUTPUT_DIR}/summary.md"

echo "Benchmark complete: ${OUTPUT_DIR}"
