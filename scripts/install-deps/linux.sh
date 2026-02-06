#!/usr/bin/env bash
# Install Idento development dependencies on Linux
# Bash script

# Source utility functions
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/../common/utils.sh"

info "🔧 Installing Idento development dependencies on Linux..."
warning "This script will install: Go, Node.js, Docker, and golangci-lint"
echo ""

# Detect Linux distribution
if [ -f /etc/os-release ]; then
    . /etc/os-release
    DISTRO=$ID
else
    error "Cannot detect Linux distribution"
    exit 1
fi

info "Detected distribution: $DISTRO"

# Install based on distribution
case "$DISTRO" in
    ubuntu|debian)
        info "Using apt package manager..."
        
        # Update package list
        sudo apt update
        
        # Install Go
        if ! command_exists go; then
            info "Installing Go..."
            GO_VERSION="1.25.0"
            wget "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz"
            sudo tar -C /usr/local -xzf "go${GO_VERSION}.linux-amd64.tar.gz"
            rm "go${GO_VERSION}.linux-amd64.tar.gz"
            
            echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc
            echo 'export PATH=$PATH:$(go env GOPATH)/bin' >> ~/.bashrc
            export PATH=$PATH:/usr/local/go/bin
        else
            success "✅ Go already installed: $(go version)"
        fi
        
        # Install Node.js
        if ! command_exists node; then
            info "Installing Node.js..."
            curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
            sudo apt-get install -y nodejs
        else
            success "✅ Node.js already installed: $(node --version)"
        fi
        
        # Install Docker
        if ! command_exists docker; then
            info "Installing Docker..."
            sudo apt-get install -y docker.io docker-compose
            sudo systemctl start docker
            sudo systemctl enable docker
            sudo usermod -aG docker $USER
            warning "⚠️  You need to log out and back in for Docker group changes to take effect"
        else
            success "✅ Docker already installed"
        fi
        
        # Install Git
        if ! command_exists git; then
            info "Installing Git..."
            sudo apt-get install -y git
        else
            success "✅ Git already installed: $(git --version)"
        fi
        ;;
        
    fedora|rhel|centos)
        info "Using dnf package manager..."
        
        # Install Go
        if ! command_exists go; then
            info "Installing Go..."
            sudo dnf install -y golang
        else
            success "✅ Go already installed: $(go version)"
        fi
        
        # Install Node.js
        if ! command_exists node; then
            info "Installing Node.js..."
            sudo dnf install -y nodejs npm
        else
            success "✅ Node.js already installed: $(node --version)"
        fi
        
        # Install Docker
        if ! command_exists docker; then
            info "Installing Docker..."
            sudo dnf install -y docker docker-compose
            sudo systemctl start docker
            sudo systemctl enable docker
            sudo usermod -aG docker $USER
            warning "⚠️  You need to log out and back in for Docker group changes to take effect"
        else
            success "✅ Docker already installed"
        fi
        
        # Install Git
        if ! command_exists git; then
            info "Installing Git..."
            sudo dnf install -y git
        else
            success "✅ Git already installed: $(git --version)"
        fi
        ;;
        
    arch|manjaro)
        info "Using pacman package manager..."
        
        # Update package database
        sudo pacman -Sy
        
        # Install Go
        if ! command_exists go; then
            info "Installing Go..."
            sudo pacman -S --noconfirm go
        else
            success "✅ Go already installed: $(go version)"
        fi
        
        # Install Node.js
        if ! command_exists node; then
            info "Installing Node.js..."
            sudo pacman -S --noconfirm nodejs npm
        else
            success "✅ Node.js already installed: $(node --version)"
        fi
        
        # Install Docker
        if ! command_exists docker; then
            info "Installing Docker..."
            sudo pacman -S --noconfirm docker docker-compose
            sudo systemctl start docker
            sudo systemctl enable docker
            sudo usermod -aG docker $USER
            warning "⚠️  You need to log out and back in for Docker group changes to take effect"
        else
            success "✅ Docker already installed"
        fi
        
        # Install Git
        if ! command_exists git; then
            info "Installing Git..."
            sudo pacman -S --noconfirm git
        else
            success "✅ Git already installed: $(git --version)"
        fi
        ;;
        
    *)
        error "Unsupported distribution: $DISTRO"
        info "Please install dependencies manually:"
        echo "  - Go 1.25+"
        echo "  - Node.js 20+"
        echo "  - Docker"
        echo "  - Git"
        exit 1
        ;;
esac

# Install golangci-lint (works on all distributions)
if ! command_exists golangci-lint; then
    info "Installing golangci-lint..."
    go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
    export PATH=$PATH:$(go env GOPATH)/bin
else
    success "✅ golangci-lint already installed"
fi

# Make sure Make is installed (usually pre-installed)
if ! command_exists make; then
    warning "Make not found. Installing..."
    case "$DISTRO" in
        ubuntu|debian)
            sudo apt-get install -y make
            ;;
        fedora|rhel|centos)
            sudo dnf install -y make
            ;;
        arch|manjaro)
            sudo pacman -S --noconfirm make
            ;;
    esac
else
    success "✅ Make already installed"
fi

success "\n🎉 Installation complete!"
echo ""
info "Next steps:"
echo "  1. Log out and back in (or run: newgrp docker)"
echo "  2. Source your bashrc: source ~/.bashrc"
echo "  3. Clone the Idento repository"
echo "  4. Run: bash scripts/start-all.sh"
echo ""
info "For more information, see DEVELOPMENT.md"
