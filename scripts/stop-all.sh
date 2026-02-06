#!/bin/bash

# Stop all Idento services
echo "🛑 Stopping Idento system..."

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get the project root directory
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Stop Node.js processes
echo -e "${BLUE}🌐 Stopping Web Frontend...${NC}"
pkill -f "vite"

# Stop Go processes
echo -e "${BLUE}🔧 Stopping Backend...${NC}"
pkill -f "idento/backend"

echo -e "${BLUE}🖨️  Stopping Agent...${NC}"
pkill -f "idento/agent"

# Stop Docker services
echo -e "${BLUE}🐳 Stopping Docker services...${NC}"
cd "$PROJECT_ROOT"
docker compose down

# Clean up PID file
rm -f "$PROJECT_ROOT/logs/pids.txt"

echo ""
echo -e "${GREEN}✅ All services stopped successfully!${NC}"
echo ""

