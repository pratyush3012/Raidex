$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root

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
  throw "Ollama is not installed. Run raidex-ai\scripts\setup.ps1 first."
}

if (-not (Get-Process -Name "ollama" -ErrorAction SilentlyContinue)) {
  Start-Process -FilePath $Ollama -ArgumentList "serve" -WindowStyle Hidden
  Start-Sleep -Seconds 5
}

python .\raidex-ai\scripts\raidex_ai.py doctor
python .\raidex-ai\scripts\raidex_ai.py continuous --interval 1800
