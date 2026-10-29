@echo off
REM Rahi test run for Windows. Double-click this file.
REM Needs Node.js 20+ from https://nodejs.org
cd /d %~dp0
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get it free from https://nodejs.org (LTS), then run this again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies (first run only, takes a few minutes)...
  call npm install
  if errorlevel 1 ( echo npm install failed. Check your internet and try again. & pause & exit /b 1 )
)
if not exist apps\api\dist\main.js (
  echo Building the API...
  call npm --workspace apps/api run build
  if errorlevel 1 ( echo API build failed. & pause & exit /b 1 )
)
set NEXT_PUBLIC_API_BASE_URL=http://localhost:3001/api/v1
if not exist apps\admin-web\.next (
  echo Building the admin app...
  call npm --workspace apps/admin-web run build
  if errorlevel 1 ( echo Admin build failed. & pause & exit /b 1 )
)
set NODE_ENV=development
set PORT=3001
set DEV_ADMIN_EMAIL=admin@rahi.test
set DEV_ADMIN_PASSWORD=af3a83300eef19bdd5cd37f7
start "Rahi API" cmd /k "node apps\api\dist\main.js"
start "Rahi Admin" cmd /k "npm --workspace apps/admin-web run start"
echo.
echo Rahi is starting. Wait for "Ready" in the Rahi Admin window,
echo then open http://localhost:3000 and sign in with:
echo   Email:    admin@rahi.test
echo   Password: af3a83300eef19bdd5cd37f7
echo.
echo To stop: close the "Rahi API" and "Rahi Admin" windows.
pause
