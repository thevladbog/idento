@echo off
REM Lint Android mobile app - Batch wrapper for PowerShell
powershell -ExecutionPolicy Bypass -File "%~dp0lint-mobile.ps1"
