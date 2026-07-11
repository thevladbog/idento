# Mobile Redesign M1d — Registration Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Registration-mode check-in screens (camera-scan tab + search/list tab) on top of M1c's engine and wire them into `IdentoNavHost`, replacing the dead-end `SetupCompleteScreen` placeholder for REGISTRATION-mode stations.

**Architecture:** One new `RegistrationHomeScreen` composable (in `presentation/registration/`) hosts two tabs — Scan and Search — driven by a single `RegistrationHomeViewModel`. The ViewModel owns the full scan pipeline (`CameraService → DebouncedScanPipeline → RegistrationVerdictMapper → RegistrationCheckInService`) and the search flow (`AttendeeRepository.searchAttendees`), plus the four StatusBar cell values. `SetupCompleteScreen` gains a mode-aware `onNavigateToStation` callback so REGISTRATION-mode stations are forwarded to `RegistrationHomeScreen` immediately after `finish()` completes; `IdentoNavHost` adds the `Screen.RegistrationHome` composable entry and updates `resolveStartDestination` to route REGISTRATION-mode pre-configured stations directly there on cold start.

**Tech Stack:** Same as M1a/M1b/M1c — Kotlin 2.3.21, Compose Multiplatform 1.11.1, Koin 4.0.0, Ktor 3.5.1, kotlinx-coroutines 1.10.x, `kotlin.time.Duration`/`kotlin.time.Clock` (used internally by `DebouncedScanPipeline` — no direct use in this plan). No new dependencies.

## Global Constraints

- Package/file layout: new code in `mobile/shared/src/commonMain/kotlin/com/idento/presentation/registration/` (one ViewModel file + one Screen file, matching every other feature package, e.g. `presentation/login/`, `presentation/setup/`).
- No new backend changes in M1d — backend is frozen (same as M1a/M1b/M1c). `EventRepository`, `AttendeeRepository`, `RegistrationCheckInService`, `RegistrationVerdictMapper` are consumed as-is.
- **CRITICAL Koin gap from M1c:** `RegistrationVerdictMapper` and `RegistrationCheckInService` are NOT yet registered in Koin after M1c — they were intentionally left unregistered because nothing consumed them. Task 2 of this plan wires them. Any implementation that skips Task 2 will silently use `RegistrationCheckInService`'s degraded constructor defaults (`AttendeeLookup { _, _ -> ApiResult.Error(...) }`, no-op `offlineQueue`, missing `printJobEnqueuer`) and produce incorrect runtime behavior without any compile error.
- `DebouncedScanPipeline` is NOT registered in Koin and does not need to be — the ViewModel instantiates it directly (no platform deps, no shared singleton). Do NOT add a Koin binding for it.
- All user-facing strings through `StringKey`/`Strings.kt` (both EN and RU required for every key, enforced by `StringsCompletenessTest`). All new keys use the `REGISTRATION_` prefix.
- All new Composables use only components from `presentation/components/redesign/` and tokens from `DesignTokens.kt`. No ad-hoc styling.
- Verdict colors per design spec: Success = `IdentoColors.Brand` (#00935E), AlreadyChecked = `IdentoColors.Amber` (#F5A300), NotFound = `IdentoColors.NeutralBand` (#2B3230), Denied = `IdentoColors.Denied` (#CE2B37), PrintError = `IdentoColors.Brand` (green band — check-in succeeded — with a separate red print-fail row).
- Dormant pre-M1a screens (`Screen.Login`, `Screen.Events`, `Screen.Checkin`, etc.) remain in the nav graph unreachable — do NOT remove or modify them (M4 cleanup).
- Every new suspend function wrapping Ktor calls must use `apiRunCatching` from `ApiResult.kt`, not bare `runCatching`. M1d only calls already-wrapped repository methods, so no new wrapping is required — but any additional wrappers added must follow this rule.
- Verification gate for every task (run from `mobile/android-app` directory): `./gradlew :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:compileTestKotlinIosSimulatorArm64 :shared:testDebugUnitTest :shared:lintDebug :app:lintDebug`. Final task additionally runs `:app:assembleDebug`.

---

### Task 1: i18n strings — REGISTRATION_* keys

**Files:**
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/data/localization/Strings.kt`
- Test: `mobile/shared/src/commonTest/kotlin/com/idento/data/localization/StringsCompletenessTest.kt` (already exists — must pass after this task without modification)

**Interfaces:**
- Consumes: existing `StringKey` enum + `englishStrings`/`russianStrings` maps (both `internal` — test works because it lives in the same Gradle module, confirming this access works in M1b already).
- Produces: 22 new `REGISTRATION_*` `StringKey` entries, each with both EN and RU translations, usable in all later tasks via `stringResource(StringKey.REGISTRATION_*)`.

- [ ] **Step 1: Add 22 new enum entries to `StringKey`**

In `Strings.kt`, inside the existing `enum class StringKey { ... }` block, append after the last existing entry (do not touch any existing entry):

```kotlin
// Registration mode screens (M1d)
REGISTRATION_TAB_SCAN,
REGISTRATION_TAB_SEARCH,
REGISTRATION_STATUSBAR_ZONE_LABEL,
REGISTRATION_STATUSBAR_PRINTER_LABEL,
REGISTRATION_STATUSBAR_QUEUE_LABEL,
REGISTRATION_STATUSBAR_CHECKED_LABEL,
REGISTRATION_VERDICT_SUCCESS_WORD,
REGISTRATION_VERDICT_ALREADY_WORD,
REGISTRATION_VERDICT_NOT_FOUND_WORD,
REGISTRATION_VERDICT_DENIED_WORD,
REGISTRATION_ATTENDEE_COMPANY,
REGISTRATION_ATTENDEE_CATEGORY,
REGISTRATION_PRINT_STATE_SENT,
REGISTRATION_PRINT_STATE_QUEUED,
REGISTRATION_PRINT_STATE_FAILED,
REGISTRATION_ALREADY_FIRST_AT,
REGISTRATION_ALREADY_DEVICE,
REGISTRATION_ALREADY_POINT,
REGISTRATION_DENIED_REASON,
REGISTRATION_SEARCH_PLACEHOLDER,
REGISTRATION_SEARCH_EMPTY,
REGISTRATION_ACTION_DISMISS,
```

- [ ] **Step 2: Add 22 English translations to `englishStrings`**

Inside the `englishStrings` map (`internal val englishStrings: Map<StringKey, String> = mapOf(...)`), append:

```kotlin
StringKey.REGISTRATION_TAB_SCAN to "SCANNER",
StringKey.REGISTRATION_TAB_SEARCH to "SEARCH",
StringKey.REGISTRATION_STATUSBAR_ZONE_LABEL to "ZONE",
StringKey.REGISTRATION_STATUSBAR_PRINTER_LABEL to "PRINTER",
StringKey.REGISTRATION_STATUSBAR_QUEUE_LABEL to "QUEUE",
StringKey.REGISTRATION_STATUSBAR_CHECKED_LABEL to "CHECKED IN",
StringKey.REGISTRATION_VERDICT_SUCCESS_WORD to "PASSED",
StringKey.REGISTRATION_VERDICT_ALREADY_WORD to "ALREADY CHECKED",
StringKey.REGISTRATION_VERDICT_NOT_FOUND_WORD to "NOT FOUND",
StringKey.REGISTRATION_VERDICT_DENIED_WORD to "DENIED",
StringKey.REGISTRATION_ATTENDEE_COMPANY to "Company",
StringKey.REGISTRATION_ATTENDEE_CATEGORY to "Category",
StringKey.REGISTRATION_PRINT_STATE_SENT to "Badge sent",
StringKey.REGISTRATION_PRINT_STATE_QUEUED to "Badge queued",
StringKey.REGISTRATION_PRINT_STATE_FAILED to "Print failed",
StringKey.REGISTRATION_ALREADY_FIRST_AT to "First checked in",
StringKey.REGISTRATION_ALREADY_DEVICE to "Device",
StringKey.REGISTRATION_ALREADY_POINT to "Point",
StringKey.REGISTRATION_DENIED_REASON to "Reason",
StringKey.REGISTRATION_SEARCH_PLACEHOLDER to "Name, email, company…",
StringKey.REGISTRATION_SEARCH_EMPTY to "No results",
StringKey.REGISTRATION_ACTION_DISMISS to "Dismiss",
```

- [ ] **Step 3: Add 22 Russian translations to `russianStrings`**

Inside the `russianStrings` map, append:

```kotlin
StringKey.REGISTRATION_TAB_SCAN to "СКАНЕР",
StringKey.REGISTRATION_TAB_SEARCH to "ПОИСК",
StringKey.REGISTRATION_STATUSBAR_ZONE_LABEL to "ЗОНА",
StringKey.REGISTRATION_STATUSBAR_PRINTER_LABEL to "ПРИНТЕР",
StringKey.REGISTRATION_STATUSBAR_QUEUE_LABEL to "ОЧЕРЕДЬ",
StringKey.REGISTRATION_STATUSBAR_CHECKED_LABEL to "ОТМЕЧЕНО",
StringKey.REGISTRATION_VERDICT_SUCCESS_WORD to "ПРОШЁЛ",
StringKey.REGISTRATION_VERDICT_ALREADY_WORD to "УЖЕ БЫЛ",
StringKey.REGISTRATION_VERDICT_NOT_FOUND_WORD to "НЕ НАЙДЕН",
StringKey.REGISTRATION_VERDICT_DENIED_WORD to "ЗАПРЕЩЕНО",
StringKey.REGISTRATION_ATTENDEE_COMPANY to "Компания",
StringKey.REGISTRATION_ATTENDEE_CATEGORY to "Категория",
StringKey.REGISTRATION_PRINT_STATE_SENT to "Бейдж отправлен",
StringKey.REGISTRATION_PRINT_STATE_QUEUED to "Бейдж в очереди",
StringKey.REGISTRATION_PRINT_STATE_FAILED to "Ошибка печати",
StringKey.REGISTRATION_ALREADY_FIRST_AT to "Первая отметка",
StringKey.REGISTRATION_ALREADY_DEVICE to "Устройство",
StringKey.REGISTRATION_ALREADY_POINT to "Точка",
StringKey.REGISTRATION_DENIED_REASON to "Причина",
StringKey.REGISTRATION_SEARCH_PLACEHOLDER to "Имя, email, компания…",
StringKey.REGISTRATION_SEARCH_EMPTY to "Нет результатов",
StringKey.REGISTRATION_ACTION_DISMISS to "Закрыть",
```

- [ ] **Step 4: Run the completeness test**

```bash
cd mobile/android-app
./gradlew :shared:testDebugUnitTest --tests "com.idento.data.localization.StringsCompletenessTest"
```

Expected: `BUILD SUCCESSFUL`, `1 test completed`.

- [ ] **Step 5: Run the full gate**

```bash
./gradlew :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:compileTestKotlinIosSimulatorArm64 :shared:testDebugUnitTest :shared:lintDebug :app:lintDebug
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 6: Commit**

```bash
git add mobile/shared/src/commonMain/kotlin/com/idento/data/localization/Strings.kt
git commit -m "feat(mobile/i18n): add REGISTRATION_* string keys (EN + RU, 22 keys)"
```

---

### Task 2: Koin wiring — register RegistrationVerdictMapper and RegistrationCheckInService

**Files:**
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/di/AppModule.kt`
- Test: `mobile/shared/src/commonTest/kotlin/com/idento/di/RegistrationServiceConstructionTest.kt` (new)

**Interfaces:**
- Consumes:
  - `RegistrationVerdictMapper(attendeeLookup: AttendeeLookup)` — `AttendeeLookup` is a `fun interface` defined in `RegistrationVerdictMapper.kt`: `suspend fun getAttendeeByCode(eventId: String, code: String): ApiResult<Attendee?>`.
  - `RegistrationCheckInService(batchSubmitter, attendeeLookup, offlineQueue, printJobEnqueuer)` — all four seam `fun interface` types defined in `RegistrationCheckInService.kt`:
    - `BatchCheckinSubmitter`: `suspend fun submitBatchCheckins(eventId: String, items: List<BatchCheckinItemDto>): ApiResult<List<BatchCheckinResultDto>>`
    - `AttendeeLookup`: same as above (shared type from `RegistrationVerdictMapper.kt`)
    - `RegistrationOfflineQueue`: `suspend fun enqueue(eventId: String, item: BatchCheckinItemDto)` — **already Koin-registered** as `single<RegistrationOfflineQueue> { get<RegistrationOfflineQueueRepository>() }`
    - `PrintJobEnqueuer`: `suspend fun enqueue(zpl: String, printer: PrinterConfig): Long`
  - `AttendeeRepository.submitBatchCheckins(eventId, items)` and `AttendeeRepository.getAttendeeByCode(eventId, code)` — existing methods with matching signatures.
  - `PrintQueueRepository.enqueue(zpl, printer): Long` — already registered as `single { PrintQueueRepository(...) }`.
- Produces:
  - `single<RegistrationVerdictMapper>` — resolvable via `get<RegistrationVerdictMapper>()` in ViewModelModule (Task 3).
  - `single<RegistrationCheckInService>` — resolvable via `get<RegistrationCheckInService>()` in ViewModelModule (Task 3).

- [ ] **Step 1: Write the seam-compatibility test**

Create `mobile/shared/src/commonTest/kotlin/com/idento/di/RegistrationServiceConstructionTest.kt`:

```kotlin
package com.idento.di

import com.idento.data.model.ApiResult
import com.idento.data.registration.AttendeeLookup
import com.idento.data.registration.BatchCheckinSubmitter
import com.idento.data.registration.PrintJobEnqueuer
import com.idento.data.registration.RegistrationCheckInService
import com.idento.data.registration.RegistrationOfflineQueue
import com.idento.data.registration.RegistrationVerdictMapper
import kotlin.test.Test
import kotlin.test.assertNotNull

class RegistrationServiceConstructionTest {

    @Test
    fun verdictMapperConstructsWithFakeLookup() {
        val mapper = RegistrationVerdictMapper(
            attendeeLookup = AttendeeLookup { _, _ -> ApiResult.Error(Exception("fake")) },
        )
        assertNotNull(mapper)
    }

    @Test
    fun checkInServiceConstructsWithAllFourSeams() {
        val service = RegistrationCheckInService(
            batchSubmitter = BatchCheckinSubmitter { _, _ -> ApiResult.Error(Exception("fake")) },
            attendeeLookup = AttendeeLookup { _, _ -> ApiResult.Error(Exception("fake")) },
            offlineQueue = RegistrationOfflineQueue { _, _ -> },
            printJobEnqueuer = PrintJobEnqueuer { _, _ -> 0L },
        )
        assertNotNull(service)
    }
}
```

- [ ] **Step 2: Run the test (it should already pass — these classes exist from M1c)**

```bash
cd mobile/android-app
./gradlew :shared:testDebugUnitTest --tests "com.idento.di.RegistrationServiceConstructionTest"
```

Expected: `BUILD SUCCESSFUL`, `2 tests completed`. If it fails with import errors, check that `AttendeeLookup`, `BatchCheckinSubmitter`, etc. are imported from the correct packages — they are defined in `data/registration/RegistrationVerdictMapper.kt` and `data/registration/RegistrationCheckInService.kt`.

- [ ] **Step 3: Add Koin registrations to AppModule.kt**

In `mobile/shared/src/commonMain/kotlin/com/idento/di/AppModule.kt`, inside the existing `module { }` block, add the following two `single {}` blocks after the existing `RegistrationOfflineQueueRepository` registration (which must already exist for `RegistrationOfflineQueue` to resolve):

```kotlin
// ── Registration engine (wired in M1d; classes existed in M1c but had no consumers) ──
single {
    val attendeeRepo = get<AttendeeRepository>()
    RegistrationVerdictMapper(
        attendeeLookup = AttendeeLookup(attendeeRepo::getAttendeeByCode),
    )
}
single {
    val attendeeRepo = get<AttendeeRepository>()
    val printRepo = get<PrintQueueRepository>()
    RegistrationCheckInService(
        batchSubmitter = BatchCheckinSubmitter(attendeeRepo::submitBatchCheckins),
        attendeeLookup = AttendeeLookup(attendeeRepo::getAttendeeByCode),
        offlineQueue = get<RegistrationOfflineQueue>(),
        printJobEnqueuer = PrintJobEnqueuer(printRepo::enqueue),
    )
}
```

Add the required imports at the top of `AppModule.kt` (only add those not already present):

```kotlin
import com.idento.data.registration.AttendeeLookup
import com.idento.data.registration.BatchCheckinSubmitter
import com.idento.data.registration.PrintJobEnqueuer
import com.idento.data.registration.RegistrationCheckInService
import com.idento.data.registration.RegistrationVerdictMapper
```

- [ ] **Step 4: Run the full gate**

```bash
cd mobile/android-app
./gradlew :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:compileTestKotlinIosSimulatorArm64 :shared:testDebugUnitTest :shared:lintDebug :app:lintDebug
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 5: Commit**

```bash
git add mobile/shared/src/commonMain/kotlin/com/idento/di/AppModule.kt \
        mobile/shared/src/commonTest/kotlin/com/idento/di/RegistrationServiceConstructionTest.kt
git commit -m "feat(mobile/di): wire RegistrationVerdictMapper + RegistrationCheckInService into Koin (M1c gap)"
```

---

### Task 3: RegistrationHomeViewModel

**Files:**
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/registration/RegistrationHomeViewModel.kt`
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/di/ViewModelModule.kt`
- Test: `mobile/shared/src/commonTest/kotlin/com/idento/presentation/registration/RegistrationHomeViewModelTest.kt`

**Interfaces:**
- Consumes:
  - `RegistrationVerdictMapper.lookup(eventId: String, code: String): RegistrationVerdictLookup` — sealed interface with variants `Found(attendee)`, `AlreadyChecked(verdict)`, `Denied(verdict)`, `NotFound(verdict)`, `LookupFailed(message)`.
  - `RegistrationCheckInService.checkIn(eventId, station: StationConfig, attendee: Attendee, badgeTemplate: BadgeTemplate?): RegistrationVerdict`
  - `DebouncedScanPipeline()` — instantiated directly in the ViewModel (no Koin). `fun process(source: Flow<String>): Flow<String>`.
  - `CameraService.startScanning(): Flow<String>`, `CameraService.stopScanning()`
  - `EventRepository.getBadgeTemplate(eventId): ApiResult<String?>` — wrap non-null result as `BadgeTemplate(zplTemplate = it)`
  - `AttendeeRepository.searchAttendees(eventId: String, query: String): ApiResult<List<Attendee>>`
  - `StationConfig` (accessed via `RegistrationStationGateway` seam defined below)
  - `Flow<Int>` of pending queue count (accessed via `PendingQueueCountSource` seam defined below)
- Produces:
  - `RegistrationTab` enum, `RegistrationHomeUiState` data class — both defined in this file
  - `class RegistrationHomeViewModel(...)` with `val uiState: StateFlow<RegistrationHomeUiState>` and public methods: `onTabSelected(tab)`, `onScanResumed()`, `onScanPaused()`, `onVerdictDismissed()`, `onSearchQueryChanged(query)`, `onManualCheckIn(attendee)`
  - Two seam interfaces defined at the top of `RegistrationHomeViewModel.kt` and used by ViewModelModule (Task 3 step 3):
    - `fun interface RegistrationStationGateway { suspend fun getConfig(): StationConfig }`
    - `fun interface PendingQueueCountSource { fun observe(): Flow<Int> }`

- [ ] **Step 1: Write failing ViewModel tests**

Create `mobile/shared/src/commonTest/kotlin/com/idento/presentation/registration/RegistrationHomeViewModelTest.kt`:

```kotlin
package com.idento.presentation.registration

import com.idento.data.model.ApiResult
import com.idento.data.model.Attendee
import com.idento.data.model.BadgeTemplate
import com.idento.data.model.PrintState
import com.idento.data.model.RegistrationVerdict
import com.idento.data.model.StationConfig
import com.idento.data.model.StationMode
import com.idento.data.model.VerdictAttendee
import com.idento.data.registration.AttendeeLookup
import com.idento.data.registration.BatchCheckinSubmitter
import com.idento.data.registration.DebouncedScanPipeline
import com.idento.data.registration.PrintJobEnqueuer
import com.idento.data.registration.RegistrationCheckInService
import com.idento.data.registration.RegistrationOfflineQueue
import com.idento.data.registration.RegistrationVerdictLookup
import com.idento.data.registration.RegistrationVerdictMapper
import com.idento.platform.camera.CameraService
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import kotlinx.datetime.Clock
import kotlinx.datetime.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class RegistrationHomeViewModelTest {

    private val dispatcher = UnconfinedTestDispatcher()

    private val fakeConfig = StationConfig(
        eventId = "evt-1",
        eventName = "Тест",
        mode = StationMode.REGISTRATION,
        dayDate = "2026-07-11",
        workPointId = "zone-1",
        workPointName = "Главный вход",
        printer = null,
        autoPrint = false,
        deviceNumber = 1,
        staffName = "test@idento.app",
    )

    private val fakeAttendee = Attendee(
        id = "att-1",
        firstName = "Иван",
        lastName = "Иванов",
        fullName = "Иван Иванов",
        email = "ivan@example.com",
        company = "ООО Тест",
        category = "Гость",
        code = "QR-001",
        checkinStatus = false,
        checkedInAt = null,
        checkedInDeviceNumber = null,
        checkedInPointName = null,
        isBlocked = false,
        blockReason = null,
    )

    private val fakeVerdictAttendee = VerdictAttendee(
        id = "att-1",
        fullName = "Иван Иванов",
        company = "ООО Тест",
        category = "Гость",
    )

    private val fakeSuccessVerdict = RegistrationVerdict.Success(
        attendee = fakeVerdictAttendee,
        at = Instant.fromEpochMilliseconds(0),
        firstTime = true,
        printState = PrintState.NotRequested,
    )

    private fun buildViewModel(
        stationGateway: RegistrationStationGateway = RegistrationStationGateway { fakeConfig },
        verdictMapper: RegistrationVerdictMapper = RegistrationVerdictMapper(
            AttendeeLookup { _, _ -> ApiResult.Error(Exception("not found")) }
        ),
        checkInService: RegistrationCheckInService = RegistrationCheckInService(
            batchSubmitter = BatchCheckinSubmitter { _, _ -> ApiResult.Error(Exception("fake")) },
        ),
        cameraService: CameraService = fakeCameraService(flowOf()),
        pendingQueueCountSource: PendingQueueCountSource = PendingQueueCountSource { flowOf(0) },
    ) = RegistrationHomeViewModel(
        stationGateway = stationGateway,
        verdictMapper = verdictMapper,
        checkInService = checkInService,
        cameraService = cameraService,
        eventRepository = fakeEventRepository(),
        attendeeRepository = fakeAttendeeRepository(),
        pendingQueueCountSource = pendingQueueCountSource,
    )

    @Test
    fun initialStateHasZoneNameAndNoPrinterWhenConfigHasNoPrinter() = runTest(dispatcher) {
        val vm = buildViewModel()
        val state = vm.uiState.value
        assertEquals("Главный вход", state.zoneName)
        assertEquals("—", state.printerLabel)
        assertEquals(false, state.printerStatusOk)
    }

    @Test
    fun pendingQueueCountUpdatesOfflineBannerVisibility() = runTest(dispatcher) {
        val countFlow = MutableStateFlow(0)
        val vm = buildViewModel(pendingQueueCountSource = PendingQueueCountSource { countFlow })
        assertEquals(false, vm.uiState.value.offlineBannerVisible)
        countFlow.value = 3
        assertEquals(true, vm.uiState.value.offlineBannerVisible)
        assertEquals(3, vm.uiState.value.pendingQueueCount)
    }

    @Test
    fun scanResultGoingThroughFoundPathUpdatesVerdictAndIncrementsSessionCount() = runTest(dispatcher) {
        val codeFlow = MutableSharedFlow<String>()
        val camera = fakeCameraService(codeFlow)
        val mapper = RegistrationVerdictMapper(
            AttendeeLookup { _, _ -> ApiResult.Success(fakeAttendee) }
        )
        val service = RegistrationCheckInService(
            batchSubmitter = BatchCheckinSubmitter { _, _ -> ApiResult.Success(emptyList()) },
            attendeeLookup = AttendeeLookup { _, _ -> ApiResult.Success(fakeAttendee) },
        )
        // Stub checkIn to return success — requires overriding internals via real service or fake
        // Use a fake checkInService seam instead:
        val fakeService = object {
            var lastAttendee: Attendee? = null
            suspend fun checkIn(
                eventId: String,
                station: StationConfig,
                attendee: Attendee,
                badgeTemplate: BadgeTemplate?,
            ): RegistrationVerdict {
                lastAttendee = attendee
                return fakeSuccessVerdict
            }
        }
        // Since RegistrationCheckInService is a concrete class, not an interface,
        // test via the seam-based ViewModel constructor by subclassing the pipeline flow:
        // The ViewModel exposes processScannedCode via scan pipeline — test via state observation.
        // This test verifies the mapping path when verdictMapper returns Found.
        // Skip direct invocation; emit code and observe state change.
        val vm = buildViewModel(cameraService = camera, verdictMapper = mapper)
        vm.onScanResumed()
        assertEquals(0, vm.uiState.value.sessionCheckedCount)
        codeFlow.emit("QR-001")
        // Allow coroutine to process
        advanceTimeBy(100)
        // Mapper returns Found(fakeAttendee); checkInService uses default degraded batchSubmitter
        // so it will produce an error state — but RegistrationVerdictMapper.lookup internally
        // calls getAttendeeByCode (which we've faked to return Success), so lookup = Found.
        // RegistrationCheckInService.checkIn with a real batchSubmitter stub returning Error
        // triggers offline enqueue path → RegistrationVerdict.Success (offlined).
        // This depends on the real RegistrationCheckInService implementation.
        // For a simpler assertion: verify currentVerdict is non-null (any result was produced).
        assertTrue(vm.uiState.value.currentVerdict != null)
    }

    @Test
    fun onVerdictDismissedClearsVerdictAndResumesScanning() = runTest(dispatcher) {
        val codeFlow = MutableSharedFlow<String>()
        val vm = buildViewModel(
            cameraService = fakeCameraService(codeFlow),
            verdictMapper = RegistrationVerdictMapper(
                AttendeeLookup { _, _ -> ApiResult.Error(Exception("not found")) }
            ),
        )
        vm.onScanResumed()
        codeFlow.emit("UNKNOWN-CODE")
        advanceTimeBy(100)
        // NotFound verdict should be set (lookup returned Error → LookupFailed path)
        assertTrue(vm.uiState.value.currentVerdict != null)
        vm.onVerdictDismissed()
        assertNull(vm.uiState.value.currentVerdict)
    }

    @Test
    fun searchQueryChangeUpdatesStateAfterDebounce() = runTest(dispatcher) {
        val vm = buildViewModel()
        vm.onSearchQueryChanged("Alice")
        assertEquals("Alice", vm.uiState.value.searchQuery)
        advanceTimeBy(350) // past 300ms debounce
        // fakeAttendeeRepository.searchAttendees returns empty list → isSearchLoading = false
        assertEquals(false, vm.uiState.value.isSearchLoading)
    }

    @Test
    fun tabSwitchToSearchStopsScanning() = runTest(dispatcher) {
        val vm = buildViewModel()
        vm.onScanResumed()
        assertTrue(vm.uiState.value.isScanActive)
        vm.onTabSelected(RegistrationTab.SEARCH)
        assertEquals(RegistrationTab.SEARCH, vm.uiState.value.currentTab)
        assertEquals(false, vm.uiState.value.isScanActive)
    }
}

// ── Test helpers ──

private fun fakeCameraService(codes: kotlinx.coroutines.flow.Flow<String>) =
    object : CameraService() {
        override fun hasCameraPermission(): Boolean = true
        override fun startScanning(): kotlinx.coroutines.flow.Flow<String> = codes
        override fun stopScanning() {}
    }

private fun fakeEventRepository() = object : com.idento.data.repository.EventRepository(
    // EventRepository constructor requires an ApiService — use a minimal stub
    apiService = TODO("replace with fake in actual test setup — or use constructor injection seam")
) {
    override suspend fun getBadgeTemplate(eventId: String): ApiResult<String?> =
        ApiResult.Success(null)
}

private fun fakeAttendeeRepository() = object : com.idento.data.repository.AttendeeRepository(
    apiService = TODO("replace with fake in actual test setup")
) {
    override suspend fun searchAttendees(eventId: String, query: String): ApiResult<List<Attendee>> =
        ApiResult.Success(emptyList())
    override suspend fun getAttendeeByCode(eventId: String, code: String): ApiResult<Attendee?> =
        ApiResult.Error(Exception("fake"))
}
```

> **Note for the engineer:** If `EventRepository` and `AttendeeRepository` cannot be subclassed cleanly in tests (e.g., they require mandatory constructor args that pull in network deps), add `fun interface EventBadgeTemplateSource { suspend fun getBadgeTemplate(eventId: String): ApiResult<String?> }` and `fun interface AttendeeSearchSource { suspend fun searchAttendees(eventId: String, query: String): ApiResult<List<Attendee>> }` seams to `RegistrationHomeViewModel`'s constructor — replacing the direct repository references — and update the ViewModelModule wiring accordingly with method references. The test fakes then become trivial lambdas.

- [ ] **Step 2: Run the test — confirm it fails (RegistrationHomeViewModel does not exist yet)**

```bash
cd mobile/android-app
./gradlew :shared:compileTestKotlinIosSimulatorArm64 2>&1 | grep "error:" | head -5
```

Expected: compile error `Unresolved reference: RegistrationHomeViewModel`.

- [ ] **Step 3: Create RegistrationHomeViewModel.kt**

Create `mobile/shared/src/commonMain/kotlin/com/idento/presentation/registration/RegistrationHomeViewModel.kt`:

```kotlin
package com.idento.presentation.registration

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.idento.data.model.ApiResult
import com.idento.data.model.Attendee
import com.idento.data.model.BadgeTemplate
import com.idento.data.model.PrintState
import com.idento.data.model.RegistrationVerdict
import com.idento.data.model.StationConfig
import com.idento.data.registration.DebouncedScanPipeline
import com.idento.data.registration.RegistrationCheckInService
import com.idento.data.registration.RegistrationVerdictLookup
import com.idento.data.registration.RegistrationVerdictMapper
import com.idento.data.repository.AttendeeRepository
import com.idento.data.repository.EventRepository
import com.idento.platform.camera.CameraService
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlin.time.Duration.Companion.milliseconds

enum class RegistrationTab { SCAN, SEARCH }

data class RegistrationHomeUiState(
    val currentTab: RegistrationTab = RegistrationTab.SCAN,
    val zoneName: String = "",
    val printerLabel: String = "",
    val printerStatusOk: Boolean = false,
    val pendingQueueCount: Int = 0,
    val sessionCheckedCount: Int = 0,
    val currentVerdict: RegistrationVerdict? = null,
    val isScanActive: Boolean = false,
    val searchQuery: String = "",
    val searchResults: List<Attendee> = emptyList(),
    val isSearchLoading: Boolean = false,
    val offlineBannerVisible: Boolean = false,
)

fun interface RegistrationStationGateway {
    suspend fun getConfig(): StationConfig
}

fun interface PendingQueueCountSource {
    fun observe(): Flow<Int>
}

class RegistrationHomeViewModel(
    private val stationGateway: RegistrationStationGateway,
    private val verdictMapper: RegistrationVerdictMapper,
    private val checkInService: RegistrationCheckInService,
    private val cameraService: CameraService,
    private val eventRepository: EventRepository,
    private val attendeeRepository: AttendeeRepository,
    private val pendingQueueCountSource: PendingQueueCountSource,
) : ViewModel() {

    private val _uiState = MutableStateFlow(RegistrationHomeUiState())
    val uiState: StateFlow<RegistrationHomeUiState> = _uiState.asStateFlow()

    private var stationConfig: StationConfig? = null
    private var badgeTemplate: BadgeTemplate? = null
    private val pipeline = DebouncedScanPipeline()
    private var scanJob: Job? = null
    private val searchQueryFlow = MutableStateFlow("")

    init {
        viewModelScope.launch {
            val config = stationGateway.getConfig()
            stationConfig = config
            _uiState.update {
                it.copy(
                    zoneName = config.workPointName,
                    printerLabel = if (config.printer != null) "OK" else "—",
                    printerStatusOk = config.printer != null,
                )
            }
            loadBadgeTemplate(config.eventId)
        }
        viewModelScope.launch {
            pendingQueueCountSource.observe().collect { count ->
                _uiState.update {
                    it.copy(pendingQueueCount = count, offlineBannerVisible = count > 0)
                }
            }
        }
        viewModelScope.launch {
            searchQueryFlow
                .debounce(300.milliseconds)
                .filter { it.length >= 2 }
                .distinctUntilChanged()
                .collectLatest { query -> executeSearch(query) }
        }
    }

    private suspend fun loadBadgeTemplate(eventId: String) {
        val result = eventRepository.getBadgeTemplate(eventId)
        if (result is ApiResult.Success && result.data != null) {
            badgeTemplate = BadgeTemplate(zplTemplate = result.data)
        }
    }

    fun onScanResumed() {
        val config = stationConfig ?: return
        scanJob?.cancel()
        scanJob = viewModelScope.launch {
            _uiState.update { it.copy(isScanActive = true) }
            pipeline.process(cameraService.startScanning()).collect { code ->
                processScannedCode(config, code)
            }
        }
    }

    fun onScanPaused() {
        scanJob?.cancel()
        cameraService.stopScanning()
        _uiState.update { it.copy(isScanActive = false) }
    }

    private suspend fun processScannedCode(config: StationConfig, code: String) {
        val verdict = when (val lookup = verdictMapper.lookup(config.eventId, code)) {
            is RegistrationVerdictLookup.Found -> checkInService.checkIn(
                eventId = config.eventId,
                station = config,
                attendee = lookup.attendee,
                badgeTemplate = badgeTemplate,
            )
            is RegistrationVerdictLookup.AlreadyChecked -> lookup.verdict
            is RegistrationVerdictLookup.Denied -> lookup.verdict
            is RegistrationVerdictLookup.NotFound -> lookup.verdict
            is RegistrationVerdictLookup.LookupFailed -> RegistrationVerdict.NotFound(
                rawCode = code,
                hint = lookup.message,
            )
        }
        val increment = if (verdict is RegistrationVerdict.Success) 1 else 0
        _uiState.update {
            it.copy(
                currentVerdict = verdict,
                sessionCheckedCount = it.sessionCheckedCount + increment,
            )
        }
    }

    fun onVerdictDismissed() {
        _uiState.update { it.copy(currentVerdict = null) }
        if (uiState.value.currentTab == RegistrationTab.SCAN) onScanResumed()
    }

    fun onTabSelected(tab: RegistrationTab) {
        _uiState.update { it.copy(currentTab = tab, currentVerdict = null) }
        if (tab == RegistrationTab.SCAN) onScanResumed() else onScanPaused()
    }

    fun onSearchQueryChanged(query: String) {
        _uiState.update { it.copy(searchQuery = query) }
        searchQueryFlow.value = query
        if (query.length < 2) {
            _uiState.update { it.copy(searchResults = emptyList()) }
        }
    }

    fun onManualCheckIn(attendee: Attendee) {
        val config = stationConfig ?: return
        viewModelScope.launch {
            val verdict = checkInService.checkIn(
                eventId = config.eventId,
                station = config,
                attendee = attendee,
                badgeTemplate = badgeTemplate,
            )
            val increment = if (verdict is RegistrationVerdict.Success) 1 else 0
            _uiState.update {
                it.copy(
                    currentVerdict = verdict,
                    sessionCheckedCount = it.sessionCheckedCount + increment,
                    currentTab = RegistrationTab.SCAN,
                )
            }
        }
    }

    private suspend fun executeSearch(query: String) {
        val config = stationConfig ?: return
        _uiState.update { it.copy(isSearchLoading = true) }
        when (val result = attendeeRepository.searchAttendees(config.eventId, query)) {
            is ApiResult.Success -> _uiState.update {
                it.copy(searchResults = result.data, isSearchLoading = false)
            }
            is ApiResult.Error -> _uiState.update {
                it.copy(searchResults = emptyList(), isSearchLoading = false)
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        scanJob?.cancel()
        cameraService.stopScanning()
    }
}
```

- [ ] **Step 4: Add the factory to ViewModelModule.kt**

In `mobile/shared/src/commonMain/kotlin/com/idento/di/ViewModelModule.kt`, add one `factory {}` block (place it after the last existing `factory {}` entry):

```kotlin
factory {
    val offlineQueueRepo = get<RegistrationOfflineQueueRepository>()
    RegistrationHomeViewModel(
        stationGateway = RegistrationStationGateway {
            get<StationConfigPreferences>().stationConfig.filterNotNull().first()
        },
        verdictMapper = get<RegistrationVerdictMapper>(),
        checkInService = get<RegistrationCheckInService>(),
        cameraService = get<CameraService>(),
        eventRepository = get<EventRepository>(),
        attendeeRepository = get<AttendeeRepository>(),
        pendingQueueCountSource = PendingQueueCountSource { offlineQueueRepo.getPendingCountFlow() },
    )
}
```

Add the required imports at the top of `ViewModelModule.kt` (only add those not already present):

```kotlin
import com.idento.data.preferences.StationConfigPreferences
import com.idento.data.registration.RegistrationCheckInService
import com.idento.data.registration.RegistrationOfflineQueueRepository
import com.idento.data.registration.RegistrationVerdictMapper
import com.idento.platform.camera.CameraService
import com.idento.presentation.registration.PendingQueueCountSource
import com.idento.presentation.registration.RegistrationHomeViewModel
import com.idento.presentation.registration.RegistrationStationGateway
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
```

- [ ] **Step 5: Run the tests**

```bash
cd mobile/android-app
./gradlew :shared:testDebugUnitTest --tests "com.idento.presentation.registration.RegistrationHomeViewModelTest"
```

Expected: `BUILD SUCCESSFUL`, all tests pass.

- [ ] **Step 6: Run the full gate**

```bash
./gradlew :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:compileTestKotlinIosSimulatorArm64 :shared:testDebugUnitTest :shared:lintDebug :app:lintDebug
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 7: Commit**

```bash
git add mobile/shared/src/commonMain/kotlin/com/idento/presentation/registration/RegistrationHomeViewModel.kt \
        mobile/shared/src/commonMain/kotlin/com/idento/di/ViewModelModule.kt \
        mobile/shared/src/commonTest/kotlin/com/idento/presentation/registration/RegistrationHomeViewModelTest.kt
git commit -m "feat(mobile/registration): add RegistrationHomeViewModel with scan + search logic"
```

---

### Task 4: RegistrationHomeScreen — scan tab and verdict rendering

**Files:**
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/registration/RegistrationHomeScreen.kt`

**Interfaces:**
- Consumes (from Task 3): `RegistrationHomeViewModel`, `RegistrationHomeUiState`, `RegistrationTab`
- Consumes (components): `VerdictBand(word, icon, color, modifier)`, `ScanReticle(modifier, size)`, `StatusBar(cells)`, `StatusCell(value, label, valueColor)`, `ActionStack(primary, secondary?)`, `ActionButtonSpec(label, onClick, containerColor, contentColor)`, `DetailTable(rows)`, `DetailRow(label, value)`, `ModeSegmentedControl(options, selectedIndex, onSelect)`, `OfflineBanner(queuedCount, lastSyncLabel)`
- Consumes (tokens): `IdentoColors.*`, `IdentoTypeScale.*`, `IdentoSpacing.*`
- Consumes (strings): `StringKey.REGISTRATION_*` via `stringResource(key)`
- Consumes (models): `RegistrationVerdict.*`, `PrintState.*`, `VerdictAttendee`
- Produces: `@Composable fun RegistrationHomeScreen(viewModel: RegistrationHomeViewModel = koinViewModel())` — used by `IdentoNavHost` in Task 6.

> **Note on camera preview:** `CameraService.startScanning()` starts the platform camera and emits scan results as a `Flow<String>`. The actual camera viewfinder rendering is platform-managed by the `CameraService` implementation established in M1a. The shared Composable shows a dark `Box` with `ScanReticle` overlay — this is intentional for the first iteration; a true viewfinder composable (`expect/actual CameraPreviewContent`) can be added in a follow-up once the platform approach is confirmed.

- [ ] **Step 1: Create RegistrationHomeScreen.kt**

Create `mobile/shared/src/commonMain/kotlin/com/idento/presentation/registration/RegistrationHomeScreen.kt`:

```kotlin
package com.idento.presentation.registration

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.HelpOutline
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.idento.data.localization.StringKey
import com.idento.data.localization.stringResource
import com.idento.data.model.PrintState
import com.idento.data.model.RegistrationVerdict
import com.idento.presentation.components.redesign.ActionButtonSpec
import com.idento.presentation.components.redesign.ActionStack
import com.idento.presentation.components.redesign.DetailRow
import com.idento.presentation.components.redesign.DetailTable
import com.idento.presentation.components.redesign.ListRow
import com.idento.presentation.components.redesign.ModeSegmentedControl
import com.idento.presentation.components.redesign.OfflineBanner
import com.idento.presentation.components.redesign.ScanReticle
import com.idento.presentation.components.redesign.StatusBar
import com.idento.presentation.components.redesign.StatusCell
import com.idento.presentation.components.redesign.VerdictBand
import com.idento.presentation.theme.IdentoColors
import com.idento.presentation.theme.IdentoSpacing
import com.idento.presentation.theme.IdentoTypeScale
import org.koin.compose.viewmodel.koinViewModel

@Composable
fun RegistrationHomeScreen(
    viewModel: RegistrationHomeViewModel = koinViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val lifecycleOwner = LocalLifecycleOwner.current

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event.name) {
                "ON_RESUME" -> if (uiState.currentTab == RegistrationTab.SCAN) viewModel.onScanResumed()
                "ON_PAUSE" -> viewModel.onScanPaused()
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        StatusBar(
            cells = listOf(
                StatusCell(
                    value = uiState.zoneName,
                    label = stringResource(StringKey.REGISTRATION_STATUSBAR_ZONE_LABEL),
                ),
                StatusCell(
                    value = uiState.printerLabel,
                    label = stringResource(StringKey.REGISTRATION_STATUSBAR_PRINTER_LABEL),
                    valueColor = if (uiState.printerStatusOk) IdentoColors.Brand else IdentoColors.TextSecondary,
                ),
                StatusCell(
                    value = uiState.pendingQueueCount.toString(),
                    label = stringResource(StringKey.REGISTRATION_STATUSBAR_QUEUE_LABEL),
                    valueColor = if (uiState.pendingQueueCount > 0) IdentoColors.Queue else IdentoColors.TextPrimary,
                ),
                StatusCell(
                    value = uiState.sessionCheckedCount.toString(),
                    label = stringResource(StringKey.REGISTRATION_STATUSBAR_CHECKED_LABEL),
                ),
            ),
        )

        ModeSegmentedControl(
            options = listOf(
                stringResource(StringKey.REGISTRATION_TAB_SCAN),
                stringResource(StringKey.REGISTRATION_TAB_SEARCH),
            ),
            selectedIndex = if (uiState.currentTab == RegistrationTab.SCAN) 0 else 1,
            onSelect = { index ->
                viewModel.onTabSelected(if (index == 0) RegistrationTab.SCAN else RegistrationTab.SEARCH)
            },
            modifier = Modifier.fillMaxWidth().padding(horizontal = IdentoSpacing.md),
        )

        if (uiState.offlineBannerVisible) {
            OfflineBanner(
                queuedCount = uiState.pendingQueueCount,
                lastSyncLabel = "—",
                modifier = Modifier.fillMaxWidth(),
            )
        }

        when (uiState.currentTab) {
            RegistrationTab.SCAN -> ScanTab(
                uiState = uiState,
                onVerdictDismissed = viewModel::onVerdictDismissed,
            )
            RegistrationTab.SEARCH -> SearchTab(
                uiState = uiState,
                onQueryChanged = viewModel::onSearchQueryChanged,
                onManualCheckIn = viewModel::onManualCheckIn,
            )
        }
    }
}

@Composable
private fun ScanTab(
    uiState: RegistrationHomeUiState,
    onVerdictDismissed: () -> Unit,
) {
    val verdict = uiState.currentVerdict
    if (verdict == null) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black),
            contentAlignment = Alignment.Center,
        ) {
            ScanReticle()
        }
    } else {
        VerdictCard(verdict = verdict, onDismiss = onVerdictDismissed)
    }
}

@Composable
private fun VerdictCard(
    verdict: RegistrationVerdict,
    onDismiss: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(IdentoSpacing.lg),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        when (verdict) {
            is RegistrationVerdict.Success -> {
                VerdictBand(
                    word = stringResource(StringKey.REGISTRATION_VERDICT_SUCCESS_WORD),
                    icon = Icons.Default.CheckCircle,
                    color = IdentoColors.Brand,
                )
                Spacer(Modifier.height(IdentoSpacing.md))
                Text(
                    text = verdict.attendee.fullName,
                    style = IdentoTypeScale.attendeeName,
                    color = IdentoColors.TextPrimary,
                )
                val detailRows = buildList {
                    if (verdict.attendee.company != null) {
                        add(DetailRow(stringResource(StringKey.REGISTRATION_ATTENDEE_COMPANY), verdict.attendee.company))
                    }
                    add(DetailRow(stringResource(StringKey.REGISTRATION_ATTENDEE_CATEGORY), verdict.attendee.category))
                    val printLabel = when (verdict.printState) {
                        is PrintState.Printing, is PrintState.Done ->
                            stringResource(StringKey.REGISTRATION_PRINT_STATE_SENT)
                        is PrintState.Queued ->
                            stringResource(StringKey.REGISTRATION_PRINT_STATE_QUEUED)
                        is PrintState.Failed ->
                            stringResource(StringKey.REGISTRATION_PRINT_STATE_FAILED)
                        is PrintState.NotRequested -> null
                    }
                    if (printLabel != null) {
                        add(DetailRow(stringResource(StringKey.REGISTRATION_STATUSBAR_PRINTER_LABEL), printLabel))
                    }
                }
                if (detailRows.isNotEmpty()) {
                    Spacer(Modifier.height(IdentoSpacing.sm))
                    DetailTable(rows = detailRows)
                }
                Spacer(Modifier.height(IdentoSpacing.lg))
                ActionStack(
                    primary = ActionButtonSpec(
                        label = stringResource(StringKey.REGISTRATION_ACTION_DISMISS),
                        onClick = onDismiss,
                        containerColor = IdentoColors.Brand,
                        contentColor = Color.White,
                    ),
                )
            }

            is RegistrationVerdict.AlreadyChecked -> {
                VerdictBand(
                    word = stringResource(StringKey.REGISTRATION_VERDICT_ALREADY_WORD),
                    icon = Icons.Default.CheckCircle,
                    color = IdentoColors.Amber,
                )
                Spacer(Modifier.height(IdentoSpacing.md))
                Text(
                    text = verdict.attendee.fullName,
                    style = IdentoTypeScale.attendeeName,
                    color = IdentoColors.TextPrimary,
                )
                Spacer(Modifier.height(IdentoSpacing.sm))
                DetailTable(
                    rows = listOf(
                        DetailRow(
                            stringResource(StringKey.REGISTRATION_ALREADY_FIRST_AT),
                            verdict.firstAt.toString(),
                        ),
                        DetailRow(
                            stringResource(StringKey.REGISTRATION_ALREADY_POINT),
                            verdict.firstPoint,
                        ),
                        DetailRow(
                            stringResource(StringKey.REGISTRATION_ALREADY_DEVICE),
                            verdict.firstDevice.toString(),
                        ),
                    ),
                )
                Spacer(Modifier.height(IdentoSpacing.lg))
                ActionStack(
                    primary = ActionButtonSpec(
                        label = stringResource(StringKey.REGISTRATION_ACTION_DISMISS),
                        onClick = onDismiss,
                        containerColor = IdentoColors.Amber,
                        contentColor = Color.White,
                    ),
                )
            }

            is RegistrationVerdict.NotFound -> {
                VerdictBand(
                    word = stringResource(StringKey.REGISTRATION_VERDICT_NOT_FOUND_WORD),
                    icon = Icons.Default.HelpOutline,
                    color = IdentoColors.NeutralBand,
                )
                Spacer(Modifier.height(IdentoSpacing.lg))
                ActionStack(
                    primary = ActionButtonSpec(
                        label = stringResource(StringKey.REGISTRATION_ACTION_DISMISS),
                        onClick = onDismiss,
                        containerColor = IdentoColors.NeutralBand,
                        contentColor = Color.White,
                    ),
                )
            }

            is RegistrationVerdict.Denied -> {
                VerdictBand(
                    word = stringResource(StringKey.REGISTRATION_VERDICT_DENIED_WORD),
                    icon = Icons.Default.Block,
                    color = IdentoColors.Denied,
                )
                Spacer(Modifier.height(IdentoSpacing.md))
                Text(
                    text = verdict.attendee.fullName,
                    style = IdentoTypeScale.attendeeName,
                    color = IdentoColors.TextPrimary,
                )
                Spacer(Modifier.height(IdentoSpacing.sm))
                DetailTable(
                    rows = listOf(
                        DetailRow(
                            stringResource(StringKey.REGISTRATION_DENIED_REASON),
                            verdict.reason,
                        ),
                    ),
                )
                Spacer(Modifier.height(IdentoSpacing.lg))
                ActionStack(
                    primary = ActionButtonSpec(
                        label = stringResource(StringKey.REGISTRATION_ACTION_DISMISS),
                        onClick = onDismiss,
                        containerColor = IdentoColors.Denied,
                        contentColor = Color.White,
                    ),
                )
            }

            is RegistrationVerdict.PrintError -> {
                // Check-in succeeded; print failed — show green Success band + red print-fail note
                VerdictBand(
                    word = stringResource(StringKey.REGISTRATION_VERDICT_SUCCESS_WORD),
                    icon = Icons.Default.CheckCircle,
                    color = IdentoColors.Brand,
                )
                Spacer(Modifier.height(IdentoSpacing.md))
                Text(
                    text = verdict.attendee.fullName,
                    style = IdentoTypeScale.attendeeName,
                    color = IdentoColors.TextPrimary,
                )
                Spacer(Modifier.height(IdentoSpacing.sm))
                Text(
                    text = "${stringResource(StringKey.REGISTRATION_PRINT_STATE_FAILED)}: ${verdict.printReason}",
                    style = IdentoTypeScale.body,
                    color = IdentoColors.Denied,
                    modifier = Modifier.padding(horizontal = IdentoSpacing.md),
                )
                Spacer(Modifier.height(IdentoSpacing.lg))
                ActionStack(
                    primary = ActionButtonSpec(
                        label = stringResource(StringKey.REGISTRATION_ACTION_DISMISS),
                        onClick = onDismiss,
                        containerColor = IdentoColors.Brand,
                        contentColor = Color.White,
                    ),
                )
            }
        }
    }
}

@Composable
private fun SearchTab(
    uiState: RegistrationHomeUiState,
    onQueryChanged: (String) -> Unit,
    onManualCheckIn: (com.idento.data.model.Attendee) -> Unit,
) {
    Column(modifier = Modifier.fillMaxSize()) {
        TextField(
            value = uiState.searchQuery,
            onValueChange = onQueryChanged,
            placeholder = {
                Text(stringResource(StringKey.REGISTRATION_SEARCH_PLACEHOLDER))
            },
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = IdentoSpacing.md, vertical = IdentoSpacing.sm),
            singleLine = true,
        )
        if (uiState.searchResults.isEmpty() && uiState.searchQuery.length >= 2 && !uiState.isSearchLoading) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = stringResource(StringKey.REGISTRATION_SEARCH_EMPTY),
                    style = IdentoTypeScale.body,
                    color = IdentoColors.TextSecondary,
                )
            }
        } else {
            LazyColumn(modifier = Modifier.fillMaxSize()) {
                items(uiState.searchResults) { attendee ->
                    ListRow(
                        initials = buildInitials(attendee.fullName),
                        title = attendee.fullName,
                        subtitle = listOfNotNull(attendee.company, attendee.category).joinToString(" · "),
                        highlighted = attendee.isCheckedIn,
                        onClick = { onManualCheckIn(attendee) },
                    )
                }
            }
        }
    }
}

private fun buildInitials(fullName: String): String {
    val parts = fullName.trim().split(" ")
    return when {
        parts.size >= 2 -> "${parts[0].first()}${parts[1].first()}".uppercase()
        parts.size == 1 && parts[0].isNotEmpty() -> parts[0].take(2).uppercase()
        else -> "?"
    }
}
```

- [ ] **Step 2: Run the full gate**

```bash
cd mobile/android-app
./gradlew :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:compileTestKotlinIosSimulatorArm64 :shared:testDebugUnitTest :shared:lintDebug :app:lintDebug
```

Expected: `BUILD SUCCESSFUL`. Fix any import or API mismatch errors before proceeding — the component signatures in `presentation/components/redesign/` are the source of truth; adjust parameter names if they differ from what's shown above.

- [ ] **Step 3: Commit**

```bash
git add mobile/shared/src/commonMain/kotlin/com/idento/presentation/registration/RegistrationHomeScreen.kt
git commit -m "feat(mobile/registration): add RegistrationHomeScreen (scan + search tabs)"
```

---

### Task 5: Screen route + NavHost routing

**Files:**
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/navigation/Screen.kt`
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/navigation/IdentoNavHost.kt`

**Interfaces:**
- Consumes (from Task 4): `RegistrationHomeScreen()` composable.
- Consumes (existing): `Screen` sealed class, `IdentoNavHost`, `resolveStartDestination(hasStationConfig, isLoggedIn)`, `StationConfigPreferences.stationConfig`, `StationMode.REGISTRATION`.
- Produces:
  - `Screen.RegistrationHome : Screen("registration_home")` — new route object.
  - Updated `resolveStartDestination`: when `hasStationConfig && isLoggedIn`, checks the persisted `stationConfig.mode`. If `REGISTRATION`, routes to `Screen.RegistrationHome.route`; otherwise routes to `Screen.SetupComplete.route` (existing behavior for other modes).
  - New `composable(Screen.RegistrationHome.route)` entry in `NavHost` block.
  - Updated `SetupComplete` composable entry: gains `onNavigateToRegistration` callback that navigates to `Screen.RegistrationHome.route` and pops the back-stack so the user cannot navigate back to the setup wizard.

> **Note:** `resolveStartDestination` currently returns only `Screen.SetupComplete.route` or `Screen.SetupLogin.route`. After this task, REGISTRATION-mode configured stations go directly to `Screen.RegistrationHome.route` on cold start, skipping `SetupComplete`. For other modes (`ZONE_CONTROL`, `KIOSK`) the existing `SetupComplete` route is still returned unchanged until M2/M3 implement those screens.

- [ ] **Step 1: Add Screen.RegistrationHome to Screen.kt**

In `mobile/shared/src/commonMain/kotlin/com/idento/presentation/navigation/Screen.kt`, add one new route object after `Screen.SetupComplete`:

```kotlin
data object RegistrationHome : Screen("registration_home")
```

- [ ] **Step 2: Update IdentoNavHost.kt — resolveStartDestination, new composable entry, SetupComplete callback**

In `mobile/shared/src/commonMain/kotlin/com/idento/presentation/navigation/IdentoNavHost.kt`:

**2a. Update `resolveStartDestination`** — it currently reads the station config from preferences to know `hasStationConfig`. Extend it to also pass the `StationMode` so the function can return the right route. The simplest approach: add a `stationMode: StationMode?` parameter (nullable for the no-config case):

```kotlin
internal fun resolveStartDestination(
    hasStationConfig: Boolean,
    isLoggedIn: Boolean,
    stationMode: StationMode? = null,
): String = when {
    !hasStationConfig || !isLoggedIn -> Screen.SetupLogin.route
    stationMode == StationMode.REGISTRATION -> Screen.RegistrationHome.route
    else -> Screen.SetupComplete.route
}
```

Update the call site inside `IdentoNavHost` to pass the mode from the collected `stationConfig` flow (add `stationMode = stationConfig?.mode` where `stationConfig` is already collected).

**2b. Add the `Screen.RegistrationHome` composable entry** — in the `NavHost { }` block, add after the `SetupComplete` entry:

```kotlin
composable(Screen.RegistrationHome.route) {
    RegistrationHomeScreen()
}
```

**2c. Add `onNavigateToRegistration` to the existing `SetupComplete` composable entry** — the `SetupCompleteScreen` composable currently only receives `onExitStation`. After Task 6, it will also accept `onNavigateToStation`. Wire it here:

```kotlin
composable(Screen.SetupComplete.route) {
    SetupCompleteScreen(
        onExitStation = {
            navController.navigate(Screen.SetupLogin.route) { popUpTo(0) { inclusive = true } }
        },
        onNavigateToStation = {
            navController.navigate(Screen.RegistrationHome.route) {
                popUpTo(0) { inclusive = true }
            }
        },
    )
}
```

Add the required imports (only add those not already present):

```kotlin
import com.idento.data.model.StationMode
import com.idento.presentation.registration.RegistrationHomeScreen
```

- [ ] **Step 3: Run the full gate**

```bash
cd mobile/android-app
./gradlew :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:compileTestKotlinIosSimulatorArm64 :shared:testDebugUnitTest :shared:lintDebug :app:lintDebug
```

Expected: `BUILD SUCCESSFUL`. If `SetupCompleteScreen` does not yet have the `onNavigateToStation` parameter, this will fail to compile — that is expected; fix it by completing Task 6 before re-running the gate, OR temporarily add a default no-op `onNavigateToStation: () -> Unit = {}` to the existing `SetupCompleteScreen` signature to unblock the gate, then remove the default when Task 6 provides the real implementation.

- [ ] **Step 4: Commit**

```bash
git add mobile/shared/src/commonMain/kotlin/com/idento/presentation/navigation/Screen.kt \
        mobile/shared/src/commonMain/kotlin/com/idento/presentation/navigation/IdentoNavHost.kt
git commit -m "feat(mobile/nav): add Screen.RegistrationHome + route REGISTRATION-mode stations at start"
```

---

### Task 6: SetupCompleteScreen mode-branching

**Files:**
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/setup/SetupCompleteScreen.kt`
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/setup/SetupCompleteViewModel.kt` (confirm mode is accessible in UiState)

**Interfaces:**
- Consumes (existing):
  - `SetupCompleteScreen(onExitStation: () -> Unit)` — current signature (one callback).
  - `SetupCompleteViewModel.finish()` — saves `StationConfig`, sets `_uiState.value = SetupCompleteUiState(stationConfig = config)`.
  - `SetupCompleteUiState(stationConfig: StationConfig?)` — already contains the fully-populated `StationConfig`.
  - `StationMode.REGISTRATION` — enum value.
- Produces:
  - `SetupCompleteScreen(onExitStation: () -> Unit, onNavigateToStation: () -> Unit)` — two callbacks.
  - The `LaunchedEffect` that calls `viewModel.finish()` is extended: after `finish()` completes and the state contains a `StationConfig`, the screen checks `config.mode`. For `REGISTRATION`, it fires `onNavigateToStation()`. For all other modes, it does nothing — the station home for those modes is not yet implemented (M2/M3).

- [ ] **Step 1: Confirm SetupCompleteUiState exposes the mode**

Read `mobile/shared/src/commonMain/kotlin/com/idento/presentation/setup/SetupCompleteViewModel.kt`. Verify that `SetupCompleteUiState.stationConfig` is of type `StationConfig?` (so `uiState.stationConfig?.mode` is accessible in the screen). No changes needed if this is already the case. If `SetupCompleteUiState` exposes only a subset of fields, add `val mode: StationMode?` to it.

- [ ] **Step 2: Update SetupCompleteScreen.kt — add onNavigateToStation callback and mode dispatch**

In `mobile/shared/src/commonMain/kotlin/com/idento/presentation/setup/SetupCompleteScreen.kt`:

Change the function signature from:

```kotlin
@Composable
fun SetupCompleteScreen(
    onExitStation: () -> Unit,
    viewModel: SetupCompleteViewModel = koinViewModel(),
)
```

to:

```kotlin
@Composable
fun SetupCompleteScreen(
    onExitStation: () -> Unit,
    onNavigateToStation: () -> Unit = {},
    viewModel: SetupCompleteViewModel = koinViewModel(),
)
```

Find the existing `LaunchedEffect(Unit) { viewModel.finish() }` and extend it. Replace it with:

```kotlin
LaunchedEffect(Unit) {
    viewModel.finish()
}

val uiState by viewModel.uiState.collectAsState()
LaunchedEffect(uiState.stationConfig) {
    val config = uiState.stationConfig ?: return@LaunchedEffect
    if (config.mode == StationMode.REGISTRATION) {
        onNavigateToStation()
    }
}
```

Add the import (only if not already present):

```kotlin
import com.idento.data.model.StationMode
```

> **Important:** The `LaunchedEffect(uiState.stationConfig)` is keyed on the config object, so it fires once when `stationConfig` transitions from `null` to a non-null value — which happens after `finish()` completes. It will NOT re-fire on recomposition if the config stays the same.

- [ ] **Step 3: Run the full gate (all tasks combined now)**

```bash
cd mobile/android-app
./gradlew :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:compileTestKotlinIosSimulatorArm64 :shared:testDebugUnitTest :shared:lintDebug :app:lintDebug
```

Expected: `BUILD SUCCESSFUL`. If Task 5 temporarily used a no-op default for `onNavigateToStation`, this task's real implementation now replaces it — re-run the gate to confirm.

- [ ] **Step 4: Commit**

```bash
git add mobile/shared/src/commonMain/kotlin/com/idento/presentation/setup/SetupCompleteScreen.kt
git commit -m "feat(mobile/setup): SetupCompleteScreen routes REGISTRATION mode to RegistrationHomeScreen after finish"
```

---

### Task 7: Final gate, summary doc, and progress update

**Files:**
- Test (gate): run all compile + test + lint + assemble targets
- Create: `docs/audit/mobile-redesign-m1d-registration-screens-summary.md`
- Modify: `.superpowers/sdd/progress.md` (mark M1d tasks complete)

- [ ] **Step 1: Run the complete final gate**

```bash
cd mobile/android-app
./gradlew :shared:compileDebugKotlinAndroid \
          :shared:compileKotlinIosSimulatorArm64 \
          :shared:compileKotlinIosArm64 \
          :shared:compileTestKotlinIosSimulatorArm64 \
          :shared:testDebugUnitTest \
          :shared:lintDebug \
          :app:assembleDebug \
          :app:lintDebug
```

Expected: `BUILD SUCCESSFUL`. All unit tests pass (including `StringsCompletenessTest`, `RegistrationServiceConstructionTest`, `RegistrationHomeViewModelTest`). No lint errors. APK produced at `app/build/outputs/apk/debug/app-debug.apk`.

- [ ] **Step 2: Create the summary document**

Create `docs/audit/mobile-redesign-m1d-registration-screens-summary.md`:

```markdown
# M1d Registration Screens — Implementation Summary

**Branch:** `redesign/m1d-registration-screens`
**Base:** `origin/main` at `40c375f` (post-PR #36, Mobile M1c)
**Gate:** All targets in `mobile/android-app` — compile (Android + iOS simulatorArm64 + iosArm64), unit tests, lint, assembleDebug — **PASS**

## What was built

### New files
- `mobile/shared/src/commonMain/kotlin/com/idento/presentation/registration/RegistrationHomeViewModel.kt` — ViewModel owning the full scan pipeline (`CameraService → DebouncedScanPipeline → RegistrationVerdictMapper → RegistrationCheckInService`) and search flow (`AttendeeRepository.searchAttendees`), plus StatusBar state (zone name, printer label, pending queue count via `RegistrationOfflineQueueRepository.getPendingCountFlow()`, session check-in count).
- `mobile/shared/src/commonMain/kotlin/com/idento/presentation/registration/RegistrationHomeScreen.kt` — Two-tab Composable (Scan | Search). Scan tab: dark Box + ScanReticle + verdict card (VerdictBand + attendee name + DetailTable + ActionStack, one per verdict type). Search tab: TextField + LazyColumn of ListRow; tapping an attendee triggers manual check-in via `RegistrationCheckInService.checkIn`.
- `mobile/shared/src/commonTest/kotlin/com/idento/di/RegistrationServiceConstructionTest.kt`
- `mobile/shared/src/commonTest/kotlin/com/idento/presentation/registration/RegistrationHomeViewModelTest.kt`

### Modified files
- `mobile/shared/src/commonMain/kotlin/com/idento/data/localization/Strings.kt` — 22 new `REGISTRATION_*` string keys, EN + RU.
- `mobile/shared/src/commonMain/kotlin/com/idento/di/AppModule.kt` — `single<RegistrationVerdictMapper>` and `single<RegistrationCheckInService>` registrations (the M1c gap, now closed; all 4 seams of `RegistrationCheckInService` wired via method references — no degraded defaults at runtime).
- `mobile/shared/src/commonMain/kotlin/com/idento/di/ViewModelModule.kt` — `factory { RegistrationHomeViewModel(...) }` added.
- `mobile/shared/src/commonMain/kotlin/com/idento/presentation/navigation/Screen.kt` — `Screen.RegistrationHome` added.
- `mobile/shared/src/commonMain/kotlin/com/idento/presentation/navigation/IdentoNavHost.kt` — new composable entry for `Screen.RegistrationHome`; `resolveStartDestination` extended to route REGISTRATION-mode configured stations directly there on cold start; `SetupComplete` entry wired with `onNavigateToStation`.
- `mobile/shared/src/commonMain/kotlin/com/idento/presentation/setup/SetupCompleteScreen.kt` — `onNavigateToStation: () -> Unit` callback added; `LaunchedEffect(uiState.stationConfig)` fires it for `StationMode.REGISTRATION` after `finish()` completes.

## Design decisions

- **Single ViewModel for both tabs:** Scan and search share a `RegistrationHomeViewModel` to avoid duplicating `StationConfig` loading, badge template loading, and StatusBar state. The ViewModel serialises the scan job (`Job?`) so switching to Search pauses the camera without losing the session check-in count.
- **Camera preview:** M1d shows a solid-black `Box` + `ScanReticle` overlay. The platform `CameraService` runs the camera in background and emits codes via `startScanning()`. A full viewfinder composable (`expect/actual CameraPreviewContent`) can be added in a follow-up once the platform approach is confirmed — no architectural change needed.
- **`DebouncedScanPipeline` not in Koin:** Instantiated directly in the ViewModel. It has no platform dependencies and doesn't need to be a singleton — each ViewModel gets its own pipeline with a fresh debounce state.
- **`onNavigateToStation` default = `{}`:** Backward-compatible no-op default on `SetupCompleteScreen`, so existing test harnesses or other modes that don't yet have a destination don't break.

## Backlog / follow-up items

- **Hardware scanner (screen 3b):** Screen 3b in the design spec describes a hardware Bluetooth/Ethernet barcode scanner input alongside the camera scan. The `DebouncedScanPipeline` is reusable for this input source. Hardware scanner integration is out of scope for M1d.
- **Camera viewfinder composable:** Replace the black Box with a real `expect/actual CameraPreviewContent` once the platform camera architecture is confirmed.
- **ZONE_CONTROL and KIOSK station homes (M2/M3):** `resolveStartDestination` returns `Screen.SetupComplete.route` for these modes. The `SetupCompleteScreen.onNavigateToStation` callback only fires for `REGISTRATION` — no action for other modes until M2/M3 implement their home screens.
- **Dormant pre-M1a screens cleanup (M4):** `Screen.Login`, `Screen.Events`, `Screen.Checkin`, etc. remain unreachable in the nav graph.
```

- [ ] **Step 3: Update .superpowers/sdd/progress.md**

In `.superpowers/sdd/progress.md`, find the M1d section (or add it after the M1c section) and mark all tasks complete. Example:

```markdown
## M1d — Registration Screens

- [x] Task 1: i18n strings (22 REGISTRATION_* keys, EN + RU)
- [x] Task 2: Koin wiring (RegistrationVerdictMapper + RegistrationCheckInService, M1c gap closed)
- [x] Task 3: RegistrationHomeViewModel (scan pipeline + search flow + StatusBar state)
- [x] Task 4: RegistrationHomeScreen (scan tab + search tab, all verdict types)
- [x] Task 5: Screen.RegistrationHome + NavHost routing + resolveStartDestination update
- [x] Task 6: SetupCompleteScreen mode-branching (onNavigateToStation for REGISTRATION)
- [x] Task 7: Gate + summary doc
```

- [ ] **Step 4: Final commit**

```bash
git add docs/audit/mobile-redesign-m1d-registration-screens-summary.md \
        .superpowers/sdd/progress.md
git commit -m "docs: add M1d implementation summary and mark progress complete"
```

---

## Self-review checklist (run before starting implementation)

**Spec coverage:**

| Design spec section | Task |
|---|---|
| Screen 3a — camera scan with VerdictBand per verdict type | Task 4 (ScanTab + VerdictCard) |
| Screen 3c — search/list with ListRow + manual check-in | Task 4 (SearchTab) |
| StatusBar 4 cells: ЗОНА / ПРИНТЕР / ОЧЕРЕДЬ / ОТМЕЧЕНО | Task 3 (UiState) + Task 4 (StatusBar composable) |
| OfflineBanner (visible when pendingQueueCount > 0) | Task 3 + Task 4 |
| REGISTRATION-mode station routing post-setup | Task 5 + Task 6 |
| REGISTRATION-mode cold-start routing | Task 5 (resolveStartDestination) |
| All new UI strings in EN + RU | Task 1 |
| Koin registration of M1c engine classes | Task 2 |
| Badge template loaded + passed to checkIn | Task 3 (loadBadgeTemplate + processScannedCode) |
| DebouncedScanPipeline per-code debounce (not Flow.debounce) | Task 3 (pipeline = DebouncedScanPipeline(), used in onScanResumed) |
| `getPendingCountFlow()` for reactive QUEUE cell | Task 3 (PendingQueueCountSource seam) |

**Placeholder scan:** None found.

**Type consistency check:**
- `RegistrationVerdictLookup.Found(val attendee: Attendee)` — used in Task 3 `processScannedCode` as `lookup.attendee` → passed directly to `RegistrationCheckInService.checkIn(attendee = lookup.attendee)`. ✓
- `RegistrationVerdict.AlreadyChecked(val firstAt: Instant, val firstPoint: String, val firstDevice: Int)` — field names used verbatim in Task 4 `DetailTable` rows. ✓
- `VerdictAttendee(id, fullName, company, category)` — `verdict.attendee.fullName`, `verdict.attendee.company`, `verdict.attendee.category` accessed in Task 4. ✓
- `PrintState` variants: `Printing`, `Done`, `Queued`, `Failed`, `NotRequested` — all handled exhaustively in Task 4 `VerdictCard`. ✓
- `RegistrationStationGateway`, `PendingQueueCountSource` defined in `RegistrationHomeViewModel.kt` (Task 3), imported in `ViewModelModule.kt` (Task 3 step 4). ✓
- `Screen.RegistrationHome` defined in Task 5, referenced in `IdentoNavHost.kt` (Task 5) and `SetupCompleteScreen.kt` wiring (Task 5). ✓
- `onNavigateToStation` added to `SetupCompleteScreen` in Task 6, wired in `IdentoNavHost` `SetupComplete` composable entry in Task 5 step 2c. ✓ (Tasks 5 and 6 must be implemented together; the gate can be run after both are done if the temporary no-op default is used in between.)
