#!/usr/bin/env bash
# Common bash utility functions for Idento scripts

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Print functions
success() {
    echo -e "${GREEN}$@${NC}"
}

info() {
    echo -e "${BLUE}$@${NC}"
}

warning() {
    echo -e "${YELLOW}$@${NC}"
}

error() {
    echo -e "${RED}$@${NC}"
}

# Get project root directory
get_project_root() {
    cd "$(dirname "$0")/.." && pwd
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}
