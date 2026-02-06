@echo off
REM Lint backend and agent - Batch wrapper for PowerShell
powershell -ExecutionPolicy Bypass -File "%~dp0lint-backend.ps1"
