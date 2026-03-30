#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

# File definitions
SRC_FILE="main.cpp"
EXEC_FILE="./sudoku_solver"
INPUT_FILE="questions.json"
OUTPUT_FILE="answer.json"

echo "====================================="
echo "  Compiling Sudoku CSP Solver...     "
echo "====================================="

# Check if main.cpp exists
if [ ! -f "$SRC_FILE" ]; then
    echo "Error: $SRC_FILE not found in the current directory."
    exit 1
fi

# Compile the C++ code
# Note: Using -O3 flag for maximum optimization, which makes CSP solvers much faster
g++ -O3 -std=c++17 "$SRC_FILE" -o sudoku_solver

echo "Compilation successful!"
echo ""
echo "====================================="
echo "  Running Solver...                  "
echo "====================================="

# Check if questions.json exists
if [ ! -f "$INPUT_FILE" ]; then
    echo "Error: $INPUT_FILE not found. Please ensure your questions file is in this directory."
    exit 1
fi

# Run the compiled executable, passing the filenames as arguments
$EXEC_FILE "$INPUT_FILE" "$OUTPUT_FILE"

echo "Done! The results have been saved to $OUTPUT_FILE."