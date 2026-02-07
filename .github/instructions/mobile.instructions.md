---
applyTo: "mobile/**"
---

# Mobile (Kotlin)

- Kotlin Multiplatform; Android app in `android-app/` uses Jetpack Compose, Hilt, Compose Navigation
- Shared code in `shared/`; iOS in `iosApp/`
- UI: Jetpack Compose only (no XML layouts or Fragments); MVI in ViewModels; Flow/StateFlow for state
- Screens: Events, Check-in, Attendees, Template editor, Scanner settings, Settings
- Build: Gradle from `mobile/android-app/` or root; run tests as in CI
- Follow `.cursor/rules/android.mdc` for Kotlin and Android (Compose) conventions
