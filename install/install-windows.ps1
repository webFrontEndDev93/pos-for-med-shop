# Installs MediPOS as a scheduled task so the till starts with Windows.
# Right-click → "Run with PowerShell", or:
#   powershell -ExecutionPolicy Bypass -File install\install-windows.ps1
$ErrorActionPreference = 'Stop'

$AppDir = Split-Path -Parent $PSScriptRoot
$Port   = if ($env:PORT) { $env:PORT } else { '4173' }
$Task   = 'MediPOS'

$node = (Get-Command node -ErrorAction SilentlyContinue)
if (-not $node) {
  Write-Error 'Node is not installed. Install Node 20 or newer first: https://nodejs.org'
  exit 1
}
$major = [int](& node -p 'process.versions.node.split(".")[0]')
if ($major -lt 20) {
  Write-Error "MediPOS needs Node 20 or newer; this machine has $(& node -v)."
  exit 1
}

# Hide the console window so staff don't close the till by closing a black box.
$action = New-ScheduledTaskAction -Execute $node.Source `
  -Argument "$AppDir\server\index.mjs" -WorkingDirectory $AppDir
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Unregister-ScheduledTask -TaskName $Task -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $Task -Action $action -Trigger $trigger `
  -Settings $settings -Description 'MediPOS point of sale' | Out-Null

[Environment]::SetEnvironmentVariable('PORT', $Port, 'User')
Start-ScheduledTask -TaskName $Task

Write-Host ''
Write-Host '  MediPOS is installed and will start when you sign in to Windows.'
Write-Host ''
Write-Host "    Open:    http://localhost:$Port"
Write-Host "    Stop:    Stop-ScheduledTask -TaskName $Task"
Write-Host "    Remove:  Unregister-ScheduledTask -TaskName $Task"
Write-Host ''
