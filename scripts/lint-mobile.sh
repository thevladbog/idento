#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/mobile"
echo "Running Android Lint..."
./gradlew :androidApp:lintDebug
echo "Done."
