@echo off
setlocal
REM install.bat — Complete setup for GridRush
echo === GridRush Setup — Automated Dependencies ===

REM 1. Python Check
echo --- Checking Python ---
python --version >nul 2>&1
if errorlevel 1 (
    echo WARNING: Python not found. Some fallback scripts may not work.
) else (
    echo [OK] Python detected.
)

REM 2. Linker Check (Critical for Rust)
echo --- Checking C++ Linker (MSVC) ---
where link.exe >nul 2>&1
if errorlevel 1 (
    echo C++ Linker ^(link.exe^) NOT found. 
    echo This is required to compile Rust on Windows.
    echo Searching for Visual Studio Build Tools via winget...
    
    winget --version >nul 2>&1
    if errorlevel 1 (
        echo ERROR: 'winget' not found. Please install the "C++ Build Tools" manually from:
        echo https://visualstudio.microsoft.com/visual-cpp-build-tools/
        goto :RUST_CHECK
    )

    echo Installing Visual Studio Build Tools ^(Silent, ~1-2GB download^)...
    echo This may take a while depending on your connection.
    winget install --id Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive --norestart --wait"
    if errorlevel 1 (
        echo ERROR: Install failed. Try running it as administrator or install manually.
    ) else (
        echo [OK] Build Tools installed. Please restart your terminal after completion.
    )
) else (
    echo [OK] Linker detected.
)

:RUST_CHECK
REM 3. Rust Check & Compile
echo --- Checking Rust Toolchain ---
cargo --version >nul 2>&1
if errorlevel 1 (
    echo Rust/Cargo not found.
    
    if exist "%USERPROFILE%\.cargo\bin\cargo.exe" (
        set "PATH=%PATH%;%USERPROFILE%\.cargo\bin"
        echo [OK] Found Rust. Path updated for this session.
        goto :BUILD
    )

    echo Attempting auto-install of Rust ^(rustup-init^)...
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe' -OutFile 'rustup-init.exe'"
    if not exist rustup-init.exe (
        echo ERROR: Failed to download rustup-init.exe. Please visit https://rustup.rs/
        goto :EXIT
    )

    echo Running rustup-init ^(Silent^)...
    .\rustup-init.exe -y --default-toolchain stable --profile minimal
    del rustup-init.exe
    
    set "PATH=%PATH%;%USERPROFILE%\.cargo\bin"
    echo [OK] Rust installed.
) else (
    echo [OK] Rust/Cargo detected.
)

:BUILD
echo --- Building Optimized Solver ---
echo This will take a moment...
cargo build --release --manifest-path "rust_solver\Cargo.toml"
if errorlevel 1 (
    echo ERROR: Build failed. If you just installed Build Tools, PLEASE RESTART YOUR TERMINAL.
) else (
    echo [OK] Solver compiled successfully.
    echo.
    echo All set! run.bat is now ready for maximum performance.
)

:EXIT
echo.
echo Setup complete.
pause
