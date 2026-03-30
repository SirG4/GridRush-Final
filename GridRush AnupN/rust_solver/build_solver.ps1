# build_solver.ps1 - Robust build script for GridRush
$ErrorActionPreference = "SilentlyContinue"

Write-Host "--- Searching for Rust Toolchain ---" -ForegroundColor Gray

$paths = @(
    "$env:USERPROFILE\.cargo\bin\cargo.exe",
    "C:\Users\Jhimp\.cargo\bin\cargo.exe",
    "C:\Program Files\Rust\bin\cargo.exe",
    "D:\.cargo\bin\cargo.exe"
)

$cargoPath = ""

# 1. Check if cargo is already in PATH
if (Get-Command cargo) {
    $cargoPath = "cargo"
} else {
    # 2. Check common absolute paths
    foreach ($p in $paths) {
        if (Test-Path $p) {
            $cargoPath = "& '$p'"
            break
        }
    }
}

# 3. Last ditch: search C:\Users (might be slow)
if (-not $cargoPath) {
    Write-Host "Searching C:\Users for cargo.exe..." -ForegroundColor Yellow
    $found = Get-ChildItem -Path C:\Users -Filter cargo.exe -Recurse -Depth 4 | Select-Object -First 1
    if ($found) {
        $cargoPath = "& '$($found.FullName)'"
    }
}

if ($cargoPath) {
    Write-Host "[OK] Found cargo: $cargoPath" -ForegroundColor Green
    Write-Host "Building optimized release binary..." -ForegroundColor Cyan
    Invoke-Expression "$cargoPath build --release"
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[SUCCESS] Solver built successfully." -ForegroundColor Green
    } else {
        Write-Error "Build failed with exit code $LASTEXITCODE"
    }
} else {
    Write-Error "Could not find 'cargo.exe'. Please ensure Rust is installed from https://rustup.rs/"
}
