@echo off
REM Opens MediPOS as its own window, with no address bar or tabs.
set PORT=4173
set URL=http://localhost:%PORT%

for %%B in (
  "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
) do (
  if exist %%B (
    start "" %%B --app=%URL% --start-maximized
    exit /b
  )
)

start "" %URL%
