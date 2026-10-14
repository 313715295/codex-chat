@echo off
setlocal
set "TASK_NODE=%ProgramFiles%\nodejs\node.exe"
if not exist "%TASK_NODE%" (
  echo Node.js 24.18 or later in the 24.x x64 series is required.
  echo Install from https://nodejs.org/en/download then run this file again.
  pause
  exit /b 1
)
"%TASK_NODE%" "%~dp0source\collaboration\install.mjs"
set "TASK_EXIT=%ERRORLEVEL%"
if not "%TASK_EXIT%"=="0" echo Installation failed; no system or permission changes were made.
pause
exit /b %TASK_EXIT%
