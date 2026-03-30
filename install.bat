@echo off
setlocal

set SCRIPT_DIR=%~dp0
pushd "%SCRIPT_DIR%"

set "CMAKE_EXE="

if defined CMAKE_EXE_OVERRIDE (
  if exist "%CMAKE_EXE_OVERRIDE%" set "CMAKE_EXE=%CMAKE_EXE_OVERRIDE%"
)

if not defined CMAKE_EXE (
  for /f "delims=" %%i in ('where cmake 2^>nul') do (
    set "CMAKE_EXE=%%i"
    goto :cmake_found
  )
)

if not defined CMAKE_EXE if defined ProgramFiles if exist "%ProgramFiles%\CMake\bin\cmake.exe" set "CMAKE_EXE=%ProgramFiles%\CMake\bin\cmake.exe"
if not defined CMAKE_EXE if defined ProgramFiles(x86) if exist "%ProgramFiles(x86)%\CMake\bin\cmake.exe" set "CMAKE_EXE=%ProgramFiles(x86)%\CMake\bin\cmake.exe"
if not defined CMAKE_EXE if defined LocalAppData if exist "%LocalAppData%\Programs\CMake\bin\cmake.exe" set "CMAKE_EXE=%LocalAppData%\Programs\CMake\bin\cmake.exe"

:cmake_found
if not defined CMAKE_EXE (
	echo ERROR: CMake executable not found.
	echo        Install CMake or set CMAKE_EXE_OVERRIDE to the full path, e.g.
	echo        set CMAKE_EXE_OVERRIDE=C:\Program Files\CMake\bin\cmake.exe
	goto :fail
)

echo Using CMake: %CMAKE_EXE%

"%CMAKE_EXE%" -S . -B build-win -DCMAKE_BUILD_TYPE=Release
if errorlevel 1 goto :fail

"%CMAKE_EXE%" --build build-win --config Release
if errorlevel 1 goto :fail

echo Build completed successfully.
popd
exit /b 0

:fail
echo Build failed.
popd
exit /b 1
