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

$BugAction = New-ScheduledTaskAction -Execute $Python -Argument ".\raidex-ai\scripts\raidex_ai.py daily-bug-report" -WorkingDirectory $Root
$BugTrigger = New-ScheduledTaskTrigger -Daily -At 6:00PM
Register-ScheduledTask -TaskName "Raidex AI Daily Bug Report" -Action $BugAction -Trigger $BugTrigger -Description "Generates Raidex daily bug report." -Force | Out-Null

$ProductAction = New-ScheduledTaskAction -Execute $Python -Argument ".\raidex-ai\scripts\raidex_ai.py weekly-product-report" -WorkingDirectory $Root
$ProductTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Wednesday -At 3:00PM
Register-ScheduledTask -TaskName "Raidex AI Weekly Product Report" -Action $ProductAction -Trigger $ProductTrigger -Description "Generates Raidex weekly product report." -Force | Out-Null

$DebtAction = New-ScheduledTaskAction -Execute $Python -Argument ".\raidex-ai\scripts\raidex_ai.py monthly-technical-debt-report" -WorkingDirectory $Root
$DebtTrigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 4 -DaysOfWeek Monday -At 4:00PM
Register-ScheduledTask -TaskName "Raidex AI Monthly Technical Debt Report" -Action $DebtAction -Trigger $DebtTrigger -Description "Generates Raidex monthly technical debt report." -Force | Out-Null

$RoadmapAction = New-ScheduledTaskAction -Execute $Python -Argument ".\raidex-ai\scripts\raidex_ai.py monthly-roadmap" -WorkingDirectory $Root
$RoadmapTrigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 4 -DaysOfWeek Tuesday -At 4:00PM
Register-ScheduledTask -TaskName "Raidex AI Monthly Roadmap" -Action $RoadmapAction -Trigger $RoadmapTrigger -Description "Generates Raidex monthly roadmap." -Force | Out-Null

Write-Host "Raidex AI scheduled tasks installed."
