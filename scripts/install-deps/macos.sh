#!/usr/bin/env bash
# Install Idento development dependencies on macOS
# Bash script

# Source utility functions
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/../common/utils.sh"

info "🔧 Installing Idento development dependencies on macOS..."
warning "This script will install: Go, Node.js, Docker, and golangci-lint"
echo ""

# Check if Homebrew is installed
if ! command_exists brew; then
    info "Homebrew not found. Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    
    # Add Homebrew to PATH for Apple Silicon
    if [[ $(uname -m) == "arm64" ]]; then
        echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
        eval "$(/opt/homebrew/bin/brew shellenv)"
    fi
else
    success "✅ Homebrew found"
fi

# Update Homebrew
info "Updating Homebrew..."
brew update

# Check and install Go
if ! command_exists go; then
    info "Installing Go..."
    brew install go
else
    GO_VERSION=$(go version)
    success "✅ Go already installed: $GO_VERSION"
fi

# Check and install Node.js
if ! command_exists node; then
    info "Installing Node.js..."
    brew install node
else
    NODE_VERSION=$(node --version)
    success "✅ Node.js already installed: $NODE_VERSION"
fi

# Check and install Docker
if ! command_exists docker; then
    info "Installing Docker Desktop..."
    brew install --cask docker
    warning "⚠️  Please start Docker Desktop manually from Applications"
else
    success "✅ Docker already installed"
fi

# Check and install Git
if ! command_exists git; then
    info "Installing Git..."
    brew install git
else
    GIT_VERSION=$(git --version)
    success "✅ Git already installed: $GIT_VERSION"
fi

# Install golangci-lint
if ! command_exists golangci-lint; then
    info "Installing golangci-lint..."
    brew install golangci-lint
else
    success "✅ golangci-lint already installed"
fi

# Optional: Install Make (usually pre-installed on macOS)
if ! command_exists make; then
    info "Installing Make..."
    brew install make
else
    success "✅ Make already installed"
fi

success "\n🎉 Installation complete!"
echo ""
info "Next steps:"
echo "  1. Start Docker Desktop from Applications"
echo "  2. Clone the Idento repository"
echo "  3. Run: bash scripts/start-all.sh"
echo ""
info "For more information, see DEVELOPMENT.md"
