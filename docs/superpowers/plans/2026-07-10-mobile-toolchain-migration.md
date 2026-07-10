# Mobile Toolchain Migration Implementation Plan

> **For agentic workers:** This is a coupled Gradle version migration. The "test" for each
> task is the Gradle build, not a unit test. Execute task-by-task; each task ends with a
> green build and a commit. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modernize the `mobile/` Kotlin Multiplatform toolchain (Kotlin/AGP/Gradle/Compose)
and the kotlinx network stack (ktor/serialization/coroutines) as one coordinated change,
keeping `mobile/android-app` building green.

**Architecture:** Version literals live in exactly three build files
(`mobile/android-app/build.gradle.kts`, `mobile/android-app/app/build.gradle.kts`,
`mobile/shared/build.gradle.kts`) plus the Gradle wrapper. `:shared` is included in the
android-app build via `settings.gradle.kts` but is **not** a dependency of `:app`, so
`:app:assembleDebug` does not compile it — `:shared` needs a separate compile gate.
The dead `libs.versions.toml` (MOBILE-QUAL-11) is not wired in and is out of scope here.

**Tech Stack:** Gradle, AGP, Kotlin Multiplatform, KSP (Hilt+Room), Jetpack/Multiplatform
Compose, ktor, kotlinx-serialization/coroutines.

## Global Constraints

- Branch off `main` (already on `claude/adoring-kirch-39c6cf` @ e945674). Small verified commits.
- **Kotlin target is 2.3.21, NOT 2.4.0.** Rationale: newest KSP is `2.3.10` (built against
  Kotlin 2.3.20); there is **no KSP for Kotlin 2.4.0**. `:app` needs KSP for Hilt + Room, and
  KSP must match Kotlin or the build fails. Kotlin 2.3.x still satisfies the original blocker
  (kotlinx-serialization 1.11.0 requires Kotlin ≥2.3 metadata). Decision confirmed with user.
  Fall back to Kotlin **2.3.20** only if KSP 2.3.10 rejects the 2.3.21 patch.
- Compose compiler plugin version must always equal the Kotlin version (2.3.21).
- Do NOT take no-CVE optional majors: retrofit stays 2.11.0 (2.x), okhttp stays 4.12.0.
  (Note: task said retrofit "already 2.12.0"; repo is actually at 2.11.0 — left untouched.)
- Every version literal for the same plugin/lib must move together across all three files,
  or Gradle fails with "plugin already on classpath with a different version".

## Verification gates

- **App gate (required):** `cd mobile/android-app && ANDROID_HOME=$HOME/Library/Android/sdk ./gradlew :app:assembleDebug`
- **Shared gate (Android + common metadata):** `./gradlew :shared:compileDebugKotlinAndroid :shared:compileCommonMainKotlinMetadata`
- **Shared gate (iOS, per user):** `./gradlew :shared:compileKotlinIosArm64 :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosX64`
- Baseline: `:app:assembleDebug` is green on `main`.

---

### Task 1: Gradle wrapper + AGP (coupled)

**Files:** `mobile/android-app/gradle/wrapper/gradle-wrapper.properties`;
`mobile/android-app/build.gradle.kts:3-4`; `mobile/shared/build.gradle.kts:3`

- [ ] Wrapper `gradle-8.11.1-bin.zip` → `gradle-8.14.5-bin.zip`
- [ ] AGP `com.android.application`/`com.android.library` `8.7.2` → `8.13.2` (top-level, both)
- [ ] AGP `com.android.library` `8.7.2` → `8.13.2` (shared)
- [ ] Verify: App gate green (Kotlin still 2.1.0; AGP is Kotlin-independent). Skip iOS (AGP/Gradle do not affect Kotlin/Native).
- [ ] Commit: `build(mobile): bump Gradle wrapper 8.11.1→8.14.5 and AGP 8.7.2→8.13.2`

### Task 2: Kotlin + KSP + Compose compiler + Compose Multiplatform (the coupled toolchain)

**Files:** `mobile/android-app/build.gradle.kts:5-8,10-11`;
`mobile/android-app/app/build.gradle.kts:7`; `mobile/shared/build.gradle.kts:2,4,5,6`

- [ ] Kotlin plugins (`kotlin.android`, `kotlin.multiplatform`, `plugin.compose`, `plugin.serialization`) `2.1.0` → `2.3.21` in all three files
- [ ] KSP `2.1.0-1.0.29` → `2.3.10`
- [ ] Compose Multiplatform `org.jetbrains.compose` `1.7.3` → `1.11.1` (top-level + shared)
- [ ] Keep network stack OLD (ktor 3.0.2 / serialization 1.7.3 / coroutines 1.9.0 are consumable by Kotlin 2.3.21).
- [ ] Verify: App gate + Shared Android/metadata + Shared iOS (first Kotlin/Native run — slow).
- [ ] If `:shared` fails to compile because `navigation-compose:2.8.0-alpha10` is incompatible with Compose MP 1.11.1, bump the shared JetBrains nav artifact here (see Task 5) — it is a hard blocker, not optional, in that case.
- [ ] Commit: `build(mobile): bump Kotlin 2.1.0→2.3.21, KSP→2.3.10, Compose MP 1.7.3→1.11.1`

### Task 3: kotlinx network/serialization stack (Batch 14)

**Files:** `mobile/shared/build.gradle.kts:55,56,61-65,83,94,99`;
`mobile/android-app/app/build.gradle.kts:96,114,115,136`

- [ ] ktor `io.ktor:ktor-client-*` `3.0.2` → `3.5.1` (7 lines in shared)
- [ ] kotlinx-serialization-json `1.7.3` → `1.11.0` (shared + app)
- [ ] kotlinx-coroutines-* `1.9.0` → `1.11.0` (shared core/test; app android/core/test)
- [ ] Verify: App gate + Shared Android/metadata + Shared iOS (ktor-client-darwin lives in iosMain).
- [ ] Commit: `build(mobile): bump ktor 3.0.2→3.5.1, kotlinx-serialization→1.11.0, coroutines→1.11.0`

### Task 4: Compose BOM (Batch 13, separate step)

**Files:** `mobile/android-app/app/build.gradle.kts:72,139`

- [ ] `androidx.compose:compose-bom` `2024.11.00` → `2026.06.01` (implementation + androidTestImplementation)
- [ ] Update the `// Compose BOM (2024.11.00 ...)` comment on line 71.
- [ ] Verify: App gate (BOM does not touch `:shared`).
- [ ] Commit: `build(mobile): bump Compose BOM 2024.11.00→2026.06.01`

### Task 5: Navigation artifact alignment (Batch 16) — conditional

**Files:** `mobile/shared/build.gradle.kts:78`

- [ ] If not already forced in Task 2: bump `org.jetbrains.androidx.navigation:navigation-compose`
      from `2.8.0-alpha10` to the latest stable compatible with Compose MP 1.11.1 (`2.9.2`).
      This is the KMP/iOS multiplatform nav artifact (different groupId from the AndroidX
      `androidx.navigation:navigation-compose:2.8.4` used by android-app — leave that one).
- [ ] Verify: App gate + Shared Android/metadata + Shared iOS.
- [ ] Commit: `build(mobile): align shared navigation-compose to 2.9.2 for Compose MP 1.11.1`

### Final verification

- [ ] Clean full run: App gate + Shared Android/metadata + Shared iOS, all green.
- [ ] `git log --oneline main..HEAD` shows the small verified commits.

## Out of scope (documented, not done)

- MOBILE-QUAL-11 wiring/removing `libs.versions.toml` (structural; the catalog is dead code and
  its versions have diverged — editing it does not affect the build).
- MOBILE-QUAL-02 android-app/shared architectural unification.
- retrofit 3.x / okhttp 5.x optional no-CVE majors.
