#!/bin/bash

# Build iOS Framework Script
# Run this before opening Xcode or when Kotlin code changes

set -e

echo "🔨 Building shared framework for iOS..."

cd android-app

# Build for simulator (M1/M2 Mac)
./gradlew :shared:linkDebugFrameworkIosSimulatorArm64

# Optionally build for real device
# ./gradlew :shared:linkReleaseFrameworkIosArm64

echo "✅ Framework built successfully!"
echo "📱 Now you can build in Xcode (⌘R)"


