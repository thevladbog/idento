# Lint Android mobile app on Windows
# PowerShell script for cross-platform development

# Import utility functions
. "$PSScriptRoot\common\colors.ps1"

$ErrorActionPreference = "Stop"

# Get the project root directory
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$AndroidPath = Join-Path $ProjectRoot "mobile\android-app"

Write-Info "Linting Android app..."

# Check if gradlew exists
$GradlewPath = Join-Path $AndroidPath "gradlew.bat"

if (-not (Test-Path $GradlewPath)) {
    Write-Error "gradlew.bat not found at: $GradlewPath"
    Write-Info "Make sure you're in the idento project directory"
    exit 1
}

# Run Android lint
Set-Location $AndroidPath
.\gradlew.bat lint

if ($LASTEXITCODE -ne 0) {
    Write-Error "Android linting failed"
    exit 1
}

Write-Success "✅ Done."
