#!/bin/bash
# Quick Start Script for Idento

echo "🚀 Starting Idento Development Environment..."
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
  echo "❌ Docker is not running. Please start Docker Desktop first."
  exit 1
fi

# Start database
echo "📦 Starting PostgreSQL and Redis..."
docker compose up -d

sleep 3

# Load seed data
echo "🌱 Loading seed data..."
docker exec -i idento_db psql -U idento -d idento_db < backend/migrations/seed.sql

echo ""
echo "✅ Database ready!"
echo ""
echo "📝 Test credentials:"
echo "   Email: admin@test.com"
echo "   Password: password123"
echo ""
echo "Now run these commands in separate terminals:"
echo ""
echo "Terminal 1 (Backend):"
echo "  cd backend && go run main.go"
echo ""
echo "Terminal 2 (Web):"
echo "  cd web && npm run dev"
echo ""
echo "Terminal 3 (Agent):"
echo "  cd agent && go run main.go --mock"
echo ""
echo "📱 Web App: http://localhost:5173"
echo "🔧 Backend API: http://localhost:8080"
echo "🖨️ Agent: http://localhost:12345"

