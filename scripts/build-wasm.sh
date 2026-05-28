#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

EMSDK_DIR="$PROJECT_ROOT/tools/emsdk"
EMSDK_VERSION="5.0.6"

XERCES_SRC="$PROJECT_ROOT/native/xerces-c"
XERCES_BUILD="$XERCES_SRC/build-wasm"
XERCES_LIB="$XERCES_BUILD/src/libxerces-c.a"
BRIDGE="$PROJECT_ROOT/native/xerces_bridge.cpp"
OUT_DIR="$PROJECT_ROOT/wasm"

# ── Ensure emsdk submodule is checked out ─────────────────────────────────────
if [ ! -f "$EMSDK_DIR/emsdk" ]; then
  echo "Initialising emsdk submodule..."
  git -C "$PROJECT_ROOT" submodule update --init tools/emsdk
fi

# ── Install + activate the pinned Emscripten version (skip if already done) ───
if [ ! -f "$EMSDK_DIR/upstream/emscripten/emcc" ]; then
  echo "Installing Emscripten $EMSDK_VERSION (one-time download, ~500 MB)..."
  "$EMSDK_DIR/emsdk" install "$EMSDK_VERSION"
  "$EMSDK_DIR/emsdk" activate "$EMSDK_VERSION"
fi

echo "Setting up Emscripten environment..."
# shellcheck source=/dev/null
source "$EMSDK_DIR/emsdk_env.sh"

# ── Build Xerces-C as a WASM static library (only if not already built) ───────
if [ ! -f "$XERCES_LIB" ]; then
  if [ ! -f "$XERCES_SRC/CMakeLists.txt" ]; then
    echo "Initialising xerces-c submodule..."
    git -C "$PROJECT_ROOT" submodule update --init native/xerces-c
  fi

  echo "Building Xerces-C for WASM (this takes a few minutes)..."
  mkdir -p "$XERCES_BUILD"
  cd "$XERCES_BUILD"
  emcmake cmake "$XERCES_SRC" \
    -DCMAKE_BUILD_TYPE=Release \
    -Dnetwork=OFF \
    -Dtranscoder=gnuiconv \
    -DCMAKE_CXX_FLAGS="-fexceptions" \
    -DBUILD_SHARED_LIBS=OFF \
    -Dthreads=OFF \
    -Dmessage-loader=inmemory
  emmake make -j$(sysctl -n hw.logicalcpu 2>/dev/null || echo 4) xerces-c
  cd "$PROJECT_ROOT"
  echo "Xerces-C WASM build complete."
else
  echo "Xerces-C WASM library already built, skipping."
fi

mkdir -p "$OUT_DIR"

echo "Compiling xerces_bridge.cpp to WASM..."
em++ "$BRIDGE" \
  -I "$XERCES_SRC/src" \
  -I "$XERCES_BUILD/src" \
  "$XERCES_LIB" \
  --bind \
  -fexceptions \
  -s DISABLE_EXCEPTION_CATCHING=0 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME=XercesModule \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap"]' \
  -O2 \
  -o "$OUT_DIR/xerces_validator.js"

echo "Done → wasm/xerces_validator.js + wasm/xerces_validator.wasm"
