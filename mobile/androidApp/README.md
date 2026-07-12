# `:androidApp`

Thin Android shell for the Idento mobile app. All UI, business logic, and platform
abstractions live in `mobile/shared` (Kotlin Multiplatform); this module only provides:

- `MainActivity` — hosts `:shared`'s Compose UI via `setContent { App() }`.
- `IdentoApplication` — initializes Koin (`:shared`'s DI graph) and runs a best-effort
  one-time migration of any session left by the pre-M1a Hilt-based app (see
  `LegacySessionMigration.kt`).
- `AndroidManifest.xml` — permissions, `network_security_config`.

See `mobile/shared/src/androidMain` for the actual Android platform implementations
(camera scanning, Bluetooth/Ethernet printing, lock task mode, SecureStore).

## Build

From `mobile/`: `./gradlew :androidApp:assembleDebug`
