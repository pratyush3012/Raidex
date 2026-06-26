$ErrorActionPreference = "SilentlyContinue"
Get-Process -Name "ollama" | Stop-Process
Write-Host "Raidex AI local services stopped."
