#!/bin/bash
set -e

echo "Setting up Emscripten..."
source ~/Projects/WASM/emsdk/emsdk_env.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

XERCES_SRC="$PROJECT_ROOT/native/xerces-c"
XERCES_BUILD="$XERCES_SRC/build-wasm"
XERCES_LIB="$XERCES_BUILD/src/libxerces-c.a"
BRIDGE="$PROJECT_ROOT/native/xerces_bridge.cpp"
OUT_DIR="$PROJECT_ROOT/wasm"

# ── Build Xerces-C as a WASM static library (only if not already built) ───────
if [ ! -f "$XERCES_LIB" ]; then
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
