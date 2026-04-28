#!/bin/bash
set -e

echo "Setting up Emscripten..."
source ~/Projects/WASM/emsdk/emsdk_env.sh

XERCES_SRC="$PWD/native/xerces-c/src"
XERCES_LIB="$PWD/../xerces-c/build-wasm/src/libxerces-c.a"
BRIDGE="$PWD/native/xerces_bridge.cpp"
OUT_DIR="$PWD/wasm"

mkdir -p $OUT_DIR

echo "Compiling xerces_bridge.cpp to WASM..."
em++ $BRIDGE \
  -I $XERCES_SRC \
  $XERCES_LIB \
  --bind \
  -s MODULARIZE=1 \
  -s EXPORT_NAME=XercesModule \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap"]' \
  -O2 \
  -o $OUT_DIR/xerces_validator.js

echo "SUCCESS: wasm/xerces_validator.js + wasm/xerces_validator.wasm"
