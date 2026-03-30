@echo off
title GridRush - Setup
color 0B
echo ---------------------------------------
echo [INIT] Initializing Setup...
echo ---------------------------------------

set EXE=none
for %%i in (pypy3 pypy py python python3) do (
    where %%i >nul 2>nul && set EXE=%%i && goto :found
)

:found
if "%EXE%"=="none" (
    color 0C
    echo [ERROR] No Python found. Please install Python first.
    pause
    exit
)

echo [FOUND] Using environment: %EXE%
%EXE% -m pip install orjson --prefer-binary
echo ---------------------------------------
echo [SUCCESS] Setup Complete.
echo ---------------------------------------
pause