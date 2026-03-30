# install.ps1 - GridRush solver setup
Write-Host "=== GridRush Solver - Install ===" -ForegroundColor Cyan

# 1. Python Check
$pBin = Get-Command python3, python -ErrorAction SilentlyContinue | Select-Object -First 1
if ($pBin) {
    Write-Host "[OK] Python detected at $($pBin.Source)" -ForegroundColor Green
}

# 2. Rust Check
Write-Host "--- Checking Rust Toolchain ---" -ForegroundColor Gray
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    $cargoPath = "$env:USERPROFILE\.cargo\bin\cargo.exe"
    if (Test-Path $cargoPath) {
        $env:Path += ";$env:USERPROFILE\.cargo\bin"
        Write-Host "[OK] Found Rust. PATH updated." -ForegroundColor Green
    } else {
        Write-Host "Rust toolchain not found. Downloading rustup-init..." -ForegroundColor Yellow
        $url = "https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe"
        Invoke-WebRequest -Uri $url -OutFile "rustup-init.exe"
        Write-Host "Installing Rust (Silent)..." -ForegroundColor Cyan
        Start-Process -FilePath ".\rustup-init.exe" -ArgumentList "-y", "--default-toolchain", "stable", "--profile", "minimal" -Wait
        Remove-Item ".\rustup-init.exe"
        $env:Path += ";$env:USERPROFILE\.cargo\bin"
        Write-Host "[OK] Rust installed." -ForegroundColor Green
    }
}

Write-Host "Building optimized Rust solver..." -ForegroundColor Cyan
cargo build --release --manifest-path "rust_solver\Cargo.toml"

Write-Host "`nSetup complete." -ForegroundColor Gray
Write-Host "Usage:  .\benchmark.ps1" -ForegroundColor Green
