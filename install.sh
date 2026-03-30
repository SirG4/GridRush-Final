#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

CMAKE_BIN="${CMAKE_BIN:-${CMAKE_COMMAND:-}}"

if [[ -n "$CMAKE_BIN" && ! -x "$CMAKE_BIN" ]]; then
  echo "ERROR: CMAKE_BIN/CMAKE_COMMAND is set but not executable: $CMAKE_BIN"
  exit 1
fi

if [[ -z "$CMAKE_BIN" ]]; then
  if command -v cmake >/dev/null 2>&1; then
    CMAKE_BIN="$(command -v cmake)"
  elif [[ -x "/opt/homebrew/bin/cmake" ]]; then
    CMAKE_BIN="/opt/homebrew/bin/cmake"
  elif [[ -x "/usr/local/bin/cmake" ]]; then
    CMAKE_BIN="/usr/local/bin/cmake"
  elif [[ -x "/usr/bin/cmake" ]]; then
    CMAKE_BIN="/usr/bin/cmake"
  fi
fi

if [[ -z "$CMAKE_BIN" ]]; then
  echo "ERROR: cmake executable not found."
  echo "       Install CMake or set CMAKE_BIN to its full path."
  exit 1
fi

echo "Using CMake: $CMAKE_BIN"

BUILD_DIR="build"
case "${OSTYPE:-}" in
  msys*|cygwin*|win32*) BUILD_DIR="build-win" ;;
esac

"$CMAKE_BIN" -S . -B "$BUILD_DIR" -DCMAKE_BUILD_TYPE=Release
"$CMAKE_BIN" --build "$BUILD_DIR" --config Release

echo "Build completed successfully."
