# Recreate venv if pip points at an old path. Run from repo root.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..
Remove-Item -Recurse -Force .venv -ErrorAction SilentlyContinue
python -m venv .venv
.\.venv\Scripts\pip.exe install -r requirements.txt
Write-Host "Done. Run: .\.venv\Scripts\python.exe app.py"
