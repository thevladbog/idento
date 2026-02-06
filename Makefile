# Idento - Cross-platform Makefile
# Supports Windows, macOS, and Linux

# Detect operating system
ifeq ($(OS),Windows_NT)
	detected_OS := Windows
	RM := del /Q
	RMDIR := if exist build rmdir /S /Q build
	MKDIR := if not exist build mkdir build
	PATH_SEP := \\
	BINARY_EXT := .exe
	SCRIPT_EXT := .ps1
	SHELL := cmd
	# On Windows, use PowerShell for complex commands
	PS := powershell -ExecutionPolicy Bypass -File
else
	detected_OS := $(shell uname -s)
	RM := rm -f
	RMDIR := rm -rf build
	MKDIR := mkdir -p build
	PATH_SEP := /
	BINARY_EXT :=
	SCRIPT_EXT := .sh
	# Use bash for Unix systems
	SHELL := /bin/bash
endif

# Project directories
BACKEND_DIR := backend
AGENT_DIR := agent
WEB_DIR := web
BUILD_DIR := build
SCRIPTS_DIR := scripts

# Binary names with platform-specific extensions
BACKEND_BIN := idento-backend$(BINARY_EXT)
AGENT_BIN := idento-agent$(BINARY_EXT)

# Go commands
GOCMD := go
GOBUILD := $(GOCMD) build
GOTEST := $(GOCMD) test
GOCLEAN := $(GOCMD) clean
GOGET := $(GOCMD) get
GOMOD := $(GOCMD) mod

# Colors for output (Unix only, Windows uses PowerShell Write-Host)
ifneq ($(OS),Windows_NT)
	GREEN := \033[0;32m
	BLUE := \033[0;34m
	YELLOW := \033[1;33m
	NC := \033[0m
endif

.PHONY: help check-deps install-tools lint test test-coverage build-backend build-agent build-all clean docker-up docker-down dev

# Default target
help:
	@echo "Idento Development Commands ($(detected_OS))"
	@echo ""
	@echo "Setup:"
	@echo "  make check-deps      - Check if required dependencies are installed"
	@echo "  make install-tools   - Install development tools (golangci-lint, etc)"
	@echo ""
	@echo "Build:"
	@echo "  make build-backend   - Build backend binary"
	@echo "  make build-agent     - Build agent binary"
	@echo "  make build-all       - Build all binaries"
	@echo "  make clean           - Remove build artifacts"
	@echo ""
	@echo "Quality:"
	@echo "  make lint            - Run linters on Go code"
	@echo "  make test            - Run tests"
	@echo "  make test-coverage   - Run tests with coverage report"
	@echo ""
	@echo "Development:"
	@echo "  make docker-up       - Start Docker services (PostgreSQL, Redis)"
	@echo "  make docker-down     - Stop Docker services"
	@echo "  make dev             - Start all development services"
	@echo ""

# Check for required dependencies
check-deps:
ifeq ($(OS),Windows_NT)
	@echo Checking dependencies on Windows...
	@where go >nul 2>&1 && echo [OK] Go installed || echo [MISSING] Go not found
	@where node >nul 2>&1 && echo [OK] Node.js installed || echo [MISSING] Node.js not found
	@where docker >nul 2>&1 && echo [OK] Docker installed || echo [MISSING] Docker not found
	@where golangci-lint >nul 2>&1 && echo [OK] golangci-lint installed || echo [INFO] golangci-lint not found - run 'make install-tools'
else
	@echo "Checking dependencies on $(detected_OS)..."
	@command -v go >/dev/null 2>&1 && echo "[OK] Go installed" || echo "[MISSING] Go not found"
	@command -v node >/dev/null 2>&1 && echo "[OK] Node.js installed" || echo "[MISSING] Node.js not found"
	@command -v docker >/dev/null 2>&1 && echo "[OK] Docker installed" || echo "[MISSING] Docker not found"
	@command -v golangci-lint >/dev/null 2>&1 && echo "[OK] golangci-lint installed" || echo "[INFO] golangci-lint not found - run 'make install-tools'"
endif

# Install development tools
install-tools:
ifeq ($(OS),Windows_NT)
	@echo Installing tools on Windows...
	@echo Please install golangci-lint manually from: https://golangci-lint.run/usage/install/
	@echo Or use: go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
else
	@echo "Installing tools on $(detected_OS)..."
	@if ! command -v golangci-lint >/dev/null 2>&1; then \
		echo "Installing golangci-lint..."; \
		go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest; \
	else \
		echo "golangci-lint already installed"; \
	fi
endif

# Lint Go code
lint:
ifeq ($(OS),Windows_NT)
	@$(PS) $(SCRIPTS_DIR)\lint-backend.ps1
else
	@bash $(SCRIPTS_DIR)/lint-backend.sh
endif

# Run tests
test:
	@echo "Running tests..."
	@cd $(BACKEND_DIR) && $(GOTEST) ./...
	@cd $(AGENT_DIR) && $(GOTEST) ./...

# Run tests with coverage
test-coverage:
	@echo "Running tests with coverage and race detection..."
	@cd $(BACKEND_DIR) && $(GOTEST) -race -coverprofile=coverage.out -covermode=atomic ./...
	@cd $(AGENT_DIR) && $(GOTEST) -race -coverprofile=coverage.out -covermode=atomic ./...
	@echo ""
	@echo "Backend Coverage:"
ifeq ($(OS),Windows_NT)
	@cd $(BACKEND_DIR) && go tool cover -func=coverage.out | findstr /C:"total"
else
	@cd $(BACKEND_DIR) && go tool cover -func=coverage.out | tail -1
endif
	@echo ""
	@echo "Agent Coverage:"
ifeq ($(OS),Windows_NT)
	@cd $(AGENT_DIR) && go tool cover -func=coverage.out | findstr /C:"total"
else
	@cd $(AGENT_DIR) && go tool cover -func=coverage.out | tail -1
endif

# Build backend
build-backend:
	@echo "Building backend for $(detected_OS)..."
	@$(MKDIR)
	@cd $(BACKEND_DIR) && $(GOBUILD) -v -o ../$(BUILD_DIR)/$(BACKEND_BIN) .
	@echo "Backend binary created: $(BUILD_DIR)/$(BACKEND_BIN)"

# Build agent
build-agent:
	@echo "Building agent for $(detected_OS)..."
	@$(MKDIR)
	@cd $(AGENT_DIR) && $(GOBUILD) -v -o ../$(BUILD_DIR)/$(AGENT_BIN) .
	@echo "Agent binary created: $(BUILD_DIR)/$(AGENT_BIN)"

# Build all
build-all: build-backend build-agent
	@echo "All binaries built successfully!"

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	@$(RMDIR)
	@cd $(BACKEND_DIR) && $(GOCLEAN)
	@cd $(AGENT_DIR) && $(GOCLEAN)
ifeq ($(OS),Windows_NT)
	@if exist $(BACKEND_DIR)\coverage.out del $(BACKEND_DIR)\coverage.out
	@if exist $(AGENT_DIR)\coverage.out del $(AGENT_DIR)\coverage.out
else
	@$(RM) $(BACKEND_DIR)/coverage.out $(AGENT_DIR)/coverage.out
endif
	@echo "Clean complete!"

# Docker commands
docker-up:
	@echo "Starting Docker services..."
	@docker compose up -d
	@echo "Docker services started!"

docker-down:
	@echo "Stopping Docker services..."
	@docker compose down
	@echo "Docker services stopped!"

# Start development environment
dev:
ifeq ($(OS),Windows_NT)
	@echo Starting development environment on Windows...
	@$(PS) $(SCRIPTS_DIR)\start-all.ps1
else
	@echo "Starting development environment on $(detected_OS)..."
	@bash $(SCRIPTS_DIR)/start-all.sh
endif
