# M4 Module Restructure & Cleanup — Implementation Summary

**Branch:** `redesign/m4-mobile-cleanup`
**Base:** `cefb1d5` (origin/main, post-PR #42, On-Prem Phase 2 P2.2)
**Plan:** `docs/superpowers/plans/2026-07-12-mobile-redesign-m4-cleanup.md` (7 tasks)
**Spec:** `docs/superpowers/specs/2026-07-12-mobile-redesign-m4-cleanup-design.md`
**Gate:** All 7 targets from `mobile/` (the new Gradle root) — `:androidApp:assembleDebug`, `:androidApp:lintDebug`, `:shared:compileKotlinIosSimulatorArm64`, `:shared:compileKotlinIosArm64`, `:shared:compileTestKotlinIosSimulatorArm64`, `:shared:testDebugUnitTest`, `:shared:lintDebug` — **PASS**

## What was built

M4 is the fifth and final phase of the mobile redesign (`B → M1 → M2 → M3 → M4`). Where M1–M3 built the three station modes (Registration, Zone Control, Kiosk), M4 is pure cleanup: deleting the dead code and dependency stacks left over from the pre-redesign app, giving Registration/Zone Control a real Settings entry point, physically restructuring the Gradle project layout to match the new `:shared` + `:androidApp` (+ iOS) shape, and upgrading CI from a lint-only Android check to a real multi-target gate that also covers iOS for the first time.

### Task 1 — Deleted dead network/storage code in `:shared`

Commit `72fb36a`. Deleted `InMemoryAuthStorage.kt` and the `createPlatformHttpClient` expect/actual triple (`ApiClient.android.kt` / `ApiClient.ios.kt` deleted whole, the `expect fun` removed from `ApiClient.kt`). Verified via grep across `mobile/shared/src` that zero source references to either symbol remained.

### Task 2 — Deleted orphaned pre-redesign nav cluster in `:shared`

Commit `f7a4944`. Removed the dormant Login/Events/Checkin/Attendees/DaySelect/Template presentation package — 14 files, 4473 lines — plus the corresponding trims to `Screen.kt`, `IdentoNavHost.kt`, and `ViewModelModule.kt`. This is the same legacy cluster that M1a, M2, and M3 had each independently flagged as out-of-scope/deferred-to-M4 in their own backlogs (`Screen.QRScanner`'s route stub, `CheckinScreen.onNavigateToQRScanner`, and siblings). Included a mandated sequencing fix: `SettingsScreen`'s dangling `onNavigateToBluetoothScanner → BluetoothScannerSettings` reference was simplified in this same task, since `SettingsScreen`'s own signature drops that param in Task 3.

### Task 3 — Settings entry point

Commit `fe2b419`. Wired a Settings entry point into `RegistrationHomeScreen` and `ZoneControlScreen` (a `Box` + `IconButton` wrapping the existing `StatusBar`, using `AppIcons.Settings`, with `onNavigateToSettings` defaulting to a no-op) plus `IdentoNavHost` wiring both call sites to `Screen.Settings`. Before this task, Settings was unreachable from either station mode's live UI.

### Task 4 — Stripped dead Hilt/Retrofit/Room/CameraX from `:app`

Commit `06aaa43`. Removed the entire pre-redesign dependency stack from the (then still-named) `:app` module: Hilt, Retrofit, Room, CameraX, ML Kit, Coil, Accompanist, zxing, `core-splashscreen`, and `kotlinx-serialization-json` — 19 files deleted, `@HiltAndroidApp` dropped from `IdentoApplication.kt`, the `RECEIVE_BOOT_COMPLETED` permission removed, and both `build.gradle.kts` files rewritten to match the plan verbatim.

Unplanned-but-verified fix folded into this task: `CryptoManager.kt` (kept — its Keystore AES/GCM logic is still live infrastructure, untouched) carried dead `@Inject`/`@Singleton` annotations that only resolved via Hilt's transitive `javax.inject` dependency. Once Hilt was removed, these became a compile break. The two dead annotations were removed with zero logic changes; the reviewer independently confirmed `CryptoManager()` has exactly one bare-constructor call site (`LegacySessionMigration.kt:36`, no DI involved).

### Task 5 — Physical module move

Commits `20c2e08` + `abba86d` (fix). Moved the Gradle root from `mobile/android-app/` to `mobile/`, and renamed `:app` to `:androidApp` (now `mobile/androidApp/`). All content-identical moves used `git mv` to preserve rename history; `settings.gradle.kts` and `README.md` were rewritten, the root `.gitignore` repointed (6 lines), and the old `mobile/android-app/` directory deleted entirely.

Fix-wave (1 Important, a plan-level gap rather than an implementer error): two pre-existing files outside any task's file list — `mobile/README.md` and `mobile/build-ios.sh` — had stale `cd android-app` references that the move broke. Fixed in the same task (README quick-start commands + directory tree diagram; `build-ios.sh`'s `cd` line removed). Re-review confirmed the fix was scoped exactly to those two files' `android-app` references, with zero remaining grep matches.

### Task 6 — CI updates

Commit `bd5d040`. `lint-android` renamed to `build-android` and upgraded from a lint-only, `continue-on-error` check to a real gate: `:androidApp:assembleDebug` + `:androidApp:lintDebug` + `:shared:testDebugUnitTest`, running from the new `mobile/` working directory with updated cache paths. A brand-new `build-ios` job was added on `macos-latest` — this repo had **zero** iOS CI before M4 — compiling `iosSimulatorArm64`/`iosArm64` plus test-compile and running `:shared:iosSimulatorArm64Test`. `ci-success`'s `needs`/status-check list was updated to include both jobs. The 3 `lint-mobile` helper scripts (`scripts/lint-mobile.sh`/`.ps1`/one more) were repointed to `mobile/:androidApp:lintDebug`.

Minor backlog (not blocking): `scripts/lint-mobile.ps1:28` has one leftover cosmetic `mobile/android-app` string in an edge-case-only error hint (fires only when bash is unavailable *and* `gradlew.bat` is missing) — zero effect on control flow.

### Task 7 — Final gate, summary doc, progress ledger (this task)

Ran the full 7-target gate from `mobile/` (see Gate results below), pushed the branch, wrote this summary, and appended the closing section to `.superpowers/sdd/progress.md`.

## Net effect

Across Tasks 1, 2, and 4, M4 deleted dead code/dependencies across both `:shared` and `:androidApp`. The full branch diff (`cefb1d5..bd5d040`, `mobile/` only) is **70 files changed, 190 insertions(+), 7692 deletions(-)** — almost entirely deletions, consistent with M4's cleanup-only scope. No new product functionality was added other than the Settings entry point (Task 3), which is a pure navigation wire-up (no new screen content).

## Backlog

Minor items noted during task review, none blocking, none fixed as part of this plan:

- **Task 6:** `scripts/lint-mobile.ps1:28` has a leftover cosmetic `mobile/android-app` string in an edge-case-only error hint (bash unavailable *and* `gradlew.bat` missing) — zero effect on control flow.
- **Carried from M3 (now closed by Task 2):** the dormant pre-M1a Login/Events/Checkin/Attendees/DaySelect/Template legacy cluster that M1a/M2/M3 each deferred is now deleted. No further cleanup items remain outstanding from that lineage.
- **General mobile backlog carried from M2/M3 (unrelated to M4, still open, out of this plan's scope):** exported Bluetooth broadcast receiver has no `broadcastPermission` argument (manufacturer-agnostic design, intentional); narrow TOCTOU window + non-`@Volatile` fields in the BT re-entrancy guard; Zone Control's 404-vs-`LookupError` mapping asymmetry vs Registration (intended); `SearchTab` subtitle cosmetic issue from M1d.
- **CI verification caveat (found during this task):** `.github/workflows/ci.yml` triggers only on `push: branches: [main, master]` and `pull_request: branches: [main, master]` — pushing directly to a feature branch with no open PR does **not** trigger a CI run. `redesign/m4-mobile-cleanup` had no open PR at the time this task ran, so `build-android`/`build-ios`/`ci-success` could not be observed running against the pushed commit `bd5d040`. The local gate (7/7 targets, this doc's Gate results table) is fully green and is the authoritative verification for this task; the actual CI run will occur once a PR is opened, which is the next step (`superpowers:finishing-a-development-branch`).

## Implementation commits

| Task | Commit(s) | Summary |
|---|---|---|
| 1. Delete dead network/storage code | `72fb36a` | `InMemoryAuthStorage.kt` + `createPlatformHttpClient` expect/actual triple removed |
| 2. Delete orphaned nav cluster | `f7a4944` | Login/Events/Checkin/Attendees/DaySelect/Template — 14 files, 4473 lines |
| 3. Settings entry point | `fe2b419` | Registration/Zone Control → `Screen.Settings` |
| 4. Strip dead `:app` stack | `06aaa43` | Hilt/Retrofit/Room/CameraX/ML Kit/Coil/Accompanist/zxing/etc. — 19 files, `CryptoManager.kt` annotation fix |
| 5. Physical module move | `20c2e08` + `abba86d` (fix) | `mobile/android-app/` → `mobile/` + `mobile/androidApp/`; README/build-ios.sh fix |
| 6. CI updates | `bd5d040` | `build-android` real gate + new `build-ios` macOS job + `ci-success` + lint-mobile scripts |
| 7. Final gate + summary + ledger | (this task) | Gate, push, summary doc, progress ledger |

## Gate results

All commands executed from `mobile/` (the new Gradle root):

| Command | Result | Details |
|---|---|---|
| `:androidApp:assembleDebug` | BUILD SUCCESSFUL | APK: `androidApp/build/outputs/apk/debug/androidApp-debug.apk` (48 MB) |
| `:androidApp:lintDebug` | BUILD SUCCESSFUL | 0 errors, 115 warnings |
| `:shared:compileKotlinIosSimulatorArm64` | BUILD SUCCESSFUL | |
| `:shared:compileKotlinIosArm64` | BUILD SUCCESSFUL | |
| `:shared:compileTestKotlinIosSimulatorArm64` | BUILD SUCCESSFUL | |
| `:shared:testDebugUnitTest` | BUILD SUCCESSFUL | 136 tests across 27 suites, 0 failures, 0 errors, 0 skipped |
| `:shared:lintDebug` | BUILD SUCCESSFUL | 0 errors, 26 warnings |

**Full gate:** 7/7 targets PASS, single combined invocation returned `BUILD SUCCESSFUL`. No blocking issues.

**CI:** not yet observed running against the pushed commit — see the CI verification caveat above. Local gate is the authoritative pass/fail signal for this task.

This is the last phase of the mobile redesign's phase table (**B → M1 → M2 → M3 → M4**). Branch is ready to proceed to `superpowers:finishing-a-development-branch` for the merge decision, which should open the PR and confirm `build-android`/`build-ios`/`ci-success` there.
