@echo off
REM BizBook Pro v2.0 - Windows launcher
REM Run this script to start BizBook Pro on any Windows machine with Node.js installed.
REM Usage:  Double-click START.bat
REM Then open http://localhost:3000 in your browser.

setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================
echo   BizBook Pro v2.0 - Starting
echo ============================================
echo.

REM ---- 1. Check Node.js ----
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed.
  echo Please install Node.js 18 or newer from https://nodejs.org and try again.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo [1/3] Node.js OK (%NODE_VER%)

REM ---- 2. Ensure bizbook.db exists ----
if not exist "bizbook.db" (
  if exist "db\bizbook.db" (
    copy /Y "db\bizbook.db" "bizbook.db" >nul
    echo [2/3] Database created from template.
  ) else (
    echo [2/3] Database not found. Creating empty database...
    set DATABASE_URL=file:./bizbook.db
    if exist "node_modules\prisma\build\index.js" (
      call node node_modules\prisma\build\index.js db push --skip-generate
    ) else (
      if exist ".next\standalone\node_modules\prisma\build\index.js" (
        call node .next\standalone\node_modules\prisma\build\index.js db push --skip-generate
      ) else (
        echo ERROR: Could not initialize database.
        echo Please run: npm install ^&^& npx prisma db push
        pause
        exit /b 1
      )
    )
  )
) else (
  echo [2/3] Database OK (.\bizbook.db)
)

REM ---- 3. Verify build, then start server ----
echo [3/3] Verifying build...
if not exist ".next\standalone" (
  echo Build not found. Running production build...
  echo This requires npm install (first run only, may take a few minutes^)...
  where npm >nul 2>nul
  if errorlevel 1 (
    echo ERROR: npm not found. Please install Node.js from https://nodejs.org
    pause
    exit /b 1
  )
  call npm install
  call npm run build
)

REM Run verification
call node scripts\verify-standalone.js
if errorlevel 1 (
  echo.
  echo ERROR: Build verification failed. Attempting rebuild...
  call npm install
  call npm run build
  call node scripts\verify-standalone.js
  if errorlevel 1 (
    echo ERROR: Verification still failing. Please contact support.
    pause
    exit /b 1
  )
)

echo.
echo ============================================
echo   BizBook Pro is running!
echo ============================================
echo.
echo   Local:   http://localhost:3000
echo   Network: http://YOUR-IP:3000  (other devices on same WiFi/LAN^)
echo.
echo   Press Ctrl+C to stop the server.
echo   Your data is stored in .\bizbook.db (SQLite^).
echo   Back up this file to keep your data safe.
echo.
echo ============================================
echo.

REM Set production env
REM IMPORTANT: Use absolute path for DATABASE_URL so Prisma always finds the DB
REM in the project root, not in some bundled node_modules/.prisma/client/ dir.
set NODE_ENV=production
set DATABASE_URL=file:%~dp0bizbook.db
set PORT=3000
set HOSTNAME=0.0.0.0

REM Start the server
node .next\standalone\server.js

pause
