# Mobile Redesign M3 — Kiosk Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the third and final staff-facing station mode — Kiosk (`StationMode.KIOSK`) — a fully self-service, unattended check-in flow for a vertical tablet, with device lockdown (screen pinning, keep-screen-on, hidden system UI) and a 3-second long-press exit gesture.

**Architecture:** `KioskViewModel` reuses `RegistrationVerdictMapper`/`RegistrationCheckInService` directly (both already Koin-registered since M1d) — Kiosk is self-service Registration, not a new check-in pipeline — and collapses the 5-variant `RegistrationVerdict` into 3 attendee-facing screen states (`Waiting`/`Greeting`/`NeedsStaff`) with automatic 5s/10s reset timers. `KioskLock` is a new `@Composable expect fun` (not a Koin service, since Lock Task Mode is Activity/Window-scoped, unlike the Context-scoped `ScanSource`/`CameraService`) providing screen pinning + keep-screen-on + hidden system bars on Android, and keep-screen-on only on iOS (Guided Access can't be app-triggered).

**Tech Stack:** Same as M1a–M2 — Kotlin 2.3.21, Compose Multiplatform 1.11.1, Koin 4.0.0, Ktor 3.5.1, kotlinx-coroutines 1.10.x. New Android-only dependency: `androidx.activity:activity-compose:1.9.3` (for `ComponentActivity` access inside `:shared`'s `androidMain` — not previously needed since no existing platform service is Activity-scoped).

## Global Constraints

- Package layout: new code in `mobile/shared/src/commonMain/kotlin/com/idento/presentation/kiosk/` (ViewModel + Screen), `mobile/shared/src/commonMain/kotlin/com/idento/platform/kiosk/` (KioskLock interface) + `androidMain`/`iosMain` actuals.
- Backend is frozen — Kiosk reuses `POST /api/events/:event_id/checkins/batch` via the exact same `RegistrationVerdictMapper`/`RegistrationCheckInService` singletons Registration mode already uses. No new backend calls, no new DTOs.
- **`KioskViewModel` must NOT define new seams for verdict classification or check-in submission.** It consumes `RegistrationVerdictMapper` and `RegistrationCheckInService` (both concrete, already Koin-registered) exactly as `RegistrationHomeViewModel` does — same `RegistrationVerdictLookup` handling, same `withContext(NonCancellable)` wrap around the write, same `EventBadgeTemplateSource` reuse (imported cross-package from `com.idento.presentation.registration`, it's a public `fun interface`).
- **`KioskLock` is a `@Composable expect fun`, not a Koin-registered class.** This is a deliberate architectural departure from every other platform service in this codebase (`CameraService`, `ScanSource`, `PrinterService` are all `Context`-based Koin singletons) — `Activity.startLockTask()` needs an actual `Activity`, whose lifetime doesn't fit a Koin singleton. Do not attempt to register `KioskLock` in `AppModule.kt`.
- **Long-press exit uses an explicit 3-second hold**, implemented via `detectTapGestures(onPress = ...)` + `withTimeout`/`awaitRelease()` — NOT Compose's default `detectTapGestures(onLongPress = ...)`, which uses `ViewConfiguration.longPressTimeoutMillis` (~500ms, too easy to trigger by accident on a public kiosk).
- **`presentation/qrscanner/` deletion requires touching `IdentoNavHost.kt`'s `Screen.QRScanner` composable block** (it directly instantiates the deleted `QRScannerScreen()`), but `Screen.QRScanner`'s route definition in `Screen.kt`, `CheckinScreen.kt`'s `onNavigateToQRScanner` callback, and the entire `Screen.Login`/`Events`/`Checkin` legacy cluster stay untouched — deferred to M4.
- All user-facing strings through `StringKey`/`Strings.kt` (EN + RU required, enforced by `StringsCompletenessTest`). New keys use the `KIOSK_` prefix.
- All new Composables use only components from `presentation/components/redesign/` and tokens from `DesignTokens.kt` (`IdentoColors`, `IdentoSpacing`, `IdentoRadius`, `IdentoTypeScale`). `IdentoTypeScale.kioskAttendeeName = 46.sp` already exists (added ahead of need in an earlier phase) — do not re-add it.
- `KioskLock`'s Android actual is **not JVM-unit-testable** (real `Activity`/`Window`) — compile + lint + manual review only, same accepted constraint as `ScanSource`'s Android actual and `CameraService`.
- Verification gate for every task (run from `mobile/android-app` directory): `./gradlew :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:compileTestKotlinIosSimulatorArm64 :shared:testDebugUnitTest :shared:lintDebug :app:lintDebug`. Final task additionally runs `:app:assembleDebug`.

---

### Task 1: Delete the dead `presentation/qrscanner/` package

**Files:**
- Delete: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/qrscanner/QRScannerViewModel.kt`
- Delete: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/qrscanner/QRScannerScreen.kt`
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/di/ViewModelModule.kt`
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/navigation/IdentoNavHost.kt`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. Pure deletion, plus removing the two references that would otherwise fail to compile (`ViewModelModule.kt`'s `QRScannerViewModel` factory, `IdentoNavHost.kt`'s `Screen.QRScanner` composable body).

- [ ] **Step 1: Confirm the package's only consumers are the ones this task removes**

```bash
cd mobile/android-app
grep -rn "QRScannerViewModel\|QRScannerScreen" ../shared/src --include="*.kt"
```

Expected output: exactly 4 matches — the two files being deleted, `ViewModelModule.kt`'s import + factory line, and `IdentoNavHost.kt`'s import + composable block. If anything else references these classes, stop and report instead of deleting.

- [ ] **Step 2: Delete the package**

```bash
rm -rf ../shared/src/commonMain/kotlin/com/idento/presentation/qrscanner/
```

- [ ] **Step 3: Remove the Koin registration**

In `mobile/shared/src/commonMain/kotlin/com/idento/di/ViewModelModule.kt`, remove the import:

```kotlin
import com.idento.presentation.qrscanner.QRScannerViewModel
```

and remove the factory line:

```kotlin
    factory { QRScannerViewModel(get()) }
```

- [ ] **Step 4: Remove the now-broken nav composable block**

In `mobile/shared/src/commonMain/kotlin/com/idento/presentation/navigation/IdentoNavHost.kt`, remove the import:

```kotlin
import com.idento.presentation.qrscanner.QRScannerScreen
```

and remove this entire composable block (it directly instantiates the deleted `QRScannerScreen`):

```kotlin
        // QR Scanner Screen (Kiosk mode)
        composable(
            route = Screen.QRScanner.route,
            arguments = listOf(
                navArgument("eventId") { type = NavType.StringType },
                navArgument("eventName") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val eventId = backStackEntry.arguments?.getString("eventId") ?: ""
            val eventName = backStackEntry.arguments?.getString("eventName") ?: ""
            
            QRScannerScreen(
                eventId = eventId,
                eventName = eventName,
                onNavigateBack = { navController.popBackStack() }
            )
        }
        
```

Do NOT remove `Screen.QRScanner`'s route definition in `Screen.kt`, and do NOT touch `CheckinScreen.kt`'s `onNavigateToQRScanner` callback or its call site (`IdentoNavHost.kt`'s `Screen.Checkin` composable, which still calls `navController.navigate(Screen.QRScanner.createRoute(...))`) — that whole chain is unreachable dead code from the real entry point (confirmed: `resolveStartDestination` never returns `Screen.Login`/`Events`/`Checkin`), and removing it is out of scope for M3 (deferred to M4). Leaving `Screen.Checkin`'s navigate-to-`Screen.QRScanner` call site pointing at a route with no registered composable is safe: it can never actually fire in production, since nothing reachable from the real app entry point ever renders `CheckinScreen`.

- [ ] **Step 5: Run the full gate**

```bash
./gradlew :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:compileTestKotlinIosSimulatorArm64 :shared:testDebugUnitTest :shared:lintDebug :app:lintDebug
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 6: Commit**

```bash
git add -A mobile/shared/src/commonMain/kotlin/com/idento/presentation/qrscanner/ \
        mobile/shared/src/commonMain/kotlin/com/idento/di/ViewModelModule.kt \
        mobile/shared/src/commonMain/kotlin/com/idento/presentation/navigation/IdentoNavHost.kt
git commit -m "refactor(mobile): delete dead presentation/qrscanner/ package

Pre-redesign legacy code — fake camera (hardcoded 'Test Scan (Demo)'
button), hardcoded English-only copy, ad-hoc colors, and the old
AttendeeRepository.getAttendeeByCode/checkinAttendee API rather than
the M1c/M2 verdict/check-in pipeline. Reachable only via the also-dead
Login->Events->Checkin chain, which resolveStartDestination never
returns. M3 builds the real Kiosk screen fresh in presentation/kiosk/.

The Screen.QRScanner composable registration in IdentoNavHost.kt is
removed since it directly instantiated the deleted QRScannerScreen;
Screen.QRScanner's route definition and CheckinScreen's
onNavigateToQRScanner callback are left untouched (larger legacy
cluster deferred to M4)."
```

---

### Task 2: i18n strings — KIOSK_* keys

**Files:**
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/data/localization/Strings.kt`
- Test: `mobile/shared/src/commonTest/kotlin/com/idento/data/localization/StringsCompletenessTest.kt` (already exists — must pass unmodified)

**Interfaces:**
- Consumes: existing `StringKey` enum + `englishStrings`/`russianStrings` maps.
- Produces: 3 new `StringKey` entries, each with EN + RU, usable via `stringResource(StringKey.KIOSK_*)` in Task 5.

- [ ] **Step 1: Add 3 new enum entries to `StringKey`**

In `Strings.kt`, the enum's last entries are (confirm at line 269 before making the edit):

```kotlin
    SCANNER_CONNECTED_SUFFIX,
    SCANNER_SWITCH_TO_CAMERA,
}
```

Insert the 3 new entries directly before the closing `}`:

```kotlin
    SCANNER_CONNECTED_SUFFIX,
    SCANNER_SWITCH_TO_CAMERA,

    // Kiosk mode screens (M3)
    KIOSK_WAITING_HINT,
    KIOSK_GREETING_PRINT_CAPTION,
    KIOSK_NEEDS_STAFF_MESSAGE,
}
```

- [ ] **Step 2: Add 3 English translations to `englishStrings`**

The map's last entries are (confirm at line 504-506 before editing):

```kotlin
    StringKey.SCANNER_CONNECTED_SUFFIX to "connected",
    StringKey.SCANNER_SWITCH_TO_CAMERA to "Switch to phone camera",
)
```

Insert before the closing `)`:

```kotlin
    StringKey.SCANNER_CONNECTED_SUFFIX to "connected",
    StringKey.SCANNER_SWITCH_TO_CAMERA to "Switch to phone camera",
    StringKey.KIOSK_WAITING_HINT to "No code? Call a staff member",
    StringKey.KIOSK_GREETING_PRINT_CAPTION to "Badge printing — collect it on the right",
    StringKey.KIOSK_NEEDS_STAFF_MESSAGE to "See a staff member",
)
```

- [ ] **Step 3: Add 3 Russian translations to `russianStrings`**

The map's last entries are (confirm at line 740-742 before editing):

```kotlin
    StringKey.SCANNER_CONNECTED_SUFFIX to "подключён",
    StringKey.SCANNER_SWITCH_TO_CAMERA to "Включить камеру телефона",
)
```

Insert before the closing `)`:

```kotlin
    StringKey.SCANNER_CONNECTED_SUFFIX to "подключён",
    StringKey.SCANNER_SWITCH_TO_CAMERA to "Включить камеру телефона",
    StringKey.KIOSK_WAITING_HINT to "Кода нет? Позовите сотрудника",
    StringKey.KIOSK_GREETING_PRINT_CAPTION to "Бейдж печатается — заберите справа",
    StringKey.KIOSK_NEEDS_STAFF_MESSAGE to "Обратитесь к сотруднику",
)
```

- [ ] **Step 4: Run the completeness test**

```bash
cd mobile/android-app
./gradlew :shared:testDebugUnitTest --tests "com.idento.data.localization.StringsCompletenessTest"
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 5: Run the full gate**

```bash
./gradlew :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:compileTestKotlinIosSimulatorArm64 :shared:testDebugUnitTest :shared:lintDebug :app:lintDebug
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 6: Commit**

```bash
git add mobile/shared/src/commonMain/kotlin/com/idento/data/localization/Strings.kt
git commit -m "feat(mobile/i18n): add KIOSK_* string keys (EN + RU, 3 keys)"
```

---

### Task 3: `KioskLock` — Activity-scoped lockdown as a `@Composable expect fun`

**Files:**
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/platform/kiosk/KioskLock.kt`
- Create: `mobile/shared/src/androidMain/kotlin/com/idento/platform/kiosk/KioskLock.android.kt`
- Create: `mobile/shared/src/iosMain/kotlin/com/idento/platform/kiosk/KioskLock.ios.kt`
- Modify: `mobile/shared/build.gradle.kts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `@Composable expect fun KioskLockEffect(enabled: Boolean)` — called once by `KioskScreen` (Task 5).

- [ ] **Step 1: Add the `androidx.activity:activity-compose` dependency**

`:shared`'s `androidMain` currently has no explicit `androidx.activity` dependency — `ComponentActivity` (needed for `Activity.startLockTask()`) isn't guaranteed to resolve without it. In `mobile/shared/build.gradle.kts`, inside the `androidMain.dependencies { ... }` block (the block also containing the CameraX/lifecycle-process dependencies), add:

```kotlin
            // ComponentActivity access for Kiosk lockdown (Lock Task Mode, keep-screen-on)
            implementation("androidx.activity:activity-compose:1.9.3")
```

Add this line after the existing `implementation("androidx.lifecycle:lifecycle-process:2.8.7")` line, still inside the same `androidMain.dependencies { }` block.

- [ ] **Step 2: Create the commonMain expect declaration**

Create `mobile/shared/src/commonMain/kotlin/com/idento/platform/kiosk/KioskLock.kt`:

```kotlin
package com.idento.platform.kiosk

import androidx.compose.runtime.Composable

/**
 * Enables/disables kiosk device lockdown for the duration this composable stays in composition
 * with [enabled] true. Unlike every other platform service in this codebase (CameraService,
 * ScanSource, PrinterService — all Context-scoped Koin singletons), lockdown is inherently
 * Activity/Window-scoped: Android's Activity.startLockTask() needs an actual Activity reference
 * whose lifetime doesn't fit a Koin singleton. Modeling this as a Composable function (rather
 * than a class registered in AppModule.kt) lets each platform actual reach the current Activity/
 * Window via Compose's own composition locals, and lets leaving the composition (e.g. navigating
 * away from the Kiosk screen) naturally reverse the lockdown via DisposableEffect's onDispose —
 * no separate manual teardown call site to keep in sync.
 */
@Composable
expect fun KioskLockEffect(enabled: Boolean)
```

- [ ] **Step 3: Create the Android actual**

Create `mobile/shared/src/androidMain/kotlin/com/idento/platform/kiosk/KioskLock.android.kt`:

```kotlin
package com.idento.platform.kiosk

import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalContext
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/**
 * Android lockdown: simplified screen pinning (Activity.startLockTask() without Device Owner
 * provisioning — works on any device, triggers Android's standard one-time "Screen pinning"
 * consent dialog on first use, exits via the OS's own back+overview-hold gesture or a device
 * PIN if one is set) + keep-screen-on + hidden system bars. Full Device Owner/COSU lockdown
 * would need out-of-app enterprise/MDM provisioning infrastructure — explicitly out of scope.
 */
@Composable
actual fun KioskLockEffect(enabled: Boolean) {
    val context = LocalContext.current
    DisposableEffect(enabled) {
        val activity = context as? ComponentActivity
        if (activity == null || !enabled) {
            return@DisposableEffect onDispose {}
        }

        activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val insetsController =
            WindowCompat.getInsetsController(activity.window, activity.window.decorView)
        insetsController.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        insetsController.hide(WindowInsetsCompat.Type.systemBars())

        try {
            activity.startLockTask()
        } catch (e: SecurityException) {
            // Screen pinning blocked by device policy — degrade gracefully: keep-screen-on and
            // hidden system bars still apply even without Lock Task Mode.
        } catch (e: IllegalArgumentException) {
            // Activity/task doesn't support lock task on this device — same graceful degradation.
        }

        onDispose {
            try {
                activity.stopLockTask()
            } catch (e: IllegalArgumentException) {
                // Wasn't actually pinned (e.g. startLockTask() above failed) — ignore.
            }
            activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            insetsController.show(WindowInsetsCompat.Type.systemBars())
        }
    }
}
```

- [ ] **Step 4: Create the iOS actual**

Create `mobile/shared/src/iosMain/kotlin/com/idento/platform/kiosk/KioskLock.ios.kt`:

```kotlin
package com.idento.platform.kiosk

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import platform.UIKit.UIApplication

/**
 * iOS lockdown: keep-screen-on only. Guided Access (the iOS equivalent of Lock Task Mode) cannot
 * be triggered programmatically by an app — it's an OS-level accessibility feature staff must
 * enable manually (triple-click the side/Home button) before handing the device to an attendee.
 * This is a platform limitation, not a missing feature — the same kind of asymmetry M2 documented
 * for BT scanning being Android-only.
 */
@Composable
actual fun KioskLockEffect(enabled: Boolean) {
    DisposableEffect(enabled) {
        UIApplication.sharedApplication().idleTimerDisabled = enabled
        onDispose {
            UIApplication.sharedApplication().idleTimerDisabled = false
        }
    }
}
```

- [ ] **Step 5: Run the full gate**

```bash
cd mobile/android-app
./gradlew :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:compileTestKotlinIosSimulatorArm64 :shared:testDebugUnitTest :shared:lintDebug :app:lintDebug
```

Expected: `BUILD SUCCESSFUL`. If the Android compile fails on `ComponentActivity`/`WindowInsetsControllerCompat` not resolving, double check Step 1's dependency was added to the correct `androidMain.dependencies { }` block (there is only one in this file). If the iOS compile fails on `UIApplication.sharedApplication()`, check whether this project's Kotlin/Native UIKit cinterop binding generates it as a different call shape (e.g. a top-level `UIApplication.shared` property) by checking IDE completion on `UIApplication` in `KioskLock.ios.kt` — adjust the call to match, the rest of the file is unaffected.

- [ ] **Step 6: Commit**

```bash
git add mobile/shared/src/commonMain/kotlin/com/idento/platform/kiosk/ \
        mobile/shared/src/androidMain/kotlin/com/idento/platform/kiosk/ \
        mobile/shared/src/iosMain/kotlin/com/idento/platform/kiosk/ \
        mobile/shared/build.gradle.kts
git commit -m "feat(mobile/kiosk): add KioskLockEffect — screen pinning + keep-screen-on

@Composable expect fun, not a Koin service — Lock Task Mode is
Activity/Window-scoped, unlike the Context-scoped ScanSource/
CameraService. Android actual: simplified screen pinning (no Device
Owner), FLAG_KEEP_SCREEN_ON, hidden system bars via
WindowInsetsControllerCompat. iOS actual: keep-screen-on only —
Guided Access can't be app-triggered."
```

---

### Task 4: `KioskViewModel`

**Files:**
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/kiosk/KioskViewModel.kt`
- Test: `mobile/shared/src/commonTest/kotlin/com/idento/presentation/kiosk/KioskViewModelTest.kt`

**Interfaces:**
- Consumes: `RegistrationVerdictMapper`, `RegistrationVerdictLookup`, `RegistrationCheckInService`, `RegistrationVerdict` (all existing, from `com.idento.data.registration`/`com.idento.data.model`), `ScanSource`/`ScannerConnectionState` (M2, `com.idento.platform.scanner`), `EventBadgeTemplateSource` (existing public `fun interface`, `com.idento.presentation.registration`), `DebouncedScanPipeline` (existing, `com.idento.data.registration`).
- Produces:
  - `sealed interface KioskScreenState { Waiting, Greeting(attendeeName: String), NeedsStaff }`
  - `data class KioskUiState(screenState: KioskScreenState, scannerState: ScannerConnectionState)`
  - `fun interface KioskStationGateway { suspend fun getConfig(): StationConfig }`
  - `class KioskViewModel(...)` with `val uiState: StateFlow<KioskUiState>` and public methods `onScanResumed()`, `onScanPaused()` — consumed by `KioskScreen` (Task 5) and wired in Koin (Task 6).

- [ ] **Step 1: Write the failing tests**

Create `mobile/shared/src/commonTest/kotlin/com/idento/presentation/kiosk/KioskViewModelTest.kt`:

```kotlin
package com.idento.presentation.kiosk

import com.idento.data.model.Attendee
import com.idento.data.model.BatchCheckinResultDto
import com.idento.data.model.StationConfig
import com.idento.data.model.StationMode
import com.idento.data.network.ApiResult
import com.idento.data.registration.AttendeeLookup
import com.idento.data.registration.BatchCheckinSubmitter
import com.idento.data.registration.RegistrationCheckInService
import com.idento.data.registration.RegistrationVerdictMapper
import com.idento.platform.scanner.ScanSource
import com.idento.platform.scanner.ScannerConnectionState
import com.idento.presentation.registration.EventBadgeTemplateSource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

@OptIn(ExperimentalCoroutinesApi::class)
class KioskViewModelTest {

    private val testDispatcher = UnconfinedTestDispatcher()

    @BeforeTest
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
    }

    @AfterTest
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private val fakeConfig = StationConfig(
        eventId = "evt-1",
        eventName = "Тест",
        mode = StationMode.KIOSK,
        dayDate = null,
        workPointId = "point-1",
        workPointName = "Точка регистрации",
        printer = null,
        autoPrint = false,
        deviceNumber = 1,
        staffName = "test@idento.app",
    )

    private val fakeAttendee = Attendee(
        id = "att-1",
        eventId = "evt-1",
        firstName = "Иван",
        lastName = "Иванов",
        code = "QR-001",
        checkinStatus = false,
    )

    private fun fakeScanSource(codes: Flow<String>) = object : ScanSource {
        override val connectionState = MutableStateFlow<ScannerConnectionState>(ScannerConnectionState.Camera)
        override fun startScanning(): Flow<String> = codes
        override fun stopScanning() {}
        override fun preferCamera() {}
        override fun setExcludedBluetoothAddress(address: String?) {}
    }

    private fun buildViewModel(
        stationGateway: KioskStationGateway = KioskStationGateway { fakeConfig },
        verdictMapper: RegistrationVerdictMapper = RegistrationVerdictMapper(
            AttendeeLookup { _, _ -> ApiResult.Error(Exception("not configured")) },
        ),
        checkInService: RegistrationCheckInService = RegistrationCheckInService(
            batchSubmitter = BatchCheckinSubmitter { _, _ -> ApiResult.Error(Exception("fake")) },
        ),
        scanSource: ScanSource = fakeScanSource(flowOf()),
        badgeTemplateSource: EventBadgeTemplateSource = EventBadgeTemplateSource { ApiResult.Success(null) },
    ) = KioskViewModel(
        stationGateway = stationGateway,
        verdictMapper = verdictMapper,
        checkInService = checkInService,
        scanSource = scanSource,
        badgeTemplateSource = badgeTemplateSource,
    )

    private fun successCheckInService() = RegistrationCheckInService(
        batchSubmitter = BatchCheckinSubmitter { _, items ->
            ApiResult.Success(
                listOf(BatchCheckinResultDto(clientUuid = items.first().clientUuid, status = "created")),
            )
        },
    )

    @Test
    fun initialStateIsWaiting() = runTest(testDispatcher) {
        val vm = buildViewModel()
        assertIs<KioskScreenState.Waiting>(vm.uiState.value.screenState)
    }

    @Test
    fun scanResultSuccessMapsToGreetingWithAttendeeName() = runTest(testDispatcher) {
        val codeFlow = MutableSharedFlow<String>()
        val vm = buildViewModel(
            scanSource = fakeScanSource(codeFlow),
            verdictMapper = RegistrationVerdictMapper(AttendeeLookup { _, _ -> ApiResult.Success(fakeAttendee) }),
            checkInService = successCheckInService(),
        )
        codeFlow.emit("QR-001")
        val state = vm.uiState.value.screenState
        assertIs<KioskScreenState.Greeting>(state)
        assertEquals("Иван Иванов", state.attendeeName)
    }

    @Test
    fun scanResultAlreadyCheckedMapsToNeedsStaff() = runTest(testDispatcher) {
        val codeFlow = MutableSharedFlow<String>()
        val vm = buildViewModel(
            scanSource = fakeScanSource(codeFlow),
            verdictMapper = RegistrationVerdictMapper(
                AttendeeLookup { _, _ ->
                    ApiResult.Success(fakeAttendee.copy(checkinStatus = true, checkedInAt = "2026-07-11T10:00:00Z"))
                },
            ),
        )
        codeFlow.emit("QR-002")
        assertIs<KioskScreenState.NeedsStaff>(vm.uiState.value.screenState)
    }

    @Test
    fun scanResultDeniedMapsToNeedsStaff() = runTest(testDispatcher) {
        val codeFlow = MutableSharedFlow<String>()
        val vm = buildViewModel(
            scanSource = fakeScanSource(codeFlow),
            verdictMapper = RegistrationVerdictMapper(
                AttendeeLookup { _, _ -> ApiResult.Success(fakeAttendee.copy(isBlocked = true, blockReason = "VIP only")) },
            ),
        )
        codeFlow.emit("QR-003")
        assertIs<KioskScreenState.NeedsStaff>(vm.uiState.value.screenState)
    }

    @Test
    fun scanResultNotFoundMapsToNeedsStaff() = runTest(testDispatcher) {
        val codeFlow = MutableSharedFlow<String>()
        val vm = buildViewModel(
            scanSource = fakeScanSource(codeFlow),
            verdictMapper = RegistrationVerdictMapper(AttendeeLookup { _, _ -> ApiResult.Success(null) }),
        )
        codeFlow.emit("UNKNOWN")
        assertIs<KioskScreenState.NeedsStaff>(vm.uiState.value.screenState)
    }

    @Test
    fun scanResultLookupFailedMapsToNeedsStaff() = runTest(testDispatcher) {
        val codeFlow = MutableSharedFlow<String>()
        val vm = buildViewModel(
            scanSource = fakeScanSource(codeFlow),
            verdictMapper = RegistrationVerdictMapper(AttendeeLookup { _, _ -> ApiResult.Error(Exception("timeout")) }),
        )
        codeFlow.emit("QR-004")
        assertIs<KioskScreenState.NeedsStaff>(vm.uiState.value.screenState)
    }

    @Test
    fun greetingAutoReturnsToWaitingAndResumesScanningAfter5Seconds() = runTest(testDispatcher) {
        val codeFlow = MutableSharedFlow<String>()
        val vm = buildViewModel(
            scanSource = fakeScanSource(codeFlow),
            verdictMapper = RegistrationVerdictMapper(AttendeeLookup { _, _ -> ApiResult.Success(fakeAttendee) }),
            checkInService = successCheckInService(),
        )
        codeFlow.emit("QR-005")
        assertIs<KioskScreenState.Greeting>(vm.uiState.value.screenState)
        advanceTimeBy(5_001)
        assertIs<KioskScreenState.Waiting>(vm.uiState.value.screenState)
        // Scanning resumed — a fresh scan is picked up.
        codeFlow.emit("QR-005")
        assertIs<KioskScreenState.Greeting>(vm.uiState.value.screenState)
    }

    @Test
    fun needsStaffAutoReturnsToWaitingAfter10Seconds() = runTest(testDispatcher) {
        val codeFlow = MutableSharedFlow<String>()
        val vm = buildViewModel(
            scanSource = fakeScanSource(codeFlow),
            verdictMapper = RegistrationVerdictMapper(AttendeeLookup { _, _ -> ApiResult.Success(null) }),
        )
        codeFlow.emit("UNKNOWN")
        assertIs<KioskScreenState.NeedsStaff>(vm.uiState.value.screenState)
        advanceTimeBy(10_001)
        assertIs<KioskScreenState.Waiting>(vm.uiState.value.screenState)
    }
}
```

- [ ] **Step 2: Run the test — confirm it fails**

```bash
cd mobile/android-app
./gradlew :shared:compileTestKotlinIosSimulatorArm64 2>&1 | grep "error:" | head -5
```

Expected: compile error `Unresolved reference: KioskViewModel`.

- [ ] **Step 3: Create `KioskViewModel.kt`**

Create `mobile/shared/src/commonMain/kotlin/com/idento/presentation/kiosk/KioskViewModel.kt`:

```kotlin
package com.idento.presentation.kiosk

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.idento.data.model.BadgeTemplate
import com.idento.data.model.RegistrationVerdict
import com.idento.data.model.StationConfig
import com.idento.data.network.ApiResult
import com.idento.data.registration.DebouncedScanPipeline
import com.idento.data.registration.RegistrationCheckInService
import com.idento.data.registration.RegistrationVerdictLookup
import com.idento.data.registration.RegistrationVerdictMapper
import com.idento.platform.scanner.ScanSource
import com.idento.platform.scanner.ScannerConnectionState
import com.idento.presentation.registration.EventBadgeTemplateSource
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

sealed interface KioskScreenState {
    data object Waiting : KioskScreenState
    data class Greeting(val attendeeName: String) : KioskScreenState
    data object NeedsStaff : KioskScreenState
}

data class KioskUiState(
    val screenState: KioskScreenState = KioskScreenState.Waiting,
    val scannerState: ScannerConnectionState = ScannerConnectionState.Camera,
)

/** Loaded from persistence; wired in Koin via
 * `StationConfigPreferences.stationConfig.filterNotNull().first()` — same pattern as
 * `RegistrationStationGateway`/`ZoneStationGateway`. */
fun interface KioskStationGateway {
    suspend fun getConfig(): StationConfig
}

/**
 * Self-service check-in for Kiosk-mode stations. Reuses [RegistrationVerdictMapper] and
 * [RegistrationCheckInService] directly — Kiosk is self-service Registration, not a separate
 * check-in pipeline. Collapses [RegistrationVerdict]'s 5 variants into 3 attendee-facing screen
 * states: `Success`/`PrintError` -> [KioskScreenState.Greeting] (check-in succeeded either way; a
 * print failure is a staff-side/print-queue concern, not shown to the attendee), everything else
 * -> [KioskScreenState.NeedsStaff] (neutral — no reason ever shown to the attendee, per the design
 * spec's §8 error-handling policy: "Kiosk: any problem -> neutral screen to attendee, details
 * staff-side only").
 */
class KioskViewModel(
    private val stationGateway: KioskStationGateway,
    private val verdictMapper: RegistrationVerdictMapper,
    private val checkInService: RegistrationCheckInService,
    private val scanSource: ScanSource,
    private val badgeTemplateSource: EventBadgeTemplateSource,
) : ViewModel() {

    private val _uiState = MutableStateFlow(KioskUiState())
    val uiState: StateFlow<KioskUiState> = _uiState.asStateFlow()

    private var stationConfig: StationConfig? = null
    private var badgeTemplate: BadgeTemplate? = null
    private val pipeline = DebouncedScanPipeline()
    private var scanJob: Job? = null
    private var resetJob: Job? = null

    init {
        viewModelScope.launch {
            val config = stationGateway.getConfig()
            stationConfig = config
            scanSource.setExcludedBluetoothAddress(config.printer?.address)
            viewModelScope.launch { loadBadgeTemplate(config.eventId) }
            onScanResumed()
        }
        viewModelScope.launch {
            scanSource.connectionState.collect { state ->
                _uiState.update { it.copy(scannerState = state) }
            }
        }
    }

    fun onScanResumed() {
        val config = stationConfig ?: return
        scanJob?.cancel()
        scanJob = viewModelScope.launch {
            pipeline.process(scanSource.startScanning()).collect { code ->
                processScannedCode(config, code)
            }
        }
    }

    fun onScanPaused() {
        scanJob?.cancel()
        scanSource.stopScanning()
    }

    private suspend fun processScannedCode(config: StationConfig, code: String) {
        val verdict = when (val lookup = verdictMapper.lookup(config.eventId, code)) {
            is RegistrationVerdictLookup.Found -> withContext(NonCancellable) {
                checkInService.checkIn(
                    eventId = config.eventId,
                    station = config,
                    attendee = lookup.attendee,
                    badgeTemplate = badgeTemplate,
                )
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
        resetJob?.cancel()
        resetJob = viewModelScope.launch {
            delay(if (screenState is KioskScreenState.Greeting) GREETING_TIMEOUT_MS else NEEDS_STAFF_TIMEOUT_MS)
            _uiState.update { it.copy(screenState = KioskScreenState.Waiting) }
            onScanResumed()
        }
    }

    private suspend fun loadBadgeTemplate(eventId: String) {
        val result = badgeTemplateSource.getBadgeTemplate(eventId)
        if (result is ApiResult.Success && result.data != null) {
            badgeTemplate = BadgeTemplate(zplTemplate = result.data)
        }
    }

    override fun onCleared() {
        super.onCleared()
        scanJob?.cancel()
        resetJob?.cancel()
        scanSource.stopScanning()
    }

    private companion object {
        const val GREETING_TIMEOUT_MS = 5_000L
        const val NEEDS_STAFF_TIMEOUT_MS = 10_000L
    }
}
```

- [ ] **Step 4: Run the tests**

```bash
cd mobile/android-app
./gradlew :shared:testDebugUnitTest --tests "com.idento.presentation.kiosk.KioskViewModelTest"
```

Expected: `BUILD SUCCESSFUL`, 8 tests pass.

- [ ] **Step 5: Run the full gate**

```bash
./gradlew :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:compileTestKotlinIosSimulatorArm64 :shared:testDebugUnitTest :shared:lintDebug :app:lintDebug
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 6: Commit**

```bash
git add mobile/shared/src/commonMain/kotlin/com/idento/presentation/kiosk/ \
        mobile/shared/src/commonTest/kotlin/com/idento/presentation/kiosk/
git commit -m "feat(mobile/kiosk): add KioskViewModel — self-service check-in via RegistrationCheckInService"
```

---

### Task 5: `KioskScreen`

**Files:**
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/kiosk/KioskScreen.kt`

**Interfaces:**
- Consumes (Task 3): `KioskLockEffect`.
- Consumes (Task 4): `KioskViewModel`, `KioskUiState`, `KioskScreenState`.
- Consumes (components): `ScanReticle` (existing, `presentation/components/redesign/`).
- Consumes (tokens): `IdentoColors.*`, `IdentoSpacing.*`, `IdentoTypeScale.kioskAttendeeName` (already exists).
- Consumes (strings): `StringKey.KIOSK_*` (Task 2) via `stringResource(key)`.
- Produces: `@Composable fun KioskScreen(viewModel: KioskViewModel = koinInject(), onExit: () -> Unit = {})` — used by `IdentoNavHost` (Task 7).

- [ ] **Step 1: Create `KioskScreen.kt`**

Create `mobile/shared/src/commonMain/kotlin/com/idento/presentation/kiosk/KioskScreen.kt`:

```kotlin
package com.idento.presentation.kiosk

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.idento.data.localization.StringKey
import com.idento.data.localization.stringResource
import com.idento.platform.kiosk.KioskLockEffect
import com.idento.presentation.components.redesign.ScanReticle
import com.idento.presentation.theme.IdentoColors
import com.idento.presentation.theme.IdentoSpacing
import com.idento.presentation.theme.IdentoTypeScale
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout
import org.koin.compose.koinInject

private const val LONG_PRESS_EXIT_DURATION_MS = 3_000L

@Composable
fun KioskScreen(
    viewModel: KioskViewModel = koinInject(),
    onExit: () -> Unit = {},
) {
    val uiState by viewModel.uiState.collectAsState()
    val lifecycleOwner = LocalLifecycleOwner.current

    KioskLockEffect(enabled = true)

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> viewModel.onScanResumed()
                Lifecycle.Event.ON_PAUSE -> viewModel.onScanPaused()
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        when (val state = uiState.screenState) {
            is KioskScreenState.Waiting -> WaitingBody()
            is KioskScreenState.Greeting -> GreetingBody(state.attendeeName)
            is KioskScreenState.NeedsStaff -> NeedsStaffBody()
        }
        KioskLogoExitTarget(
            onLongPressExit = onExit,
            modifier = Modifier
                .align(Alignment.TopCenter)
                .statusBarsPadding()
                .padding(top = IdentoSpacing.lg),
        )
    }
}

/** Long-press (3s) target — the only way to exit lockdown. Uses a manual press-and-hold timer
 * instead of Compose's default `detectTapGestures(onLongPress = ...)` (~500ms), which would be
 * far too easy for an attendee's finger to trigger by accident on a public kiosk. */
@Composable
private fun KioskLogoExitTarget(onLongPressExit: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier.pointerInput(Unit) {
            detectTapGestures(
                onPress = {
                    val heldLongEnough = try {
                        withTimeout(LONG_PRESS_EXIT_DURATION_MS) {
                            awaitRelease()
                            false
                        }
                    } catch (e: TimeoutCancellationException) {
                        true
                    }
                    if (heldLongEnough) onLongPressExit()
                },
            )
        },
    ) {
        Text(
            text = "Idento",
            color = IdentoColors.TextSecondary,
            fontSize = 16.sp,
            fontWeight = FontWeight.Bold,
        )
    }
}

@Composable
private fun WaitingBody() {
    Box(
        modifier = Modifier.fillMaxSize().background(Color.Black),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            ScanReticle(size = 340.dp)
            Spacer(Modifier.height(IdentoSpacing.xl))
            Text(
                text = stringResource(StringKey.KIOSK_WAITING_HINT),
                color = IdentoColors.TextSecondary,
                fontSize = 16.sp,
            )
        }
    }
}

@Composable
private fun GreetingBody(attendeeName: String) {
    Box(
        modifier = Modifier.fillMaxSize().background(IdentoColors.Brand),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                text = attendeeName,
                color = Color.White,
                fontSize = IdentoTypeScale.kioskAttendeeName,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(IdentoSpacing.lg))
            Text(
                text = stringResource(StringKey.KIOSK_GREETING_PRINT_CAPTION),
                color = Color.White,
                fontSize = 18.sp,
            )
        }
    }
}

@Composable
private fun NeedsStaffBody() {
    Box(
        modifier = Modifier.fillMaxSize().background(IdentoColors.NeutralBand),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = stringResource(StringKey.KIOSK_NEEDS_STAFF_MESSAGE),
            color = IdentoColors.TextPrimary,
            fontSize = 24.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = IdentoSpacing.xl),
        )
    }
}
```

- [ ] **Step 2: Run the full gate**

```bash
cd mobile/android-app
./gradlew :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:compileTestKotlinIosSimulatorArm64 :shared:testDebugUnitTest :shared:lintDebug :app:lintDebug
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 3: Commit**

```bash
git add mobile/shared/src/commonMain/kotlin/com/idento/presentation/kiosk/KioskScreen.kt
git commit -m "feat(mobile/kiosk): add KioskScreen (Waiting/Greeting/NeedsStaff + 3s long-press exit)"
```

---

### Task 6: Koin wiring — `KioskViewModel` factory

**Files:**
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/di/ViewModelModule.kt`

**Interfaces:**
- Consumes: `KioskViewModel`, `KioskStationGateway` (Task 4); `RegistrationVerdictMapper`, `RegistrationCheckInService` (existing, already Koin-registered since M1d); `ScanSource` (M2, existing single); `StationConfigPreferences`, `EventRepository` (existing).
- Produces: `factory { KioskViewModel(...) }` — resolvable via `koinInject()` in `KioskScreen` (Task 5).

- [ ] **Step 1: Add the factory block**

In `mobile/shared/src/commonMain/kotlin/com/idento/di/ViewModelModule.kt`, add imports:

```kotlin
import com.idento.presentation.kiosk.KioskStationGateway
import com.idento.presentation.kiosk.KioskViewModel
```

(These insert alphabetically among the existing `com.idento.presentation.*` imports — check the surrounding import block before placing them, matching the file's existing strict alphabetical ordering, same as M2's Koin-wiring task.)

Add the factory block after the `ZoneControlViewModel` factory (the file's last existing `factory { }` block):

```kotlin
    factory {
        // KioskViewModel follows the same narrow-seam pattern as RegistrationHomeViewModel/
        // ZoneControlViewModel, but reuses RegistrationVerdictMapper/RegistrationCheckInService
        // directly rather than defining new seams for them — Kiosk is self-service Registration,
        // not a separate check-in pipeline.
        val stationConfigPrefs: StationConfigPreferences = get()
        val eventRepository: EventRepository = get()
        KioskViewModel(
            stationGateway = KioskStationGateway {
                stationConfigPrefs.stationConfig.filterNotNull().first()
            },
            verdictMapper = get<RegistrationVerdictMapper>(),
            checkInService = get<RegistrationCheckInService>(),
            scanSource = get<ScanSource>(),
            badgeTemplateSource = EventBadgeTemplateSource { eventId ->
                eventRepository.getBadgeTemplate(eventId)
            },
        )
    }
```

`StationConfigPreferences`, `EventRepository`, `RegistrationVerdictMapper`, `RegistrationCheckInService`, `ScanSource`, and `EventBadgeTemplateSource` are all already imported in this file (consumed by the `RegistrationHomeViewModel`/`ZoneControlViewModel` factories above) — no new imports needed for them.

- [ ] **Step 2: Run the full gate**

```bash
cd mobile/android-app
./gradlew :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:compileTestKotlinIosSimulatorArm64 :shared:testDebugUnitTest :shared:lintDebug :app:lintDebug
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 3: Commit**

```bash
git add mobile/shared/src/commonMain/kotlin/com/idento/di/ViewModelModule.kt
git commit -m "feat(mobile/di): wire KioskViewModel into Koin"
```

---

### Task 7: Nav + Setup wiring — `Screen.KioskHome`

**Files:**
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/navigation/Screen.kt`
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/navigation/IdentoNavHost.kt`
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/setup/SetupCompleteScreen.kt`
- Modify: `mobile/shared/src/commonTest/kotlin/com/idento/presentation/navigation/SetupStartDestinationTest.kt`

**Interfaces:**
- Consumes (Task 5): `KioskScreen`.
- Produces: `Screen.KioskHome` route, reachable both cold-start (`resolveStartDestination`) and warm-start (`SetupCompleteScreen` → `IdentoNavHost`'s `onNavigateToStation`), plus an exit route (long-press → back to `Screen.SetupComplete`).

- [ ] **Step 1: Add the route to `Screen.kt`**

In `Screen.kt`, after the `ZoneControlHome` entry:

```kotlin
    // Zone Control mode (M2) — screen shown on cold start when stationMode == ZONE_CONTROL.
    data object ZoneControlHome : Screen("zone_control_home")

    // Kiosk mode (M3) — screen shown on cold start when stationMode == KIOSK.
    data object KioskHome : Screen("kiosk_home")
```

- [ ] **Step 2: Update `resolveStartDestination` and register the composable in `IdentoNavHost.kt`**

Add the import:

```kotlin
import com.idento.presentation.kiosk.KioskScreen
```

Update the kdoc and function:

```kotlin
/**
 * Per spec §8: an expired/revoked token always routes back to Login, even if a StationConfig
 * is still persisted (queues survive and are re-delivered after signing back in — that's
 * SyncService's job, unrelated to this decision).
 *
 * When both [hasStationConfig] and [isLoggedIn] are true the [stationMode] is used to select
 * the correct home screen: REGISTRATION → [Screen.RegistrationHome]; ZONE_CONTROL →
 * [Screen.ZoneControlHome]; KIOSK → [Screen.KioskHome]; the default null falls back to
 * [Screen.SetupComplete] (no station has been configured with an unrecognized mode).
 */
fun resolveStartDestination(
    hasStationConfig: Boolean,
    isLoggedIn: Boolean,
    stationMode: StationMode? = null,
): String = when {
    !hasStationConfig || !isLoggedIn -> Screen.SetupLogin.route
    stationMode == StationMode.REGISTRATION -> Screen.RegistrationHome.route
    stationMode == StationMode.ZONE_CONTROL -> Screen.ZoneControlHome.route
    stationMode == StationMode.KIOSK -> Screen.KioskHome.route
    else -> Screen.SetupComplete.route
}
```

Add the composable route registration after `ZoneControlHome`'s:

```kotlin
        composable(Screen.ZoneControlHome.route) {
            ZoneControlScreen()
        }

        composable(Screen.KioskHome.route) {
            KioskScreen(
                onExit = {
                    navController.navigate(Screen.SetupComplete.route) {
                        popUpTo(0) { inclusive = true }
                    }
                },
            )
        }
```

- [ ] **Step 3: Update `SetupCompleteScreen.kt`'s mode branch**

Current mode-branch `LaunchedEffect`:

```kotlin
    LaunchedEffect(uiState.stationConfig) {
        val config = uiState.stationConfig ?: return@LaunchedEffect
        when (config.mode) {
            StationMode.REGISTRATION -> onNavigateToStation(Screen.RegistrationHome.route)
            StationMode.ZONE_CONTROL -> onNavigateToStation(Screen.ZoneControlHome.route)
            StationMode.KIOSK -> Unit // M3 — stays on SetupComplete until the Kiosk screen exists.
        }
    }
```

Replace with:

```kotlin
    LaunchedEffect(uiState.stationConfig) {
        val config = uiState.stationConfig ?: return@LaunchedEffect
        when (config.mode) {
            StationMode.REGISTRATION -> onNavigateToStation(Screen.RegistrationHome.route)
            StationMode.ZONE_CONTROL -> onNavigateToStation(Screen.ZoneControlHome.route)
            StationMode.KIOSK -> onNavigateToStation(Screen.KioskHome.route)
        }
    }
```

- [ ] **Step 4: Update `SetupStartDestinationTest.kt`**

Current test:

```kotlin
    @Test
    fun startsAtSetupCompleteForKioskMode() {
        // KIOSK still goes to SetupComplete until M3 implements the Kiosk screen.
        assertEquals(
            Screen.SetupComplete.route,
            resolveStartDestination(hasStationConfig = true, isLoggedIn = true, stationMode = StationMode.KIOSK),
        )
    }
```

Replace with:

```kotlin
    @Test
    fun startsAtKioskHomeWhenKioskModeConfigured() {
        // M3: KIOSK-mode station cold-starts directly at KioskScreen.
        assertEquals(
            Screen.KioskHome.route,
            resolveStartDestination(hasStationConfig = true, isLoggedIn = true, stationMode = StationMode.KIOSK),
        )
    }
```

- [ ] **Step 5: Run the nav tests**

```bash
cd mobile/android-app
./gradlew :shared:testDebugUnitTest --tests "com.idento.presentation.navigation.SetupStartDestinationTest"
```

Expected: `BUILD SUCCESSFUL`, 6 tests pass.

- [ ] **Step 6: Run the full gate**

```bash
./gradlew :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:compileTestKotlinIosSimulatorArm64 :shared:testDebugUnitTest :shared:lintDebug :app:lintDebug
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 7: Commit**

```bash
git add mobile/shared/src/commonMain/kotlin/com/idento/presentation/navigation/Screen.kt \
        mobile/shared/src/commonMain/kotlin/com/idento/presentation/navigation/IdentoNavHost.kt \
        mobile/shared/src/commonMain/kotlin/com/idento/presentation/setup/SetupCompleteScreen.kt \
        mobile/shared/src/commonTest/kotlin/com/idento/presentation/navigation/SetupStartDestinationTest.kt
git commit -m "feat(mobile/nav): add Screen.KioskHome + route KIOSK-mode stations

Cold start: resolveStartDestination now routes KIOSK directly to
KioskScreen (was falling through to SetupComplete). Warm start:
SetupCompleteScreen's onNavigateToStation now covers all 3 modes.
Kiosk's long-press exit navigates back to Screen.SetupComplete with
popUpTo(0), reusing the existing station-summary + exit-station flow."
```

---

### Task 8: Final gate, summary doc, progress update

**Files:**
- Create: `docs/audit/mobile-redesign-m3-kiosk-mode-summary.md`
- Modify: `.superpowers/sdd/progress.md`

**Interfaces:**
- Consumes: nothing new — this task verifies and documents everything built in Tasks 1–7.
- Produces: a summary doc for future sessions/PR description, matching the M2 precedent (`docs/audit/mobile-redesign-m2-zone-control-summary.md`).

- [ ] **Step 1: Run the complete verification gate**

```bash
cd mobile/android-app
./gradlew :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:compileTestKotlinIosSimulatorArm64 :shared:testDebugUnitTest :shared:lintDebug :app:lintDebug :app:assembleDebug
```

Expected: `BUILD SUCCESSFUL` — all 8 targets pass, including the final `:app:assembleDebug` (not run by intermediate tasks).

- [ ] **Step 2: Write the summary doc**

Create `docs/audit/mobile-redesign-m3-kiosk-mode-summary.md` covering: what was built (per the 7 implementation tasks — dead `qrscanner/` removal, `KIOSK_*` i18n, `KioskLockEffect` as a `@Composable expect fun` with the Android screen-pinning + iOS keep-screen-on-only asymmetry, `KioskViewModel` reusing the Registration engine, `KioskScreen`'s 3-second long-press exit, Koin/nav wiring), the exit criterion this phase completes ("all 3 station modes reachable and functional" — Registration, Zone Control, Kiosk), and a Backlog section for any Minor items noted during task review (empty is fine if nothing came up).

- [ ] **Step 3: Update `.superpowers/sdd/progress.md`**

Append a new `=== MOBILE REDESIGN M3 ===` section (matching the M2 section's format) recording: branch name, plan file path, each task's completion status and commit SHA, and the final gate result. This file is git-ignored scratch — commit is not required for this file, but update it for session continuity per the established project convention.

- [ ] **Step 4: Commit the summary doc**

```bash
git add docs/audit/mobile-redesign-m3-kiosk-mode-summary.md
git commit -m "docs: add M3 implementation summary"
```

---

## Post-plan: PR

After all 8 tasks pass and a final whole-branch review (per `superpowers:subagent-driven-development`) finds no blocking issues, push the branch and open a PR:

```bash
git push -u origin redesign/m3-kiosk-mode
gh pr create --title "Mobile M3: Kiosk mode (self-service check-in + device lockdown)" --base main
```
