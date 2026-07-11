# M3 Kiosk Mode — Implementation Summary

**Branch:** `redesign/m3-kiosk-mode`
**Base:** `8cb2c6a` (origin/main, post-PR #39, Mobile M2 Zone Control)
**Plan:** `docs/superpowers/plans/2026-07-11-mobile-redesign-m3-kiosk-mode.md` (8 tasks)
**Spec:** `docs/superpowers/specs/2026-07-11-mobile-redesign-m3-kiosk-mode-design.md`
**Gate:** All 8 targets in `mobile/android-app` — `:shared` compile (Android + iOS simulatorArm64 + iosArm64 + iOS test compile), `:shared:testDebugUnitTest`, `:shared:lintDebug`, `:app:lintDebug`, `:app:assembleDebug` — **PASS**

## What was built

This plan added the third and final staff-facing station mode, "Kiosk" — an unattended, self-service check-in screen for a locked-down device standing at an event entrance, as opposed to Registration's staff-operated scan-and-print flow or Zone Control's checkpoint access gate.

### Task 1 — Deleted dead `presentation/qrscanner/` package

Removed `QRScannerViewModel`/`QRScannerScreen` (533 lines) — pre-redesign fake-camera scaffolding with a hardcoded `"DEMO-001"` test-scan button and the old `AttendeeRepository` API. Removed the now-broken `Screen.QRScanner` composable registration in `IdentoNavHost.kt` (it directly instantiated the deleted class). `Screen.QRScanner`'s route definition and `CheckinScreen`'s `onNavigateToQRScanner` callback were left untouched — they belong to the larger dormant Login/Events/Checkin legacy cluster, whose cleanup is deferred to M4.

### Task 2 — i18n strings

3 new `KIOSK_*` `StringKey` entries added to `Strings.kt`, with EN + RU translations: `KIOSK_WAITING_HINT`, `KIOSK_GREETING_PRINT_CAPTION`, `KIOSK_NEEDS_STAFF_MESSAGE`.

### Task 3 — `KioskLockEffect` (device lockdown)

New `@Composable expect fun KioskLockEffect`, deliberately **not** a Koin-registered class — unlike `CameraService`/`ScanSource`/`PrinterService` (which are Context-scoped platform singletons), Lock Task Mode is inherently Activity/Window-scoped and has no meaningful "shared" instance.

- **Android actual:** simplified screen pinning (`Activity.startLockTask()`/`stopLockTask()`, without Device Owner provisioning) + `FLAG_KEEP_SCREEN_ON` + hidden system bars via `WindowInsetsControllerCompat`. All three pieces are applied unconditionally before the pinning attempt, so keep-screen-on and hidden-bars degrade gracefully even if `startLockTask()` itself fails (e.g. on a device that hasn't granted the pinning permission).
- **iOS actual:** keep-screen-on only, via `UIApplication.sharedApplication().idleTimerDisabled`. Guided Access — iOS's equivalent of Lock Task Mode — cannot be triggered programmatically by an app; this is a platform limitation, not a missing feature.
- Required adding `androidx.activity:activity-compose:1.9.3` as a new Gradle dependency — `:shared`'s `androidMain` had no prior Activity-scoped dependency.

### Task 4 — `KioskViewModel`

Reuses `RegistrationVerdictMapper`/`RegistrationCheckInService` **directly** — Kiosk is self-service Registration, not a separate check-in pipeline. Collapses `RegistrationVerdict`'s 5 variants into 3 attendee-facing screen states:

- `Success`/`PrintError` → **Greeting** (the check-in itself succeeded either way; a print failure is a staff-side concern, never surfaced to the attendee).
- `AlreadyChecked`/`Denied`/`NotFound`/`LookupError` → **NeedsStaff** (fully neutral — no reason is ever shown to the attendee, to avoid revealing registration status to a stranger at an unattended kiosk).

A 5-second auto-return timer applies to Greeting, 10 seconds to NeedsStaff, both returning the screen to Waiting.

**Fix-wave during review** (1 Important finding): the implementer had deviated from the established `RegistrationHomeViewModel` pattern by moving `DebouncedScanPipeline` from a ViewModel-lifetime class field to a per-call local, to work around a virtual-vs-real-clock test artifact. This was reverted to match the class-field pattern; the underlying test was fixed by scanning a different code on re-verification instead of by weakening the debounce architecture.

### Task 5 — `KioskScreen`

Three screen bodies: **Waiting** (a large `ScanReticle` + hint text), **Greeting** (attendee name at the 46sp `kioskAttendeeName` token + print caption), **NeedsStaff** (a neutral message with no check-in-outcome detail). Also implements a 3-second long-press-exit gesture on the logo, via `detectTapGestures(onPress)` + `withTimeout`/`awaitRelease` — deliberately **not** Compose's default `onLongPress` (~500ms), which would be far too easy to trigger by accident on a public kiosk.

### Task 6 — Koin wiring

`KioskViewModel` wired into Koin, reusing the existing `RegistrationVerdictMapper`/`RegistrationCheckInService`/`ScanSource` singletons directly with no new seams introduced for them.

### Task 7 — Navigation wiring

`Screen.KioskHome` route added; `resolveStartDestination` (cold start) and `SetupCompleteScreen`'s mode-branch (warm start) both route `KIOSK`-mode stations there.

**Fix-wave during review** (1 Important finding, a real pre-existing bug predating M3): this task's exit route (long-press → navigate back to `Screen.SetupComplete`) was the first code path in the entire app to ever re-enter that screen after initial wizard completion. That exposed a bug from M1b: `SetupCompleteViewModel.finish()` unconditionally rebuilt `StationConfig` from the shared `SetupWizardDraft` singleton, which had already been `reset()` after the first successful build — causing an `IllegalStateException` on re-entry. Fixed by having `finish()` check the already-persisted `StationConfigPreferences` first (via a new `StationConfigGateway.get()` method) and load that directly on re-entry, without touching the draft at all.

## Milestone significance

Every task went through implementer + reviewer, with 2 fix-waves total across the 8 tasks (Task 4's `DebouncedScanPipeline` architecture revert, Task 7's `SetupComplete` re-entry crash fix). All reviews came back Approved.

This phase completes the M3 exit criterion from the phase table: **"Все 3 режима"** (all 3 station modes) — Registration, Zone Control, and now Kiosk — are reachable and functional, both cold-start (fresh setup wizard completion) and warm-start (returning to an already-configured station). Combined with M1a (foundation), M1b (setup wizard), M1c (registration engine), M1d (registration screens), and M2 (zone control), the mobile redesign's core station-mode functionality is now complete.

## Backlog

Minor items noted during task review, none blocking, none fixed as part of this plan:

- **Task 1:** the broader dormant Login/Events/Checkin legacy screen cluster (including `Screen.QRScanner`'s route definition and `CheckinScreen.onNavigateToQRScanner`) remains unreachable/unused in the nav graph — cleanup deferred to M4, per the established phase philosophy already applied to similar dormant screens in M1a/M2.
- **Task 5 (`KioskScreen`):** hardcoded `"Idento"` logo text and raw `sp` literals for the exit-target text — matches the pre-existing pattern already present in `IdentoLogo.kt`/`LoginScreen.kt`/other screens, not a new regression. The long-press hit area is glyph-bounds only with no minimum-touch-target padding — intentional, since the design goal is specifically that this gesture be hard to trigger by accident on a public-facing kiosk.
- **General (carried from M2, still open):** exported Bluetooth broadcast receiver has no `broadcastPermission` argument (matches the manufacturer-agnostic scanner design, flagged for awareness); narrow TOCTOU window + non-`@Volatile` fields in the BT re-entrancy guard; Zone Control's 404-vs-`LookupError` mapping asymmetry vs Registration (intended); `SearchTab` subtitle cosmetic issue from M1d.
- **Dormant pre-M1a screens** (`Screen.Login`, `Screen.Events`, `Screen.Checkin`, etc.) remain unreachable in the nav graph — cleanup still deferred to M4.

## Implementation commits

| Task | Commit(s) | Summary |
|---|---|---|
| 1. Delete dead `qrscanner/` | `55304f7` | Removed 533 lines, zero references left |
| 2. i18n strings | `a182a26` | 3 `KIOSK_*` keys (EN + RU) |
| 3. `KioskLockEffect` | `d97c6cd` | Android screen pinning + iOS keep-screen-on, `activity-compose` dep added |
| 4. `KioskViewModel` | `61526fe` + `a767026` (fix) | Reuses Registration engine, 8/8 tests, `DebouncedScanPipeline` architecture reverted to class field |
| 5. `KioskScreen` | `1b204bc` | Waiting/Greeting/NeedsStaff + 3s long-press exit |
| 6. Koin wiring | `d33f3ce` | `KioskViewModel` factory, no new seams |
| 7. Nav wiring | `335a4b6` + `2eaf043` (fix) | `Screen.KioskHome`, `SetupCompleteViewModel.finish()` re-entry crash fixed |

## Gate results

All commands executed from `mobile/android-app`, targeting `mobile/shared` (`../shared`) and `mobile/android-app/app`:

| Command | Result | Details |
|---|---|---|
| `:shared:compileDebugKotlinAndroid` | BUILD SUCCESSFUL | |
| `:shared:compileKotlinIosSimulatorArm64` | BUILD SUCCESSFUL | |
| `:shared:compileKotlinIosArm64` | BUILD SUCCESSFUL | |
| `:shared:compileTestKotlinIosSimulatorArm64` | BUILD SUCCESSFUL | |
| `:shared:testDebugUnitTest` | BUILD SUCCESSFUL | 134 tests across 27 suites, 0 failures, 0 errors, 0 skipped |
| `:shared:lintDebug` | BUILD SUCCESSFUL | 0 errors, 26 warnings |
| `:app:lintDebug` | BUILD SUCCESSFUL | 0 errors, 144 warnings (exact match to M2 baseline, no drift) |
| `:app:assembleDebug` | BUILD SUCCESSFUL | APK: `app/build/outputs/apk/debug/app-debug.apk` (49 MB) |

**Full gate:** 8/8 targets PASS. No blocking issues. Ready for final whole-branch review and merge.
