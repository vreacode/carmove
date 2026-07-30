#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
systemctl --user start nano-hesai-xt16.service 2>/dev/null || "${SCRIPT_DIR}/ensure_lidar_hesai_xt16.sh" start
source /opt/ros/humble/setup.bash
exec rviz2 -d "${ROOT_DIR}/config/navigation/hesai_xt16_lidar.rviz"
