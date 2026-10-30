@echo off
title WeScan Word Sync Agent
echo.
echo  WeScan Word Sync Agent
echo  ================================
echo  Keep this window open while using Word.
echo  Once running, click "Open in Word" in the site.
echo  Press Ctrl+S in Word to save directly to WeScan!
echo.
node scripts\word-agent.js
pause
