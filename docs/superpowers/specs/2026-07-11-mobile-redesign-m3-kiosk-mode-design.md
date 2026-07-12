# M3: Kiosk Mode — Design

**Status:** Approved for planning
**Branch (future):** `redesign/m3-kiosk-mode`
**Depends on:** M1c/M1d (Registration engine + screens, merged), M2 (Zone Control + shared `ScanSource`, merged as PR #39)

## Goal

Add the third and final staff-facing station mode — Kiosk (`StationMode.KIOSK`) — a fully self-service, unattended check-in flow for a vertical tablet, with device lockdown (screen pinning, keep-screen-on, hidden system UI) so an unattended kiosk can't be trivially exited by an attendee.

Per the design spec's phase table (`docs/superpowers/specs/2026-07-10-mobile-refactor-redesign-design.md:202`):
> M3 | Киоск: планшетная вёрстка, lockdown, авто-сброс, long-press выход | Все 3 режима

Exit criterion: all 3 station modes (Registration, Zone Control, Kiosk) reachable and functional.

## Context

- **Backend is done.** Kiosk mode reuses the exact same staff-authenticated `POST /api/events/:event_id/checkins/batch` contract as Registration mode, using the `staff_jwt` issued at station provisioning. There is no separate public/unauthenticated self-service API — the self-service UX is a client-side UI restriction only, not a different trust boundary. No backend work in this phase.
- **`StationMode.KIOSK` already exists** and the setup wizard already special-cases it correctly: `dayDate` is skipped (`SetupWizardDraft.kt:54`), the day-zone picker hides the day pills and skips the event-days lookup (`SetupDayZoneViewModel.kt:71,88-90`), work-point filtering matches Registration's (`SetupDayZoneViewModel.kt:104-110`), and the mode-selection card already has copy ("Self-service check-in for attendees" / "Самостоятельная регистрация участников"). Only the destination screen is missing — `SetupCompleteScreen`'s mode-branch is currently `StationMode.KIOSK -> Unit`, a genuine no-op (`SetupCompleteScreen.kt:80`), and `resolveStartDestination` falls through to `Screen.SetupComplete` for KIOSK (`IdentoNavHost.kt:44-53`, with a kdoc explicitly noting "until M3 implements the Kiosk screen").
- **Dead code to remove.** `presentation/qrscanner/` (`QRScannerViewModel`, `QRScannerScreen`) is pre-redesign legacy code with a fake camera (a "Test Scan (Demo)" button hardcoding `"DEMO-001"`), hardcoded English-only copy, ad-hoc colors (no design tokens), and calls into the old `AttendeeRepository.getAttendeeByCode`/`checkinAttendee` API — not the M1c/M2 verdict/check-in pipeline. It's Koin-registered but reachable only via the also-dead `Screen.Login → Events → Checkin` chain, which `resolveStartDestination` never returns (confirmed: the redesigned nav only ever resolves to `SetupLogin`, `RegistrationHome`, `ZoneControlHome`, or `SetupComplete`). M3 deletes only `presentation/qrscanner/`; `Screen.Login`/`Events`/`Checkin` and their composables are a separate, larger legacy cluster already slated for M4's `:shared` cleanup — left untouched here to keep M3's scope from creeping into M4's.

## Scope Decisions (locked in brainstorming)

1. **Delete `presentation/qrscanner/` now**, build fresh — same precedent as M2's `presentation/zoneselect/` deletion. `Screen.Login`/`Events`/`Checkin` are NOT touched in M3 (deferred to M4).
2. **Reuse `RegistrationCheckInService`/`RegistrationVerdictMapper` as the check-in engine**, not a new parallel pipeline. Kiosk is self-service Registration — same batch-checkin call, same offline queue, same badge-print pipeline. `KioskViewModel` is a thin presentation layer that collapses `RegistrationVerdict`'s 5 variants into 3 kiosk screen states.
3. **Lock Task Mode: simplified screen pinning, not Device Owner/COSU.** `Activity.startLockTask()` without Device Owner provisioning works on any Android device with a one-time system consent dialog — no enterprise/MDM setup required. Full Device Owner mode would need out-of-app provisioning infrastructure, explicitly out of scope.
4. **Badge printing is in scope**, via the same `PrintQueueRepository` `RegistrationCheckInService` already drives — Kiosk stations that have a printer configured print exactly like Registration does.
5. **Tablet layout: fixed dimensions for a vertical tablet**, not a general `WindowSizeClass` adaptive-layout system. The parent design spec explicitly scopes adaptive layout to kiosk screens only ("адаптивная вёрстка по window size class (киоск-экраны рассчитаны на вертикальный планшет)") and keeps staff-UI adaptive layout out of v1 scope entirely (`docs/superpowers/specs/2026-07-10-mobile-refactor-redesign-design.md:21`). No new cross-cutting layout infrastructure.

## Architecture

### Check-in engine reuse — no new verdict-classification logic

`KioskViewModel` consumes `RegistrationVerdictMapper` and `RegistrationCheckInService` directly (both already Koin-registered since M1d) — the exact same lookup → check-in flow as `RegistrationHomeViewModel`. The only new logic is collapsing the outcome into a kiosk-appropriate screen state:

```kotlin
// mobile/shared/src/commonMain/kotlin/com/idento/presentation/kiosk/KioskViewModel.kt
sealed interface KioskScreenState {
    data object Waiting : KioskScreenState
    data class Greeting(val attendeeName: String) : KioskScreenState
    data object NeedsStaff : KioskScreenState
}

data class KioskUiState(
    val screenState: KioskScreenState = KioskScreenState.Waiting,
    val scannerState: ScannerConnectionState = ScannerConnectionState.Camera,
)
```

Mapping from `RegistrationVerdict` (produced by the same `verdictMapper.lookup()` → `checkInService.checkIn()` flow already used by `RegistrationHomeViewModel.processScannedCode`):

- `Success`, `PrintError` → `Greeting(attendee.fullName)` — check-in succeeded either way; a print failure is a staff-side/print-queue concern, not something to surface to the attendee (matches the design doc's error-handling policy §8: "Kiosk: any problem → neutral screen to attendee, details staff-side only" — print failures are the one case where the check-in itself still succeeded, so the *attendee-facing* outcome is success).
- `AlreadyChecked`, `Denied`, `NotFound`, `LookupError` → `NeedsStaff` — all four collapse into the same neutral "See a staff member" screen; the real reason is never shown to the attendee (only in whatever staff-facing logging/audit trail already exists server-side).

No manual code entry, no search — Kiosk is scan-only (camera or hardware scanner via the shared `ScanSource`, same as Registration/Zone Control). The Waiting screen's only fallback affordance is static text ("Кода нет? Позовите сотрудника" / "No code? Call a staff member") — there's no interactive search UI for the attendee to use.

Auto-return timers (5s for Greeting, 10s for NeedsStaff, per the design doc's §6.3 screen-3g description) drive the reset back to `Waiting`, at which point scanning resumes:

```kotlin
private suspend fun processScannedCode(config: StationConfig, code: String) {
    val verdict = when (val lookup = verdictMapper.lookup(config.eventId, code)) {
        is RegistrationVerdictLookup.Found -> withContext(NonCancellable) {
            checkInService.checkIn(config.eventId, config, lookup.attendee, badgeTemplate)
        }
        is RegistrationVerdictLookup.AlreadyChecked -> lookup.verdict
        is RegistrationVerdictLookup.Denied -> lookup.verdict
        is RegistrationVerdictLookup.NotFound -> lookup.verdict
        is RegistrationVerdictLookup.LookupFailed -> RegistrationVerdict.LookupError(lookup.message)
    }
    val screenState = when (verdict) {
        is RegistrationVerdict.Success -> KioskScreenState.Greeting(verdict.attendee.fullName)
        is RegistrationVerdict.PrintError -> KioskScreenState.Greeting(verdict.attendee.fullName)
        else -> KioskScreenState.NeedsStaff
    }
    _uiState.update { it.copy(screenState = screenState) }
    onScanPaused()
    viewModelScope.launch {
        delay(if (screenState is KioskScreenState.Greeting) 5_000L else 10_000L)
        _uiState.update { it.copy(screenState = KioskScreenState.Waiting) }
        onScanResumed()
    }
}
```

No Dismiss/Next buttons on any kiosk screen — the attendee never interacts with the verdict screens; the reset is fully automatic. Since scanning is paused for the full auto-return window, no new scan can interrupt the timer early.

### `KioskLock` — a `@Composable expect fun`, not a Koin service

Lock Task Mode, keep-screen-on, and hiding system UI are all Activity/Window-scoped Android APIs — unlike `CameraService`/`ScanSource` (which only need a `Context` and fit cleanly as app-scoped Koin singletons), `Activity.startLockTask()` requires an actual `Activity` reference whose lifetime doesn't match a Koin singleton's. The clean Compose Multiplatform fit is an `expect`/`actual` **Composable function** rather than a class:

```kotlin
// mobile/shared/src/commonMain/kotlin/com/idento/platform/kiosk/KioskLock.kt
@Composable
expect fun KioskLockEffect(enabled: Boolean)
```

- **Android actual**: `DisposableEffect` keyed on `enabled`, using `LocalContext.current as ComponentActivity`. When `enabled` becomes true: `activity.startLockTask()` (simplified screen pinning — no Device Owner, triggers Android's standard one-time "Screen pinning" consent dialog on first use), `activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)`, and hide system bars via `WindowInsetsControllerCompat` (`systemBarsBehavior = BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`, hide `WindowInsetsCompat.Type.systemBars()`). `onDispose` reverses all three: `activity.stopLockTask()`, clears the window flag, shows system bars again.
- **iOS actual**: `DisposableEffect` toggling `UIApplication.shared.isIdleTimerDisabled = enabled` only. Guided Access (the iOS equivalent of Lock Task Mode) cannot be triggered programmatically by an app — it's an OS-level accessibility feature staff must enable manually (triple-click the side/Home button) before handing the device to attendees. This asymmetry is documented the same way M2 documented BT-scanning being Android-only: a comment on the iOS actual, not a silent gap.

`KioskScreen` calls `KioskLockEffect(enabled = true)` once, unconditionally, at the top of its composition — the effect's own `DisposableEffect(enabled)` + Compose's disposal-on-leaving-composition together mean navigating away from the Kiosk screen (via the long-press exit) automatically reverses lockdown; there's no separate manual `stopLockTask()` call site to keep in sync.

### Exit flow — long-press logo, no additional PIN gate

A `pointerInput`-based long-press gesture (explicit **3-second hold**, not Compose's default ~500ms `detectTapGestures(onLongPress)` timeout — a public-facing kiosk needs deliberate friction against an attendee's finger lingering by accident) on the kiosk logo/header shows a confirm `AlertDialog` **inside `KioskScreen` itself** (reusing the wizard's existing exit-confirmation copy — `SETUP_EXIT_STATION_CONFIRM_TITLE`/`BODY`/`SETUP_EXIT_STATION`/`CANCEL` — no new i18n keys, but not navigating to `Screen.SetupComplete`). Confirming calls `KioskViewModel.exitStation()`, which invokes a narrow `KioskExitGateway` seam (clears `StationConfigPreferences` + `AuthPreferences.clearAuth()` — the same two calls `SetupCompleteViewModel.exitStation()` makes) and sets `uiState.exited = true`; `KioskScreen` then navigates directly to `Screen.SetupLogin.route` with `popUpTo(0) { inclusive = true }`.

This design was revised during the final whole-branch review: the original plan (navigate to `Screen.SetupComplete.route`, reusing the wizard's station-summary + "Exit station" screen verbatim) turned out to be broken — `SetupCompleteScreen`'s `LaunchedEffect(uiState.stationConfig)` auto-forwards back into the mode-specific home screen as soon as a persisted config loads, which bounced the operator straight back into the still-locked Kiosk with no way out. Rather than touch `SetupCompleteScreen`/`SetupCompleteViewModel` (shared with Registration/Zone Control's warm-start flow), Kiosk's exit was made fully self-contained instead. Leaving the Kiosk composable (after the exit navigation) naturally disposes `KioskLockEffect`, reversing lockdown. No additional app-level PIN/auth gate on top of the long-press: Android's screen-pinning already requires a deliberate back+overview-hold (or PIN, if the device has one set) to exit Lock Task Mode at the OS level before the long-press gesture is even reachable, which is adequate friction for this MVP scope — an idle attendee won't stumble into either step.

### `KioskScreen` — 3 states, fixed vertical-tablet dimensions

```kotlin
// mobile/shared/src/commonMain/kotlin/com/idento/presentation/kiosk/KioskScreen.kt
```

- **Waiting**: large `ScanReticle` (reused from `presentation/components/redesign/`) centered, static hint text below ("Кода нет? Позовите сотрудника" / "No code? Call a staff member"), logo/header with the long-press-exit gesture.
- **Greeting**: full-screen green (`IdentoColors.Brand`), attendee name at a new large kiosk-specific type-scale token (46px per the design doc — added to `IdentoTypeScale` as `kioskAttendeeName`, distinct from the staff-screen `attendeeName` token), "бейдж печатается — заберите справа" / "Badge printing — collect it on the right" caption.
- **NeedsStaff**: neutral-toned full-screen (`IdentoColors.NeutralBand`, matching Registration's `NotFound` treatment), generic "Обратитесь к сотруднику" / "See a staff member" message — no attendee name, no reason, nothing that could leak a denial/already-checked-in reason to the person standing at the kiosk.

Fixed dimensions sized for a vertical tablet (no `WindowSizeClass` branching) — the screen renders at whatever size the device provides, using the existing token system (`IdentoSpacing`, `IdentoColors`) scaled up via the new `kioskAttendeeName` token and correspondingly larger touch/visual targets than the phone-oriented staff screens, but no adaptive breakpoint logic.

### Nav + Setup wiring

- `Screen.KioskHome` added, route registered in `IdentoNavHost.kt`.
- `resolveStartDestination`: `stationMode == StationMode.KIOSK -> Screen.KioskHome.route` (removes the current KIOSK-falls-through-to-SetupComplete case; `SetupStartDestinationTest.kt`'s existing `startsAtSetupCompleteForKioskMode` test is updated to assert the new route instead).
- `SetupCompleteScreen`'s mode-branch `when (config.mode)` gains `StationMode.KIOSK -> onNavigateToStation(Screen.KioskHome.route)`, replacing the current `Unit` no-op — same pattern as M2's REGISTRATION/ZONE_CONTROL branches.

### Koin wiring

- `KioskViewModel` registered as `factory {}` in `ViewModelModule.kt`, mirroring `RegistrationHomeViewModel`'s factory: `KioskStationGateway` → `StationConfigPreferences`-backed lambda (identical shape to `RegistrationStationGateway`/`ZoneStationGateway`), `verdictMapper`/`checkInService` → `get<RegistrationVerdictMapper>()`/`get<RegistrationCheckInService>()` (the exact same singletons Registration uses), `scanSource` → `get<ScanSource>()`, `badgeTemplateSource` → method reference into `EventRepository`.

### i18n

New `StringKey.KIOSK_*` entries (EN + RU): waiting-screen hint, greeting caption ("badge printing — collect it"), needs-staff message. Small key count (~4-5) compared to Registration/Zone Control since there's no StatusBar, no detail tables, no action buttons on any kiosk screen.

## Testing

- `KioskViewModel`: unit tests mirroring `RegistrationHomeViewModelTest.kt`'s structure — fake `ScanSource`, fake `RegistrationVerdictMapper`/`RegistrationCheckInService` seams (same construction pattern already used in that test file). Covers: scan → Success maps to Greeting with correct name, scan → PrintError also maps to Greeting, scan → each of AlreadyChecked/Denied/NotFound/LookupFailed maps to NeedsStaff, auto-return timer fires and resumes scanning (using `runTest`'s virtual time / `advanceTimeBy`, matching the existing debounce-test pattern in `RegistrationHomeViewModelTest.kt`).
- `KioskLockEffect` Android actual: not JVM-unit-testable (real `Activity`/`Window`) — compile + lint + manual review only, same accepted constraint as `ScanSource`'s Android actual and `CameraService`.
- `resolveStartDestination`: `SetupStartDestinationTest.kt` updated — `KIOSK` now asserts `Screen.KioskHome.route`.
- `StringsCompletenessTest`: extended automatically once `KIOSK_*` keys are added to both EN and RU maps.

## Out of Scope for M3

- Device Owner / COSU provisioning (full enterprise lockdown) — explicitly deferred, no infrastructure for it exists or is planned here.
- General `WindowSizeClass`/adaptive-layout system for staff screens — kiosk-only fixed tablet dimensions, per the parent design spec's own scope boundary.
- Deleting `Screen.Login`/`Events`/`Checkin` and their composables — a larger legacy cluster deferred to M4's `:shared` cleanup, not part of M3's `presentation/qrscanner/` deletion.
- In-app BT scanner discovery/pairing UI, per-manufacturer scanner support — already out of scope from M2, unchanged here (Kiosk reuses the same M2 `ScanSource`).
- iOS Guided Access being app-triggerable — not possible on iOS regardless of scope; documented as a platform limitation, not a missing feature.
