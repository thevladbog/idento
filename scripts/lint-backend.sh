#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if ! command -v golangci-lint &>/dev/null; then
  echo "golangci-lint is not installed. Install it from https://golangci-lint.run/usage/install/"
  exit 1
fi
echo "Linting backend..."
(cd backend && golangci-lint run ./internal/...)
echo "Linting agent..."
(cd agent && golangci-lint run ./...)
echo "Done."
