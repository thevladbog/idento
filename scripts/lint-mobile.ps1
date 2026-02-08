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
$GradlewBat = Join-Path $AndroidPath "gradlew.bat"
$GradlewSh = Join-Path $AndroidPath "gradlew"

# Run Android lint
Set-Location $AndroidPath
if (Test-Path $GradlewBat) {
    .\gradlew.bat lint
} elseif (Test-Path $GradlewSh) {
    if (Get-Command bash -ErrorAction SilentlyContinue) {
        bash ./gradlew lint
    } else {
        Write-Error "gradlew.bat not found and bash is unavailable to run ./gradlew"
        Write-Info "Install Git Bash or use WSL, or add gradlew.bat to mobile/android-app"
        exit 1
    }
} else {
    Write-Error "Gradle wrapper not found in: $AndroidPath"
    Write-Info "Make sure you're in the idento project directory"
    exit 1
}

if ($LASTEXITCODE -ne 0) {
    Write-Error "Android linting failed"
    exit 1
}

Write-Success "Done."
