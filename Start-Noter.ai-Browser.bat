@echo off
title Noter.ai in your browser
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-installed-noter.ps1" -Browser
if errorlevel 1 pause
