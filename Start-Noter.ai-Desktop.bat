@echo off
title Noter.ai
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-installed-noter.ps1"
if errorlevel 1 pause
