# GridRush Sudoku Solver

Need the shortest setup path?

1. Start with [docs/QUICKSTART.md](docs/QUICKSTART.md)

## Required After Clone

After cloning this repository, build the C++ solver backend before `npm start`.
If you do not, you can get this runtime error:

`Solver binary not found. Build backend first with cmake -S . -B build && cmake --build build`

From repository root, run:

```bash
cmake -S . -B build
cmake --build build
```

Or as a single command:

```bash
cmake -S . -B build && cmake --build build
```

GridRush is a full-stack Sudoku variant solver with:

1. C++ solver core (classic + variants + uniqueness/count support)
2. Node/Express API server
3. Browser UI (served statically by the Node server)

Supported categories:

1. Classic
2. Even/Odd
3. Killer
4. Thermo
5. Arrow
6. Kropki
7. Hybrid (mixed constraints)

## Project Layout

1. Solver source: [src](src)
2. Solver headers: [include](include)
3. API server: [server/index.js](server/index.js)
4. Frontend files: [frontend](frontend)
5. Build config: [CMakeLists.txt](CMakeLists.txt), [package.json](package.json)

## Prerequisites

Install these first.

### Common (Windows + macOS)

1. Node.js 18+ (includes npm)
2. CMake 3.16+
3. C++17-capable compiler toolchain
4. Internet access during first CMake configure (CMake fetches nlohmann_json if missing)

### Windows Toolchain Options

Pick one:

1. Visual Studio 2022 Build Tools (Desktop C++)
2. LLVM/Clang with MinGW runtime

### macOS Toolchain

1. Xcode Command Line Tools

Command:

```bash
xcode-select --install
```

## One-Time Dependency Install

From repository root:

```bash
npm install
```

This installs server dependencies from [package.json](package.json).

## Build the C++ Solver

The server searches for solver binaries in these locations:

1. Windows first: `build-win/sudoku_solver.exe` (preferred)
2. Fallbacks: `build/sudoku_solver(.exe)` and config-specific subfolders

### Windows (recommended)

Use a dedicated Windows build directory so server resolution is straightforward.

```powershell
cmake -S . -B build-win
cmake --build build-win
```

If CMake is installed but not in `PATH`, `install.bat` also supports:

```powershell
$env:CMAKE_EXE_OVERRIDE="C:\Program Files\CMake\bin\cmake.exe"
.\install.bat
```

Expected binary:

1. `build-win/sudoku_solver.exe`

### macOS

```bash
cmake -S . -B build
cmake --build build
```

If CMake is installed in a custom location, `install.sh` supports:

```bash
CMAKE_BIN=/custom/path/cmake ./install.sh
```

Expected binary:

1. `build/sudoku_solver`

## Start the Application

From repository root:

```bash
npm start
```

Open:

1. http://localhost:3000

## Health Check

Use this to confirm server and solver visibility:

1. Browser: http://localhost:3000/api/health
2. Response includes `solverFound` and detected `solverPath`

If `solverFound` is `false`, build the solver first.

## Quick User Flow

1. Launch app in browser
2. Pick category
3. Enter givens in grid
4. Add/edit variant data using tools and/or JSON box
5. Click Start Solver
6. Optionally click Check Uniqueness
7. Read solved grid + uniqueness + solution count metadata

## CLI Solver Usage (Optional)

### Windows

```powershell
.\build-win\sudoku_solver.exe path\to\puzzle.json
```

### macOS

```bash
./build/sudoku_solver path/to/puzzle.json
```

## Puzzle JSON Reference

Coordinates are 1-based in JSON.

1. `category`: `classic|even-odd|killer|thermo|arrow|kropki|hybrid`
2. `givens_grid`: 9x9 integers in `0..9` (`0` means empty)
3. `check_uniqueness`: boolean
4. `max_solution_count`: optional positive integer cap
5. `emit_logs`: optional boolean

Variant fields:

1. Even/Odd: `even_cells`, `odd_cells` as `[row,col]` arrays
2. Killer: `killer_cages` with `sum` and `cells`
3. Thermo: `thermos` with ordered `cells` (bulb to tip)
4. Arrow: `arrows` with `circle` and `path`
5. Kropki: `kropki` with `a`, `b`, `type: white|black`
6. Hybrid: combine any/all above variant fields

## Environment Variables

The API server supports:

1. `PORT` (default `3000`)
2. `SOLVER_TIMEOUT_MS` (default `180000`)

Examples:

### Windows PowerShell

```powershell
$env:PORT=3001
$env:SOLVER_TIMEOUT_MS=240000
npm start
```

### macOS

```bash
PORT=3001 SOLVER_TIMEOUT_MS=240000 npm start
```

## Troubleshooting

### 1) `solverFound: false`

Cause:

1. Solver not built
2. Built in unexpected folder

Fix:

1. Windows: build to `build-win`
2. macOS: build to `build`
3. Recheck `/api/health`

### 2) Port already in use

Symptoms:

1. Server fails to start on 3000

Fix:

1. Stop existing process on port 3000
2. Or run with another port (`PORT=3001`)

### 3) Solver timeout on difficult puzzles

Symptoms:

1. API returns timeout message

Fix:

1. Add more givens/constraints
2. Increase `SOLVER_TIMEOUT_MS`
3. Reduce uniqueness/count request scope where possible

### 4) Build errors on first configure

Cause:

1. Missing compiler tools
2. CMake cannot fetch dependencies due to network restrictions

Fix:

1. Install/update toolchain
2. Ensure outbound access to dependency URL used by CMake

## Clean Rebuild

If build artifacts are stale:

### Windows

```powershell
Remove-Item -Recurse -Force build-win
cmake -S . -B build-win
cmake --build build-win
```

### macOS

```bash
rm -rf build
cmake -S . -B build
cmake --build build
```

## Minimal Start Commands

If someone has only this repository and wants to run quickly:

### Windows

```powershell
npm install
cmake -S . -B build-win
cmake --build build-win
npm start
```

### macOS

```bash
npm install
cmake -S . -B build
cmake --build build
npm start
```

Then open:

1. http://localhost:3000
