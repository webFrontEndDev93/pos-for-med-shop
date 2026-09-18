# Sets MediPOS up on a Windows shop computer: checks Node, puts a MediPOS icon
# on the desktop, and offers to start it automatically when Windows starts.
#
#   Right-click this file -> "Run with PowerShell"
$ErrorActionPreference = 'Stop'

$AppDir   = Split-Path -Parent $PSScriptRoot
$Launcher = Join-Path $PSScriptRoot 'MediPOS.vbs'
$IconPath = Join-Path $PSScriptRoot 'MediPOS.ico'
$Desktop  = [Environment]::GetFolderPath('Desktop')

Write-Host ''
Write-Host '  Setting up MediPOS...' -ForegroundColor Cyan
Write-Host ''

# --- 1. Node -----------------------------------------------------------------
# A bundled runtime means nothing to install and no internet needed.
$Bundled = Join-Path $AppDir 'runtime\win-x64\node.exe'
if (Test-Path $Bundled) {
  Write-Host '  Node is bundled with MediPOS - nothing to install.' -ForegroundColor Green
}
else {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    Write-Host '  Node.js is not installed.' -ForegroundColor Yellow
    Write-Host '  Install the LTS version from https://nodejs.org, then run this again.'
    Write-Host ''
    Start-Process 'https://nodejs.org'
    Read-Host '  Press Enter to close'
    exit 1
  }
  $major = [int](& node -p 'process.versions.node.split(".")[0]')
  if ($major -lt 20) {
    Write-Host "  MediPOS needs Node 20 or newer; this computer has $(& node -v)." -ForegroundColor Yellow
    Write-Host '  Update it from https://nodejs.org, then run this again.'
    Read-Host '  Press Enter to close'
    exit 1
  }
  Write-Host "  Node $(& node -v) found." -ForegroundColor Green
}

# --- 2. Desktop shortcut -----------------------------------------------------
$shell    = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut((Join-Path $Desktop 'MediPOS.lnk'))
$shortcut.TargetPath       = 'wscript.exe'
$shortcut.Arguments        = """$Launcher"""
$shortcut.WorkingDirectory = $AppDir
$shortcut.IconLocation     = $IconPath
$shortcut.Description      = 'Open the MediPOS till'
$shortcut.Save()
Write-Host '  Put a MediPOS icon on the desktop.' -ForegroundColor Green

# Pin it to the Start menu too, so it survives a tidied desktop.
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
Copy-Item (Join-Path $Desktop 'MediPOS.lnk') (Join-Path $startMenu 'MediPOS.lnk') -Force
Write-Host '  Added it to the Start menu.' -ForegroundColor Green

# --- 3. Start with Windows (optional) ---------------------------------------
Write-Host ''
$auto = Read-Host '  Start MediPOS automatically when this computer turns on? (Y/n)'
if ($auto -eq '' -or $auto -match '^[Yy]') {
  $startup = [Environment]::GetFolderPath('Startup')
  $boot = $shell.CreateShortcut((Join-Path $startup 'MediPOS.lnk'))
  $boot.TargetPath       = 'wscript.exe'
  $boot.Arguments        = """$Launcher"""
  $boot.WorkingDirectory = $AppDir
  $boot.IconLocation     = $IconPath
  $boot.Save()
  Write-Host '  It will now open by itself when the computer starts.' -ForegroundColor Green
} else {
  Write-Host '  Skipped. Staff can open it from the desktop icon.'
}

Write-Host ''
Write-Host '  Done. Double-click the MediPOS icon on the desktop.' -ForegroundColor Cyan
Write-Host ''
Read-Host '  Press Enter to close'
