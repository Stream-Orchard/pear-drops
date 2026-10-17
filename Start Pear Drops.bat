@echo off
rem Runs Pear Drops from source on Windows: installs what it needs the first time,
rem switches on login encryption, then starts the app.
cd /d "%~dp0"
where node >nul 2>nul || (start https://nodejs.org & echo Pear Drops needs Node.js 24 or newer. & pause & exit /b 1)
rem First run, or an update changed the app engine (the updater leaves .needs-install).
set NEEDS=
if not exist node_modules\electron set NEEDS=1
if exist .needs-install set NEEDS=1
if defined NEEDS (
  echo Installing...
  call npm install --no-fund --no-audit || (echo Install failed. & pause & exit /b 1)
  if exist .needs-install del .needs-install
)
node scripts\harden.js
start "" node_modules\electron\dist\electron.exe .
