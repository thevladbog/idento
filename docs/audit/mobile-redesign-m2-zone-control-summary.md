# M2 Zone Control — Implementation Summary

**Branch:** `redesign/m2-zone-control`
**Base:** `dbe499d` (origin/main, post-PR #38, Mobile M1d)
**Plan:** `docs/superpowers/plans/2026-07-11-mobile-redesign-m2-zone-control.md` (11 tasks)
**Spec:** `docs/superpowers/specs/2026-07-11-mobile-redesign-m2-zone-control-design.md`
**Gate:** All 8 targets in `mobile/android-app` — `:shared` compile (Android + iOS simulatorArm64 + iosArm64 + iOS test compile), `:shared:testDebugUnitTest`, `:shared:lintDebug`, `:app:lintDebug`, `:app:assembleDebug` — **PASS**

## What was built

This plan added a second station operating mode, "Zone Control" (access-control checkpoint scanning, as opposed to Registration's first-time badge printing), and along the way unified how both modes read scan input.

### Task 1 — Deleted dead `presentation/zoneselect/` package

Removed `ZoneSelectViewModel`, `ZoneSelectScreen`, `ZoneQRScannerViewModel` (404 lines). This was pre-M1 scaffolding, unreferenced anywhere in `mobile/`, from before the redesign's real Zone Control screens existed.

### Task 2 — i18n strings

17 new `ZONE_*`/`SCANNER_*` `StringKey` entries added to `Strings.kt`, with EN + RU translations, covering the Zone Control StatusBar cells, verdict copy, and the scanner-connection-state pill.

### Task 3 — `ZoneVerdict.LookupError`

Extended the `ZoneVerdict` sealed interface with a `LookupError(message: String)` variant, covering network/lookup failures (and, per a deliberate design decision, 404s — see Deviations below).

### Task 4 — `ScanSource` abstraction (camera + hardware/BT scanner)

New shared seam, `mobile/shared/src/commonMain/kotlin/com/idento/platform/scanner/ScanSource.kt`:

```kotlin
interface ScanSource {
    val connectionState: StateFlow<ScannerConnectionState>
    fun startScanning(): Flow<String>
    fun stopScanning()
    fun preferCamera()
}
```

`ScannerConnectionState` is `Camera | HardwareConnected(label) | HardwareDisconnected`, feeding screen 3b's scanner-status pill.

- **Android actual** (`ScanSource.android.kt`): merges the platform camera with a generic broadcast-receiver-based hardware scanner and Bluetooth SPP auto-connect to already-bonded devices only (no new pairing UI). This closes **MOBILE-BUG-04**: the old code called a suspending `emit()` from inside `BroadcastReceiver.onReceive()` (which runs on a non-suspending callback thread) — replaced with `tryEmit()`.
- **iOS actual** (`ScanSource.ios.kt`): camera-only (no BT/hardware scanner support on iOS in this phase).
- Wired into Koin as a shared `single` in all three `AppModule` files (common/android/ios).

**Fix-wave during review** (commit `db01146`, 2 Important findings, both fixed):
1. No re-entrancy guard on `connectBondedBluetoothScanner` — repeated `startScanning()` calls could leak sockets/coroutines. Fixed with an early-return `isConnected` guard.
2. A race where the intentional camera-switch state write (`preferCamera()`) could be clobbered by the just-closed Bluetooth socket's own async `IOException` handler setting `HardwareDisconnected` on a background coroutine. Fixed via an `isActive` check in that catch block.

### Task 5 — Retrofit `RegistrationHomeViewModel`/`RegistrationHomeScreen` to `ScanSource`

The already-shipped M1d Registration screens (PR #38) used a camera-only `CameraScanGateway` seam. Retrofitted to the new shared `ScanSource`, so Registration-mode stations also pick up hardware/BT scanners — `CameraScanGateway` was fully removed (zero remaining references). Added a new shared `ScannerStatusIndicator` composable (screen 3b), reused by both Registration and Zone Control screens. All 11 pre-existing `RegistrationHomeViewModelTest` assertions verified unchanged (only parameter/helper names changed, not behavior).

### Task 6 — `ZoneVerdictAdapter`

`mobile/shared/src/commonMain/kotlin/com/idento/data/zonecontrol/ZoneVerdictAdapter.kt` — a thin mapper from the backend's already-classified `ZoneScanResponseDto` (`POST /api/zones/:zone_id/scan`) to `ZoneVerdict`. Unlike Registration, where the client classifies the verdict from raw attendee data, Zone Control's backend does all classification server-side — the adapter only maps DTO fields to the domain type and handles the error case (see Deviations below for the 404 mapping).

### Task 7 — `ZoneControlViewModel`

Owns the scan pipeline (`ScanSource.startScanning() → ZoneVerdictAdapter.lookup()`) and the override flow. Session counters (`allowedCount`/`deniedCount`) increment client-side only for `Allowed`/`NoAccess` verdicts (not `NotRegistered`/`LookupError`). The whole scan lookup runs under `withContext(NonCancellable)`, since — unlike Registration's separate lookup/check-in calls — the single `POST /api/zones/:zone_id/scan` request performs both the read and (on an `allowed` outcome) the server-side write atomically; cancelling mid-request on a tab switch could otherwise orphan that write. See Deviations below for `onOverride`'s no-re-scan behavior.

### Task 8 — `ZoneControlScreen`

4-cell `StatusBar` (ЗОНА / ДОПУЩЕНО / ОТКАЗОВ / ОЧЕРЕДЬ), an always-visible print-disabled badge (Zone Control never prints badges), and all 4 verdict types rendered with the correct colors:

| Verdict | Color |
|---|---|
| `Allowed` | Brand green |
| `NoAccess` | Denied red |
| `NotRegistered` | Amber |
| `LookupError` | Denied red |

`NotRegistered` is the only verdict with both an override action ("Всё равно пропустить") and a dismiss-only "next" action.

### Task 9 — Koin wiring

`ZoneControlViewModel` wired into `ViewModelModule.kt` with all 5 constructor seams (`ZoneStationGateway`, `ZoneVerdictAdapter`, `ScanSource`, `PendingQueueCountSource`, `CheckinOverrideSource`) via method references — including the safety-critical `context = "not_registered"` literal on the override call and an exhaustive `ApiResult<CheckinOverrideDto> → ApiResult<Unit>` mapping.

### Task 10 — Navigation wiring

- `Screen.ZoneControlHome` route added (`"zone_control_home"`).
- `resolveStartDestination` routes `ZONE_CONTROL`-mode configured stations there on cold start.
- `SetupCompleteScreen.onNavigateToStation` changed from `() -> Unit` to `(route: String) -> Unit`, with an exhaustive `when (config.mode)` branch for warm-start routing after the setup wizard: `REGISTRATION → Screen.RegistrationHome.route`, `ZONE_CONTROL → Screen.ZoneControlHome.route`, `KIOSK → Unit` (stays on `SetupComplete` until M3 ships the Kiosk screen — no catch-all branch, so this is compiler-enforced, not a silent fallthrough).

## Deviations from the original design spec

Two intentional, documented deviations were made during implementation (both discussed with reviewers and accepted as correct, not defects):

1. **`ZoneControlViewModel.onOverride` does not re-scan after submission.** The backend's `CreateCheckinOverride` endpoint (`POST /api/events/:event_id/checkins/override`) is audit-only — it logs the override decision but does not change what a subsequent zone-scan call would return for that attendee/zone pair. Rather than call the override endpoint and then re-issue a scan (which would still return `NotRegistered`, confusing the operator), `onOverride` treats the operator's tap on the override button as the pass-through decision itself: on success it clears the current verdict and increments `allowedCount` locally, without another round-trip to the scan endpoint.

2. **404-vs-`LookupError` mapping asymmetry vs Registration.** In `ZoneVerdictAdapter`, a 404 response (scanned code matches no attendee) is mapped to `ZoneVerdict.LookupError`, the same bucket as any other network failure. This differs from Registration's handling of the equivalent "no match" case, which has a dedicated not-found verdict path. This is a known, accepted backend/frontend asymmetry: Zone Control's backend does not distinguish "no such attendee" from other scan-endpoint failures in a way the client can act on differently, so both surface as the same generic lookup-failure state to the operator.

## Backlog

Minor items surfaced during task reviews, none blocking, none fixed as part of this plan:

- **Task 2:** A missing blank line before the `SCANNER_*` string-key comment block, inherited from the brief text itself (not an implementer deviation) — cosmetic only.
- **Task 4 (`ScanSource`), non-regressive residuals after the fix-wave:**
  - A narrow TOCTOU window in the Bluetooth re-entrancy guard between the `startScanning()` call and the `bluetoothSocket` assignment post-`connect()`.
  - `bluetoothSocket`/`listenJob` are not `@Volatile` (pre-existing pattern, not introduced by this task).
  - The exported broadcast receiver has no `broadcastPermission` argument — this matches the manufacturer-agnostic design intent (any hardware scanner app can broadcast scanned codes) but is flagged for awareness.
- **Task 6 (`ZoneVerdictAdapter`):** an unused `VerdictAttendee` import in the test file, and an unreachable `ApiResult.Loading` branch in the `when` (exhaustiveness-only, `ZoneScanSource.scan` never actually returns `Loading`) — both inherited from the brief, not implementer defects.
- **General (carried from M1d, still open):** `SearchTab` subtitle uses `attendee.position` instead of `attendee.category`; no dedicated `onManualCheckIn` test coverage; cosmetic import ordering in `IdentoNavHost.kt`. None of these were in M2's scope.
- **Dormant pre-M1a screens** (`Screen.Login`, `Screen.Events`, `Screen.Checkin`, etc.) remain unreachable in the nav graph — cleanup deferred to M4 per the established phase philosophy.
- **M3 (Kiosk mode)** still has no home screen; `SetupCompleteScreen` stays on itself for `StationMode.KIOSK` until M3 ships.

## Implementation commits

| Task | Commit(s) | Summary |
|---|---|---|
| 1. Delete dead `zoneselect/` | `d7ca954` | Removed 404 lines, zero references left |
| 2. i18n strings | `2028996` | 17 `ZONE_*`/`SCANNER_*` keys (EN + RU) |
| 3. `ZoneVerdict.LookupError` | `04531b9` | New sealed-interface variant |
| 4. `ScanSource` abstraction | `fba8647` + `db01146` (fix) | Camera + hardware/BT, MOBILE-BUG-04 fixed, 2 Important race fixes |
| 5. Registration retrofit | `9a64918` | `CameraScanGateway` → `ScanSource`, `ScannerStatusIndicator` added |
| 6. `ZoneVerdictAdapter` | `f2b8b85` | DTO → `ZoneVerdict` mapper, 5/5 tests |
| 7. `ZoneControlViewModel` | `58c0bbf` | Scan + override logic, 8/8 tests |
| 8. `ZoneControlScreen` | `305fa02` | 4-cell StatusBar, all 4 verdict types |
| 9. Koin wiring | `ed61b5e` | `ZoneControlViewModel` factory, 5 seams |
| 10. Nav wiring | `7c2d880` | `Screen.ZoneControlHome`, warm/cold-start routing |

## Gate results

All commands executed from `mobile/android-app`, targeting `mobile/shared` (`../shared`) and `mobile/android-app/app`:

| Command | Result | Details |
|---|---|---|
| `:shared:compileDebugKotlinAndroid` | ✅ BUILD SUCCESSFUL | |
| `:shared:compileKotlinIosSimulatorArm64` | ✅ BUILD SUCCESSFUL | |
| `:shared:compileKotlinIosArm64` | ✅ BUILD SUCCESSFUL | |
| `:shared:compileTestKotlinIosSimulatorArm64` | ✅ BUILD SUCCESSFUL | |
| `:shared:testDebugUnitTest` | ✅ BUILD SUCCESSFUL | 125 tests across 26 suites, 0 failures, 0 errors, 0 skipped |
| `:shared:lintDebug` | ✅ BUILD SUCCESSFUL | 0 errors, 25 warnings |
| `:app:lintDebug` | ✅ BUILD SUCCESSFUL | 0 errors, 144 warnings (vs M1d baseline 142 — 2 net new, no new errors) |
| `:app:assembleDebug` | ✅ BUILD SUCCESSFUL | APK: `app/build/outputs/apk/debug/app-debug.apk` (49.2 MB) |

**Full gate:** 8/8 targets PASS. No blocking issues. Ready for final whole-branch review and merge.
