#!/bin/bash
# Script to load seed data into the database

# Load environment variables if .env exists
if [ -f .env ]; then
  export $(cat .env | xargs)
fi

# Default database connection
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5438}"
DB_USER="${DB_USER:-idento_user}"
DB_PASSWORD="${DB_PASSWORD:-idento_password}"
DB_NAME="${DB_NAME:-idento_db}"

echo "Loading seed data into $DB_NAME..."

PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f backend/migrations/seed.sql

if [ $? -eq 0 ]; then
  echo "✅ Seed data loaded successfully!"
  echo ""
  echo "Test credentials:"
  echo "  Email: admin@test.com"
  echo "  Password: password123"
else
  echo "❌ Failed to load seed data"
  exit 1
fi

