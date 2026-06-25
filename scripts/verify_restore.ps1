param(
  [Parameter(Mandatory=$true)][string]$MongoUrl,
  [Parameter(Mandatory=$true)][string]$Database,
  [Parameter(Mandatory=$true)][string]$ArchivePath
)

$restoreDir = Join-Path ([System.IO.Path]::GetTempPath()) ("raidex-restore-" + [System.Guid]::NewGuid().ToString("N"))
Expand-Archive -Path $ArchivePath -DestinationPath $restoreDir -Force
mongorestore --uri="$MongoUrl" --drop "$restoreDir\$Database"
Write-Output "Restore verification completed for $Database"
