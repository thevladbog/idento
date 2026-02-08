# Install Idento development dependencies on Windows
# PowerShell script

# Import utility functions
. "$PSScriptRoot\..\common\colors.ps1"

Write-Info "Installing Idento development dependencies on Windows..."
Write-Warning "This script will install: Go, Node.js, Docker Desktop, and golangci-lint"
Write-Warning ""

# Check if Chocolatey is installed
if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
    Write-Info "Chocolatey package manager not found."
    Write-Info "Install Chocolatey from: https://chocolatey.org/install"
    Write-Warning ""
    Write-Warning "Or install dependencies manually:"
    Write-Host "  - Go: https://golang.org/dl/"
    Write-Host "  - Node.js: https://nodejs.org/"
    Write-Host "  - Docker Desktop: https://www.docker.com/products/docker-desktop/"
    Write-Host "  - Git: https://git-scm.com/"
    exit 1
}

Write-Success "Chocolatey found"

# Check and install Go
if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    Write-Info "Installing Go..."
    choco install golang -y
} else {
    $goVersion = go version
    Write-Success "Go already installed: $goVersion"
}

# Check and install Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Info "Installing Node.js..."
    choco install nodejs -y
} else {
    $nodeVersion = node --version
    Write-Success "Node.js already installed: $nodeVersion"
}

# Check and install Docker Desktop
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Info "Installing Docker Desktop..."
    choco install docker-desktop -y
    Write-Warning "Docker Desktop requires a system restart to complete installation"
} else {
    Write-Success "Docker already installed"
}

# Check and install Git
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Info "Installing Git..."
    choco install git -y
} else {
    $gitVersion = git --version
    Write-Success "Git already installed: $gitVersion"
}

# Install golangci-lint
Write-Info "Installing golangci-lint..."
go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest

# Optional: Install Make
$installMake = Read-Host "Do you want to install Make? (y/N)"
if ($installMake -eq 'y' -or $installMake -eq 'Y') {
    Write-Info "Installing Make..."
    choco install make -y
}

Write-Success "`nInstallation complete!"
Write-Info ""
Write-Info "Next steps:"
Write-Host "  1. Restart your terminal (or computer if Docker was installed)"
Write-Host "  2. Clone the Idento repository"
Write-Host "  3. Run: .\scripts\start-all.ps1"
Write-Info ""
Write-Info "For more information, see DEVELOPMENT.md"
