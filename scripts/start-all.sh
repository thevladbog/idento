#!/bin/bash

# Start all Idento services
echo "🚀 Starting Idento system..."

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the project root directory
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo -e "${BLUE}📂 Project root: ${PROJECT_ROOT}${NC}"

# Start Docker services
echo -e "${GREEN}🐳 Starting Docker services (PostgreSQL, Redis, PgAdmin)...${NC}"
cd "$PROJECT_ROOT"
docker compose up -d

# Wait for database to be ready
echo -e "${YELLOW}⏳ Waiting for database to be ready...${NC}"
sleep 5

# Check if seed data exists
echo -e "${GREEN}🌱 Checking seed data...${NC}"
docker exec idento_db psql -U idento -d idento_db -c "SELECT COUNT(*) FROM users;" > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo -e "${YELLOW}📝 Running migrations and seed data...${NC}"
    bash "$PROJECT_ROOT/scripts/seed.sh"
else
    echo -e "${GREEN}✅ Database already seeded${NC}"
fi

# Create logs directory if it doesn't exist
mkdir -p "$PROJECT_ROOT/logs"

# Start Backend
echo -e "${GREEN}🔧 Starting Go Backend...${NC}"
cd "$PROJECT_ROOT/backend"
go run main.go > "$PROJECT_ROOT/logs/backend.log" 2>&1 &
BACKEND_PID=$!
echo -e "${BLUE}Backend PID: $BACKEND_PID${NC}"

# Wait a bit for backend to start
sleep 2

# Start Web Frontend
echo -e "${GREEN}🌐 Starting Web Frontend...${NC}"
cd "$PROJECT_ROOT/web"
npm run dev > "$PROJECT_ROOT/logs/web.log" 2>&1 &
WEB_PID=$!
echo -e "${BLUE}Web PID: $WEB_PID${NC}"

# Start Agent (optional)
echo -e "${GREEN}🖨️  Starting Printing Agent...${NC}"
cd "$PROJECT_ROOT/agent"
go run main.go > "$PROJECT_ROOT/logs/agent.log" 2>&1 &
AGENT_PID=$!
echo -e "${BLUE}Agent PID: $AGENT_PID${NC}"

# Save PIDs to file for easy stopping
echo "$BACKEND_PID" > "$PROJECT_ROOT/logs/pids.txt"
echo "$WEB_PID" >> "$PROJECT_ROOT/logs/pids.txt"
echo "$AGENT_PID" >> "$PROJECT_ROOT/logs/pids.txt"

echo ""
echo -e "${GREEN}✅ All services started successfully!${NC}"
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
echo -e "${GREEN}📊 Services:${NC}"
echo -e "   🌐 Web:        http://localhost:5173"
echo -e "   🔧 Backend:    http://localhost:8008"
echo -e "   🖨️  Agent:      http://localhost:3000"
echo -e "   🗄️  PgAdmin:    http://localhost:50050"
echo -e "      Email:     admin@admin.com"
echo -e "      Password:  admin"
echo ""
echo -e "${GREEN}🔑 Test Credentials:${NC}"
echo -e "   Email:     admin@test.com"
echo -e "   Password:  password123"
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}📋 To stop all services, run: bash scripts/stop-all.sh${NC}"
echo -e "${YELLOW}📝 Logs are available in: logs/backend.log, logs/web.log, logs/agent.log${NC}"
echo ""

# Keep script running to show logs
echo -e "${GREEN}Press Ctrl+C to stop monitoring logs...${NC}"
tail -f "$PROJECT_ROOT/logs/backend.log" "$PROJECT_ROOT/logs/web.log" "$PROJECT_ROOT/logs/agent.log"

