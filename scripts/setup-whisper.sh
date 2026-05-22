#!/usr/bin/env bash
# Builds whisper.cpp v1.8.4 from source and installs the whisper-cli binary
# into resources/whisper/. Run once at dev time on macOS arm64. Metal is
# enabled by default on macOS, so no extra flag is needed. The model file is
# downloaded at app first run, not here.
set -euo pipefail

WHISPER_TAG="v1.8.4"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST_DIR="${REPO_ROOT}/resources/whisper"
BUILD_DIR="$(mktemp -d)"

echo "Cloning whisper.cpp ${WHISPER_TAG} into ${BUILD_DIR}"
git clone --depth 1 --branch "${WHISPER_TAG}" \
  https://github.com/ggml-org/whisper.cpp.git "${BUILD_DIR}/whisper.cpp"

cd "${BUILD_DIR}/whisper.cpp"
echo "Configuring with CMake"
# BUILD_SHARED_LIBS=OFF links libwhisper and the ggml libraries statically
# into whisper-cli. The Metal shader library is embedded by default, so the
# result is a single self-contained binary with no @rpath dylib dependencies.
cmake -B build -DBUILD_SHARED_LIBS=OFF
echo "Building whisper-cli (Release)"
cmake --build build --config Release -j

mkdir -p "${DEST_DIR}"
cp "build/bin/whisper-cli" "${DEST_DIR}/whisper-cli"
chmod +x "${DEST_DIR}/whisper-cli"
echo "Installed whisper-cli to ${DEST_DIR}/whisper-cli"

rm -rf "${BUILD_DIR}"
echo "Done. The model is downloaded automatically on first app run."
