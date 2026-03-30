@echo off
title GridRush - Hybrid Speed Solver
color 0B
echo ---------------------------------------
echo [START] Launching Hybrid Speed Solver...
echo ---------------------------------------

set EXE=none
for %%i in (pypy3 pypy py python python3) do (
    where %%i >nul 2>nul && set EXE=%%i && goto :found
)

:found
if "%EXE%"=="none" (
    color 0C
    echo [ERROR] Execution engine not found.
    pause
    exit
)

echo [INFO] Running main.py with %EXE%...
%EXE% main.py

echo ---------------------------------------
echo [SUCCESS] answer.json generated!
echo ---------------------------------------
pause