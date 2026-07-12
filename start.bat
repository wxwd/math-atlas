@echo off
setlocal
chcp 65001 >nul

if /i "%~1"=="--wait-for-server" goto :wait_for_server

title MathAtlas One-click Start
cd /d "%~dp0"

echo ========================================
echo          MathAtlas One-click Start
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 goto :node_missing

where npm >nul 2>nul
if errorlevel 1 goto :npm_missing

for /f "delims=" %%V in ('node -p "Number(process.versions.node.split('.')[0])" 2^>nul') do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR goto :node_missing
if %NODE_MAJOR% LSS 18 goto :node_too_old

echo [1/2] Checking and installing dependencies. Please wait...
call npm install
if errorlevel 1 goto :install_failed

echo.
echo [2/2] Starting MathAtlas...
echo Your browser will open when the service is ready: http://localhost:3000
echo Press Ctrl+C or close this window to stop the service.
echo.

rem Launch a background copy of this script to wait for the HTTP service.
start "" /b cmd.exe /d /c call "%~f0" --wait-for-server

call npm run dev
set "DEV_EXIT=%ERRORLEVEL%"

echo.
if not "%DEV_EXIT%"=="0" echo The development server exited with error code %DEV_EXIT%.
echo MathAtlas has stopped.
pause
exit /b %DEV_EXIT%

:wait_for_server
for /l %%I in (1,1,120) do (
  curl.exe --silent --output nul --max-time 2 http://localhost:3000 && (
    start "" http://localhost:3000
    exit /b 0
  )
  ping.exe 127.0.0.1 -n 2 >nul
)
exit /b 1

:node_missing
echo [ERROR] Node.js was not found.
echo Install Node.js 18 or later from https://nodejs.org/ and run this file again.
goto :failed

:npm_missing
echo [ERROR] Node.js was found, but npm is unavailable.
echo Reinstall Node.js 18 or later with npm from https://nodejs.org/.
goto :failed

:node_too_old
echo [ERROR] Node.js %NODE_MAJOR% is installed, but MathAtlas requires version 18 or later.
echo Install a newer version from https://nodejs.org/ and try again.
goto :failed

:install_failed
echo.
echo [ERROR] Dependency installation failed. Check the npm error above and your network connection.
goto :failed

:failed
echo.
pause
exit /b 1
