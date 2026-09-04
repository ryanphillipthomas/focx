#!/bin/sh
set -eu

PACKAGE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BUILD_DIR=${FOCX_BROKER_BUILD_DIR:-"$PACKAGE_DIR/build"}
CLANG_CACHE_DIR=${CLANG_MODULE_CACHE_PATH:-"$BUILD_DIR/clang-cache"}

mkdir -p "$BUILD_DIR" "$CLANG_CACHE_DIR"
CLANG_MODULE_CACHE_PATH="$CLANG_CACHE_DIR" /usr/bin/clang \
  -fobjc-arc \
  -Wall \
  -Wextra \
  -Werror \
  -Wno-deprecated-declarations \
  -framework Foundation \
  -framework Security \
  "$PACKAGE_DIR/src/focx-credential-broker.m" \
  -o "$BUILD_DIR/focx-credential-broker"

echo "$BUILD_DIR/focx-credential-broker"
