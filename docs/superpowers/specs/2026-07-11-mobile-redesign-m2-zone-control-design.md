# M2: Zone Control Mode — Design

**Status:** Approved for planning
**Branch (future):** `redesign/m2-zone-control`
**Depends on:** M1d (Registration screens, merged as PR #38), Phase B backend contract (merged, PR #27)

## Goal

Add the second staff-facing station mode — Zone Control (`StationMode.ZONE_CONTROL`) — to the mobile app, and fix MOBILE-BUG-04 (`runBlocking` on the main thread in hardware-scanner broadcast receivers) by porting the hardware/BT scanner integration from the legacy `mobile/android-app` (`:app`) module into `:shared` with the fix applied.

Per the design spec's phase table (`docs/superpowers/specs/2026-07-10-mobile-refactor-redesign-design.md:201`):
> M2 | Контроль зоны + аппаратный/BT-сканер (+фикс MOBILE-BUG-04) | Все staff-режимы

## Context

- **Backend is done.** `POST /api/zones/:zone_id/scan` (`backend/internal/handler/zone_scan.go`) already performs all verdict classification server-side (zone-hours check, registration-required check, `CheckZoneAccessAt` rule evaluation, idempotent zone-checkin creation) and returns a structured `ZoneScanResponse` — always HTTP 200, business outcome in the body, mirroring `RegistrationVerdict`'s "never treat business outcomes as HTTP errors" pattern. `POST /api/events/:event_id/checkins/override` exists for the "Всё равно пропустить" (check in anyway) override action.
- **Mobile HTTP client is done.** `ZoneRepository.scanZone(zoneId, code): ApiResult<ZoneScanResponseDto>` and matching DTOs (`ZoneScanRequestDto`, `RegistrationInfoDto`, `ZoneScanResponseDto`) already exist in `:shared`, unused by any reachable screen.
- **`StationMode.ZONE_CONTROL` already exists** as an enum value, and the setup wizard already special-cases it correctly (skips printer step, shows all work points unfiltered, requires day/zone same as Registration). Only the destination screen is missing — `resolveStartDestination` currently falls through to `Screen.SetupComplete.route` for this mode.
- **Hardware/BT scanner code exists but in the wrong module.** `mobile/android-app/app/src/main/java/com/idento/data/scanner/HardwareScannerService.kt` (generic broadcast + per-manufacturer extraction) and `BluetoothScannerService.kt` (BT SPP discovery/connect) are Hilt-wired into the legacy `:app` module, which the redesign plan deletes in M4. Both contain MOBILE-BUG-04: `kotlinx.coroutines.runBlocking { flow.emit(...) }` called from `BroadcastReceiver.onReceive()`, which runs on the main thread — a slow collector can deadlock/ANR the app during a scan.
- **Dead code to remove.** `presentation/zoneselect/` (`ZoneSelectViewModel`, `ZoneSelectScreen`, `ZoneQRScannerViewModel`) is an earlier, abandoned attempt at zone check-in UI — never registered in Koin or nav (flagged in the MOBILE-BUG-03 audit finding). M2 deletes it and builds the real screen fresh, following the M1d `RegistrationHome` seam pattern instead.

## Scope Decisions (locked in brainstorming)

1. **One plan for all of M2** — Zone Control screen/VM/nav + hardware/BT scanner port + MOBILE-BUG-04 fix, single branch/plan (matches M1b/M1c precedent of ~10-task plans).
2. **Delete `presentation/zoneselect/` now**, build fresh rather than repurpose — cleaner architectural fit with the seam pattern, no risk of stale untested code.
3. **Scanner port scope: generic broadcast fallback + BT SPP, no per-manufacturer extraction branches.** The old code's Zebra/Honeywell/Datalogic/Newland/Chainway/Urovo/Point Mobile/Bluebird-specific intent-extraction branches are NOT ported in M2; only the manufacturer-agnostic broadcast receiver (works with most scanners in keyboard-wedge/intent mode) and BT SPP (covers Zebra-class devices) are ported. Per-vendor branches can be added later on demand.
4. **Hardware scanner support ships in BOTH Registration and Zone Control**, not just Zone Control. This retrofits `RegistrationHomeViewModel`/`RegistrationHomeScreen` (M1d, already merged) to consume the new shared `ScanSource` abstraction instead of the narrower `CameraScanGateway`.
5. **New shared `ScanSource` abstraction**, replacing `CameraScanGateway` in both ViewModels — one seam interface, not two independent ones merged ad hoc per-VM. Reduces duplication, matches the design doc's "unified scan pipeline" description (`docs/superpowers/specs/2026-07-10-mobile-refactor-redesign-design.md` §4).
6. **BT scanner: auto-connect to already-paired devices only.** No in-app discovery/pairing UI in M2 — pairing happens via Android system Bluetooth settings, outside the app. `Screen.BluetoothScannerSettings` remains the existing "coming soon" placeholder; full discovery/pairing UI is out of scope for M2.

## Architecture

### `ScanSource` — unified scan pipeline seam

Replaces `CameraScanGateway` (defined in `RegistrationHomeViewModel.kt`, M1d) with a single interface shared by both `RegistrationHomeViewModel` and the new `ZoneControlViewModel`:

```kotlin
// mobile/shared/src/commonMain/kotlin/com/idento/platform/scanner/ScanSource.kt
sealed interface ScannerConnectionState {
    data object Camera : ScannerConnectionState
    data class HardwareConnected(val label: String) : ScannerConnectionState  // e.g. "Zebra TC21"
    data object HardwareDisconnected : ScannerConnectionState
}

interface ScanSource {
    val connectionState: StateFlow<ScannerConnectionState>
    fun startScanning(): Flow<String>
    fun stopScanning()
}
```

- **Android actual**: merges three inputs via `merge()` — (a) existing `CameraService.startScanning()` Flow, (b) a generic broadcast-receiver-based hardware scanner (manufacturer-agnostic intent extraction, ported from `HardwareScannerService.kt` with MOBILE-BUG-04 fixed), (c) BT SPP scanner (ported from `BluetoothScannerService.kt`, same fix, auto-connects only to devices already bonded via `BluetoothAdapter.bondedDevices`). `connectionState` reflects whichever hardware source is currently active; defaults to `Camera` when no hardware scanner is connected. When a hardware scanner connects, the UI shows the "scanner ready" state (§6.3 screen 3b) and the camera preview is not shown (matches design doc: "Режим включается автоматически при подключённом сканере" — hardware mode auto-activates when a scanner connects).
- **iOS actual**: camera-only (`connectionState` always `Camera`), since BT-SPP scanning is explicitly out of v1 scope for iOS per the design doc (line 21: "BT-SPP печать/сканер на iOS (дизайн: «только Android»)").
- **MOBILE-BUG-04 fix**: both ported receivers replace `runBlocking { flow.emit(x) }` with `flow.tryEmit(x)` on a `MutableSharedFlow(replay = 0, extraBufferCapacity = 8)` — non-suspending, cannot deadlock the main thread. A dropped emit (buffer exhausted) is an acceptable degradation (operator rescans); silently blocking the UI thread is not.

### `ZoneVerdictAdapter` — thin server-verdict adapter (no client-side classification)

Unlike `RegistrationVerdictMapper` (M1c/M1d), which classifies verdicts from raw attendee data on the client, the zone-scan backend endpoint already returns a fully classified verdict. The adapter only maps DTO → domain type and handles the network-error case:

```kotlin
// mobile/shared/src/commonMain/kotlin/com/idento/data/zonecontrol/ZoneVerdictAdapter.kt
fun interface ZoneScanSource {
    suspend fun scan(zoneId: String, code: String): ApiResult<ZoneScanResponseDto>
}

sealed interface ZoneVerdict {
    data class Allowed(val attendee: VerdictAttendee, val registeredAt: Instant, val registeredPoint: String, val firstEntry: Boolean) : ZoneVerdict
    data class NoAccess(val attendee: VerdictAttendee, val ruleReason: String, val registeredAt: Instant?) : ZoneVerdict
    data class NotRegistered(val attendee: VerdictAttendee, val registrationPointHint: String) : ZoneVerdict
    data class LookupError(val message: String) : ZoneVerdict
}

class ZoneVerdictAdapter(private val scanSource: ZoneScanSource) {
    suspend fun lookup(zoneId: String, code: String): ZoneVerdict =
        when (val result = scanSource.scan(zoneId, code)) {
            is ApiResult.Success -> result.data.toZoneVerdict()  // maps verdict/reason/attendee/registration/first_entry
            is ApiResult.Error -> ZoneVerdict.LookupError(result.message ?: "Lookup failed")
            is ApiResult.Loading -> ZoneVerdict.LookupError("Still loading")
        }
}
```

`ZoneVerdict` lives in `data/model/` alongside `RegistrationVerdict`, matching the sealed-interface-per-screen-outcome pattern. `LookupError` follows the same pattern as the [`RegistrationVerdict.LookupError` fix applied to M1d](../../../mobile/shared/src/commonMain/kotlin/com/idento/data/model/RegistrationVerdict.kt) (post-merge Codex review): transient network failures must not be displayed as a business verdict like "NOT REGISTERED".

### `ZoneControlViewModel`

```kotlin
// mobile/shared/src/commonMain/kotlin/com/idento/presentation/zonecontrol/ZoneControlViewModel.kt
fun interface ZoneStationGateway {
    suspend fun getConfig(): StationConfig
}

// Maps to POST /api/events/:event_id/checkins/override, body {attendee_id, zone_id, context}.
// context is one of the backend's fixed enum (already_checked | not_registered | no_access;
// backend/internal/handler/checkins_override.go:12-16). Zone Control's override button always
// sends "not_registered" since that's the only verdict with an override action in this design.
// zone_id is optional server-side (*uuid.UUID) but Zone Control always has one, so the mobile
// seam takes it as required.
fun interface CheckinOverrideSource {
    suspend fun submitOverride(eventId: String, zoneId: String, attendeeId: String): ApiResult<Unit>
}

data class ZoneControlUiState(
    val zoneName: String = "",
    val allowedCount: Int = 0,
    val deniedCount: Int = 0,
    val pendingQueueCount: Int = 0,
    val currentVerdict: ZoneVerdict? = null,
    val scannerState: ScannerConnectionState = ScannerConnectionState.Camera,
    val offlineBannerVisible: Boolean = false,
)

class ZoneControlViewModel(
    private val stationGateway: ZoneStationGateway,
    private val verdictAdapter: ZoneVerdictAdapter,
    private val scanSource: ScanSource,
    private val pendingQueueCountSource: PendingQueueCountSource,  // reused as-is from M1d
    private val overrideSource: CheckinOverrideSource,
) : ViewModel() { /* ... */ }
```

- Session counters (`allowedCount`/`deniedCount`) increment client-side per verdict, same pattern as Registration's `sessionCheckedCount` — no server round-trip needed for the StatusBar, since the backend already logs every scan to `zone_scan_log` independently for dashboard-level stats.
- `pendingQueueCount` reuses `PendingQueueCountSource` verbatim (same offline-queue infrastructure as Registration).
- `onOverride(attendee)` (for the `NotRegistered` verdict's "Всё равно пропустить" button) calls `overrideSource.submitOverride(...)`, then re-runs the scan to get a fresh `Allowed` verdict — mirrors M1d's `onManualCheckIn` submit-then-refresh pattern.
- Same lifecycle/scan-pause fixes already applied to `RegistrationHomeViewModel` post-review (pause scanning while a verdict is visible; `withContext(NonCancellable)` around the override submission so a tab switch can't orphan a write) apply here from day one — not something to rediscover in review.

### `ZoneControlScreen`

Mirrors `RegistrationHomeScreen` structurally:
- `StatusBar`: ЗОНА / ДОПУЩЕНО / ОТКАЗОВ / ОЧЕРЕДЬ (4 cells, matches design doc §6.3 verbatim)
- Fixed badge: «Контроль допуска — печать отключена» (always shown — Zone Control never prints)
- Scanner state indicator (screen 3b): when `scannerState is HardwareConnected`, show the "scanner ready" pill (device label) + "Включить камеру телефона" fallback button instead of the live camera preview; when `HardwareDisconnected` (was connected, dropped), show a reconnect/fallback prompt; when `Camera`, show the existing `ScanReticle` camera view unchanged.
- `VerdictCard` exhaustive `when` over `ZoneVerdict`: `Allowed` (green band, "ДОСТУП РАЗРЕШЁН", registered-at/point/first-entry detail), `NoAccess` (red band, "НЕТ ДОПУСКА", rule reason), `NotRegistered` (amber band, "НЕ БЫЛ НА РЕГИСТРАЦИИ", registration-point hint, two actions: "Всё равно пропустить" primary + "Следующий" secondary dismiss-only), `LookupError` (red band, "ОШИБКА", message — same visual treatment as Registration's `LookupError`).
- `statusBarsPadding()` applied from the start (was a post-merge fix in M1d — apply proactively here).

### Nav + Setup wiring

- `Screen.ZoneControlHome` added, route registered in `IdentoNavHost.kt`.
- `resolveStartDestination`: `stationMode == StationMode.ZONE_CONTROL -> Screen.ZoneControlHome.route` (removes the `SetupStartDestinationTest.kt:37-44` "falls through to SetupComplete" case for this mode — test updated to assert the new route).
- `SetupCompleteScreen`'s `LaunchedEffect` mode-branch extended: `StationMode.ZONE_CONTROL -> onNavigateToStation()` alongside the existing `REGISTRATION` branch (same callback, `IdentoNavHost` passes the right target based on which mode navigated).

### Koin wiring

- `ScanSource` registered as `single {}` in `AppModule.kt` (Android actual constructed with `CameraService` + hardware scanner + BT SPP; iOS actual camera-only).
- `ZoneControlViewModel` registered as `factory {}` in `ViewModelModule.kt`, all 5 seams wired to real implementations via method references, following the exact M1d pattern (`ZoneStationGateway` → `StationConfigPreferences`, `ZoneScanSource` → `ZoneRepository::scanZone`, `CheckinOverrideSource` → a new `OverrideRepository` or extension on `ZoneRepository`, `PendingQueueCountSource` reused, `ScanSource` injected as the shared single).

### i18n

New `StringKey.ZONE_*` entries (EN + RU), following the `REGISTRATION_*` naming/organization pattern: StatusBar labels (ЗОНА/ДОПУЩЕНО/ОТКАЗОВ/ОЧЕРЕДЬ), verdict words (ДОСТУП РАЗРЕШЁН/НЕТ ДОПУСКА/НЕ БЫЛ НА РЕГИСТРАЦИИ/ОШИБКА), the printer-disabled badge text, override action labels ("Всё равно пропустить"/"Следующий"), scanner-state labels ("· подключён", "Включить камеру телефона").

## Retrofit to `RegistrationHomeViewModel` (M1d)

Since `ScanSource` replaces `CameraScanGateway`, M2 touches already-merged M1d code:
- `CameraScanGateway` interface removed from `RegistrationHomeViewModel.kt`; constructor parameter changes from `cameraGateway: CameraScanGateway?` to `scanSource: ScanSource`.
- `onScanResumed()`/`onScanPaused()` call `scanSource.startScanning()`/`stopScanning()` instead of the old gateway methods; nullability goes away since `ScanSource` is always available (no more `?: return` early-exit for missing camera).
- `RegistrationHomeUiState` gains a `scannerState: ScannerConnectionState` field; `RegistrationHomeScreen` gets the same screen-3b indicator treatment as Zone Control (shared composable, extracted once and reused by both screens to avoid duplicating the scanner-status UI).
- Existing `RegistrationHomeViewModelTest.kt` fakes (`fakeCameraGateway(codeFlow)`) are updated to construct a fake `ScanSource` instead — mechanical rename, same `MutableSharedFlow`-backed test double shape.

## Testing

- `ZoneControlViewModel`: unit tests mirroring `RegistrationHomeViewModelTest.kt`'s structure — fake `ScanSource` (`MutableSharedFlow`-backed), fake `ZoneScanSource` returning canned `ZoneScanResponseDto`s for each verdict, fake `CheckinOverrideSource`. Covers: scan → each of the 4 verdicts, session counter increments (allowed/denied only, not not-registered or error), override flow re-scans and updates to `Allowed`, offline queue count reflected in StatusBar.
- `ScanSource` Android actual: not JVM-unit-testable (real `BroadcastReceiver`/`BluetoothAdapter`) — compile + lint + manual review only, same constraint already accepted for `CameraService` and the Keystore/Keychain `SecureStore` actuals in M3/M4.
- `RegistrationHomeViewModelTest.kt`: updated fakes, all existing assertions unchanged (behavior is the same, only the seam interface name/shape changes).
- `resolveStartDestination`: `SetupStartDestinationTest.kt` updated — `ZONE_CONTROL` now asserts `Screen.ZoneControlHome.route` instead of falling through to `SetupComplete`.
- `StringsCompletenessTest`: extended automatically once new `ZONE_*` keys are added to both EN and RU maps (existing exhaustiveness check, no new test needed).

## Out of Scope for M2

- Per-manufacturer hardware scanner intent-extraction branches (Zebra DataWedge-specific, Honeywell, Datalogic, Newland, Chainway, Urovo, Point Mobile, Bluebird) — generic broadcast fallback only.
- In-app BT scanner discovery/pairing UI (`BluetoothScannerSettings` stays a placeholder) — pairing via Android system settings only.
- Kiosk mode (M3) and the `mobile/android-app` deletion / `:shared`-only cleanup (M4) — untouched by this phase beyond the hardware-scanner code that's ported *out* of `:app` (the old `:app` files are not deleted in M2; that's M4's job per the phase table, since `:app` still needs to keep working until M4's cutover).
