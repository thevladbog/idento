@echo off
REM Stop all Idento services - Batch wrapper for PowerShell
powershell -ExecutionPolicy Bypass -File "%~dp0stop-all.ps1"
