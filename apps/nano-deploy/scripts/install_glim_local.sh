#!/usr/bin/env bash
set -euo pipefail

# Install the official GLIM 1.2.2 CUDA 12.6 ARM64 binaries without modifying
# apt sources or writing into system directories. Files are extracted into a
# dedicated local root and loaded through config/outdoor/glim_local_setup.bash.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
GLIM_WORKSPACE="${GLIM_WORKSPACE:-/home/nvidia/glim_ws}"
GLIM_LOCAL_ROOT="${GLIM_LOCAL_ROOT:-${GLIM_WORKSPACE}/local_root}"
DEB_CACHE="${GLIM_DEB_CACHE:-${GLIM_WORKSPACE}/debs}"
SETUP_FILE="${ROOT_DIR}/config/outdoor/glim_local_setup.bash"
PPA_BASE="https://koide3.github.io/ppa/ubuntu2204"
UBUNTU_PORTS_BASE="https://ports.ubuntu.com/ubuntu-ports"

declare -a PACKAGES=(
  "libgtsam-notbb-dev_4.3.0_arm64.deb|${PPA_BASE}/libgtsam-notbb-dev_4.3.0_arm64.deb|aa610582fc1e799a800b673f5f0016124a8f7819301b131d337770735c59eb91"
  "libgtsam-points-cuda12.6-dev_1.2.2_arm64.deb|${PPA_BASE}/libgtsam-points-cuda12.6-dev_1.2.2_arm64.deb|388f5294f9241ee49ae15ed2d71337491cf271b1c3c203acae662c30c017bf01"
  "libiridescence-dev_1.0.2_arm64.deb|${PPA_BASE}/libiridescence-dev_1.0.2_arm64.deb|d5d946ee7ffa8f9de795cd28713317a62b8b59c192271446c81b1a19046f1180"
  "ros-humble-glim-cuda12.6_1.2.2-0jammy_arm64.deb|${PPA_BASE}/ros-humble-glim-cuda12.6_1.2.2-0jammy_arm64.deb|9d3b9bec13cb078ab3d86afaf239eb0bc928c8481846a61e63d47234ed905412"
  "ros-humble-glim-ros-cuda12.6_1.2.2-0jammy_arm64.deb|${PPA_BASE}/ros-humble-glim-ros-cuda12.6_1.2.2-0jammy_arm64.deb|ec896d955192e7e6278c5d3350b3f38bdb8a12142ce6eacad7faf52612acd77b"
  "libglfw3_3.3.6-1_arm64.deb|${UBUNTU_PORTS_BASE}/pool/universe/g/glfw3/libglfw3_3.3.6-1_arm64.deb|7059ebdbe088179b24f9cac9fe40988455a7fd3a39196cdcf5cb10d3d8c73635"
)

download_verified() {
  local filename="$1"
  local url="$2"
  local expected_sha="$3"
  local target="${DEB_CACHE}/${filename}"
  local actual_sha=""

  if [[ -f "${target}" ]]; then
    actual_sha="$(sha256sum "${target}" | awk '{print $1}')"
  fi
  if [[ "${actual_sha}" != "${expected_sha}" ]]; then
    rm -f "${target}.part"
    curl --fail --location --retry 3 --output "${target}.part" "${url}"
    actual_sha="$(sha256sum "${target}.part" | awk '{print $1}')"
    if [[ "${actual_sha}" != "${expected_sha}" ]]; then
      rm -f "${target}.part"
      echo "Checksum mismatch for ${filename}" >&2
      return 1
    fi
    mv "${target}.part" "${target}"
  fi
  printf '%s\n' "${target}"
}

if [[ "$(dpkg --print-architecture)" != "arm64" ]]; then
  echo "This pinned installer is only for the Jetson ARM64 host." >&2
  exit 1
fi
if [[ ! -f /opt/ros/humble/setup.bash ]]; then
  echo "ROS 2 Humble is not installed at /opt/ros/humble." >&2
  exit 1
fi
if [[ ! -d /usr/local/cuda-12.6 ]]; then
  echo "CUDA 12.6 was not found at /usr/local/cuda-12.6." >&2
  exit 1
fi
[[ -f "${SETUP_FILE}" ]] || {
  echo "Missing GLIM environment file: ${SETUP_FILE}" >&2
  exit 1
}

mkdir -p "${DEB_CACHE}" "${GLIM_LOCAL_ROOT}"
for package_entry in "${PACKAGES[@]}"; do
  IFS='|' read -r filename url expected_sha <<<"${package_entry}"
  package_path="$(download_verified "${filename}" "${url}" "${expected_sha}")"
  dpkg-deb --extract "${package_path}" "${GLIM_LOCAL_ROOT}"
done

set +u
source /opt/ros/humble/setup.bash
source "${SETUP_FILE}"
set -u

GLIM_NODE="${GLIM_PREFIX}/lib/glim_ros/glim_rosnode"
[[ -x "${GLIM_NODE}" ]] || {
  echo "GLIM executable was not extracted correctly: ${GLIM_NODE}" >&2
  exit 1
}

missing_libraries="$(ldd "${GLIM_NODE}" | awk '/not found/{print}')"
if [[ -n "${missing_libraries}" ]]; then
  echo "GLIM still has unresolved runtime libraries:" >&2
  printf '%s\n' "${missing_libraries}" >&2
  exit 1
fi
glim_executables="$(ros2 pkg executables glim_ros)"
grep -q 'glim_rosnode' <<<"${glim_executables}"

echo "GLIM 1.2.2 local installation is ready."
echo "  root: ${GLIM_LOCAL_ROOT}"
echo "  setup: ${SETUP_FILE}"
echo "  no system package or sudo change was made"
