#!/usr/bin/env bash
# Source this file after /opt/ros/humble/setup.bash to expose the local,
# non-root GLIM installation used on the Jetson.

GLIM_LOCAL_ROOT="${GLIM_LOCAL_ROOT:-/home/nvidia/glim_ws/local_root}"
GLIM_PREFIX="${GLIM_PREFIX:-${GLIM_LOCAL_ROOT}/opt/ros/humble}"

export GLIM_LOCAL_ROOT
export GLIM_PREFIX
export AMENT_PREFIX_PATH="${GLIM_PREFIX}:${AMENT_PREFIX_PATH:-}"
export CMAKE_PREFIX_PATH="${GLIM_PREFIX}:${GLIM_LOCAL_ROOT}/usr/local:${CMAKE_PREFIX_PATH:-}"
export LD_LIBRARY_PATH="${GLIM_PREFIX}/lib:${GLIM_LOCAL_ROOT}/usr/local/lib:${GLIM_LOCAL_ROOT}/usr/lib/aarch64-linux-gnu:/usr/local/cuda-12.6/lib64:${LD_LIBRARY_PATH:-}"
export PATH="${GLIM_PREFIX}/bin:${PATH}"
