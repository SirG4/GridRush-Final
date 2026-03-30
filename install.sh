#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

echo "=========================================="
echo "  Installing Sudoku Solver Requirements   "
echo "=========================================="

# 1. Download the nlohmann/json header file
JSON_VERSION="v3.11.3"
JSON_URL="https://github.com/nlohmann/json/releases/download/${JSON_VERSION}/json.hpp"
JSON_FILE="json.hpp"

echo "-> Fetching nlohmann/json (${JSON_VERSION})..."

if [ ! -f "$JSON_FILE" ]; then
    # Check if curl or wget is installed
    if command -v curl >/dev/null 2>&1; then
        curl -L -o "$JSON_FILE" "$JSON_URL"
    elif command -v wget >/dev/null 2>&1; then
        wget -O "$JSON_FILE" "$JSON_URL"
    else
        echo "Error: Neither curl nor wget is installed. Please install one of them to download dependencies."
        exit 1
    fi
    echo "Successfully downloaded json.hpp!"
else
    echo "json.hpp already exists in this directory. Skipping download."
fi

# 2. Check for a C++ compiler
echo ""
echo "-> Checking for C++ compiler..."
if command -v g++ >/dev/null 2>&1; then
    echo "g++ is installed: $(g++ --version | head -n 1)"
elif command -v clang++ >/dev/null 2>&1; then
    echo "clang++ is installed: $(clang++ --version | head -n 1)"
else
    echo "Warning: No C++ compiler (g++ or clang++) found."
    echo "Please install a C++ compiler to build the project."
    echo "  - On Ubuntu/Debian: sudo apt update && sudo apt install build-essential"
    echo "  - On macOS: xcode-select --install"
    exit 1
fi

echo ""
echo "=========================================="
echo "  All requirements are ready!             "
echo "=========================================="
echo "You can now run your compilation script: ./run.sh"