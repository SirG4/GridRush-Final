@echo off
REM run.bat — GridRush solver runner (Windows)
REM Optimized for performance (prefer Rust)
REM Requirements: questions.json as input, answer.json as output.

set RUST_BIN="rust_solver\target\release\grid_rush.exe"
set INPUT="questions.json"

if not exist %INPUT% (
    echo ERROR: questions.json not found.
    exit /b 1
)

if exist %RUST_BIN% (
    REM Run optimized Rust solver
    %RUST_BIN% %INPUT%
) else (
    REM Fallback to Python
    python --version >nul 2>&1
    if %errorlevel% neq 0 (
        echo ERROR: Neither Rust binary nor Python found. Please run install.bat.
        exit /b 1
    )
    python solve.py %INPUT%
)
