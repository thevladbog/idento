#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/mobile/android-app"
echo "Running Android Lint..."
./gradlew lint
echo "Done."
