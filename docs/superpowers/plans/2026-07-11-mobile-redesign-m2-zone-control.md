# Mobile Redesign M2 — Zone Control Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Zone Control station mode (scan → allow/deny/not-registered verdict screen) on top of the already-shipped backend contract, port the hardware/BT scanner integration from the legacy `mobile/android-app` module into `:shared` with the MOBILE-BUG-04 fix applied, and retrofit the already-merged M1d `RegistrationHomeViewModel`/`RegistrationHomeScreen` to consume the same shared scan-input abstraction.

**Architecture:** A new `ScanSource` interface (`platform/scanner/`) unifies camera + hardware-broadcast + BT-SPP scan input behind one seam, replacing M1d's narrower `CameraScanGateway`. A new `ZoneControlViewModel`/`ZoneControlScreen` pair (`presentation/zonecontrol/`) mirrors the M1d `RegistrationHome` seam pattern, consuming a thin `ZoneVerdictAdapter` that maps the backend's already-fully-classified `ZoneScanResponseDto` to a `ZoneVerdict` (no client-side classification needed, unlike Registration). `RegistrationHomeViewModel`/`RegistrationHomeScreen` are retrofit in the same plan to consume `ScanSource` instead of `CameraScanGateway`. The dead `presentation/zoneselect/` package is deleted.

**Tech Stack:** Same as M1a–M1d — Kotlin 2.3.21, Compose Multiplatform 1.11.1, Koin 4.0.0, Ktor 3.5.1, kotlinx-coroutines 1.10.x. No new dependencies. Android-only additions: `android.bluetooth.*` (already used by `BluetoothPrinterService`), `android.content.BroadcastReceiver`/`IntentFilter` (already used by the legacy `:app` scanner code being ported).

## Global Constraints

- Package layout: new code in `mobile/shared/src/commonMain/kotlin/com/idento/presentation/zonecontrol/` (ViewModel + Screen), `mobile/shared/src/commonMain/kotlin/com/idento/data/zonecontrol/` (verdict adapter), `mobile/shared/src/commonMain/kotlin/com/idento/platform/scanner/` (ScanSource interface) + `androidMain`/`iosMain` equivalents (actuals).
- Backend is frozen — `POST /api/zones/:zone_id/scan`, `POST /api/events/:event_id/checkins/override`, `ZoneRepository.scanZone`, `AttendeeRepository.submitOverride`, `ZoneScanResponseDto`, `CreateCheckinOverrideRequestDto`, `ZoneVerdict` (partial — Allowed/NoAccess/NotRegistered already exist in `data/model/ZoneVerdict.kt`) are all consumed as-is or extended additively (Task 3 adds `LookupError`).
- **Known backend asymmetry (not a bug, just different from Registration):** `POST /api/zones/:zone_id/scan` returns **HTTP 404** (not a 200-with-verdict) when the scanned code matches no attendee at all (`backend/internal/handler/zone_scan.go:62-64`) — unlike `getAttendeeByCode`, which returns `ApiResult.Success(null)` for the same "no match" case in Registration. A 404 surfaces through `ZoneRepository.scanZone` as `ApiResult.Error` (Ktor's `expectSuccess` throws on 4xx, caught by `apiRunCatching`), which `ZoneVerdictAdapter` correctly maps to `ZoneVerdict.LookupError` (Task 3/6) — this is the intended, correct mapping, not a gap to fix. The error message text comes from Ktor's exception (`"Client request(...) invalid: 404 Not Found..."`), which is not pretty but matches the project's already-accepted "raw error strings, low severity, trusted staff" pattern (see M1c summary backlog).
- **`CreateCheckinOverride` is audit-only — it does NOT change what a subsequent zone scan returns.** It inserts a `checkin_overrides` row for the audit trail; it does not create a `zone_checkins` row or touch `attendee.RegisteredAt`. This means `onOverride` (Task 7) must NOT re-scan expecting a fresh `Allowed` verdict — a re-scan would return the same `NotRegistered` verdict again. Task 7's `onOverride` instead locally clears the verdict and increments `allowedCount` on a successful override submission — the operator's tap on "Всё равно пропустить" *is* the pass-through decision; the override call only records who made it and why.
- All user-facing strings through `StringKey`/`Strings.kt` (EN + RU required, enforced by `StringsCompletenessTest`). New keys use the `ZONE_` prefix, except two scanner-status keys shared with Registration which use the `SCANNER_` prefix (Task 2).
- All new Composables use only components from `presentation/components/redesign/` and tokens from `DesignTokens.kt` (`IdentoColors`, `IdentoSpacing`, `IdentoRadius`, `IdentoTypeScale`). No ad-hoc styling.
- Verdict colors: Allowed = `IdentoColors.Brand` (#00935E), NoAccess = `IdentoColors.Denied` (#CE2B37), NotRegistered = `IdentoColors.Amber` (#F5A300), LookupError = `IdentoColors.Denied` (matches `RegistrationVerdict.LookupError`'s established treatment).
- Every new screen applies `.statusBarsPadding()` on its root `Column` from the start (M1d had to add this as a post-merge fix — Task 8 applies it proactively).
- Hardware/BT scanner Android code is **not JVM-unit-testable** (real `BroadcastReceiver`/`BluetoothAdapter`/`Context`) — compile + lint + manual review only, same accepted constraint as `CameraService.android.kt` and the Keystore/Keychain `SecureStore` actuals.
- Verification gate for every task (run from `mobile/android-app` directory): `./gradlew :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:compileTestKotlinIosSimulatorArm64 :shared:testDebugUnitTest :shared:lintDebug :app:lintDebug`. Final task additionally runs `:app:assembleDebug`.

---

### Task 1: Delete the dead `presentation/zoneselect/` package

**Files:**
- Delete: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/zoneselect/ZoneSelectViewModel.kt`
- Delete: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/zoneselect/ZoneSelectScreen.kt`
- Delete: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/zoneselect/ZoneQRScannerViewModel.kt`

**Interfaces:**
- Consumes: nothing (this package is confirmed unreferenced — not registered in Koin, not routed in `IdentoNavHost.kt`, not imported by any other file).
- Produces: nothing. This is pure deletion.

- [ ] **Step 1: Confirm the package really is unreferenced**

```bash
cd mobile/android-app
grep -rn "zoneselect\|ZoneSelectViewModel\|ZoneSelectScreen\|ZoneQRScannerViewModel" ../shared/src --include="*.kt" | grep -v "presentation/zoneselect/"
```

Expected: no output (confirms nothing outside the package itself references these classes). If this prints any matches, stop and report them instead of deleting — the package may no longer be dead.

- [ ] **Step 2: Delete the package directory**

```bash
rm -rf ../shared/src/commonMain/kotlin/com/idento/presentation/zoneselect/
```

- [ ] **Step 3: Run the full gate**

```bash
./gradlew :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:compileTestKotlinIosSimulatorArm64 :shared:testDebugUnitTest :shared:lintDebug :app:lintDebug
```

Expected: `BUILD SUCCESSFUL` (confirms nothing broke by removing the package).

- [ ] **Step 4: Commit**

```bash
git add -A mobile/shared/src/commonMain/kotlin/com/idento/presentation/zoneselect/
git commit -m "refactor(mobile): delete dead presentation/zoneselect/ package

Unregistered in Koin, unrouted in nav — an earlier abandoned attempt
at zone check-in UI (MOBILE-BUG-03 audit finding). M2 builds the real
Zone Control screen fresh in presentation/zonecontrol/."
```

---

### Task 2: i18n strings — ZONE_* and SCANNER_* keys

**Files:**
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/data/localization/Strings.kt`
- Test: `mobile/shared/src/commonTest/kotlin/com/idento/data/localization/StringsCompletenessTest.kt` (already exists — must pass unmodified)

**Interfaces:**
- Consumes: existing `StringKey` enum + `englishStrings`/`russianStrings` maps.
- Produces: 17 new `StringKey` entries (15 `ZONE_*` + 2 `SCANNER_*`), each with EN + RU, usable via `stringResource(StringKey.ZONE_*)` / `stringResource(StringKey.SCANNER_*)` in Tasks 5, 8.

- [ ] **Step 1: Add 17 new enum entries to `StringKey`**

In `Strings.kt`, inside `enum class StringKey { ... }`, append after the last `REGISTRATION_*` entry (`REGISTRATION_ACTION_DISMISS,`):

```kotlin
// Zone Control mode screens (M2)
ZONE_STATUSBAR_ZONE_LABEL,
ZONE_STATUSBAR_ALLOWED_LABEL,
ZONE_STATUSBAR_DENIED_LABEL,
ZONE_STATUSBAR_QUEUE_LABEL,
ZONE_BADGE_PRINT_DISABLED,
ZONE_VERDICT_ALLOWED_WORD,
ZONE_VERDICT_NO_ACCESS_WORD,
ZONE_VERDICT_NOT_REGISTERED_WORD,
ZONE_VERDICT_ERROR_WORD,
ZONE_ALLOWED_REGISTERED_AT,
ZONE_ALLOWED_POINT,
ZONE_NO_ACCESS_REASON,
ZONE_NOT_REGISTERED_HINT,
ZONE_ACTION_OVERRIDE,
ZONE_ACTION_NEXT,
// Shared scanner-status indicator (M2) — used by both Registration and Zone Control screens
SCANNER_CONNECTED_SUFFIX,
SCANNER_SWITCH_TO_CAMERA,
```

- [ ] **Step 2: Add 17 English translations to `englishStrings`**

Append inside the `englishStrings` map, after the last `REGISTRATION_*` entry:

```kotlin
StringKey.ZONE_STATUSBAR_ZONE_LABEL to "ZONE",
StringKey.ZONE_STATUSBAR_ALLOWED_LABEL to "ALLOWED",
StringKey.ZONE_STATUSBAR_DENIED_LABEL to "DENIED",
StringKey.ZONE_STATUSBAR_QUEUE_LABEL to "QUEUE",
StringKey.ZONE_BADGE_PRINT_DISABLED to "Access control — printing disabled",
StringKey.ZONE_VERDICT_ALLOWED_WORD to "ACCESS GRANTED",
StringKey.ZONE_VERDICT_NO_ACCESS_WORD to "NO ACCESS",
StringKey.ZONE_VERDICT_NOT_REGISTERED_WORD to "NOT REGISTERED",
StringKey.ZONE_VERDICT_ERROR_WORD to "ERROR",
StringKey.ZONE_ALLOWED_REGISTERED_AT to "Registered at",
StringKey.ZONE_ALLOWED_POINT to "Point",
StringKey.ZONE_NO_ACCESS_REASON to "Reason",
StringKey.ZONE_NOT_REGISTERED_HINT to "Send to the registration desk",
StringKey.ZONE_ACTION_OVERRIDE to "Let through anyway",
StringKey.ZONE_ACTION_NEXT to "Next",
StringKey.SCANNER_CONNECTED_SUFFIX to "connected",
StringKey.SCANNER_SWITCH_TO_CAMERA to "Switch to phone camera",
```

- [ ] **Step 3: Add 17 Russian translations to `russianStrings`**

Append inside the `russianStrings` map, after the last `REGISTRATION_*` entry:

```kotlin
StringKey.ZONE_STATUSBAR_ZONE_LABEL to "ЗОНА",
StringKey.ZONE_STATUSBAR_ALLOWED_LABEL to "ДОПУЩЕНО",
StringKey.ZONE_STATUSBAR_DENIED_LABEL to "ОТКАЗОВ",
StringKey.ZONE_STATUSBAR_QUEUE_LABEL to "ОЧЕРЕДЬ",
StringKey.ZONE_BADGE_PRINT_DISABLED to "Контроль допуска — печать отключена",
StringKey.ZONE_VERDICT_ALLOWED_WORD to "ДОСТУП РАЗРЕШЁН",
StringKey.ZONE_VERDICT_NO_ACCESS_WORD to "НЕТ ДОПУСКА",
StringKey.ZONE_VERDICT_NOT_REGISTERED_WORD to "НЕ БЫЛ НА РЕГИСТРАЦИИ",
StringKey.ZONE_VERDICT_ERROR_WORD to "ОШИБКА",
StringKey.ZONE_ALLOWED_REGISTERED_AT to "Зарегистрирован",
StringKey.ZONE_ALLOWED_POINT to "Точка",
StringKey.ZONE_NO_ACCESS_REASON to "Причина",
StringKey.ZONE_NOT_REGISTERED_HINT to "Направьте на стойку регистрации",
StringKey.ZONE_ACTION_OVERRIDE to "Всё равно пропустить",
StringKey.ZONE_ACTION_NEXT to "Следующий",
StringKey.SCANNER_CONNECTED_SUFFIX to "подключён",
StringKey.SCANNER_SWITCH_TO_CAMERA to "Включить камеру телефона",
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
git commit -m "feat(mobile/i18n): add ZONE_* and SCANNER_* string keys (EN + RU, 17 keys)"
```

---

### Task 3: Extend `ZoneVerdict` with `LookupError`

**Files:**
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/data/model/ZoneVerdict.kt`

**Interfaces:**
- Consumes: existing `sealed interface ZoneVerdict` with `Allowed`/`NoAccess`/`NotRegistered` (already shipped, unmodified).
- Produces: `ZoneVerdict.LookupError(val message: String)` — consumed by `ZoneVerdictAdapter` (Task 6) and `ZoneControlScreen`'s exhaustive `when` (Task 8).

- [ ] **Step 1: Add the `LookupError` variant**

Current file (`ZoneVerdict.kt`):

```kotlin
package com.idento.data.model

import kotlinx.datetime.Instant

/** Zone-control-mode scan outcome, matching the backend's POST /api/zones/:zone_id/scan verdict field. */
sealed interface ZoneVerdict {
    data class Allowed(val attendee: VerdictAttendee, val registeredAt: Instant, val registeredPoint: String, val firstEntry: Boolean) : ZoneVerdict
    data class NoAccess(val attendee: VerdictAttendee, val ruleReason: String, val registeredAt: Instant?) : ZoneVerdict
    data class NotRegistered(val attendee: VerdictAttendee, val registrationPointHint: String) : ZoneVerdict
}
```

Change the last line to add `LookupError`:

```kotlin
    data class NotRegistered(val attendee: VerdictAttendee, val registrationPointHint: String) : ZoneVerdict

    /** Transient lookup failure (network error, or the scanned code matched no attendee at all —
     * backend returns HTTP 404 for that case, see zone_scan.go:62-64) — distinct from the three
     * business verdicts above so a network blip never displays as "NOT REGISTERED" or similar.
     * Mirrors RegistrationVerdict.LookupError's identical rationale. */
    data class LookupError(val message: String) : ZoneVerdict
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
git add mobile/shared/src/commonMain/kotlin/com/idento/data/model/ZoneVerdict.kt
git commit -m "feat(mobile/zonecontrol): add ZoneVerdict.LookupError variant"
```

---

### Task 4: `ScanSource` abstraction — interface + Android/iOS actuals with MOBILE-BUG-04 fix

**Files:**
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/platform/scanner/ScanSource.kt`
- Create: `mobile/shared/src/androidMain/kotlin/com/idento/platform/scanner/ScanSource.android.kt`
- Create: `mobile/shared/src/iosMain/kotlin/com/idento/platform/scanner/ScanSource.ios.kt`
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/di/AppModule.kt`
- Modify: `mobile/shared/src/androidMain/kotlin/com/idento/di/AppModule.android.kt`
- Modify: `mobile/shared/src/iosMain/kotlin/com/idento/di/AppModule.ios.kt`

**Interfaces:**
- Consumes: `CameraService` (existing `expect class`, already Koin-registered as `single { createCameraService() }`).
- Produces:
  - `sealed interface ScannerConnectionState { Camera, HardwareConnected(label: String), HardwareDisconnected }`
  - `interface ScanSource { val connectionState: StateFlow<ScannerConnectionState>; fun startScanning(): Flow<String>; fun stopScanning(); fun preferCamera() }`
  - `single<ScanSource>` in Koin — resolvable via `get<ScanSource>()` in Tasks 5 and 9.

- [ ] **Step 1: Create the commonMain interface**

Create `mobile/shared/src/commonMain/kotlin/com/idento/platform/scanner/ScanSource.kt`:

```kotlin
package com.idento.platform.scanner

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow

/** UI-facing indicator for screen 3b's scanner-status pill — Camera is the default/fallback. */
sealed interface ScannerConnectionState {
    data object Camera : ScannerConnectionState
    data class HardwareConnected(val label: String) : ScannerConnectionState
    data object HardwareDisconnected : ScannerConnectionState
}

/**
 * Unified scan-input seam consumed by both RegistrationHomeViewModel and ZoneControlViewModel.
 * Merges the platform camera with any connected hardware/BT scanner into one Flow<String> — the
 * caller doesn't need to know which physical source produced a given code.
 */
interface ScanSource {
    val connectionState: StateFlow<ScannerConnectionState>
    fun startScanning(): Flow<String>
    fun stopScanning()

    /** Forces the camera path for the current scan session even if a hardware scanner is
     * connected — wired to the "Switch to phone camera" fallback button on screen 3b. Resets on
     * the next [stopScanning] → [startScanning] cycle (e.g. leaving and re-entering the scan
     * tab), so leaving the screen and coming back re-detects the hardware scanner normally. */
    fun preferCamera()
}
```

- [ ] **Step 2: Create the Android actual**

Create `mobile/shared/src/androidMain/kotlin/com/idento/platform/scanner/ScanSource.android.kt`:

```kotlin
package com.idento.platform.scanner

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.idento.platform.camera.CameraService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.launch
import java.io.IOException
import java.io.InputStream
import java.util.UUID

private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

/**
 * Android [ScanSource]: merges the camera scan flow with a generic hardware-scanner broadcast
 * receiver and an auto-connecting BT SPP scanner (bonded devices only, no in-app discovery UI —
 * pairing happens via Android system Bluetooth settings). Per-manufacturer intent extraction
 * (Zebra DataWedge, Honeywell, etc — see the legacy mobile/android-app HardwareScannerService)
 * is intentionally NOT ported; only the manufacturer-agnostic broadcast fallback is.
 *
 * Fixes MOBILE-BUG-04: the ported legacy code called `kotlinx.coroutines.runBlocking { emit(...) }`
 * from inside `BroadcastReceiver.onReceive()`, which runs on the main thread — a slow collector
 * could deadlock/ANR the app during a scan. This implementation uses `tryEmit` (non-suspending)
 * on a buffered `MutableSharedFlow` instead; a dropped emit under buffer pressure is an acceptable
 * degradation (the operator rescans), unlike blocking the UI thread.
 */
class AndroidScanSource(
    private val cameraService: CameraService,
    private val context: Context,
) : ScanSource {

    private val _connectionState = MutableStateFlow<ScannerConnectionState>(ScannerConnectionState.Camera)
    override val connectionState: StateFlow<ScannerConnectionState> = _connectionState.asStateFlow()

    private val _hardwareScanResults = MutableSharedFlow<String>(replay = 0, extraBufferCapacity = 8)

    private var broadcastReceiver: BroadcastReceiver? = null
    private var isReceiverRegistered = false
    private var preferCameraOverride = false

    private val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    private val bluetoothAdapter: BluetoothAdapter? = bluetoothManager?.adapter
    private val serviceScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var bluetoothSocket: BluetoothSocket? = null
    private var listenJob: Job? = null

    override fun startScanning(): Flow<String> {
        if (!preferCameraOverride) {
            registerHardwareReceiver()
            connectBondedBluetoothScanner()
        }
        return merge(cameraService.startScanning(), _hardwareScanResults)
    }

    override fun stopScanning() {
        preferCameraOverride = false
        cameraService.stopScanning()
        unregisterHardwareReceiver()
        disconnectBluetooth()
    }

    override fun preferCamera() {
        preferCameraOverride = true
        unregisterHardwareReceiver()
        disconnectBluetooth()
        _connectionState.value = ScannerConnectionState.Camera
    }

    // ── Generic broadcast hardware scanner (manufacturer-agnostic) ──────────────────────────────

    private fun registerHardwareReceiver() {
        if (isReceiverRegistered) return
        val filter = IntentFilter().apply {
            addAction("com.idento.SCAN")
            addAction("android.intent.action.BARCODE_SCAN")
        }
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(receiverContext: Context?, intent: Intent?) {
                if (intent == null) return
                val data = extractGenericData(intent) ?: return
                // MOBILE-BUG-04 fix: tryEmit (non-suspending), not runBlocking { emit(...) } —
                // onReceive runs on the main thread; a suspending emit could deadlock/ANR.
                _hardwareScanResults.tryEmit(data)
                _connectionState.value = ScannerConnectionState.HardwareConnected("Scanner")
            }
        }
        broadcastReceiver = receiver
        ContextCompat.registerReceiver(context, receiver, filter, ContextCompat.RECEIVER_EXPORTED)
        isReceiverRegistered = true
    }

    private fun unregisterHardwareReceiver() {
        val receiver = broadcastReceiver ?: return
        if (isReceiverRegistered) {
            try {
                context.unregisterReceiver(receiver)
            } catch (e: IllegalArgumentException) {
                // Already unregistered — ignore.
            }
            isReceiverRegistered = false
        }
        broadcastReceiver = null
    }

    private fun extractGenericData(intent: Intent): String? {
        val keys = listOf("data", "barcode", "scan", "code", "SCAN_BARCODE", "barcode_string", "Barcode")
        return keys.firstNotNullOfOrNull { key -> intent.getStringExtra(key) }
    }

    // ── BT SPP — auto-connect to an already-bonded device only, no discovery UI ─────────────────

    private fun hasBluetoothConnectPermission(): Boolean {
        val permission = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Manifest.permission.BLUETOOTH_CONNECT
        } else {
            Manifest.permission.BLUETOOTH
        }
        return ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
    }

    @SuppressLint("MissingPermission")
    private fun connectBondedBluetoothScanner() {
        val adapter = bluetoothAdapter ?: return
        if (!adapter.isEnabled || !hasBluetoothConnectPermission()) return
        val device = adapter.bondedDevices?.firstOrNull() ?: return
        serviceScope.launch {
            try {
                val socket = device.createRfcommSocketToServiceRecord(SPP_UUID)
                socket.connect()
                bluetoothSocket = socket
                _connectionState.value = ScannerConnectionState.HardwareConnected(device.name ?: "Scanner")
                listenToBluetoothInput(socket.inputStream)
            } catch (e: IOException) {
                _connectionState.value = ScannerConnectionState.HardwareDisconnected
            }
        }
    }

    private fun listenToBluetoothInput(inputStream: InputStream) {
        listenJob = serviceScope.launch {
            val buffer = ByteArray(1024)
            val builder = StringBuilder()
            try {
                while (bluetoothSocket?.isConnected == true) {
                    val bytes = inputStream.read(buffer)
                    if (bytes > 0) {
                        builder.append(String(buffer, 0, bytes))
                        val lines = builder.toString().split("\n", "\r")
                        for (i in 0 until lines.size - 1) {
                            val line = lines[i].trim()
                            if (line.isNotEmpty()) {
                                // Runs on Dispatchers.IO inside serviceScope, never on the main
                                // thread — a suspending emit here cannot deadlock the UI, unlike
                                // the broadcast receiver path above (which is why that path uses
                                // tryEmit and this one can safely use suspending emit).
                                _hardwareScanResults.emit(line)
                            }
                        }
                        builder.clear()
                        if (lines.isNotEmpty()) builder.append(lines.last())
                    }
                }
            } catch (e: IOException) {
                _connectionState.value = ScannerConnectionState.HardwareDisconnected
            }
        }
    }

    private fun disconnectBluetooth() {
        listenJob?.cancel()
        listenJob = null
        try {
            bluetoothSocket?.close()
        } catch (e: IOException) {
            // Ignore close errors.
        }
        bluetoothSocket = null
        if (_connectionState.value is ScannerConnectionState.HardwareConnected) {
            _connectionState.value = ScannerConnectionState.Camera
        }
    }
}
```

- [ ] **Step 3: Create the iOS actual**

Create `mobile/shared/src/iosMain/kotlin/com/idento/platform/scanner/ScanSource.ios.kt`:

```kotlin
package com.idento.platform.scanner

import com.idento.platform.camera.CameraService
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * iOS [ScanSource]: camera-only. BT-SPP hardware scanning is explicitly out of v1 scope for iOS
 * (design spec: "BT-SPP печать/сканер на iOS — только Android").
 */
class IosScanSource(private val cameraService: CameraService) : ScanSource {

    private val _connectionState = MutableStateFlow<ScannerConnectionState>(ScannerConnectionState.Camera)
    override val connectionState: StateFlow<ScannerConnectionState> = _connectionState.asStateFlow()

    override fun startScanning(): Flow<String> = cameraService.startScanning()
    override fun stopScanning() = cameraService.stopScanning()
    override fun preferCamera() { /* no-op: iOS is already camera-only */ }
}
```

- [ ] **Step 4: Wire the expect/actual factory function and Koin registration**

In `mobile/shared/src/commonMain/kotlin/com/idento/di/AppModule.kt`, add the import and `single`:

```kotlin
import com.idento.platform.scanner.ScanSource
```

Add inside the `appModule` block's Platform Services section (next to `single { createCameraService() }`):

```kotlin
    single { createCameraService() }
    single<ScanSource> { createScanSource(get()) }
```

Add the expect declaration next to the other platform factory functions at the bottom of the file:

```kotlin
expect fun createScanSource(cameraService: CameraService): ScanSource
```

In `mobile/shared/src/androidMain/kotlin/com/idento/di/AppModule.android.kt`, add the import and actual:

```kotlin
import com.idento.platform.scanner.AndroidScanSource
import com.idento.platform.scanner.ScanSource
```

```kotlin
actual fun createScanSource(cameraService: CameraService): ScanSource {
    return AndroidScanSource(cameraService, object : KoinComponent {}.getKoin().get())
}
```

In `mobile/shared/src/iosMain/kotlin/com/idento/di/AppModule.ios.kt`, add the import and actual:

```kotlin
import com.idento.platform.scanner.IosScanSource
import com.idento.platform.scanner.ScanSource
```

```kotlin
actual fun createScanSource(cameraService: CameraService): ScanSource {
    return IosScanSource(cameraService)
}
```

- [ ] **Step 5: Run the full gate**

```bash
cd mobile/android-app
./gradlew :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:compileTestKotlinIosSimulatorArm64 :shared:testDebugUnitTest :shared:lintDebug :app:lintDebug
```

Expected: `BUILD SUCCESSFUL`. This is the first task that touches Android-specific Bluetooth/broadcast APIs — pay attention to any new lint warnings (e.g. missing permission checks) and fix them before proceeding; do not suppress with `@Suppress` unless the check above (`hasBluetoothConnectPermission`) already covers the call site and lint just can't see through it (mirror `@SuppressLint("MissingPermission")` usage exactly as in `BluetoothPrinterService.android.kt`, which this file's `connectBondedBluetoothScanner` already does).

- [ ] **Step 6: Commit**

```bash
git add mobile/shared/src/commonMain/kotlin/com/idento/platform/scanner/ \
        mobile/shared/src/androidMain/kotlin/com/idento/platform/scanner/ \
        mobile/shared/src/iosMain/kotlin/com/idento/platform/scanner/ \
        mobile/shared/src/commonMain/kotlin/com/idento/di/AppModule.kt \
        mobile/shared/src/androidMain/kotlin/com/idento/di/AppModule.android.kt \
        mobile/shared/src/iosMain/kotlin/com/idento/di/AppModule.ios.kt
git commit -m "feat(mobile/scanner): add ScanSource — camera + hardware/BT scan pipeline

Ports the generic broadcast hardware-scanner receiver and BT SPP
auto-connect (bonded devices only) from mobile/android-app into
:shared, fixing MOBILE-BUG-04 (runBlocking in BroadcastReceiver.
onReceive) with tryEmit + extraBufferCapacity. Per-manufacturer
intent extraction is not ported — generic fallback only. iOS actual
is camera-only (BT scanning is Android-only for v1)."
```

---

### Task 5: Retrofit `RegistrationHomeViewModel`/`RegistrationHomeScreen` to `ScanSource`

**Files:**
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/registration/RegistrationHomeViewModel.kt`
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/registration/RegistrationHomeScreen.kt`
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/di/ViewModelModule.kt`
- Modify: `mobile/shared/src/commonTest/kotlin/com/idento/presentation/registration/RegistrationHomeViewModelTest.kt`
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/components/redesign/ScannerStatusIndicator.kt`

**Interfaces:**
- Consumes (from Task 4): `ScanSource`, `ScannerConnectionState`.
- Produces: `ScannerStatusIndicator` composable — reused by `ZoneControlScreen` in Task 8. `RegistrationHomeUiState.scannerState: ScannerConnectionState` — no other task consumes this directly.

This task removes `CameraScanGateway` entirely (no other file references it outside this package after this task).

- [ ] **Step 1: Create the shared `ScannerStatusIndicator` composable**

Create `mobile/shared/src/commonMain/kotlin/com/idento/presentation/components/redesign/ScannerStatusIndicator.kt`:

```kotlin
package com.idento.presentation.components.redesign

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.idento.data.localization.StringKey
import com.idento.data.localization.stringResource
import com.idento.presentation.theme.IdentoColors
import com.idento.presentation.theme.IdentoRadius
import com.idento.presentation.theme.IdentoSpacing

/**
 * Screen 3b — shown instead of the camera preview when a hardware/BT scanner is connected
 * ([com.idento.platform.scanner.ScannerConnectionState.HardwareConnected]). Shared by
 * RegistrationHomeScreen and ZoneControlScreen — both consume the same ScanSource abstraction.
 */
@Composable
fun ScannerStatusIndicator(
    label: String,
    onSwitchToCamera: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier.fillMaxSize().background(Color.Black),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Box(
                modifier = Modifier
                    .background(IdentoColors.GreenTint, RoundedCornerShape(IdentoRadius.pill))
                    .padding(horizontal = IdentoSpacing.md, vertical = IdentoSpacing.sm),
            ) {
                Text(
                    text = "$label · ${stringResource(StringKey.SCANNER_CONNECTED_SUFFIX)}",
                    color = IdentoColors.Indicator,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Medium,
                )
            }
            Spacer(Modifier.height(IdentoSpacing.lg))
            Button(
                onClick = onSwitchToCamera,
                colors = ButtonDefaults.buttonColors(
                    containerColor = IdentoColors.Surface,
                    contentColor = IdentoColors.TextPrimary,
                ),
            ) {
                Text(stringResource(StringKey.SCANNER_SWITCH_TO_CAMERA))
            }
        }
    }
}
```

- [ ] **Step 2: Update `RegistrationHomeViewModel.kt`**

Remove the `CameraScanGateway` interface entirely (delete this block):

```kotlin
/** Abstracts [com.idento.platform.camera.CameraService] (an `expect class` that cannot be
 * subclassed from commonTest) behind a regular interface, keeping the ViewModel testable. */
interface CameraScanGateway {
    fun startScanning(): Flow<String>
    fun stopScanning()
}
```

Add the import:

```kotlin
import com.idento.platform.scanner.ScanSource
import com.idento.platform.scanner.ScannerConnectionState
```

Change the constructor parameter (in the class declaration) from:

```kotlin
    private val cameraGateway: CameraScanGateway?,
```

to:

```kotlin
    private val scanSource: ScanSource,
```

Add `scannerState` to `RegistrationHomeUiState`:

```kotlin
data class RegistrationHomeUiState(
    val currentTab: RegistrationTab = RegistrationTab.SCAN,
    val zoneName: String = "",
    val printerLabel: String = "",
    val printerStatusOk: Boolean = false,
    val pendingQueueCount: Int = 0,
    val sessionCheckedCount: Int = 0,
    val currentVerdict: RegistrationVerdict? = null,
    val isScanActive: Boolean = false,
    val scannerState: ScannerConnectionState = ScannerConnectionState.Camera,
    val searchQuery: String = "",
    val searchResults: List<Attendee> = emptyList(),
    val isSearchLoading: Boolean = false,
    val offlineBannerVisible: Boolean = false,
)
```

Add a `connectionState` collector to the `init` block (add this as a new `viewModelScope.launch { ... }` alongside the existing three):

```kotlin
        viewModelScope.launch {
            scanSource.connectionState.collect { state ->
                _uiState.update { it.copy(scannerState = state) }
            }
        }
```

Replace `onScanResumed()`/`onScanPaused()`:

```kotlin
    fun onScanResumed() {
        val config = stationConfig ?: return
        scanJob?.cancel()
        scanJob = viewModelScope.launch {
            _uiState.update { it.copy(isScanActive = true) }
            pipeline.process(scanSource.startScanning()).collect { code ->
                processScannedCode(config, code)
            }
        }
    }

    fun onScanPaused() {
        scanJob?.cancel()
        scanSource.stopScanning()
        _uiState.update { it.copy(isScanActive = false) }
    }

    fun onSwitchToCamera() {
        scanSource.preferCamera()
    }
```

Replace `onCleared()`:

```kotlin
    override fun onCleared() {
        super.onCleared()
        scanJob?.cancel()
        scanSource.stopScanning()
    }
```

- [ ] **Step 3: Update `RegistrationHomeScreen.kt`**

Add the import:

```kotlin
import com.idento.platform.scanner.ScannerConnectionState
import com.idento.presentation.components.redesign.ScannerStatusIndicator
```

In `ScanTab`, change the branch that shows the camera view when there's no verdict to check `scannerState` first:

Current:

```kotlin
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
```

Replace with (add `onSwitchToCamera: () -> Unit` as a new `ScanTab` parameter, threaded from `RegistrationHomeScreen`'s call site the same way `onVerdictDismissed` already is):

```kotlin
    val verdict = uiState.currentVerdict
    val scannerState = uiState.scannerState
    when {
        verdict != null -> VerdictCard(verdict = verdict, onDismiss = onVerdictDismissed)
        scannerState is ScannerConnectionState.HardwareConnected -> ScannerStatusIndicator(
            label = scannerState.label,
            onSwitchToCamera = onSwitchToCamera,
        )
        else -> Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black),
            contentAlignment = Alignment.Center,
        ) {
            ScanReticle()
        }
    }
```

Update `ScanTab`'s signature and its call site in `RegistrationHomeScreen`:

```kotlin
@Composable
private fun ScanTab(
    uiState: RegistrationHomeUiState,
    onVerdictDismissed: () -> Unit,
    onSwitchToCamera: () -> Unit,
) {
```

```kotlin
            RegistrationTab.SCAN -> ScanTab(
                uiState = uiState,
                onVerdictDismissed = viewModel::onVerdictDismissed,
                onSwitchToCamera = viewModel::onSwitchToCamera,
            )
```

- [ ] **Step 4: Update `ViewModelModule.kt`**

Replace the `RegistrationHomeViewModel` factory's `cameraGateway` wiring. Current:

```kotlin
        val cameraService: CameraService = get()
        val offlineQueueRepo: RegistrationOfflineQueueRepository = get()
        RegistrationHomeViewModel(
            stationGateway = RegistrationStationGateway {
                stationConfigPrefs.stationConfig.filterNotNull().first()
            },
            verdictMapper = get<RegistrationVerdictMapper>(),
            checkInService = get<RegistrationCheckInService>(),
            cameraGateway = object : CameraScanGateway {
                override fun startScanning() = cameraService.startScanning()
                override fun stopScanning() = cameraService.stopScanning()
            },
```

Replace with:

```kotlin
        val offlineQueueRepo: RegistrationOfflineQueueRepository = get()
        RegistrationHomeViewModel(
            stationGateway = RegistrationStationGateway {
                stationConfigPrefs.stationConfig.filterNotNull().first()
            },
            verdictMapper = get<RegistrationVerdictMapper>(),
            checkInService = get<RegistrationCheckInService>(),
            scanSource = get<ScanSource>(),
```

Remove the now-unused `CameraService` import and `com.idento.presentation.registration.CameraScanGateway` import from `ViewModelModule.kt`; add:

```kotlin
import com.idento.platform.scanner.ScanSource
```

(Leave `CameraService` imported only if another factory in the same file still uses it — check before removing; `SetupLoginViewModel`'s factory in this file also uses `get<CameraService>()`, so the import stays. Only remove the `CameraScanGateway` import.)

- [ ] **Step 5: Update `RegistrationHomeViewModelTest.kt`**

Add the import:

```kotlin
import com.idento.platform.scanner.ScanSource
import com.idento.platform.scanner.ScannerConnectionState
import kotlinx.coroutines.flow.MutableStateFlow
```

(`MutableStateFlow` is likely already imported — check before duplicating.)

Replace the `buildViewModel` builder's `cameraGateway` parameter and the `fakeCameraGateway` helper. Current builder parameter:

```kotlin
        cameraGateway: CameraScanGateway? = null,
```

and its use in the constructor call:

```kotlin
        cameraGateway = cameraGateway,
```

Replace with:

```kotlin
        scanSource: ScanSource = fakeScanSource(flowOf()),
```

```kotlin
        scanSource = scanSource,
```

Replace the test helper at the bottom of the file:

```kotlin
private fun fakeCameraGateway(codes: Flow<String>) = object : CameraScanGateway {
    override fun startScanning(): Flow<String> = codes
    override fun stopScanning() {}
}
```

with:

```kotlin
private fun fakeScanSource(codes: Flow<String>) = object : ScanSource {
    override val connectionState = MutableStateFlow<ScannerConnectionState>(ScannerConnectionState.Camera)
    override fun startScanning(): Flow<String> = codes
    override fun stopScanning() {}
    override fun preferCamera() {}
}
```

Update every call site in the test file that passes `cameraGateway = fakeCameraGateway(codeFlow)` to `scanSource = fakeScanSource(codeFlow)` (5 call sites: `scanResultUpdatesVerdictWhenLookupFails`, `scanResultIncrementsSessionCountOnSuccess`, `onVerdictDismissedClearsVerdictAndResumesScanning`, `tabSwitchToSearchStopsScanning`, `tabSwitchBackToScanResumesScanning`) — mechanical find-and-replace, the return type shape (`Flow<String>` in) is unchanged.

- [ ] **Step 6: Run the tests**

```bash
cd mobile/android-app
./gradlew :shared:testDebugUnitTest --tests "com.idento.presentation.registration.RegistrationHomeViewModelTest"
```

Expected: `BUILD SUCCESSFUL`, all 11 existing tests still pass (behavior is unchanged — only the seam interface name/shape changed).

- [ ] **Step 7: Run the full gate**

```bash
./gradlew :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:compileTestKotlinIosSimulatorArm64 :shared:testDebugUnitTest :shared:lintDebug :app:lintDebug
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 8: Commit**

```bash
git add mobile/shared/src/commonMain/kotlin/com/idento/presentation/registration/RegistrationHomeViewModel.kt \
        mobile/shared/src/commonMain/kotlin/com/idento/presentation/registration/RegistrationHomeScreen.kt \
        mobile/shared/src/commonMain/kotlin/com/idento/presentation/components/redesign/ScannerStatusIndicator.kt \
        mobile/shared/src/commonMain/kotlin/com/idento/di/ViewModelModule.kt \
        mobile/shared/src/commonTest/kotlin/com/idento/presentation/registration/RegistrationHomeViewModelTest.kt
git commit -m "refactor(mobile/registration): retrofit RegistrationHomeViewModel to ScanSource

Replaces the narrower CameraScanGateway (camera-only) with the shared
ScanSource seam (Task 4), so Registration-mode stations now also pick
up hardware/BT scanners automatically. Adds the shared
ScannerStatusIndicator composable (screen 3b), reused by
ZoneControlScreen. No behavior change for camera-only stations —
existing tests pass unmodified in assertions, only the fake helper's
shape changed."
```

---

### Task 6: `ZoneVerdictAdapter` — thin server-verdict mapper

**Files:**
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/data/zonecontrol/ZoneVerdictAdapter.kt`
- Test: `mobile/shared/src/commonTest/kotlin/com/idento/data/zonecontrol/ZoneVerdictAdapterTest.kt`

**Interfaces:**
- Consumes: `ZoneScanResponseDto` (`data/model/CheckinDtos.kt`, existing, unmodified), `ApiResult` (`data/network/ApiResult.kt`), `toVerdictAttendee(attendee: Attendee): VerdictAttendee` (existing, `data/registration/RegistrationVerdictMapper.kt`), `parseCheckedInAt(raw: String?, fallback: Instant): Instant` (existing `internal` function, same module, `data/registration/RegistrationVerdictMapper.kt`).
- Produces:
  - `fun interface ZoneScanSource { suspend fun scan(zoneId: String, code: String): ApiResult<ZoneScanResponseDto> }` — consumed by `ZoneControlViewModel` (Task 7) and wired in Koin (Task 9) via `ZoneRepository::scanZone`.
  - `class ZoneVerdictAdapter(private val scanSource: ZoneScanSource) { suspend fun lookup(zoneId: String, code: String): ZoneVerdict }` — consumed by `ZoneControlViewModel` (Task 7).

- [ ] **Step 1: Write the failing tests**

Create `mobile/shared/src/commonTest/kotlin/com/idento/data/zonecontrol/ZoneVerdictAdapterTest.kt`:

```kotlin
package com.idento.data.zonecontrol

import com.idento.data.model.Attendee
import com.idento.data.model.RegistrationInfoDto
import com.idento.data.model.VerdictAttendee
import com.idento.data.model.ZoneScanResponseDto
import com.idento.data.model.ZoneVerdict
import com.idento.data.network.ApiResult
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class ZoneVerdictAdapterTest {

    private fun fakeAttendee(id: String = "att-1") = Attendee(
        id = id,
        eventId = "evt-1",
        firstName = "Иван",
        lastName = "Иванов",
        code = "QR-001",
        checkinStatus = false,
    )

    @Test
    fun allowedVerdictMapsCorrectly() = runTest {
        val adapter = ZoneVerdictAdapter(ZoneScanSource { _, _ ->
            ApiResult.Success(
                ZoneScanResponseDto(
                    verdict = "allowed",
                    attendee = fakeAttendee(),
                    registration = RegistrationInfoDto(passed = true, at = "2026-07-11T10:00:00Z", point = "Главный вход"),
                    checkedInAt = "2026-07-11T12:00:00Z",
                    firstEntry = true,
                )
            )
        })
        val result = adapter.lookup("zone-1", "QR-001")
        assertIs<ZoneVerdict.Allowed>(result)
        assertEquals("Главный вход", result.registeredPoint)
        assertEquals(true, result.firstEntry)
    }

    @Test
    fun noAccessVerdictMapsCorrectly() = runTest {
        val adapter = ZoneVerdictAdapter(ZoneScanSource { _, _ ->
            ApiResult.Success(
                ZoneScanResponseDto(verdict = "no_access", reason = "Zone is closed", attendee = fakeAttendee())
            )
        })
        val result = adapter.lookup("zone-1", "QR-001")
        assertIs<ZoneVerdict.NoAccess>(result)
        assertEquals("Zone is closed", result.ruleReason)
    }

    @Test
    fun notRegisteredVerdictMapsCorrectly() = runTest {
        val adapter = ZoneVerdictAdapter(ZoneScanSource { _, _ ->
            ApiResult.Success(
                ZoneScanResponseDto(verdict = "not_registered", reason = "Attendee has not registered yet", attendee = fakeAttendee())
            )
        })
        val result = adapter.lookup("zone-1", "QR-001")
        assertIs<ZoneVerdict.NotRegistered>(result)
        assertEquals("Attendee has not registered yet", result.registrationPointHint)
    }

    @Test
    fun networkErrorMapsToLookupError() = runTest {
        val adapter = ZoneVerdictAdapter(ZoneScanSource { _, _ ->
            ApiResult.Error(Exception("404 Not Found"), "404 Not Found")
        })
        val result = adapter.lookup("zone-1", "UNKNOWN-CODE")
        assertIs<ZoneVerdict.LookupError>(result)
        assertEquals("404 Not Found", result.message)
    }

    @Test
    fun missingAttendeeInSuccessResponseMapsToLookupError() = runTest {
        // Defensive: the backend should never return verdict=allowed with no attendee body, but
        // if it did, this must not crash — it should degrade to LookupError like a network error.
        val adapter = ZoneVerdictAdapter(ZoneScanSource { _, _ ->
            ApiResult.Success(ZoneScanResponseDto(verdict = "allowed", attendee = null))
        })
        val result = adapter.lookup("zone-1", "QR-001")
        assertIs<ZoneVerdict.LookupError>(result)
    }
}
```

- [ ] **Step 2: Run the test — confirm it fails**

```bash
cd mobile/android-app
./gradlew :shared:compileTestKotlinIosSimulatorArm64 2>&1 | grep "error:" | head -5
```

Expected: compile error `Unresolved reference: ZoneVerdictAdapter`.

- [ ] **Step 3: Create `ZoneVerdictAdapter.kt`**

Create `mobile/shared/src/commonMain/kotlin/com/idento/data/zonecontrol/ZoneVerdictAdapter.kt`:

```kotlin
package com.idento.data.zonecontrol

import com.idento.data.model.ZoneScanResponseDto
import com.idento.data.model.ZoneVerdict
import com.idento.data.network.ApiResult
import com.idento.data.registration.parseCheckedInAt
import com.idento.data.registration.toVerdictAttendee
import kotlinx.datetime.Instant

/** Seam: ZoneRepository is a plain non-open class wrapping a live Ktor HttpClient with no
 * mock-engine seam (established M1c/M1d pattern) — adapted from the real repository via a
 * method reference in Koin (see ViewModelModule.kt, Task 9). */
fun interface ZoneScanSource {
    suspend fun scan(zoneId: String, code: String): ApiResult<ZoneScanResponseDto>
}

/**
 * Unlike RegistrationVerdictMapper (which classifies verdicts from raw attendee data on the
 * client), POST /api/zones/:zone_id/scan already returns a fully classified verdict — this
 * adapter only maps DTO -> domain type and handles the error case. See this plan's Global
 * Constraints for why a 404 (code matches no attendee) correctly lands in LookupError here,
 * same as any other network failure.
 */
class ZoneVerdictAdapter(private val scanSource: ZoneScanSource) {

    suspend fun lookup(zoneId: String, code: String): ZoneVerdict {
        return when (val result = scanSource.scan(zoneId, code)) {
            is ApiResult.Success -> result.data.toZoneVerdict()
            is ApiResult.Error -> ZoneVerdict.LookupError(result.message ?: "Lookup failed")
            is ApiResult.Loading -> ZoneVerdict.LookupError("Still loading")
        }
    }
}

private fun ZoneScanResponseDto.toZoneVerdict(): ZoneVerdict {
    val verdictAttendee = attendee?.let { toVerdictAttendee(it) }
        ?: return ZoneVerdict.LookupError("Zone scan response missing attendee")
    return when (verdict) {
        "allowed" -> ZoneVerdict.Allowed(
            attendee = verdictAttendee,
            registeredAt = parseCheckedInAt(checkedInAt, Instant.DISTANT_PAST),
            registeredPoint = registration?.point ?: "",
            firstEntry = firstEntry,
        )
        "no_access" -> ZoneVerdict.NoAccess(
            attendee = verdictAttendee,
            ruleReason = reason ?: "Access denied",
            registeredAt = registration?.at?.let { parseCheckedInAt(it, Instant.DISTANT_PAST) },
        )
        "not_registered" -> ZoneVerdict.NotRegistered(
            attendee = verdictAttendee,
            registrationPointHint = reason ?: "",
        )
        else -> ZoneVerdict.LookupError("Unknown zone verdict: $verdict")
    }
}
```

- [ ] **Step 4: Run the tests**

```bash
cd mobile/android-app
./gradlew :shared:testDebugUnitTest --tests "com.idento.data.zonecontrol.ZoneVerdictAdapterTest"
```

Expected: `BUILD SUCCESSFUL`, 5 tests pass.

- [ ] **Step 5: Run the full gate**

```bash
./gradlew :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:compileTestKotlinIosSimulatorArm64 :shared:testDebugUnitTest :shared:lintDebug :app:lintDebug
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 6: Commit**

```bash
git add mobile/shared/src/commonMain/kotlin/com/idento/data/zonecontrol/ \
        mobile/shared/src/commonTest/kotlin/com/idento/data/zonecontrol/
git commit -m "feat(mobile/zonecontrol): add ZoneVerdictAdapter — DTO to ZoneVerdict mapping"
```

---

### Task 7: `ZoneControlViewModel`

**Files:**
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/zonecontrol/ZoneControlViewModel.kt`
- Test: `mobile/shared/src/commonTest/kotlin/com/idento/presentation/zonecontrol/ZoneControlViewModelTest.kt`

**Interfaces:**
- Consumes (Task 4): `ScanSource`, `ScannerConnectionState`.
- Consumes (Task 6): `ZoneVerdictAdapter`.
- Consumes (existing, M1d): `PendingQueueCountSource` (`presentation/registration/RegistrationHomeViewModel.kt`, public, reused as-is).
- Consumes (existing): `StationConfig`, `ZoneVerdict`, `ApiResult`.
- Produces:
  - `fun interface ZoneStationGateway { suspend fun getConfig(): StationConfig }`
  - `fun interface CheckinOverrideSource { suspend fun submitOverride(eventId: String, zoneId: String, attendeeId: String): ApiResult<Unit> }` — wired in Koin (Task 9) to `AttendeeRepository::submitOverride`.
  - `data class ZoneControlUiState(...)`, `class ZoneControlViewModel(...)` with `val uiState: StateFlow<ZoneControlUiState>` and public methods `onScanResumed()`, `onScanPaused()`, `onSwitchToCamera()`, `onVerdictDismissed()`, `onOverride(attendeeId: String)` — consumed by `ZoneControlScreen` (Task 8).

**Deviation from the design spec, locked in during plan-writing (see Global Constraints):** `onOverride` does NOT re-scan after a successful submission — `CreateCheckinOverride` is audit-only and does not change what a subsequent scan returns, so a re-scan would just show `NotRegistered` again. It clears the verdict and increments `allowedCount` locally instead.

- [ ] **Step 1: Write the failing tests**

Create `mobile/shared/src/commonTest/kotlin/com/idento/presentation/zonecontrol/ZoneControlViewModelTest.kt`:

```kotlin
package com.idento.presentation.zonecontrol

import com.idento.data.model.StationConfig
import com.idento.data.model.StationMode
import com.idento.data.model.VerdictAttendee
import com.idento.data.model.ZoneScanResponseDto
import com.idento.data.model.ZoneVerdict
import com.idento.data.network.ApiResult
import com.idento.data.zonecontrol.ZoneScanSource
import com.idento.data.zonecontrol.ZoneVerdictAdapter
import com.idento.platform.scanner.ScanSource
import com.idento.platform.scanner.ScannerConnectionState
import com.idento.presentation.registration.PendingQueueCountSource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class ZoneControlViewModelTest {

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
        mode = StationMode.ZONE_CONTROL,
        dayDate = "2026-07-11",
        workPointId = "zone-1",
        workPointName = "Главный вход",
        printer = null,
        autoPrint = false,
        deviceNumber = 1,
        staffName = "test@idento.app",
    )

    private fun fakeScanSource(codes: Flow<String>) = object : ScanSource {
        override val connectionState = MutableStateFlow<ScannerConnectionState>(ScannerConnectionState.Camera)
        override fun startScanning(): Flow<String> = codes
        override fun stopScanning() {}
        override fun preferCamera() {}
    }

    private fun buildViewModel(
        stationGateway: ZoneStationGateway = ZoneStationGateway { fakeConfig },
        verdictAdapter: ZoneVerdictAdapter = ZoneVerdictAdapter(
            ZoneScanSource { _, _ -> ApiResult.Error(Exception("not configured")) },
        ),
        scanSource: ScanSource = fakeScanSource(flowOf()),
        pendingQueueCountSource: PendingQueueCountSource = PendingQueueCountSource { flowOf(0) },
        overrideSource: CheckinOverrideSource = CheckinOverrideSource { _, _, _ -> ApiResult.Success(Unit) },
    ) = ZoneControlViewModel(
        stationGateway = stationGateway,
        verdictAdapter = verdictAdapter,
        scanSource = scanSource,
        pendingQueueCountSource = pendingQueueCountSource,
        overrideSource = overrideSource,
    )

    @Test
    fun initialStateHasZoneName() = runTest(testDispatcher) {
        val vm = buildViewModel()
        assertEquals("Главный вход", vm.uiState.value.zoneName)
    }

    @Test
    fun pendingQueueCountUpdatesOfflineBannerVisibility() = runTest(testDispatcher) {
        val countFlow = MutableStateFlow(0)
        val vm = buildViewModel(pendingQueueCountSource = PendingQueueCountSource { countFlow })
        assertEquals(false, vm.uiState.value.offlineBannerVisible)
        countFlow.value = 2
        assertEquals(true, vm.uiState.value.offlineBannerVisible)
        assertEquals(2, vm.uiState.value.pendingQueueCount)
    }

    @Test
    fun scanResultAllowedIncrementsAllowedCount() = runTest(testDispatcher) {
        val codeFlow = MutableSharedFlow<String>()
        val verdictAdapter = ZoneVerdictAdapter(ZoneScanSource { _, _ ->
            ApiResult.Success(
                ZoneScanResponseDto(
                    verdict = "allowed",
                    attendee = fakeAttendeeDto(),
                    firstEntry = true,
                )
            )
        })
        val vm = buildViewModel(scanSource = fakeScanSource(codeFlow), verdictAdapter = verdictAdapter)
        vm.onScanResumed()
        assertEquals(0, vm.uiState.value.allowedCount)
        codeFlow.emit("QR-001")
        assertEquals(1, vm.uiState.value.allowedCount)
        assertEquals(0, vm.uiState.value.deniedCount)
        assertIs<ZoneVerdict.Allowed>(vm.uiState.value.currentVerdict)
    }

    @Test
    fun scanResultNoAccessIncrementsDeniedCount() = runTest(testDispatcher) {
        val codeFlow = MutableSharedFlow<String>()
        val verdictAdapter = ZoneVerdictAdapter(ZoneScanSource { _, _ ->
            ApiResult.Success(ZoneScanResponseDto(verdict = "no_access", reason = "Zone is closed", attendee = fakeAttendeeDto()))
        })
        val vm = buildViewModel(scanSource = fakeScanSource(codeFlow), verdictAdapter = verdictAdapter)
        vm.onScanResumed()
        codeFlow.emit("QR-002")
        assertEquals(0, vm.uiState.value.allowedCount)
        assertEquals(1, vm.uiState.value.deniedCount)
        assertIs<ZoneVerdict.NoAccess>(vm.uiState.value.currentVerdict)
    }

    @Test
    fun scanResultNotRegisteredDoesNotIncrementEitherCounter() = runTest(testDispatcher) {
        val codeFlow = MutableSharedFlow<String>()
        val verdictAdapter = ZoneVerdictAdapter(ZoneScanSource { _, _ ->
            ApiResult.Success(ZoneScanResponseDto(verdict = "not_registered", reason = "hint", attendee = fakeAttendeeDto()))
        })
        val vm = buildViewModel(scanSource = fakeScanSource(codeFlow), verdictAdapter = verdictAdapter)
        vm.onScanResumed()
        codeFlow.emit("QR-003")
        assertEquals(0, vm.uiState.value.allowedCount)
        assertEquals(0, vm.uiState.value.deniedCount)
        assertIs<ZoneVerdict.NotRegistered>(vm.uiState.value.currentVerdict)
    }

    @Test
    fun onVerdictDismissedClearsVerdictAndResumesScanning() = runTest(testDispatcher) {
        val codeFlow = MutableSharedFlow<String>()
        val verdictAdapter = ZoneVerdictAdapter(ZoneScanSource { _, _ ->
            ApiResult.Success(ZoneScanResponseDto(verdict = "no_access", reason = "x", attendee = fakeAttendeeDto()))
        })
        val vm = buildViewModel(scanSource = fakeScanSource(codeFlow), verdictAdapter = verdictAdapter)
        vm.onScanResumed()
        codeFlow.emit("QR-004")
        assertTrue(vm.uiState.value.currentVerdict != null)
        vm.onVerdictDismissed()
        assertNull(vm.uiState.value.currentVerdict)
        assertTrue(vm.uiState.value.isScanActive)
    }

    @Test
    fun onOverrideSuccessClearsVerdictAndIncrementsAllowedCount() = runTest(testDispatcher) {
        val codeFlow = MutableSharedFlow<String>()
        val verdictAdapter = ZoneVerdictAdapter(ZoneScanSource { _, _ ->
            ApiResult.Success(ZoneScanResponseDto(verdict = "not_registered", reason = "hint", attendee = fakeAttendeeDto()))
        })
        val vm = buildViewModel(
            scanSource = fakeScanSource(codeFlow),
            verdictAdapter = verdictAdapter,
            overrideSource = CheckinOverrideSource { _, _, _ -> ApiResult.Success(Unit) },
        )
        vm.onScanResumed()
        codeFlow.emit("QR-005")
        assertIs<ZoneVerdict.NotRegistered>(vm.uiState.value.currentVerdict)
        vm.onOverride("att-1")
        assertNull(vm.uiState.value.currentVerdict)
        assertEquals(1, vm.uiState.value.allowedCount)
    }

    @Test
    fun onOverrideFailureLeavesVerdictVisible() = runTest(testDispatcher) {
        val codeFlow = MutableSharedFlow<String>()
        val verdictAdapter = ZoneVerdictAdapter(ZoneScanSource { _, _ ->
            ApiResult.Success(ZoneScanResponseDto(verdict = "not_registered", reason = "hint", attendee = fakeAttendeeDto()))
        })
        val vm = buildViewModel(
            scanSource = fakeScanSource(codeFlow),
            verdictAdapter = verdictAdapter,
            overrideSource = CheckinOverrideSource { _, _, _ -> ApiResult.Error(Exception("network")) },
        )
        vm.onScanResumed()
        codeFlow.emit("QR-006")
        vm.onOverride("att-1")
        assertIs<ZoneVerdict.NotRegistered>(vm.uiState.value.currentVerdict)
        assertEquals(0, vm.uiState.value.allowedCount)
    }
}

private fun fakeAttendeeDto() = com.idento.data.model.Attendee(
    id = "att-1",
    eventId = "evt-1",
    firstName = "Иван",
    lastName = "Иванов",
    code = "QR-001",
    checkinStatus = false,
)
```

- [ ] **Step 2: Run the test — confirm it fails**

```bash
cd mobile/android-app
./gradlew :shared:compileTestKotlinIosSimulatorArm64 2>&1 | grep "error:" | head -5
```

Expected: compile error `Unresolved reference: ZoneControlViewModel`.

- [ ] **Step 3: Create `ZoneControlViewModel.kt`**

Create `mobile/shared/src/commonMain/kotlin/com/idento/presentation/zonecontrol/ZoneControlViewModel.kt`:

```kotlin
package com.idento.presentation.zonecontrol

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.idento.data.model.StationConfig
import com.idento.data.model.ZoneVerdict
import com.idento.data.network.ApiResult
import com.idento.data.zonecontrol.ZoneVerdictAdapter
import com.idento.platform.scanner.ScanSource
import com.idento.platform.scanner.ScannerConnectionState
import com.idento.presentation.registration.PendingQueueCountSource
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Loaded from persistence; wired in Koin via
 * `StationConfigPreferences.stationConfig.filterNotNull().first()` — same pattern as
 * RegistrationStationGateway. */
fun interface ZoneStationGateway {
    suspend fun getConfig(): StationConfig
}

/** Maps to POST /api/events/:event_id/checkins/override, body {attendee_id, zone_id, context}.
 * context is fixed server-side to one of a small enum (already_checked | not_registered |
 * no_access) — Zone Control's override button always sends "not_registered", the only ZoneVerdict
 * with an override action in this design. Wired in Koin to AttendeeRepository::submitOverride. */
fun interface CheckinOverrideSource {
    suspend fun submitOverride(eventId: String, zoneId: String, attendeeId: String): ApiResult<Unit>
}

data class ZoneControlUiState(
    val zoneName: String = "",
    val allowedCount: Int = 0,
    val deniedCount: Int = 0,
    val pendingQueueCount: Int = 0,
    val currentVerdict: ZoneVerdict? = null,
    val isScanActive: Boolean = false,
    val scannerState: ScannerConnectionState = ScannerConnectionState.Camera,
    val offlineBannerVisible: Boolean = false,
)

/**
 * Core business logic for the Zone Control home screen. Owns the scan pipeline
 * (`scanSource -> ZoneVerdictAdapter`) and all StatusBar state (zone name, allowed/denied session
 * counters, pending offline-queue count). Unlike RegistrationHomeViewModel there is no client-side
 * verdict classification and no DebouncedScanPipeline — the single POST /api/zones/:zone_id/scan
 * call performs both the read and (on an allowed outcome) the write atomically server-side, so the
 * whole lookup is wrapped in withContext(NonCancellable) rather than only the write half, unlike
 * Registration's separate lookup/checkIn split.
 */
class ZoneControlViewModel(
    private val stationGateway: ZoneStationGateway,
    private val verdictAdapter: ZoneVerdictAdapter,
    private val scanSource: ScanSource,
    private val pendingQueueCountSource: PendingQueueCountSource,
    private val overrideSource: CheckinOverrideSource,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ZoneControlUiState())
    val uiState: StateFlow<ZoneControlUiState> = _uiState.asStateFlow()

    private var stationConfig: StationConfig? = null
    private var scanJob: Job? = null

    init {
        viewModelScope.launch {
            val config = stationGateway.getConfig()
            stationConfig = config
            _uiState.update { it.copy(zoneName = config.workPointName) }
            onScanResumed()
        }
        viewModelScope.launch {
            pendingQueueCountSource.observe().collect { count ->
                _uiState.update { it.copy(pendingQueueCount = count, offlineBannerVisible = count > 0) }
            }
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
            _uiState.update { it.copy(isScanActive = true) }
            scanSource.startScanning().collect { code ->
                processScannedCode(config, code)
            }
        }
    }

    fun onScanPaused() {
        scanJob?.cancel()
        scanSource.stopScanning()
        _uiState.update { it.copy(isScanActive = false) }
    }

    fun onSwitchToCamera() {
        scanSource.preferCamera()
    }

    private suspend fun processScannedCode(config: StationConfig, code: String) {
        // withContext(NonCancellable): unlike Registration's separate lookup/checkIn calls, one
        // HTTP request here performs both the read and (on "allowed") the server-side write —
        // cancelling mid-request on a tab switch could orphan that write.
        val verdict = withContext(NonCancellable) {
            verdictAdapter.lookup(config.workPointId, code)
        }
        _uiState.update {
            it.copy(
                currentVerdict = verdict,
                allowedCount = it.allowedCount + if (verdict is ZoneVerdict.Allowed) 1 else 0,
                deniedCount = it.deniedCount + if (verdict is ZoneVerdict.NoAccess) 1 else 0,
            )
        }
        onScanPaused()
    }

    fun onVerdictDismissed() {
        _uiState.update { it.copy(currentVerdict = null) }
        onScanResumed()
    }

    /** "Всё равно пропустить" — submits an audit-logged override for a NotRegistered verdict.
     * Does NOT re-scan: CreateCheckinOverride is audit-only and does not change what a subsequent
     * scan returns (see this plan's Global Constraints). On success, the operator's tap on this
     * button IS the pass-through decision — clear the verdict and count it as allowed locally. */
    fun onOverride(attendeeId: String) {
        val config = stationConfig ?: return
        viewModelScope.launch {
            val result = withContext(NonCancellable) {
                overrideSource.submitOverride(config.eventId, config.workPointId, attendeeId)
            }
            if (result is ApiResult.Success) {
                _uiState.update {
                    it.copy(currentVerdict = null, allowedCount = it.allowedCount + 1)
                }
                onScanResumed()
            }
            // On ApiResult.Error the verdict stays visible so the operator can retry or dismiss —
            // no silent failure.
        }
    }

    override fun onCleared() {
        super.onCleared()
        scanJob?.cancel()
        scanSource.stopScanning()
    }
}
```

- [ ] **Step 4: Run the tests**

```bash
cd mobile/android-app
./gradlew :shared:testDebugUnitTest --tests "com.idento.presentation.zonecontrol.ZoneControlViewModelTest"
```

Expected: `BUILD SUCCESSFUL`, 8 tests pass.

- [ ] **Step 5: Run the full gate**

```bash
./gradlew :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:compileTestKotlinIosSimulatorArm64 :shared:testDebugUnitTest :shared:lintDebug :app:lintDebug
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 6: Commit**

```bash
git add mobile/shared/src/commonMain/kotlin/com/idento/presentation/zonecontrol/ \
        mobile/shared/src/commonTest/kotlin/com/idento/presentation/zonecontrol/
git commit -m "feat(mobile/zonecontrol): add ZoneControlViewModel with scan + override logic"
```

---

### Task 8: `ZoneControlScreen`

**Files:**
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/zonecontrol/ZoneControlScreen.kt`

**Interfaces:**
- Consumes (Task 7): `ZoneControlViewModel`, `ZoneControlUiState`.
- Consumes (Task 5): `ScannerStatusIndicator`.
- Consumes (Task 4): `ScannerConnectionState`.
- Consumes (Task 3): `ZoneVerdict.*`.
- Consumes (components): `StatusBar`, `StatusCell`, `VerdictBand`, `ScanReticle`, `ActionStack`, `ActionButtonSpec`, `DetailTable`, `DetailRow`, `OfflineBanner` (all existing, unmodified).
- Consumes (tokens): `IdentoColors.*`, `IdentoSpacing.*`, `IdentoTypeScale.*`.
- Consumes (strings): `StringKey.ZONE_*` via `stringResource(key)`.
- Produces: `@Composable fun ZoneControlScreen(viewModel: ZoneControlViewModel = koinInject())` — used by `IdentoNavHost` (Task 10).

- [ ] **Step 1: Create `ZoneControlScreen.kt`**

Create `mobile/shared/src/commonMain/kotlin/com/idento/presentation/zonecontrol/ZoneControlScreen.kt`:

```kotlin
package com.idento.presentation.zonecontrol

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.statusBarsPadding
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.idento.data.localization.StringKey
import com.idento.data.localization.stringResource
import com.idento.data.model.ZoneVerdict
import com.idento.platform.scanner.ScannerConnectionState
import com.idento.presentation.components.AppIcons
import com.idento.presentation.components.redesign.ActionButtonSpec
import com.idento.presentation.components.redesign.ActionStack
import com.idento.presentation.components.redesign.DetailRow
import com.idento.presentation.components.redesign.DetailTable
import com.idento.presentation.components.redesign.ScanReticle
import com.idento.presentation.components.redesign.ScannerStatusIndicator
import com.idento.presentation.components.redesign.StatusBar
import com.idento.presentation.components.redesign.StatusCell
import com.idento.presentation.components.redesign.VerdictBand
import com.idento.presentation.theme.IdentoColors
import com.idento.presentation.theme.IdentoRadius
import com.idento.presentation.theme.IdentoSpacing
import com.idento.presentation.theme.IdentoTypeScale
import org.koin.compose.koinInject

@Composable
fun ZoneControlScreen(
    viewModel: ZoneControlViewModel = koinInject(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val lifecycleOwner = LocalLifecycleOwner.current

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

    Column(modifier = Modifier.fillMaxSize().statusBarsPadding()) {
        StatusBar(
            cells = listOf(
                StatusCell(
                    value = uiState.zoneName,
                    label = stringResource(StringKey.ZONE_STATUSBAR_ZONE_LABEL),
                ),
                StatusCell(
                    value = uiState.allowedCount.toString(),
                    label = stringResource(StringKey.ZONE_STATUSBAR_ALLOWED_LABEL),
                    valueColor = IdentoColors.Brand,
                ),
                StatusCell(
                    value = uiState.deniedCount.toString(),
                    label = stringResource(StringKey.ZONE_STATUSBAR_DENIED_LABEL),
                    valueColor = if (uiState.deniedCount > 0) IdentoColors.Denied else IdentoColors.TextPrimary,
                ),
                StatusCell(
                    value = uiState.pendingQueueCount.toString(),
                    label = stringResource(StringKey.ZONE_STATUSBAR_QUEUE_LABEL),
                    valueColor = if (uiState.pendingQueueCount > 0) IdentoColors.Queue else IdentoColors.TextPrimary,
                ),
            ),
        )

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = IdentoSpacing.md, vertical = IdentoSpacing.sm)
                .background(IdentoColors.Surface, RoundedCornerShape(IdentoRadius.pill))
                .padding(horizontal = IdentoSpacing.md, vertical = IdentoSpacing.sm),
        ) {
            Text(
                text = stringResource(StringKey.ZONE_BADGE_PRINT_DISABLED),
                color = IdentoColors.TextSecondary,
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
            )
        }

        if (uiState.offlineBannerVisible) {
            com.idento.presentation.components.redesign.OfflineBanner(
                queuedCount = uiState.pendingQueueCount,
                lastSyncLabel = "—",
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = IdentoSpacing.md),
            )
        }

        ScanBody(
            uiState = uiState,
            onVerdictDismissed = viewModel::onVerdictDismissed,
            onSwitchToCamera = viewModel::onSwitchToCamera,
            onOverride = viewModel::onOverride,
        )
    }
}

@Composable
private fun ScanBody(
    uiState: ZoneControlUiState,
    onVerdictDismissed: () -> Unit,
    onSwitchToCamera: () -> Unit,
    onOverride: (String) -> Unit,
) {
    val verdict = uiState.currentVerdict
    val scannerState = uiState.scannerState
    when {
        verdict != null -> VerdictCard(verdict = verdict, onDismiss = onVerdictDismissed, onOverride = onOverride)
        scannerState is ScannerConnectionState.HardwareConnected -> ScannerStatusIndicator(
            label = scannerState.label,
            onSwitchToCamera = onSwitchToCamera,
        )
        else -> Box(
            modifier = Modifier.fillMaxSize().background(Color.Black),
            contentAlignment = Alignment.Center,
        ) {
            ScanReticle()
        }
    }
}

@Composable
private fun VerdictCard(
    verdict: ZoneVerdict,
    onDismiss: () -> Unit,
    onOverride: (String) -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(IdentoSpacing.lg),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        when (verdict) {
            is ZoneVerdict.Allowed -> AllowedVerdictContent(verdict, onDismiss)
            is ZoneVerdict.NoAccess -> NoAccessVerdictContent(verdict, onDismiss)
            is ZoneVerdict.NotRegistered -> NotRegisteredVerdictContent(verdict, onDismiss, onOverride)
            is ZoneVerdict.LookupError -> LookupErrorVerdictContent(verdict, onDismiss)
        }
    }
}

@Composable
private fun AllowedVerdictContent(verdict: ZoneVerdict.Allowed, onDismiss: () -> Unit) {
    VerdictBand(
        word = stringResource(StringKey.ZONE_VERDICT_ALLOWED_WORD),
        icon = AppIcons.CheckCircle,
        color = IdentoColors.Brand,
    )
    Spacer(Modifier.height(IdentoSpacing.md))
    Text(
        text = verdict.attendee.fullName,
        fontSize = IdentoTypeScale.attendeeName,
        fontWeight = FontWeight.SemiBold,
        color = IdentoColors.TextPrimary,
    )
    Spacer(Modifier.height(IdentoSpacing.sm))
    DetailTable(
        rows = listOf(
            DetailRow(stringResource(StringKey.ZONE_ALLOWED_REGISTERED_AT), verdict.registeredAt.toString()),
            DetailRow(stringResource(StringKey.ZONE_ALLOWED_POINT), verdict.registeredPoint),
        ),
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

@Composable
private fun NoAccessVerdictContent(verdict: ZoneVerdict.NoAccess, onDismiss: () -> Unit) {
    VerdictBand(
        word = stringResource(StringKey.ZONE_VERDICT_NO_ACCESS_WORD),
        icon = AppIcons.Close,
        color = IdentoColors.Denied,
    )
    Spacer(Modifier.height(IdentoSpacing.md))
    Text(
        text = verdict.attendee.fullName,
        fontSize = IdentoTypeScale.attendeeName,
        fontWeight = FontWeight.SemiBold,
        color = IdentoColors.TextPrimary,
    )
    Spacer(Modifier.height(IdentoSpacing.sm))
    DetailTable(rows = listOf(DetailRow(stringResource(StringKey.ZONE_NO_ACCESS_REASON), verdict.ruleReason)))
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

@Composable
private fun NotRegisteredVerdictContent(
    verdict: ZoneVerdict.NotRegistered,
    onDismiss: () -> Unit,
    onOverride: (String) -> Unit,
) {
    VerdictBand(
        word = stringResource(StringKey.ZONE_VERDICT_NOT_REGISTERED_WORD),
        icon = AppIcons.Warning,
        color = IdentoColors.Amber,
    )
    Spacer(Modifier.height(IdentoSpacing.md))
    Text(
        text = verdict.attendee.fullName,
        fontSize = IdentoTypeScale.attendeeName,
        fontWeight = FontWeight.SemiBold,
        color = IdentoColors.TextPrimary,
    )
    Spacer(Modifier.height(IdentoSpacing.sm))
    Text(
        // registrationPointHint is dynamic (from the backend's `reason` field, e.g. "Attendee has
        // not registered yet") — show it, don't override with a static local string. Fall back to
        // the generic ZONE_NOT_REGISTERED_HINT only if the backend ever sends an empty reason.
        text = verdict.registrationPointHint.ifBlank { stringResource(StringKey.ZONE_NOT_REGISTERED_HINT) },
        fontSize = 14.sp,
        color = IdentoColors.TextSecondary,
        modifier = Modifier.padding(horizontal = IdentoSpacing.md),
    )
    Spacer(Modifier.height(IdentoSpacing.lg))
    ActionStack(
        primary = ActionButtonSpec(
            label = stringResource(StringKey.ZONE_ACTION_OVERRIDE),
            onClick = { onOverride(verdict.attendee.id) },
            containerColor = IdentoColors.Amber,
            contentColor = Color.White,
        ),
        secondary = ActionButtonSpec(
            label = stringResource(StringKey.ZONE_ACTION_NEXT),
            onClick = onDismiss,
        ),
    )
}

@Composable
private fun LookupErrorVerdictContent(verdict: ZoneVerdict.LookupError, onDismiss: () -> Unit) {
    VerdictBand(
        word = stringResource(StringKey.ZONE_VERDICT_ERROR_WORD),
        icon = AppIcons.Warning,
        color = IdentoColors.Denied,
    )
    Spacer(Modifier.height(IdentoSpacing.sm))
    Text(
        text = verdict.message,
        fontSize = 14.sp,
        color = IdentoColors.TextSecondary,
        modifier = Modifier.padding(horizontal = IdentoSpacing.md),
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
```

Note: `StringKey.REGISTRATION_ACTION_DISMISS` ("Dismiss"/"Закрыть") is reused directly for the generic dismiss action rather than duplicating an identical `ZONE_ACTION_DISMISS` key — same text, already exists, matches DRY.

- [ ] **Step 2: Run the full gate**

```bash
cd mobile/android-app
./gradlew :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:compileTestKotlinIosSimulatorArm64 :shared:testDebugUnitTest :shared:lintDebug :app:lintDebug
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 3: Commit**

```bash
git add mobile/shared/src/commonMain/kotlin/com/idento/presentation/zonecontrol/ZoneControlScreen.kt
git commit -m "feat(mobile/zonecontrol): add ZoneControlScreen (scan + all 4 verdict types)"
```

---

### Task 9: Koin wiring — `ZoneControlViewModel` factory

**Files:**
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/di/ViewModelModule.kt`

**Interfaces:**
- Consumes: `ZoneControlViewModel`, `ZoneStationGateway`, `CheckinOverrideSource` (Task 7); `ZoneVerdictAdapter`, `ZoneScanSource` (Task 6); `ScanSource` (Task 4); `PendingQueueCountSource` (existing); `StationConfigPreferences`, `ZoneRepository`, `AttendeeRepository` (existing).
- Produces: `factory { ZoneControlViewModel(...) }` — resolvable via `koinInject()` in `ZoneControlScreen` (Task 8).

- [ ] **Step 1: Add the factory block**

In `mobile/shared/src/commonMain/kotlin/com/idento/di/ViewModelModule.kt`, add imports:

```kotlin
import com.idento.data.repository.ZoneRepository
import com.idento.data.zonecontrol.ZoneScanSource
import com.idento.data.zonecontrol.ZoneVerdictAdapter
import com.idento.platform.scanner.ScanSource
import com.idento.presentation.zonecontrol.CheckinOverrideSource
import com.idento.presentation.zonecontrol.ZoneControlViewModel
import com.idento.presentation.zonecontrol.ZoneStationGateway
```

(`ZoneRepository` may already be imported for another factory in this file — check before duplicating.)

Add the factory block after the `RegistrationHomeViewModel` factory:

```kotlin
    factory {
        // ZoneControlViewModel follows the same narrow-seam pattern as RegistrationHomeViewModel:
        // ZoneStationGateway is the same StationConfigPreferences-backed lambda shape as
        // RegistrationStationGateway; ZoneScanSource/CheckinOverrideSource are method references
        // into ZoneRepository/AttendeeRepository; ScanSource and PendingQueueCountSource are the
        // shared singles already registered above/in AppModule.
        val stationConfigPrefs: StationConfigPreferences = get()
        val zoneRepository: ZoneRepository = get()
        val attendeeRepository: AttendeeRepository = get()
        val offlineQueueRepo: RegistrationOfflineQueueRepository = get()
        ZoneControlViewModel(
            stationGateway = ZoneStationGateway {
                stationConfigPrefs.stationConfig.filterNotNull().first()
            },
            verdictAdapter = ZoneVerdictAdapter(
                ZoneScanSource(zoneRepository::scanZone),
            ),
            scanSource = get<ScanSource>(),
            pendingQueueCountSource = PendingQueueCountSource {
                offlineQueueRepo.getPendingCountFlow()
            },
            overrideSource = CheckinOverrideSource { eventId, zoneId, attendeeId ->
                attendeeRepository.submitOverride(
                    eventId,
                    com.idento.data.model.CreateCheckinOverrideRequestDto(
                        attendeeId = attendeeId,
                        context = "not_registered",
                        zoneId = zoneId,
                    ),
                ).let { result ->
                    when (result) {
                        is com.idento.data.network.ApiResult.Success -> com.idento.data.network.ApiResult.Success(Unit)
                        is com.idento.data.network.ApiResult.Error -> result
                        is com.idento.data.network.ApiResult.Loading -> com.idento.data.network.ApiResult.Loading
                    }
                }
            },
        )
    }
```

(`CheckinOverrideSource`'s return type is `ApiResult<Unit>` but `AttendeeRepository.submitOverride` returns `ApiResult<CheckinOverrideDto>` — the `.let { ... }` block above discards the DTO payload and maps to `ApiResult<Unit>`, matching the seam's simpler contract; `ZoneControlViewModel.onOverride` only checks success/failure, never reads override-record fields.)

- [ ] **Step 2: Run the full gate**

```bash
cd mobile/android-app
./gradlew :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:compileTestKotlinIosSimulatorArm64 :shared:testDebugUnitTest :shared:lintDebug :app:lintDebug
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 3: Commit**

```bash
git add mobile/shared/src/commonMain/kotlin/com/idento/di/ViewModelModule.kt
git commit -m "feat(mobile/di): wire ZoneControlViewModel into Koin"
```

---

### Task 10: Nav + Setup wiring — `Screen.ZoneControlHome`

**Files:**
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/navigation/Screen.kt`
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/navigation/IdentoNavHost.kt`
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/setup/SetupCompleteScreen.kt`
- Modify: `mobile/shared/src/commonTest/kotlin/com/idento/presentation/navigation/SetupStartDestinationTest.kt`

**Interfaces:**
- Consumes (Task 8): `ZoneControlScreen`.
- Produces: `Screen.ZoneControlHome` route, reachable both cold-start (`resolveStartDestination`) and warm-start (`SetupCompleteScreen` → `IdentoNavHost`'s `onNavigateToStation`).

- [ ] **Step 1: Add the route to `Screen.kt`**

In `Screen.kt`, after the `RegistrationHome` entry:

```kotlin
    // Registration mode (M1d) — screen shown on cold start when stationMode == REGISTRATION.
    data object RegistrationHome : Screen("registration_home")

    // Zone Control mode (M2) — screen shown on cold start when stationMode == ZONE_CONTROL.
    data object ZoneControlHome : Screen("zone_control_home")
```

- [ ] **Step 2: Update `resolveStartDestination` and register the composable in `IdentoNavHost.kt`**

Add the import:

```kotlin
import com.idento.presentation.zonecontrol.ZoneControlScreen
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
 * [Screen.ZoneControlHome]; all other modes (and the default null) fall back to
 * [Screen.SetupComplete] until M3 implements the Kiosk screen.
 */
fun resolveStartDestination(
    hasStationConfig: Boolean,
    isLoggedIn: Boolean,
    stationMode: StationMode? = null,
): String = when {
    !hasStationConfig || !isLoggedIn -> Screen.SetupLogin.route
    stationMode == StationMode.REGISTRATION -> Screen.RegistrationHome.route
    stationMode == StationMode.ZONE_CONTROL -> Screen.ZoneControlHome.route
    else -> Screen.SetupComplete.route
}
```

Update `SetupCompleteScreen`'s composable entry to route based on the configured mode instead of always going to `RegistrationHome`. Current:

```kotlin
        composable(Screen.SetupComplete.route) {
            SetupCompleteScreen(
                onExitStation = {
                    navController.navigate(Screen.SetupLogin.route) {
                        popUpTo(0) { inclusive = true }
                    }
                },
                onNavigateToStation = {
                    navController.navigate(Screen.RegistrationHome.route) {
                        popUpTo(0) { inclusive = true }
                    }
                },
            )
        }
```

Replace with — `SetupCompleteScreen` (Step 3 below) will call `onNavigateToStation` with the target route already resolved, since it has direct access to `uiState.stationConfig.mode`:

```kotlin
        composable(Screen.SetupComplete.route) {
            SetupCompleteScreen(
                onExitStation = {
                    navController.navigate(Screen.SetupLogin.route) {
                        popUpTo(0) { inclusive = true }
                    }
                },
                onNavigateToStation = { route ->
                    navController.navigate(route) {
                        popUpTo(0) { inclusive = true }
                    }
                },
            )
        }
```

Add the new composable route registration after `RegistrationHome`'s:

```kotlin
        composable(Screen.RegistrationHome.route) {
            RegistrationHomeScreen()
        }

        composable(Screen.ZoneControlHome.route) {
            ZoneControlScreen()
        }
```

- [ ] **Step 3: Update `SetupCompleteScreen.kt`'s mode branch**

Change the `onNavigateToStation` parameter type from a no-arg callback to one that takes the resolved route, and branch on both modes. Current:

```kotlin
@Composable
fun SetupCompleteScreen(
    viewModel: SetupCompleteViewModel = koinInject(),
    onExitStation: () -> Unit = {},
    onNavigateToStation: () -> Unit = {},
) {
```

Replace with:

```kotlin
@Composable
fun SetupCompleteScreen(
    viewModel: SetupCompleteViewModel = koinInject(),
    onExitStation: () -> Unit = {},
    onNavigateToStation: (route: String) -> Unit = {},
) {
```

Current mode-branch `LaunchedEffect`:

```kotlin
    LaunchedEffect(uiState.stationConfig) {
        val config = uiState.stationConfig ?: return@LaunchedEffect
        if (config.mode == StationMode.REGISTRATION) {
            onNavigateToStation()
        }
    }
```

Replace with:

```kotlin
    LaunchedEffect(uiState.stationConfig) {
        val config = uiState.stationConfig ?: return@LaunchedEffect
        when (config.mode) {
            StationMode.REGISTRATION -> onNavigateToStation(com.idento.presentation.navigation.Screen.RegistrationHome.route)
            StationMode.ZONE_CONTROL -> onNavigateToStation(com.idento.presentation.navigation.Screen.ZoneControlHome.route)
            StationMode.KIOSK -> Unit // M3 — stays on SetupComplete until the Kiosk screen exists.
        }
    }
```

(Using the fully-qualified `com.idento.presentation.navigation.Screen` reference inline rather than adding an import avoids a potential circular-import concern between `presentation.setup` and `presentation.navigation` — check whether `presentation.navigation` already imports anything from `presentation.setup` before deciding; if not, a normal top-of-file `import com.idento.presentation.navigation.Screen` is cleaner and preferred. `IdentoNavHost.kt` already imports `com.idento.presentation.setup.SetupCompleteScreen`, so `presentation.setup` → `presentation.navigation` is a new edge; Kotlin permits it fine either way, this is a style choice — prefer the top-of-file import for readability unless the build reports a genuine cycle, which Kotlin/Gradle would surface as a compile error, not a silent issue.)

- [ ] **Step 4: Update `SetupStartDestinationTest.kt`**

Replace the `ZONE_CONTROL` half of `startsAtSetupCompleteForNonRegistrationModes` with its own test asserting the new route, and rename the remaining test to reflect it now only covers `KIOSK`. Current:

```kotlin
    @Test
    fun startsAtSetupCompleteForNonRegistrationModes() {
        // ZONE_CONTROL and KIOSK still go to SetupComplete until M2/M3 implement their screens.
        assertEquals(
            Screen.SetupComplete.route,
            resolveStartDestination(hasStationConfig = true, isLoggedIn = true, stationMode = StationMode.ZONE_CONTROL),
        )
        assertEquals(
            Screen.SetupComplete.route,
            resolveStartDestination(hasStationConfig = true, isLoggedIn = true, stationMode = StationMode.KIOSK),
        )
    }
```

Replace with:

```kotlin
    @Test
    fun startsAtZoneControlHomeWhenZoneControlModeConfigured() {
        // M2: ZONE_CONTROL-mode station cold-starts directly at ZoneControlScreen.
        assertEquals(
            Screen.ZoneControlHome.route,
            resolveStartDestination(hasStationConfig = true, isLoggedIn = true, stationMode = StationMode.ZONE_CONTROL),
        )
    }

    @Test
    fun startsAtSetupCompleteForKioskMode() {
        // KIOSK still goes to SetupComplete until M3 implements the Kiosk screen.
        assertEquals(
            Screen.SetupComplete.route,
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
git commit -m "feat(mobile/nav): add Screen.ZoneControlHome + route ZONE_CONTROL-mode stations

Cold start: resolveStartDestination now routes ZONE_CONTROL directly
to ZoneControlScreen (was falling through to SetupComplete). Warm
start: SetupCompleteScreen's onNavigateToStation now takes a route
parameter and branches on the configured mode, since it must forward
to either RegistrationHome or ZoneControlHome depending on which mode
the wizard configured."
```

---

### Task 11: Final gate, summary doc, progress update

**Files:**
- Create: `docs/audit/mobile-redesign-m2-zone-control-summary.md`
- Modify: `.superpowers/sdd/progress.md`

**Interfaces:**
- Consumes: nothing new — this task verifies and documents everything built in Tasks 1–10.
- Produces: a summary doc for future sessions/PR description, matching the M1d precedent (`docs/audit/mobile-redesign-m1d-registration-screens-summary.md`).

- [ ] **Step 1: Run the complete verification gate**

```bash
cd mobile/android-app
./gradlew :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:compileTestKotlinIosSimulatorArm64 :shared:testDebugUnitTest :shared:lintDebug :app:lintDebug :app:assembleDebug
```

Expected: `BUILD SUCCESSFUL` — all 8 targets pass, including the final `:app:assembleDebug` (not run by intermediate tasks).

- [ ] **Step 2: Write the summary doc**

Create `docs/audit/mobile-redesign-m2-zone-control-summary.md` covering: what was built (ScanSource + Android/iOS actuals, MOBILE-BUG-04 fix, ZoneVerdictAdapter, ZoneControlViewModel/Screen, RegistrationHomeViewModel/Screen retrofit, nav wiring, deleted `zoneselect/`), the two documented deviations from the original design spec (onOverride doesn't re-scan; the 404-vs-LookupError mapping), and any backlog items surfaced during implementation (e.g. if a task's implementer found something worth flagging but out of scope — leave a placeholder section header "## Backlog" for the implementer to fill in if applicable, empty is fine if nothing came up).

- [ ] **Step 3: Update `.superpowers/sdd/progress.md`**

Append a new `=== MOBILE REDESIGN M2 ===` section (matching the existing M1d section's format) recording: branch name, plan file path, each task's completion status and commit SHA, and the final gate result. This file is git-ignored scratch — commit is not required for this file, but update it for session continuity per the established project convention.

- [ ] **Step 4: Commit the summary doc**

```bash
git add docs/audit/mobile-redesign-m2-zone-control-summary.md
git commit -m "docs: add M2 implementation summary"
```

---

## Post-plan: PR

After all 11 tasks pass and a final whole-branch review (per `superpowers:subagent-driven-development`) finds no blocking issues, push the branch and open a PR:

```bash
git push -u origin redesign/m2-zone-control
gh pr create --title "Mobile M2: Zone Control mode + hardware/BT scanner (MOBILE-BUG-04 fix)" --base main
```
