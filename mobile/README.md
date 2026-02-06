# 📱 Idento Mobile - Kotlin Multiplatform

**Cross-platform mobile apps for Android, iOS, and iPadOS**

---

## 📂 Structure

```
mobile/
├── shared/           # KMP shared module (85% code)
│   ├── commonMain/   # Shared code
│   ├── androidMain/  # Android-specific
│   └── iosMain/      # iOS-specific
│
├── android-app/      # Android application
│   └── app/
│
└── iosApp/           # iOS/iPadOS application
    └── iosApp/
```

---

## 🚀 Quick Start

### Build Shared Module:

```bash
cd android-app
./gradlew :shared:build
```

### Run Android:

```bash
cd android-app
./gradlew installDebug
```

### Run iOS:

```bash
# Build framework
cd android-app
./gradlew :shared:linkDebugFrameworkIosSimulatorArm64

# Install dependencies
cd ../iosApp
pod install

# Open in Xcode
open iosApp.xcworkspace
```

---

## 📊 Code Sharing

- **Shared:** 85% (4,500 lines)
- **Android-specific:** 8% (800 lines)
- **iOS-specific:** 7% (600 lines)

---

## 📚 Documentation

See root directory:
- `START_HERE_KMP.md` - Quick start guide
- `KMP_BUILD_INSTRUCTIONS.md` - Detailed build instructions
- `KMP_ARCHITECTURE_OVERVIEW.md` - Architecture details

---

## ✅ Status

| Platform | Status | Progress |
|----------|--------|----------|
| **Android** | ✅ Production Ready | 100% |
| **iOS** | ⚠️ Platform Services Needed | 90% |
| **iPadOS** | ⚠️ Platform Services Needed | 90% |

---

**Built with Kotlin Multiplatform** ❤️


