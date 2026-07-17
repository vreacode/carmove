#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

log "demo stack shutdown begin"

stop_component "server"
stop_component "agent"
stop_component "imu_republisher"
stop_component "imu_driver"
stop_component "lidar_driver"

stop_by_pattern "dashboard_platform.server.app:app" "server"
stop_by_pattern "dashboard_platform.agent.app:app" "agent"
stop_by_pattern "dashboard_platform/agent/imu_republisher.py" "imu republisher"
stop_by_pattern "yesense_node.launch.py" "imu driver launch"
stop_by_pattern "yesense_node_publisher" "imu driver node"
stop_by_pattern "lslidar_c16driver_node" "lidar driver node"
stop_by_pattern "rviz2" "rviz2"

log "demo stack shutdown complete"
