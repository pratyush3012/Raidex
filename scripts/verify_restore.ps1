param(
  [Parameter(Mandatory=$true)][string]$MongoUrl,
  [Parameter(Mandatory=$true)][string]$Database,
  [Parameter(Mandatory=$true)][string]$ArchivePath
)

# This script actually verifies the restore (count-checks every collection)
# instead of just running mongorestore and printing success unconditionally.
# NOTE: --drop replaces the target database's contents - only point $MongoUrl
# at a database you intend to overwrite (a restore-test database, not prod).

$restoreDir = Join-Path ([System.IO.Path]::GetTempPath()) ("raidex-restore-" + [System.Guid]::NewGuid().ToString("N"))
Expand-Archive -Path $ArchivePath -DestinationPath $restoreDir -Force
$dumpDir = Join-Path $restoreDir $Database
if (-not (Test-Path $dumpDir)) {
  throw "Archive does not contain a '$Database' dump directory - cannot verify restore."
}

mongorestore --uri="$MongoUrl" --drop "$dumpDir"
if ($LASTEXITCODE -ne 0) {
  throw "mongorestore failed with exit code $LASTEXITCODE"
}

# Expected document counts, per collection, from the backup's own .bson files.
$bsonFiles = Get-ChildItem -Path $dumpDir -Filter "*.bson" -File
if ($bsonFiles.Count -eq 0) {
  throw "No .bson files found in $dumpDir - archive looks empty or corrupt."
}

$failures = @()
foreach ($file in $bsonFiles) {
  $collection = $file.BaseName
  $expected = (bsondump --quiet "$($file.FullName)" | Measure-Object -Line).Lines
  if ($LASTEXITCODE -ne 0) {
    throw "bsondump failed reading $($file.FullName) (exit code $LASTEXITCODE) - is the MongoDB Database Tools package installed?"
  }

  $countScript = "print(db.getSiblingDB('$Database').getCollection('$collection').countDocuments({}))"
  $actualRaw = mongosh "$MongoUrl" --quiet --eval $countScript
  if ($LASTEXITCODE -ne 0) {
    throw "mongosh count query failed for collection '$collection' (exit code $LASTEXITCODE)"
  }
  $actual = [int]($actualRaw | Select-Object -Last 1)

  if ($actual -ne $expected) {
    $failures += "  $collection - expected $expected, found $actual"
  } else {
    Write-Output "  $collection - OK ($actual documents)"
  }
}

if ($failures.Count -gt 0) {
  Write-Output "Restore verification FAILED for $Database:"
  $failures | ForEach-Object { Write-Output $_ }
  exit 1
}

Write-Output "Restore verification PASSED for $Database - all $($bsonFiles.Count) collection(s) match expected document counts."
