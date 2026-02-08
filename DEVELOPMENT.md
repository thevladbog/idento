# Idento Development Guide

Complete cross-platform development guide for Windows, macOS, and Linux.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Windows Setup](#windows-setup)
- [macOS Setup](#macos-setup)
- [Linux Setup](#linux-setup)
- [Common Development Tasks](#common-development-tasks)
- [Troubleshooting](#troubleshooting)

## Prerequisites

All platforms require:
- **Go 1.25+** - Backend and agent
- **Node.js 20+** - Web frontend
- **Docker Desktop** - Database and services
- **Git** - Version control

## Windows Setup

### Required Software

1. **Go**: Download from [golang.org](https://golang.org/dl/)
2. **Node.js**: Download from [nodejs.org](https://nodejs.org/)
3. **Docker Desktop**: Download from [docker.com](https://www.docker.com/products/docker-desktop/)
   - Requires WSL2 on Windows 10/11
4. **Git**: Download from [git-scm.com](https://git-scm.com/)

### Optional Tools

**Make** (optional, if you want to use `make` commands):
```powershell
# Using Chocolatey
choco install make

# Or using Scoop
scoop install make
```

**golangci-lint** (for linting):
```powershell
go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
```

### Quick Start (Windows)

**Option 1: PowerShell (Recommended)**
```powershell
# Start all services
.\scripts\start-all.ps1

# Stop all services
.\scripts\stop-all.ps1
```

**Option 2: Batch files**
```cmd
:: Start all services
.\scripts\start-all.bat

:: Stop all services
.\scripts\stop-all.bat
```

**Option 3: Make (if installed)**
```powershell
make dev
```

### Development Commands (Windows)

```powershell
# Build
make build-backend    # Creates idento-backend.exe
make build-agent      # Creates idento-agent.exe

# Test
make test
make test-coverage

# Lint
make lint
# Or directly:
.\scripts\lint-backend.ps1

# Database
.\scripts\seed.ps1    # Run migrations and seed data
```

### Windows-Specific Notes

**Line Endings:**
- Git automatically handles line endings via `.gitattributes`
- `.sh` files: LF (Unix)
- `.ps1` and `.bat` files: CRLF (Windows)

**Paths:**
- Use forward slashes `/` in Go code (works on all platforms)
- PowerShell accepts both `/` and `\`

**Environment Variables:**
- Use `$env:VARIABLE_NAME` in PowerShell
- Or edit `.env` file in project root

**Docker Desktop:**
- Must be running before starting services
- Enable WSL2 integration in settings
- Resources: Allocate at least 4GB RAM

## macOS Setup

### Required Software

**Using Homebrew** (recommended):
```bash
# Install Homebrew if not installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install dependencies
brew install go node docker golangci-lint

# Start Docker Desktop
open -a Docker
```

### Quick Start (macOS)

```bash
# Start all services
bash scripts/start-all.sh

# Stop all services
bash scripts/stop-all.sh

# Or use Make
make dev
```

### Development Commands (macOS)

```bash
# Build
make build-backend
make build-agent

# Test
make test
make test-coverage

# Lint
make lint
# Or directly:
bash scripts/lint-backend.sh

# Database
bash scripts/seed.sh
```

### macOS-Specific Notes

**Apple Silicon (M1/M2/M3):**
- Go and Docker work natively on ARM
- Homebrew installs to `/opt/homebrew` on ARM vs `/usr/local` on Intel
- No special configuration needed

**Docker Desktop:**
- Install from [docker.com](https://www.docker.com/products/docker-desktop/) or `brew install --cask docker`
- Enable "Use the new Virtualization framework" in settings for better performance

**Permissions:**
- Scripts may need execute permissions: `chmod +x scripts/*.sh`
- Docker socket: usually at `/var/run/docker.sock`

## Linux Setup

### Required Software

**Ubuntu/Debian:**
```bash
# Update package list
sudo apt update

# Install Go
wget https://go.dev/dl/go1.25.0.linux-amd64.tar.gz
sudo tar -C /usr/local -xzf go1.25.0.linux-amd64.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc
source ~/.bashrc

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Docker
sudo apt-get install -y docker.io docker-compose
sudo usermod -aG docker $USER
newgrp docker

# Install golangci-lint
go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
```

**Fedora/RHEL:**
```bash
# Install Go
sudo dnf install golang

# Install Node.js
sudo dnf install nodejs npm

# Install Docker
sudo dnf install docker docker-compose
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker $USER

# Install golangci-lint
go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
```

**Arch Linux:**
```bash
# Install dependencies
sudo pacman -S go nodejs npm docker docker-compose

# Start Docker
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker $USER

# Install golangci-lint
go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
```

### Quick Start (Linux)

```bash
# Start all services
bash scripts/start-all.sh

# Stop all services
bash scripts/stop-all.sh

# Or use Make
make dev
```

### Development Commands (Linux)

Same as macOS - see above.

### Linux-Specific Notes

**Docker Permissions:**
- After adding user to docker group, log out and back in
- Or use `newgrp docker` to activate group

**SELinux (Fedora/RHEL):**
- If volumes don't work, you may need to set SELinux contexts
- Or run: `sudo setenforce 0` (development only)

**Systemd:**
- Docker typically runs as systemd service
- Check status: `systemctl status docker`

## Common Development Tasks

### Starting Development Environment

**All Platforms:**
```bash
# Using scripts (recommended)
./scripts/start-all.sh     # Unix
.\scripts\start-all.ps1    # Windows

# Using Make
make dev

# Manual (all platforms)
make docker-up             # Start Docker services
cd backend && go run main.go &
cd web && npm run dev &
cd agent && go run main.go &
```

### Building Binaries

```bash
# Build backend
make build-backend

# Build agent
make build-agent

# Build all
make build-all

# Binaries are placed in ./build/ directory
# Windows: build/idento-backend.exe and build/idento-agent.exe
# Unix: build/idento-backend and build/idento-agent
```

### Running Tests

```bash
# Run all tests
make test

# Run tests with coverage
make test-coverage

# Run tests for specific package
cd backend && go test ./internal/handler/...
```

### Linting Code

```bash
# Lint all Go code
make lint

# Lint web code
cd web && npm run lint

# Lint Android (if you have mobile dev setup)
cd mobile/android-app && ./gradlew lint    # Unix
cd mobile\android-app && .\gradlew.bat lint  # Windows
```

### Database Management

```bash
# Run migrations and seed data
./scripts/seed.sh        # Unix
.\scripts\seed.ps1       # Windows

# Connect to database
docker exec -it idento_db psql -U idento -d idento_db

# View logs
docker logs idento_db
```

### Viewing Logs

**Using scripts:**
- Logs are stored in `logs/` directory
- `logs/backend.log` - Backend logs
- `logs/web.log` - Web frontend logs
- `logs/agent.log` - Agent logs

**Docker logs:**
```bash
docker logs idento_db      # PostgreSQL
docker logs idento_redis   # Redis
docker logs idento_pgadmin # PgAdmin
```

## Troubleshooting

### Windows Issues

**PowerShell execution policy error:**
```powershell
# Run this once to allow scripts
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

**Docker not starting:**
- Ensure Docker Desktop is running
- Check WSL2 is installed: `wsl --status`
- Restart Docker Desktop

**"make: command not found":**
- Use PowerShell scripts instead: `.\scripts\start-all.ps1`
- Or install Make: `choco install make`

**Ports already in use:**
```powershell
# Find process using port (e.g., 5173)
netstat -ano | findstr :5173
# Kill process by PID
taskkill /PID <pid> /F
```

### macOS Issues

**"permission denied" errors:**
```bash
# Make scripts executable
chmod +x scripts/*.sh

# Or run with bash explicitly
bash scripts/start-all.sh
```

**Docker socket error:**
```bash
# Ensure Docker Desktop is running
open -a Docker

# Check Docker status
docker ps
```

**Homebrew path issues (Apple Silicon):**
```bash
# Add to ~/.zshrc or ~/.bashrc
export PATH=/opt/homebrew/bin:$PATH
```

**Ports already in use:**
```bash
# Find process using port
lsof -i :5173

# Kill process
kill -9 <PID>
```

### Linux Issues

**Docker permission denied:**
```bash
# Add user to docker group
sudo usermod -aG docker $USER

# Activate group (or log out/in)
newgrp docker
```

**golangci-lint not found:**
```bash
# Ensure GOPATH/bin is in PATH
echo 'export PATH=$PATH:$(go env GOPATH)/bin' >> ~/.bashrc
source ~/.bashrc
```

**Node.js version too old:**
```bash
# Ubuntu/Debian: Use NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### Cross-Platform Issues

**Line ending issues:**
- Git automatically handles this via `.gitattributes`
- If you see issues, run: `git config core.autocrlf true` (Windows) or `false` (Unix)

**Database connection refused:**
```bash
# Wait for database to be ready
docker ps  # Check if idento_db is running

# Check database logs
docker logs idento_db
```

**Port conflicts:**
- Backend: 8008
- Web: 5173
- Agent: 3000
- PostgreSQL: 5438
- Redis: 6379
- PgAdmin: 50050

Stop other services using these ports or change ports in `docker-compose.yml` and `.env`.

**Go version mismatch:**
```bash
# Check Go version
go version  # Should be 1.25+

# Upgrade Go:
# - Windows: Download new installer
# - macOS: brew upgrade go
# - Linux: Download and extract new version
```

## Additional Resources

- [Go Documentation](https://golang.org/doc/)
- [Node.js Documentation](https://nodejs.org/docs/)
- [Docker Documentation](https://docs.docker.com/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [React Documentation](https://react.dev/)

## Need Help?

Check the main [README.md](README.md) for project overview and quick start.

For CI/CD information, see [.github/CI.md](.github/CI.md).
