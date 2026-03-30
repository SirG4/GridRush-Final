# GridRush — High-Performance Sudoku Variant Solver (Rust)

GridRush is a blazing-fast Sudoku variant solver written in Rust. It utilizes advanced inference techniques, bitmask-based domain representation, and parallel execution to solve complex Sudoku variants in milliseconds.

## 🚀 Key Features

- **Sudoku Variant Support**: Handles Classic Sudoku, Even/Odd, Killer, Thermo, Arrow, and Kropki.
- **Advanced Inference Engine**: Employs bitmask domain representation, Arc-Consistency (AC-1) propagation, and Hidden Singles deduction.
- **Optimized Search**: Uses MRV (Minimum Remaining Values) heuristics for backtracking.
- **Parallel Solving**: Leverages `rayon` for solving multiple puzzles in parallel.
- **Structured Output**: Generates beautifully formatted `answer.json` matching specific visual templates (3x3 grid grouping, blank lines).

## 🛠️ Installation

Run the automated setup script to install necessary dependencies (Rust toolchain, C++ Build Tools) and compile the optimized binary.

**On Windows:**

```powershell
.\install.bat
```

_(Note: If you just installed the build tools, please restart your terminal after the script completes.)_

### Requirements

- **Rust (stable)**: The project is written in Rust for maximum performance.
- **C++ Build Tools**: Required on Windows for linking the Rust binary.

## 🏃 How to Run

Place your puzzle definitions in a file named `questions.json` in the root directory.

### Quick Start (Windows)

```powershell
.\run.bat
```

This script will automatically run the compiled Rust solver and generate `answer.json`.

### Manual Execution (Cargo)

```bash
cd rust_solver
cargo run --release ../questions.json
```

## 📂 Project Structure

- `rust_solver/src/`: Core logic in Rust.
  - `main.rs`: Entry point, JSON I/O, and output formatting logic.
  - `solver.rs`: Bitmask domain representation, AC-1 inference, and MRV backtracking.
  - `constraints.rs`: Implementation for All 6 variant constraints.
  - `precompute.rs`: Static lookup tables for peers, units, and killer combinations.
- `install.bat` / `install.ps1`: Automated environment setup and build scripts.
- `run.bat`: Runner script for the optimized binary.

## 🧠 Solvers & Optimizations

- **Bitmask Domains**: Cell candidates are stored in a 16-bit bitmask (`u16`) for efficiency.
- **Inference Engine**: Before backtracking, the solver exhausts all deterministic moves via hidden singles and peer elimination.
- **MRV (Minimum Remaining Values)**: Picks the cell with the fewest remaining candidates to explore during search to minimize the search tree.
- **Parallelism**: Puzzles are solved concurrently using a thread pool.
- **Visual Formatter**: A custom post-processor in `main.rs` ensures the `answer.json` is human-readable with 3x3 grid spacing.
