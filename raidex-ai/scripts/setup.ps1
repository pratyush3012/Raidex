param(
  [switch]$SkipModelPull
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root

Write-Host "Raidex AI setup starting..."

function Get-OllamaPath {
  $cmd = Get-Command ollama -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @(
    "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe",
    "$env:LOCALAPPDATA\Ollama\ollama.exe",
    "$env:ProgramFiles\Ollama\ollama.exe"
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) { return $candidate }
  }
  return $null
}

$Ollama = Get-OllamaPath
if (-not $Ollama) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "Ollama is missing and winget is not available. Install Ollama manually from https://ollama.com/download/windows"
  }
  Write-Host "Installing Ollama via winget..."
  winget install --id Ollama.Ollama --source winget --accept-package-agreements --accept-source-agreements
  $Ollama = Get-OllamaPath
}

if (-not (Get-Process -Name "ollama" -ErrorAction SilentlyContinue)) {
  Write-Host "Starting Ollama service..."
  Start-Process -FilePath $Ollama -ArgumentList "serve" -WindowStyle Hidden
  Start-Sleep -Seconds 6
}

python .\raidex-ai\scripts\raidex_ai.py doctor

if (-not $SkipModelPull) {
  python .\raidex-ai\scripts\raidex_ai.py pull-models
}

Write-Host "Raidex AI setup complete."
