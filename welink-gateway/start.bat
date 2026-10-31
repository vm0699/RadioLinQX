@echo off
title WeLink DICOM Gateway (C-STORE SCP)
cd /d "%~dp0"

echo.
echo ============================================================
echo               WeLink DICOM Edge Gateway
echo ============================================================
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not found on this computer!
    echo Please install Node.js from https://nodejs.org/ (LTS version)
    echo and run this file again.
    echo.
    pause
    exit /b 1
)

:: Install dependencies if node_modules is missing
if not exist "node_modules\" (
    echo [Setup] First-time setup: installing dependencies...
    call npm install --no-audit --no-fund
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install dependencies. Check your internet connection.
        pause
        exit /b 1
    )
    echo [Setup] Installation complete!
    echo.
)

echo Starting WeLink Gateway...
echo Keep this window OPEN while sending scans from the modality.
echo.
node index.js
pause
