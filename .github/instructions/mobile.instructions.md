---
applyTo: "mobile/**"
---

# Mobile (Kotlin)

- Kotlin Multiplatform; Android app in `androidApp/` — thin shell (Koin, no Hilt), Compose Navigation
- Shared code in `shared/`; iOS in `iosApp/`
- UI: Jetpack Compose only (no XML layouts or Fragments); MVI in ViewModels; Flow/StateFlow for state
- Screens: Setup wizard, Registration, Zone Control, Kiosk, Settings
- Build: Gradle from `mobile/` (root)
- Follow `.cursor/rules/android.mdc` for Kotlin and Android (Compose) conventions
