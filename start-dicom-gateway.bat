@echo off
title WeLink DICOM Gateway (C-STORE SCP)
cd /d "%~dp0"
echo.
echo  ============================================================
echo               WeLink DICOM Edge Gateway
echo  ============================================================
echo  Keep this window OPEN while sending scans from the modality.
echo.
node scripts\dicom-gateway.js
pause
