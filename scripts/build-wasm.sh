#!/bin/bash
set -e

echo "Setting up Emscripten..."
source ~/Projects/WASM/emsdk/emsdk_env.sh

XERCES_SRC="$HOME/Projects/WASM/xerces-c/src"
XERCES_BUILD_SRC="$HOME/Projects/WASM/xerces-c/build-wasm/src"
XERCES_LIB="$HOME/Projects/WASM/xerces-c/build-wasm/src/libxerces-c.a"
BRIDGE="$PWD/native/xerces_bridge.cpp"
OUT_DIR="$PWD/wasm"

mkdir -p $OUT_DIR

echo "Compiling xerces_bridge.cpp to WASM..."
em++ $BRIDGE \
  -I $XERCES_SRC \
  -I $XERCES_BUILD_SRC \
  $XERCES_LIB \
  --bind \
  -fexceptions \
  -s DISABLE_EXCEPTION_CATCHING=0 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME=XercesModule \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap"]' \
  -O2 \
  -o $OUT_DIR/xerces_validator.js

echo "Done → wasm/xerces_validator.js + wasm/xerces_validator.wasm"
