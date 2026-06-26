$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$Python = (Get-Command python).Source

$DailyAction = New-ScheduledTaskAction -Execute $Python -Argument ".\raidex-ai\scripts\raidex_ai.py daily-report" -WorkingDirectory $Root
$DailyTrigger = New-ScheduledTaskTrigger -Daily -At 10:00AM
Register-ScheduledTask -TaskName "Raidex AI Daily Engineering Report" -Action $DailyAction -Trigger $DailyTrigger -Description "Generates Raidex daily AI engineering report." -Force | Out-Null

$WeeklyAction = New-ScheduledTaskAction -Execute $Python -Argument ".\raidex-ai\scripts\raidex_ai.py weekly-architecture-report" -WorkingDirectory $Root
$WeeklyTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 11:00AM
Register-ScheduledTask -TaskName "Raidex AI Weekly Architecture Report" -Action $WeeklyAction -Trigger $WeeklyTrigger -Description "Generates Raidex weekly AI architecture report." -Force | Out-Null

$SecurityAction = New-ScheduledTaskAction -Execute $Python -Argument ".\raidex-ai\scripts\raidex_ai.py security-report" -WorkingDirectory $Root
$SecurityTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Friday -At 12:00PM
Register-ScheduledTask -TaskName "Raidex AI Security Report" -Action $SecurityAction -Trigger $SecurityTrigger -Description "Generates Raidex AI security report." -Force | Out-Null

Write-Host "Raidex AI scheduled tasks installed."
