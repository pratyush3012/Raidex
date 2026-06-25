param(
  [Parameter(Mandatory=$true)][string]$MongoUrl,
  [Parameter(Mandatory=$true)][string]$Database,
  [string]$OutputDir = "backups"
)

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$target = Join-Path $OutputDir "$Database-$timestamp"
New-Item -ItemType Directory -Force -Path $target | Out-Null
mongodump --uri="$MongoUrl" --db="$Database" --out="$target"
Compress-Archive -Path "$target\*" -DestinationPath "$target.zip" -Force
Write-Output "$target.zip"
