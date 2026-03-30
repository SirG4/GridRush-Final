Write-Host "--- Initializing Indestructible Setup ---" -ForegroundColor Cyan
$Exe = "none"
$Candidates = @("pypy3", "pypy", "py", "python", "python3")
foreach ($cmd in $Candidates) {
    if (Get-Command $cmd -ErrorAction SilentlyContinue) { $Exe = $cmd; break }
}
if ($Exe -eq "none") {
    Write-Host "[ERROR] No Python found. Please install Python." -ForegroundColor Red
    exit
}
Write-Host "[FOUND] Using environment: $Exe" -ForegroundColor Green
& $Exe -m pip install orjson --prefer-binary
Write-Host "[SUCCESS] Setup Complete." -ForegroundColor Green