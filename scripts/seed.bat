@echo off
REM Seed database - Batch wrapper for PowerShell
powershell -ExecutionPolicy Bypass -File "%~dp0seed.ps1"
