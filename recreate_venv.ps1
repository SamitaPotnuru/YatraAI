# Fix broken venv (was created in D:\firefox\Samis). Run from D:\firefox\YatraAI
Remove-Item -Recurse -Force .venv -ErrorAction SilentlyContinue
python -m venv .venv
.\.venv\Scripts\pip.exe install -r requirements.txt
Write-Host "Done. Activate with: .\.venv\Scripts\Activate.ps1"
