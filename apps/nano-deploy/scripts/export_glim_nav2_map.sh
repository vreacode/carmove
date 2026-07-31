#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  echo "Usage: $0 <glim_map_directory> [output_directory] [map_name]" >&2
}

[[ $# -ge 1 && $# -le 3 ]] || {
  usage
  exit 2
}

MAP_DIR="$(realpath "$1")"
OUTPUT_DIR="${2:-$(dirname "${MAP_DIR}")/nav2_map}"
MAP_NAME="${3:-glim_nav2_map}"
OUTPUT_DIR="$(realpath -m "${OUTPUT_DIR}")"
PLY_PATH="${OUTPUT_DIR}/optimized_map.ply"

mkdir -p "${OUTPUT_DIR}"
"${SCRIPT_DIR}/export_glim_map.sh" "${MAP_DIR}" "${PLY_PATH}"
python3 "${SCRIPT_DIR}/project_pointcloud_to_nav2.py" \
  "${PLY_PATH}" "${OUTPUT_DIR}" --map-name "${MAP_NAME}"

echo "Nav2 projection ready for review: ${OUTPUT_DIR}/${MAP_NAME}.yaml"
echo "Do not start autonomous motion until the PGM and projection report have been reviewed."
