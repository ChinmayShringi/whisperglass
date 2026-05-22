#!/usr/bin/env bash
# Builds the Customcluely Swift capture sidecar in release mode and installs
# the binary into resources/sidecar/. Run once at dev time on macOS arm64.
# Mirrors scripts/setup-whisper.sh: a dev-time native build that commits its
# product so the app runs without a build step.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SIDECAR_DIR="${REPO_ROOT}/sidecar"
DEST_DIR="${REPO_ROOT}/resources/sidecar"

echo "Building customcluely-sidecar (release)"
swift build -c release --package-path "${SIDECAR_DIR}"

BUILT_BINARY="${SIDECAR_DIR}/.build/release/customcluely-sidecar"
if [ ! -x "${BUILT_BINARY}" ]; then
  echo "Build did not produce ${BUILT_BINARY}" >&2
  exit 1
fi

mkdir -p "${DEST_DIR}"
cp "${BUILT_BINARY}" "${DEST_DIR}/customcluely-sidecar"
chmod +x "${DEST_DIR}/customcluely-sidecar"
echo "Installed customcluely-sidecar to ${DEST_DIR}/customcluely-sidecar"
