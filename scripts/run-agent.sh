#!/bin/bash
# Script to build and run Idento Printing Agent

cd "$(dirname "$0")/../agent"

echo "Building Idento Agent..."
go build -o bin/idento-agent

if [ $? -eq 0 ]; then
  echo "✅ Build successful!"
  echo ""
  echo "Starting Idento Agent..."
  ./bin/idento-agent --mock
else
  echo "❌ Build failed"
  exit 1
fi

