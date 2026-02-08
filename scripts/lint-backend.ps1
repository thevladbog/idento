# Lint Go backend and agent on Windows
# PowerShell script for cross-platform development

# Import utility functions
. "$PSScriptRoot\common\colors.ps1"

$ErrorActionPreference = "Stop"

# Get the project root directory
$ProjectRoot = Split-Path -Parent $PSScriptRoot

# Check if golangci-lint is installed
if (-not (Get-Command golangci-lint -ErrorAction SilentlyContinue)) {
    Write-Error "golangci-lint is not installed."
    Write-Info "Install it from: https://golangci-lint.run/usage/install/"
    Write-Info "Or run: go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest"
    exit 1
}

# Lint backend
Write-Info "Linting backend..."
Set-Location (Join-Path $ProjectRoot "backend")
golangci-lint run .\internal\...

if ($LASTEXITCODE -ne 0) {
    Write-Error "Backend linting failed"
    exit 1
}

# Lint agent
Write-Info "Linting agent..."
Set-Location (Join-Path $ProjectRoot "agent")
golangci-lint run .\...

if ($LASTEXITCODE -ne 0) {
    Write-Error "Agent linting failed"
    exit 1
}

Write-Success "Done."
