Write-Host "--- Launching Hybrid Speed Solver ---" -ForegroundColor Cyan
$Exe = "none"
$Candidates = @("pypy3", "pypy", "py", "python", "python3")
foreach ($cmd in $Candidates) {
    if (Get-Command $cmd -ErrorAction SilentlyContinue) { $Exe = $cmd; break }
}
if ($Exe -eq "none") {
    Write-Host "[ERROR] Execution engine not found." -ForegroundColor Red
    exit
}
& $Exe main.py
Write-Host "---------------------------------------"
Write-Host "[SUCCESS] answer.json generated!" -ForegroundColor Green
Read-Host -Prompt "Press Enter to exit..."