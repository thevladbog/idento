# Mobile Redesign M1b — Setup Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the station setup wizard (login via provisioning QR or manager email/password → 4-step config: Event → Mode → Day/Zone → Printer → Done) on top of the M1a foundation, with `StationConfig` now actually persisted and produced, and the app wired to restore a configured station on launch instead of always starting at Login.

**Architecture:** New `presentation/setup/` package (matching this codebase's existing `presentation/<feature>/` convention — the spec's aspirational `feature/setup/` package name is not used; see Global Constraints). Five new screens + ViewModels share an in-progress wizard draft through a single Koin-singleton `SetupWizardDraft` (plain mutable holder), since all existing ViewModels in this codebase are registered `factory { }` — a fresh instance per `koinInject()` call site — so nothing else survives across screen navigation. The finished `StationConfig` is persisted field-by-field in a new `StationConfigPreferences` (DataStore), following the exact pattern of the existing `AppPreferences`/`AuthPreferences`. `App.kt` gains a startup check: a persisted `StationConfig` + a valid stored token skips straight past Login/wizard into a placeholder "station home" screen; anything else starts the wizard.

**Tech Stack:** Same as M1a — Kotlin 2.3.21, Compose Multiplatform 1.11.1, Koin 4.0.0, Ktor 3.5.1, kotlinx-serialization 1.11.0, kotlinx-datetime 0.6.1, `androidx.datastore:datastore-preferences-core:1.1.1` (already a commonMain dependency).

## Global Constraints

- Package/file layout: new code goes under `mobile/shared/src/commonMain/kotlin/com/idento/presentation/setup/` (one file per screen + one file per ViewModel, matching every existing feature package in this codebase, e.g. `presentation/login/`, `presentation/events/`). Do **not** introduce the spec's `designsystem/`/`domain/`/`feature/` top-level package restructuring (§3 of the spec) — that would require moving every existing file and is out of scope; this plan only adds new files in the existing structure.
- Existing screens/ViewModels/theme files anywhere in `:shared` must not be modified except where a task below explicitly names a file to modify (`App.kt`, `IdentoNavHost.kt`, `Screen.kt`, `AppModule.kt`, `ViewModelModule.kt`, `Strings.kt`). The three dormant pre-M1a screens (`DaySelectScreen`/`ZoneSelectScreen`/`ZoneQRScannerViewModel`) are **not** reused or touched — they target the old per-staff-assignment zone contract and are unrelated to this wizard (confirmed by research; left dormant for M4 cleanup, same as M1a's dormant Android files).
- No runtime-configurable "server URL" field anywhere in this plan (explicit user decision, 2026-07-11): the manager login path is email + password only, against the already-resolved build-time base URL (`resolveBaseUrl`/`isDebugBuild`, unchanged). Revisit only once the separate dual-distribution on-prem initiative defines how mobile should target an on-prem instance.
- All new user-facing strings go through the existing `StringKey`/`Strings.kt` i18n system (English + Russian, both required for every key — see Task 2's completeness test). No hardcoded literal UI strings in any new Composable.
- All new screens are built from the M1a reusable components (`presentation/components/redesign/*`) and `DesignTokens.kt` — no new ad-hoc styling primitives. Reference exact component signatures from Task briefs; do not guess at APIs.
- `StationConfig`, `StationMode`, `PrinterConfig` (`data/model/StationConfig.kt`) are unchanged from their M1a-shipped shape — this plan is the first real *producer* and *consumer* of that model, not a redesign of it. In particular `dayDate` stays `String?` (ISO `"YYYY-MM-DD"`), not `kotlinx.datetime.LocalDate?` as the spec's illustrative code block shows — an intentional, already-shipped deviation (consistent with every other date field in this codebase, e.g. `Event.startDate`/`endDate`, also `String`).
- Backend contract is frozen (Phase B, already merged, already verified field-for-field in M1a) — no backend changes in this plan. `StationRepository`/`StationApiService`/`StationDtos.kt` are consumed as-is.
- Workpoint (`workPointId`/`workPointName`) is always chosen from `ZoneRepository.getStaffZones(eventId)` (`List<EventZoneWithStats>`), filtered by `isRegistrationZone` per mode (see Task 6) — no new backend endpoint. `getStaffZones` already returns *all* zones for admin/manager-role JWTs and only assigned zones for plain staff-role JWTs (server-side, `GetAvailableZones` handler) — this plan relies on that existing behavior, it is not reimplemented client-side.
- Every new suspend network-facing function that wraps a Ktor call must rethrow `CancellationException` (use the existing `com.idento.data.network.apiRunCatching` helper from `ApiResult.kt`, not bare `runCatching`) — this plan only adds calls to already-`apiRunCatching`-wrapped repository/service methods, so no new instances of the old bug are introduced, but any *new* wrapper written in this plan must use `apiRunCatching`.
- Verification gate for every task (run from `mobile/android-app`): `./gradlew :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:compileTestKotlinIosSimulatorArm64 :shared:testDebugUnitTest :shared:lintDebug` — **both** `:app:lintDebug` and `:shared:lintDebug` must be run (a prior session found `:app:lintDebug` alone does not exercise `:shared`'s own lint error gate; see project memory `mobile-toolchain-ceiling`). Final task additionally runs `:app:assembleDebug` and `:app:lintDebug`.

---

### Task 1: `StationConfig` persistence + shared wizard draft

**Files:**
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/data/preferences/StationConfigPreferences.kt`
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/setup/SetupWizardDraft.kt`
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/data/storage/DataStoreFactory.kt` (add one new `DataStoreNames` constant)
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/di/AppModule.kt` (register both new classes)
- Test: `mobile/shared/src/commonTest/kotlin/com/idento/presentation/setup/SetupWizardDraftTest.kt`

**Interfaces:**
- Consumes: `DataStoreFactory`/`DataStoreNames` (`data/storage/DataStoreFactory.kt`), `StationConfig`/`StationMode`/`PrinterConfig` (`data/model/StationConfig.kt`, unchanged).
- Produces (used by every later task in this plan):
  - `class StationConfigPreferences(dataStoreFactory: DataStoreFactory)` with:
    - `val stationConfig: Flow<StationConfig?>`
    - `suspend fun save(config: StationConfig)`
    - `suspend fun clear()` (for "Выйти со станции" / Exit station)
  - `class SetupWizardDraft` (plain mutable holder, Koin `single`) with a public mutable `var` per field needed to accumulate the wizard's in-progress state, plus:
    - `fun reset()` — clears every field back to its initial empty state (called when entering the Login step fresh).
    - `fun toStationConfig(deviceNumber: Int, staffName: String): StationConfig` — builds the final `StationConfig` once all required fields are set; throws `IllegalStateException` with a descriptive message if a required field for the current `mode` is missing (this is the "pure validation logic" this task's test covers).

- [ ] **Step 1: Add the DataStore file-name constant**

In `mobile/shared/src/commonMain/kotlin/com/idento/data/storage/DataStoreFactory.kt`, add one line to the existing `DataStoreNames` object (do not touch anything else in the file):

```kotlin
object DataStoreNames {
    const val AUTH = "auth_preferences"
    const val APP_SETTINGS = "app_settings"
    const val PRINTER = "printer_settings"
    const val SCANNER = "scanner_settings"
    const val CHECKIN = "checkin_preferences"
    const val DISPLAY_TEMPLATES = "display_templates"
    const val STATION_CONFIG = "station_config"
}
```

- [ ] **Step 2: Write the failing test for `SetupWizardDraft.toStationConfig`**

```kotlin
package com.idento.presentation.setup

import com.idento.data.model.PrinterConfig
import com.idento.data.model.StationMode
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class SetupWizardDraftTest {

    @Test
    fun toStationConfigBuildsRegistrationConfigWithPrinter() {
        val draft = SetupWizardDraft()
        draft.eventId = "evt-1"
        draft.eventName = "Технопром-2026"
        draft.mode = StationMode.REGISTRATION
        draft.dayDate = "2026-07-10"
        draft.workPointId = "zone-1"
        draft.workPointName = "Главный вход"
        draft.printer = PrinterConfig(name = "Zebra ZD421", transport = "bluetooth", address = "00:11:22:33:44:55")
        draft.autoPrint = true

        val config = draft.toStationConfig(deviceNumber = 3, staffName = "staff@idento.app")

        assertEquals("evt-1", config.eventId)
        assertEquals(StationMode.REGISTRATION, config.mode)
        assertEquals("2026-07-10", config.dayDate)
        assertEquals("zone-1", config.workPointId)
        assertEquals(true, config.autoPrint)
        assertEquals(3, config.deviceNumber)
        assertEquals("staff@idento.app", config.staffName)
    }

    @Test
    fun toStationConfigAllowsNullDayForKiosk() {
        val draft = SetupWizardDraft()
        draft.eventId = "evt-1"
        draft.eventName = "Технопром-2026"
        draft.mode = StationMode.KIOSK
        draft.dayDate = null
        draft.workPointId = "zone-2"
        draft.workPointName = "Регистрация — Холл"
        draft.printer = PrinterConfig(name = "Zebra ZD421", transport = "ethernet", address = "192.168.1.50:9100")
        draft.autoPrint = true

        val config = draft.toStationConfig(deviceNumber = 7, staffName = "kiosk@idento.app")
        assertEquals(null, config.dayDate)
    }

    @Test
    fun toStationConfigAllowsNullPrinterForZoneControl() {
        val draft = SetupWizardDraft()
        draft.eventId = "evt-1"
        draft.eventName = "Технопром-2026"
        draft.mode = StationMode.ZONE_CONTROL
        draft.dayDate = "2026-07-10"
        draft.workPointId = "zone-3"
        draft.workPointName = "Зона «Конференция»"
        draft.printer = null
        draft.autoPrint = false

        val config = draft.toStationConfig(deviceNumber = 5, staffName = "staff2@idento.app")
        assertEquals(null, config.printer)
    }

    @Test
    fun toStationConfigRejectsMissingDayForNonKioskModes() {
        val draft = SetupWizardDraft()
        draft.eventId = "evt-1"
        draft.eventName = "Технопром-2026"
        draft.mode = StationMode.REGISTRATION
        draft.dayDate = null // missing — required for REGISTRATION/ZONE_CONTROL
        draft.workPointId = "zone-1"
        draft.workPointName = "Главный вход"
        draft.printer = null
        draft.autoPrint = false

        assertFailsWith<IllegalStateException> {
            draft.toStationConfig(deviceNumber = 1, staffName = "staff@idento.app")
        }
    }

    @Test
    fun toStationConfigRejectsMissingWorkPoint() {
        val draft = SetupWizardDraft()
        draft.eventId = "evt-1"
        draft.eventName = "Технопром-2026"
        draft.mode = StationMode.KIOSK
        draft.workPointId = "" // missing
        draft.workPointName = ""

        assertFailsWith<IllegalStateException> {
            draft.toStationConfig(deviceNumber = 1, staffName = "staff@idento.app")
        }
    }

    @Test
    fun resetClearsEveryField() {
        val draft = SetupWizardDraft()
        draft.eventId = "evt-1"
        draft.mode = StationMode.KIOSK
        draft.reset()
        assertEquals("", draft.eventId)
        assertEquals(null, draft.mode)
    }
}
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `./gradlew :shared:testDebugUnitTest --tests "com.idento.presentation.setup.SetupWizardDraftTest"` from `mobile/android-app`.
Expected: FAIL — `SetupWizardDraft` does not exist yet (compile error).

- [ ] **Step 4: Implement `SetupWizardDraft`**

```kotlin
package com.idento.presentation.setup

import com.idento.data.model.PrinterConfig
import com.idento.data.model.StationConfig
import com.idento.data.model.StationMode

/**
 * In-progress wizard state, shared across the five setup screens. A single Koin instance
 * (see AppModule.kt) — every ViewModel in this codebase is Koin `factory`-scoped (a fresh
 * instance per `koinInject()` call site), so this plain holder is what actually survives
 * navigation between the wizard's screens.
 */
class SetupWizardDraft {
    var eventId: String = ""
    var eventName: String = ""
    var mode: StationMode? = null
    var dayDate: String? = null
    var workPointId: String = ""
    var workPointName: String = ""
    var printer: PrinterConfig? = null
    var autoPrint: Boolean = false

    fun reset() {
        eventId = ""
        eventName = ""
        mode = null
        dayDate = null
        workPointId = ""
        workPointName = ""
        printer = null
        autoPrint = false
    }

    /**
     * Builds the final [StationConfig] once the wizard reaches "Готово". [deviceNumber] and
     * [staffName] come from the provisioning response (StationRepository.provisionStation),
     * not from this draft — they're issued by the backend, not chosen by the user.
     */
    fun toStationConfig(deviceNumber: Int, staffName: String): StationConfig {
        val mode = checkNotNull(mode) { "Cannot build StationConfig: mode not selected" }
        check(eventId.isNotBlank()) { "Cannot build StationConfig: eventId missing" }
        check(workPointId.isNotBlank()) { "Cannot build StationConfig: workPointId missing" }
        check(mode == StationMode.KIOSK || dayDate != null) {
            "Cannot build StationConfig: dayDate is required for $mode"
        }
        return StationConfig(
            eventId = eventId,
            eventName = eventName,
            mode = mode,
            dayDate = dayDate,
            workPointId = workPointId,
            workPointName = workPointName,
            printer = printer,
            autoPrint = autoPrint,
            deviceNumber = deviceNumber,
            staffName = staffName,
        )
    }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `./gradlew :shared:testDebugUnitTest --tests "com.idento.presentation.setup.SetupWizardDraftTest"` from `mobile/android-app`.
Expected: PASS (5/5).

- [ ] **Step 6: Implement `StationConfigPreferences`**

```kotlin
package com.idento.data.preferences

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import com.idento.data.model.PrinterConfig
import com.idento.data.model.StationConfig
import com.idento.data.model.StationMode
import com.idento.data.storage.DataStoreFactory
import com.idento.data.storage.DataStoreNames
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * Persists the wizard's finished [StationConfig] — one field per DataStore key, mirroring
 * AuthPreferences/AppPreferences (this codebase never stores a JSON blob in DataStore).
 * "Выйти со станции" (Exit station) calls [clear].
 */
class StationConfigPreferences(dataStoreFactory: DataStoreFactory) {

    private val dataStore: DataStore<Preferences> =
        dataStoreFactory.createDataStore(DataStoreNames.STATION_CONFIG)

    companion object {
        private val EVENT_ID = stringPreferencesKey("event_id")
        private val EVENT_NAME = stringPreferencesKey("event_name")
        private val MODE = stringPreferencesKey("mode")
        private val DAY_DATE = stringPreferencesKey("day_date")
        private val WORK_POINT_ID = stringPreferencesKey("work_point_id")
        private val WORK_POINT_NAME = stringPreferencesKey("work_point_name")
        private val PRINTER_NAME = stringPreferencesKey("printer_name")
        private val PRINTER_TRANSPORT = stringPreferencesKey("printer_transport")
        private val PRINTER_ADDRESS = stringPreferencesKey("printer_address")
        private val AUTO_PRINT = booleanPreferencesKey("auto_print")
        private val DEVICE_NUMBER = intPreferencesKey("device_number")
        private val STAFF_NAME = stringPreferencesKey("staff_name")
    }

    val stationConfig: Flow<StationConfig?> = dataStore.data.map { prefs ->
        val eventId = prefs[EVENT_ID] ?: return@map null
        val modeName = prefs[MODE] ?: return@map null
        val mode = runCatching { StationMode.valueOf(modeName) }.getOrNull() ?: return@map null
        val printerName = prefs[PRINTER_NAME]
        val printer = if (printerName != null) {
            PrinterConfig(
                name = printerName,
                transport = prefs[PRINTER_TRANSPORT] ?: "",
                address = prefs[PRINTER_ADDRESS] ?: "",
            )
        } else {
            null
        }
        StationConfig(
            eventId = eventId,
            eventName = prefs[EVENT_NAME] ?: "",
            mode = mode,
            dayDate = prefs[DAY_DATE],
            workPointId = prefs[WORK_POINT_ID] ?: "",
            workPointName = prefs[WORK_POINT_NAME] ?: "",
            printer = printer,
            autoPrint = prefs[AUTO_PRINT] ?: false,
            deviceNumber = prefs[DEVICE_NUMBER] ?: 0,
            staffName = prefs[STAFF_NAME] ?: "",
        )
    }

    suspend fun save(config: StationConfig) {
        dataStore.edit { prefs ->
            prefs[EVENT_ID] = config.eventId
            prefs[EVENT_NAME] = config.eventName
            prefs[MODE] = config.mode.name
            if (config.dayDate != null) prefs[DAY_DATE] = config.dayDate else prefs.remove(DAY_DATE)
            prefs[WORK_POINT_ID] = config.workPointId
            prefs[WORK_POINT_NAME] = config.workPointName
            if (config.printer != null) {
                prefs[PRINTER_NAME] = config.printer.name
                prefs[PRINTER_TRANSPORT] = config.printer.transport
                prefs[PRINTER_ADDRESS] = config.printer.address
            } else {
                prefs.remove(PRINTER_NAME)
                prefs.remove(PRINTER_TRANSPORT)
                prefs.remove(PRINTER_ADDRESS)
            }
            prefs[AUTO_PRINT] = config.autoPrint
            prefs[DEVICE_NUMBER] = config.deviceNumber
            prefs[STAFF_NAME] = config.staffName
        }
    }

    suspend fun clear() {
        dataStore.edit { it.clear() }
    }
}
```

- [ ] **Step 7: Register both classes in Koin**

In `mobile/shared/src/commonMain/kotlin/com/idento/di/AppModule.kt`, add these two lines next to the other `single { AuthPreferences(get(), get()) }` / `single { DisplayTemplatePreferences(get()) }` registrations (same block, same style):

```kotlin
single { StationConfigPreferences(get()) }
single { SetupWizardDraft() }
```

Add the matching imports:
```kotlin
import com.idento.data.preferences.StationConfigPreferences
import com.idento.presentation.setup.SetupWizardDraft
```

- [ ] **Step 8: Run the full test suite and verify gate**

Run: `./gradlew :shared:testDebugUnitTest :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:lintDebug` from `mobile/android-app`.
Expected: all PASS/BUILD SUCCESSFUL; no lint errors.

- [ ] **Step 9: Commit**

```bash
git add mobile/shared/src/commonMain/kotlin/com/idento/data/preferences/StationConfigPreferences.kt \
        mobile/shared/src/commonMain/kotlin/com/idento/presentation/setup/SetupWizardDraft.kt \
        mobile/shared/src/commonMain/kotlin/com/idento/data/storage/DataStoreFactory.kt \
        mobile/shared/src/commonMain/kotlin/com/idento/di/AppModule.kt \
        mobile/shared/src/commonTest/kotlin/com/idento/presentation/setup/SetupWizardDraftTest.kt
git commit -m "feat(mobile): StationConfig persistence + shared setup-wizard draft state"
```

---

### Task 2: i18n completeness test + all M1b wizard strings

**Files:**
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/data/localization/Strings.kt` (add ~40 new `StringKey` entries + EN/RU values — no other file in this task)
- Test: `mobile/shared/src/commonTest/kotlin/com/idento/data/localization/StringsCompletenessTest.kt`

**Interfaces:**
- Produces: every `StringKey` entry named in Step 4 below (these exact names are what Tasks 3–8 reference — do not rename them when consuming).

- [ ] **Step 1: Write the failing completeness test**

This test protects the i18n system going forward — it currently should PASS against the existing keys (proving it's a meaningful regression test), so run it once before adding any new keys to confirm that, then again after Step 4.

```kotlin
package com.idento.data.localization

import kotlin.test.Test
import kotlin.test.assertTrue

class StringsCompletenessTest {

    @Test
    fun everyStringKeyHasBothEnglishAndRussianEntries() {
        val missingEnglish = StringKey.entries.filterNot { englishStrings.containsKey(it) }
        val missingRussian = StringKey.entries.filterNot { russianStrings.containsKey(it) }
        assertTrue(
            missingEnglish.isEmpty() && missingRussian.isEmpty(),
            "Missing English: $missingEnglish\nMissing Russian: $missingRussian"
        )
    }
}
```

- [ ] **Step 2: Run it — confirm it currently passes against existing keys**

Run: `./gradlew :shared:testDebugUnitTest --tests "com.idento.data.localization.StringsCompletenessTest"` from `mobile/android-app`.
Expected: PASS. (If it fails here, that's a pre-existing gap unrelated to this plan — stop and report rather than proceeding, since Step 4 assumes a clean baseline.)

- [ ] **Step 3: Temporarily add one key to only one map, confirm the test catches it**

Add `SETUP_TEMP_CHECK` to the `StringKey` enum and to `englishStrings` only (not `russianStrings`), run the test, confirm it FAILS naming `SETUP_TEMP_CHECK` under "Missing Russian". Then remove `SETUP_TEMP_CHECK` from both the enum and the map again before continuing — this step exists purely to prove the test is load-bearing, not to ship a temp key.

- [ ] **Step 4: Add every new `StringKey` (both language maps) for the wizard**

Add these entries to the `StringKey` enum (`Strings.kt`, after the existing last entry — check the file for its current last key and append there) and to both `englishStrings`/`russianStrings` maps:

```kotlin
// Setup wizard — Login
SETUP_LOGIN_TITLE,               // "Set up this station" / "Настройка станции"
SETUP_LOGIN_SCAN_QR,             // "Scan staff QR" / "Сканировать QR персонала"
SETUP_LOGIN_SCAN_HINT,           // "Point camera at the provisioning QR code" / "Наведите камеру на QR-код провижининга"
SETUP_LOGIN_MANAGER_TOGGLE,      // "Sign in as manager instead" / "Войти как менеджер"
SETUP_LOGIN_BACK_TO_QR,          // "Scan QR instead" / "Сканировать QR вместо этого"
SETUP_LOGIN_PROVISIONING,        // "Setting up station…" / "Настраиваем станцию…"
SETUP_LOGIN_ERROR_INVALID_TOKEN, // "This QR code is invalid or expired" / "QR-код недействителен или устарел"
SETUP_LOGIN_ERROR_GENERIC,       // "Could not set up this station" / "Не удалось настроить станцию"

// Setup wizard — Event (step 1/4)
SETUP_STEP_EVENT_LABEL,          // "1/4 Event" / "1/4 Событие"
SETUP_STEP_EVENT_TITLE,          // "Choose an event" / "Выберите событие"
SETUP_STEP_EVENT_EMPTY,          // "No events available" / "Нет доступных событий"

// Setup wizard — Mode (step 2/4)
SETUP_STEP_MODE_LABEL,           // "2/4 Mode" / "2/4 Режим"
SETUP_STEP_MODE_TITLE,           // "Choose a station mode" / "Выберите режим станции"
SETUP_MODE_REGISTRATION_NAME,    // "Registration" / "Регистрация"
SETUP_MODE_REGISTRATION_DESC,    // "Scan attendees in at the entrance and print badges" / "Отмечайте участников на входе и печатайте бейджи"
SETUP_MODE_ZONE_CONTROL_NAME,    // "Zone control" / "Контроль зоны"
SETUP_MODE_ZONE_CONTROL_DESC,    // "Check access into a specific zone, no printing" / "Проверяйте допуск в зону, без печати"
SETUP_MODE_KIOSK_NAME,           // "Kiosk" / "Киоск"
SETUP_MODE_KIOSK_DESC,           // "Self-service check-in for attendees" / "Самостоятельная регистрация участников"

// Setup wizard — Day & zone (step 3/4)
SETUP_STEP_DAYZONE_LABEL,        // "3/4 Day & zone" / "3/4 День и зона"
SETUP_STEP_DAYZONE_TITLE,        // "Choose a day and work point" / "Выберите день и точку"
SETUP_STEP_WORKPOINT_ONLY_TITLE, // "Choose a registration point" / "Выберите точку регистрации"
SETUP_WORKPOINT_EMPTY,           // "No work points available for your account" / "Нет доступных точек для вашей учётной записи"

// Setup wizard — Printer (step 4/4)
SETUP_STEP_PRINTER_LABEL,        // "4/4 Printer" / "4/4 Принтер"
SETUP_STEP_PRINTER_TITLE,        // "Set up a printer" / "Настройте принтер"
SETUP_PRINTER_TAB_BLUETOOTH,     // "Bluetooth" / "Bluetooth"
SETUP_PRINTER_TAB_ETHERNET,      // "Ethernet" / "Ethernet"
SETUP_PRINTER_TAB_QR,            // "QR code" / "QR-код"
SETUP_PRINTER_ETHERNET_IP_LABEL, // "Printer IP address" / "IP-адрес принтера"
SETUP_PRINTER_ETHERNET_PORT_LABEL, // "Port" / "Порт"
SETUP_PRINTER_QR_HINT,           // "Scan the QR code printed on the printer" / "Отсканируйте QR-код на корпусе принтера"
SETUP_PRINTER_NONE_PAIRED,       // "No paired Bluetooth printers" / "Нет сопряжённых Bluetooth-принтеров"
SETUP_PRINTER_TEST_PRINT,        // "Test print" / "Пробная печать"
SETUP_PRINTER_TEST_PRINT_SENT,   // "Test page sent" / "Тестовая страница отправлена"
SETUP_PRINTER_TEST_PRINT_FAILED, // "Test print failed" / "Не удалось выполнить пробную печать"
SETUP_PRINTER_AUTOPRINT_TOGGLE,  // "Auto-print on check-in" / "Автопечать при чек-ине"

// Setup wizard — Done / station home
SETUP_DONE_TITLE,                // "Done — to scanner" / "Готово — к сканеру"
SETUP_STATION_HOME_DEVICE,       // "Device #{n}" / "Устройство №{n}" (uses the "{n}" placeholder convention from OFFLINE_QUEUED_TEMPLATE)
SETUP_EXIT_STATION,              // "Exit station" / "Выйти со станции"
SETUP_EXIT_STATION_CONFIRM_TITLE,   // "Exit this station?" / "Выйти со станции?"
SETUP_EXIT_STATION_CONFIRM_BODY,    // "You'll need to set it up again to use it" / "Понадобится настроить её заново"

// Setup wizard — shared wizard chrome
SETUP_WIZARD_BACK,               // "Back" / "Назад"
SETUP_WIZARD_CONTINUE,           // "Continue" / "Продолжить"
```

(Exact English/Russian copy is up to the implementer within the meaning given in the comments above — this is translated UI copy, not a literal contract like an API field name. Keep both languages natural, not machine-translated word salad.)

- [ ] **Step 5: Run the completeness test again — must pass with the new keys included**

Run: `./gradlew :shared:testDebugUnitTest --tests "com.idento.data.localization.StringsCompletenessTest"` from `mobile/android-app`.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mobile/shared/src/commonMain/kotlin/com/idento/data/localization/Strings.kt \
        mobile/shared/src/commonTest/kotlin/com/idento/data/localization/StringsCompletenessTest.kt
git commit -m "feat(mobile): i18n completeness test + all M1b setup-wizard strings"
```

---

### Task 3: `SetupLoginScreen` + `SetupLoginViewModel`

**Files:**
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/setup/SetupLoginScreen.kt`
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/setup/SetupLoginViewModel.kt`
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/di/ViewModelModule.kt` (register `SetupLoginViewModel`)
- Test: `mobile/shared/src/commonTest/kotlin/com/idento/presentation/setup/SetupLoginViewModelTest.kt`

**Interfaces:**
- Consumes: `CameraService` (`platform/camera/CameraService.kt`, `expect class` with `startScanning(): Flow<String>`, `stopScanning()`, `hasCameraPermission(): Boolean`), `StationRepository` (`createProvisioningToken(eventId, staffUserId): ApiResult<CreateProvisioningTokenResponseDto>`, `provisionStation(token, deviceInfo): ApiResult<ProvisionStationResponseDto>`), `AuthRepository` (existing `login(email, password): ApiResult<LoginResponse>` — read the file to confirm the exact method name/signature before use, do not guess), `AuthPreferences.saveAuthToken(token): Boolean`, `SetupWizardDraft` (Task 1).
- Produces: `SetupLoginViewModel.uiState: StateFlow<SetupLoginUiState>` with a `nextStep: NextStep?` field the screen reads to navigate — `NextStep.Event` (manager path, event not yet chosen) or `NextStep.Mode` (QR path, event already fixed by the token) — Task 4 and Task 5's screens are the two possible destinations from here.

Two convergent paths, both ending by populating `SetupWizardDraft.eventId`/`eventName` and calling `AuthPreferences.saveAuthToken`:

1. **QR path** (default): `CameraService.startScanning()` emits a token string → `StationRepository.provisionStation(token, deviceInfo = null)` directly (event already fixed by the token the manager generated on the web console for this specific event) → on success, save `staffJwt`, set draft's `eventId`/`eventName` from the response's `stationConfig` subset, `nextStep = NextStep.Mode` (skip the Event step entirely).
2. **Manager path** (toggle): email + password fields → `AuthRepository.login(email, password)` (existing, unchanged call) → on success, `nextStep = NextStep.Event` (Task 4's screen will pick the event, then call `createProvisioningToken`+`provisionStation` itself for the now-known event — see Task 4).

- [ ] **Step 1: Read `AuthRepository.kt` and `AuthApiService.login` to confirm exact signatures**

Before writing any code, read `mobile/shared/src/commonMain/kotlin/com/idento/data/repository/AuthRepository.kt` in full and confirm the exact method name/signature for email+password login (likely `suspend fun login(email: String, password: String): ApiResult<LoginResponse>`, but confirm — do not guess). Use whatever the real signature is in the steps below.

- [ ] **Step 2: Write the failing ViewModel test (QR path)**

```kotlin
package com.idento.presentation.setup

import com.idento.data.model.CreateProvisioningTokenResponseDto
import com.idento.data.model.ProvisionStationResponseDto
import com.idento.data.model.ProvisionedStationConfigDto
import com.idento.data.network.ApiResult
import com.idento.data.repository.AuthRepository
import com.idento.data.repository.StationRepository
import com.idento.data.preferences.AuthPreferences
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class SetupLoginViewModelTest {

    private class FakeCameraService(private val tokens: Flow<String>) {
        fun startScanning(): Flow<String> = tokens
        fun stopScanning() {}
        fun hasCameraPermission(): Boolean = true
    }

    @Test
    fun scanningAValidTokenProvisionsTheStationAndSkipsToModeStep() = runTest {
        val response = ProvisionStationResponseDto(
            stationConfig = ProvisionedStationConfigDto(eventId = "evt-1", eventName = "Технопром-2026", staffName = "staff@idento.app"),
            staffJwt = "jwt-token",
            deviceNumber = 3,
        )
        val draft = SetupWizardDraft()
        val viewModel = SetupLoginViewModel(
            stationRepository = FakeStationRepository(provisionResult = ApiResult.Success(response)),
            authRepository = FakeAuthRepository(),
            authPreferences = FakeAuthPreferences(),
            draft = draft,
        )

        viewModel.onQrTokenScanned("provisioning-token-abc")
        // (advance test dispatcher per this codebase's existing ViewModel test conventions — see StationRepositoryTest.kt for the exact pattern used)

        assertEquals("evt-1", draft.eventId)
        assertEquals(NextStep.Mode, viewModel.uiState.value.nextStep)
    }

    @Test
    fun invalidTokenSurfacesAnError() = runTest {
        val draft = SetupWizardDraft()
        val viewModel = SetupLoginViewModel(
            stationRepository = FakeStationRepository(provisionResult = ApiResult.Error(RuntimeException("Invalid or expired token"), "Invalid or expired token")),
            authRepository = FakeAuthRepository(),
            authPreferences = FakeAuthPreferences(),
            draft = draft,
        )

        viewModel.onQrTokenScanned("bad-token")

        assertTrue(viewModel.uiState.value.error != null)
        assertEquals(null, viewModel.uiState.value.nextStep)
    }
}
```

Note: write `FakeStationRepository`/`FakeAuthRepository`/`FakeAuthPreferences` as small local fakes in the same test file (matching the exact fake-style already used in `StationRepositoryTest.kt` — read that file first and copy its fake-construction pattern precisely, including whatever test-dispatcher/`runTest` conventions it uses, rather than inventing a new style).

- [ ] **Step 3: Run test, verify it fails** (class doesn't exist)

- [ ] **Step 4: Implement `SetupLoginViewModel`**

```kotlin
package com.idento.presentation.setup

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.idento.data.network.ApiResult
import com.idento.data.preferences.AuthPreferences
import com.idento.data.repository.AuthRepository
import com.idento.data.repository.StationRepository
import com.idento.platform.camera.CameraService
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

enum class NextStep { Event, Mode }

data class SetupLoginUiState(
    val isManagerMode: Boolean = false,
    val email: String = "",
    val password: String = "",
    val isLoading: Boolean = false,
    val error: String? = null,
    val nextStep: NextStep? = null,
)

class SetupLoginViewModel(
    private val cameraService: CameraService,
    private val stationRepository: StationRepository,
    private val authRepository: AuthRepository,
    private val authPreferences: AuthPreferences,
    private val draft: SetupWizardDraft,
) : ViewModel() {

    private val _uiState = MutableStateFlow(SetupLoginUiState())
    val uiState: StateFlow<SetupLoginUiState> = _uiState.asStateFlow()

    private val exceptionHandler = CoroutineExceptionHandler { _, throwable ->
        _uiState.value = _uiState.value.copy(isLoading = false, error = throwable.message ?: "Unknown error")
    }

    init {
        draft.reset()
    }

    fun startQrScan() {
        if (!cameraService.hasCameraPermission()) return
        viewModelScope.launch(exceptionHandler) {
            cameraService.startScanning().collect { token ->
                cameraService.stopScanning()
                onQrTokenScanned(token)
            }
        }
    }

    fun toggleManagerMode() {
        _uiState.value = _uiState.value.copy(isManagerMode = !_uiState.value.isManagerMode, error = null)
    }

    fun onEmailChanged(value: String) {
        _uiState.value = _uiState.value.copy(email = value, error = null)
    }

    fun onPasswordChanged(value: String) {
        _uiState.value = _uiState.value.copy(password = value, error = null)
    }

    fun onQrTokenScanned(token: String) {
        _uiState.value = _uiState.value.copy(isLoading = true, error = null)
        viewModelScope.launch(exceptionHandler) {
            when (val result = stationRepository.provisionStation(token, deviceInfo = null)) {
                is ApiResult.Success -> applyProvisioning(result.data, nextStep = NextStep.Mode)
                is ApiResult.Error -> _uiState.value = _uiState.value.copy(isLoading = false, error = result.message ?: "Could not set up this station")
                is ApiResult.Loading -> {}
            }
        }
    }

    fun signInAsManager() {
        val email = _uiState.value.email
        val password = _uiState.value.password
        _uiState.value = _uiState.value.copy(isLoading = true, error = null)
        viewModelScope.launch(exceptionHandler) {
            when (val result = authRepository.login(email, password)) {
                is ApiResult.Success -> {
                    authPreferences.saveAuthToken(result.data.token)
                    _uiState.value = _uiState.value.copy(isLoading = false, nextStep = NextStep.Event)
                }
                is ApiResult.Error -> _uiState.value = _uiState.value.copy(isLoading = false, error = result.message ?: "Sign-in failed")
                is ApiResult.Loading -> {}
            }
        }
    }

    private suspend fun applyProvisioning(
        response: com.idento.data.model.ProvisionStationResponseDto,
        nextStep: NextStep,
    ) {
        authPreferences.saveAuthToken(response.staffJwt)
        draft.eventId = response.stationConfig.eventId
        draft.eventName = response.stationConfig.eventName
        deviceNumberHolder = response.deviceNumber
        staffNameHolder = response.stationConfig.staffName
        _uiState.value = _uiState.value.copy(isLoading = false, nextStep = nextStep)
    }

    // Carried forward to the final "Готово" step (Task 8) via the draft's companion fields —
    // see Task 8 for how deviceNumber/staffName reach StationConfigPreferences.save(...).
    companion object {
        var deviceNumberHolder: Int = 0
        var staffNameHolder: String = ""
    }
}
```

**Note on `deviceNumberHolder`/`staffNameHolder`:** confirm with a fresh read of `SetupWizardDraft` (Task 1) whether it's cleaner to add `deviceNumber: Int` and `staffName: String` as real mutable fields on `SetupWizardDraft` itself (populated here, read in Task 8) instead of the companion-object pattern sketched above — the companion-object approach is NOT idiomatic and is written this way only to keep this task's diff self-contained; the implementer should prefer adding two fields to `SetupWizardDraft` (`deviceNumber: Int = 0`, `staffName: String = ""`) and updating `toStationConfig()` to read them directly instead of taking them as parameters. If changing `SetupWizardDraft`'s public signature this way, update Task 1's already-committed `toStationConfig(deviceNumber, staffName)` call sites accordingly (there are none yet outside this task at this point in the plan, so this is a same-PR, pre-merge adjustment, not a breaking change to shipped code) and update `SetupWizardDraftTest.kt` to set `draft.deviceNumber`/`draft.staffName` directly instead of passing them as arguments. Do this now rather than carrying the companion-object workaround forward.

- [ ] **Step 5: Run test, verify it passes**

- [ ] **Step 6: Build `SetupLoginScreen`** using `IdentoColors`/`IdentoSpacing`/`IdentoTypeScale` (`presentation/theme/DesignTokens.kt`) and `ScanReticle` (`presentation/components/redesign/ScanReticle.kt`, `ScanReticle(modifier, size: Dp = 260.dp)`) for the QR-scan viewfinder frame, `ActionStack` for the primary/secondary buttons, and `Strings.kt`'s new `SETUP_LOGIN_*` keys (Task 2) for all copy. Two sub-layouts driven by `uiState.isManagerMode`:
  - `false` (default): `ScanReticle` + `SETUP_LOGIN_SCAN_HINT` text + an `ActionStack` with primary "—" (scanning starts automatically via `LaunchedEffect(Unit) { viewModel.startQrScan() }`) and secondary = `SETUP_LOGIN_MANAGER_TOGGLE` → `viewModel.toggleManagerMode()`.
  - `true`: two text fields (email/password, reuse the existing `IdentoTextField` composable from `presentation/components/IdentoTextField.kt` — read its exact signature first) + `ActionStack(primary = ActionButtonSpec(Strings.get(StringKey.SIGN_IN), onClick = viewModel::signInAsManager), secondary = ActionButtonSpec(Strings.get(StringKey.SETUP_LOGIN_BACK_TO_QR), onClick = viewModel::toggleManagerMode))`.
  - Handle `uiState.nextStep` with a `LaunchedEffect(uiState.nextStep)` that calls the screen's `onNavigateToEvent`/`onNavigateToMode` callback params (wired in Task 9's nav graph) exactly once (guard against re-firing on recomposition, matching how other screens in this codebase call navigation callbacks from `LaunchedEffect`).

- [ ] **Step 7: Register in Koin**

`mobile/shared/src/commonMain/kotlin/com/idento/di/ViewModelModule.kt`, add:
```kotlin
factory { SetupLoginViewModel(get(), get(), get(), get(), get()) }
```
with the matching import.

- [ ] **Step 8: Run full gate + commit**

```bash
git add mobile/shared/src/commonMain/kotlin/com/idento/presentation/setup/SetupLoginScreen.kt \
        mobile/shared/src/commonMain/kotlin/com/idento/presentation/setup/SetupLoginViewModel.kt \
        mobile/shared/src/commonMain/kotlin/com/idento/presentation/setup/SetupWizardDraft.kt \
        mobile/shared/src/commonMain/kotlin/com/idento/di/ViewModelModule.kt \
        mobile/shared/src/commonTest/kotlin/com/idento/presentation/setup/SetupLoginViewModelTest.kt \
        mobile/shared/src/commonTest/kotlin/com/idento/presentation/setup/SetupWizardDraftTest.kt
git commit -m "feat(mobile): setup-wizard login screen (QR provisioning + manager email/password)"
```

---

### Task 4: `SetupEventScreen` + `SetupEventViewModel` (step 1/4 — manager path only)

**Files:**
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/setup/SetupEventScreen.kt`
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/setup/SetupEventViewModel.kt`
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/di/ViewModelModule.kt`
- Test: `mobile/shared/src/commonTest/kotlin/com/idento/presentation/setup/SetupEventViewModelTest.kt`

**Interfaces:**
- Consumes: `EventRepository.getEvents(): ApiResult<List<Event>>`, `StationRepository.createProvisioningToken(eventId, staffUserId): ApiResult<CreateProvisioningTokenResponseDto>` + `.provisionStation(token, deviceInfo): ApiResult<ProvisionStationResponseDto>`, `AuthApiService.getMe()` or equivalent current-user lookup for `staffUserId` (read `AuthRepository`/`AuthApiService` first to find the exact already-existing method that returns the current user's id — do not add a new one), `SetupWizardDraft`.
- Produces: on event selection, this screen performs the SAME provisioning round-trip the QR path does (self-mint + redeem), then advances to `Screen.SetupMode` (Task 9's nav graph) — from this point on, both the QR path and the manager path have identical, converged state (`draft.eventId`/`eventName` set, `deviceNumber`/`staffName` known, `staffJwt` saved).

**Only reached via the manager-login path** (Task 3's `NextStep.Event`) — this screen is never shown for the QR path (event already fixed by the token).

- [ ] **Step 1: Confirmed current-user-id accessor (do not re-derive — use exactly this)**

`AuthRepository.getUserId(): String?` (`data/repository/AuthRepository.kt`) already reads the id persisted by `login()`'s own `authPreferences.saveUserInfo(userId = user.id, ...)` call. Since this screen is only ever reached after Task 3's `signInAsManager()` has already called `AuthRepository.login(email, password)` successfully, `authRepository.getUserId()` reliably returns the manager's own user id at this point — no new endpoint call, no `getMe()` round-trip needed.

- [ ] **Step 2: Write the failing test**

```kotlin
package com.idento.presentation.setup

import com.idento.data.model.Event
import com.idento.data.model.CreateProvisioningTokenResponseDto
import com.idento.data.model.ProvisionStationResponseDto
import com.idento.data.model.ProvisionedStationConfigDto
import com.idento.data.network.ApiResult
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals

class SetupEventViewModelTest {

    @Test
    fun selectingAnEventMintsAndRedeemsAProvisioningTokenForSelf() = runTest {
        val events = listOf(Event(id = "evt-1", name = "Технопром-2026", startDate = "2026-07-10", endDate = "2026-07-12"))
        val draft = SetupWizardDraft()
        val viewModel = SetupEventViewModel(
            eventRepository = FakeEventRepository(events = ApiResult.Success(events)),
            stationRepository = FakeStationRepository(
                createTokenResult = ApiResult.Success(CreateProvisioningTokenResponseDto(token = "tok-1", expiresAt = "2026-07-10T00:10:00Z")),
                provisionResult = ApiResult.Success(
                    ProvisionStationResponseDto(
                        stationConfig = ProvisionedStationConfigDto(eventId = "evt-1", eventName = "Технопром-2026", staffName = "manager@idento.app"),
                        staffJwt = "jwt-2",
                        deviceNumber = 9,
                    )
                ),
            ),
            authRepository = FakeAuthRepository(userId = "user-1"),
            draft = draft,
        )

        viewModel.loadEvents()
        viewModel.onEventSelected(events.first())

        assertEquals("evt-1", draft.eventId)
        assertEquals(true, viewModel.uiState.value.provisioned)
    }
}
```

(Same note as Task 3 Step 2: write local fakes matching `StationRepositoryTest.kt`'s exact fake style. `FakeAuthRepository`'s `getUserId()` returns the constructor-provided id directly.)

- [ ] **Step 3: Run test, verify it fails**

- [ ] **Step 4: Implement `SetupEventViewModel`**

```kotlin
package com.idento.presentation.setup

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.idento.data.model.Event
import com.idento.data.network.ApiResult
import com.idento.data.repository.AuthRepository
import com.idento.data.repository.EventRepository
import com.idento.data.repository.StationRepository
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class SetupEventUiState(
    val events: List<Event> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
    val provisioned: Boolean = false,
)

class SetupEventViewModel(
    private val eventRepository: EventRepository,
    private val stationRepository: StationRepository,
    private val authRepository: AuthRepository, // for the current user's id — see Step 1's confirmed accessor
    private val draft: SetupWizardDraft,
) : ViewModel() {

    private val _uiState = MutableStateFlow(SetupEventUiState())
    val uiState: StateFlow<SetupEventUiState> = _uiState.asStateFlow()

    private val exceptionHandler = CoroutineExceptionHandler { _, throwable ->
        _uiState.value = _uiState.value.copy(isLoading = false, error = throwable.message ?: "Unknown error")
    }

    fun loadEvents() {
        _uiState.value = _uiState.value.copy(isLoading = true, error = null)
        viewModelScope.launch(exceptionHandler) {
            when (val result = eventRepository.getEvents()) {
                is ApiResult.Success -> _uiState.value = _uiState.value.copy(isLoading = false, events = result.data)
                is ApiResult.Error -> _uiState.value = _uiState.value.copy(isLoading = false, error = result.message ?: "Could not load events")
                is ApiResult.Loading -> {}
            }
        }
    }

    fun onEventSelected(event: Event) {
        _uiState.value = _uiState.value.copy(isLoading = true, error = null)
        viewModelScope.launch(exceptionHandler) {
            val staffUserId = authRepository.getUserId()
            if (staffUserId == null) {
                _uiState.value = _uiState.value.copy(isLoading = false, error = "Not signed in")
                return@launch
            }
            when (val tokenResult = stationRepository.createProvisioningToken(event.id, staffUserId)) {
                is ApiResult.Success -> redeemToken(tokenResult.data.token)
                is ApiResult.Error -> _uiState.value = _uiState.value.copy(isLoading = false, error = tokenResult.message ?: "Could not provision this station")
                is ApiResult.Loading -> {}
            }
        }
    }

    private suspend fun redeemToken(token: String) {
        when (val result = stationRepository.provisionStation(token, deviceInfo = null)) {
            is ApiResult.Success -> {
                draft.eventId = result.data.stationConfig.eventId
                draft.eventName = result.data.stationConfig.eventName
                draft.deviceNumber = result.data.deviceNumber
                draft.staffName = result.data.stationConfig.staffName
                _uiState.value = _uiState.value.copy(isLoading = false, provisioned = true)
            }
            is ApiResult.Error -> _uiState.value = _uiState.value.copy(isLoading = false, error = result.message ?: "Could not provision this station")
            is ApiResult.Loading -> {}
        }
    }
}
```

This task assumes Task 3's `SetupWizardDraft.deviceNumber`/`staffName` field change is already in place (Task 3 Step 4's note) — `redeemToken` above writes to those fields directly.

- [ ] **Step 5: Run test, verify it passes**

- [ ] **Step 6: Build `SetupEventScreen`** using `SelectableCard` (`presentation/components/redesign/MiscComponents.kt`) for each event in a scrollable column, `SETUP_STEP_EVENT_LABEL`/`SETUP_STEP_EVENT_TITLE`/`SETUP_STEP_EVENT_EMPTY` copy, `LaunchedEffect(Unit) { viewModel.loadEvents() }`, and a `LaunchedEffect(uiState.provisioned)` that calls `onEventProvisioned()` (nav callback to Task 9's Mode step) exactly once when `true`.

- [ ] **Step 7: Register in Koin, run full gate, commit**

```bash
git add mobile/shared/src/commonMain/kotlin/com/idento/presentation/setup/SetupEventScreen.kt \
        mobile/shared/src/commonMain/kotlin/com/idento/presentation/setup/SetupEventViewModel.kt \
        mobile/shared/src/commonMain/kotlin/com/idento/presentation/setup/SetupWizardDraft.kt \
        mobile/shared/src/commonMain/kotlin/com/idento/di/ViewModelModule.kt \
        mobile/shared/src/commonTest/kotlin/com/idento/presentation/setup/SetupEventViewModelTest.kt
git commit -m "feat(mobile): setup-wizard event step (manager path — self-mint + redeem provisioning token)"
```

---

### Task 5: `SetupModeScreen` + `SetupModeViewModel` (step 2/4)

**Files:**
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/setup/SetupModeScreen.kt`
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/setup/SetupModeViewModel.kt`
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/di/ViewModelModule.kt`
- Test: `mobile/shared/src/commonTest/kotlin/com/idento/presentation/setup/SetupModeViewModelTest.kt`

**Interfaces:**
- Consumes: `SetupWizardDraft` only (no network calls — this step is pure local selection).
- Produces: `draft.mode` set; screen's `onContinue` callback (Task 9) navigates to `Screen.SetupDayZone`.

- [ ] **Step 1: Write the failing test**

```kotlin
package com.idento.presentation.setup

import com.idento.data.model.StationMode
import kotlin.test.Test
import kotlin.test.assertEquals

class SetupModeViewModelTest {

    @Test
    fun selectingAModeWritesItToTheDraft() {
        val draft = SetupWizardDraft()
        val viewModel = SetupModeViewModel(draft)

        viewModel.onModeSelected(StationMode.ZONE_CONTROL)

        assertEquals(StationMode.ZONE_CONTROL, draft.mode)
        assertEquals(StationMode.ZONE_CONTROL, viewModel.uiState.value.selectedMode)
    }
}
```

- [ ] **Step 2: Run test, verify it fails**

- [ ] **Step 3: Implement `SetupModeViewModel`**

```kotlin
package com.idento.presentation.setup

import androidx.lifecycle.ViewModel
import com.idento.data.model.StationMode
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class SetupModeUiState(val selectedMode: StationMode? = null)

class SetupModeViewModel(private val draft: SetupWizardDraft) : ViewModel() {

    private val _uiState = MutableStateFlow(SetupModeUiState(selectedMode = draft.mode))
    val uiState: StateFlow<SetupModeUiState> = _uiState.asStateFlow()

    fun onModeSelected(mode: StationMode) {
        draft.mode = mode
        _uiState.value = SetupModeUiState(selectedMode = mode)
    }
}
```

- [ ] **Step 4: Run test, verify it passes**

- [ ] **Step 5: Build `SetupModeScreen`** — three `SelectableCard`s (Registration/ZoneControl/Kiosk), each showing name (`SETUP_MODE_*_NAME`) + description (`SETUP_MODE_*_DESC`), `selected = uiState.selectedMode == StationMode.X`. `ActionStack` primary = `SETUP_WIZARD_CONTINUE`, disabled (`onClick` no-ops) while `uiState.selectedMode == null`.

- [ ] **Step 6: Register in Koin, run full gate, commit**

```bash
git add mobile/shared/src/commonMain/kotlin/com/idento/presentation/setup/SetupModeScreen.kt \
        mobile/shared/src/commonMain/kotlin/com/idento/presentation/setup/SetupModeViewModel.kt \
        mobile/shared/src/commonMain/kotlin/com/idento/di/ViewModelModule.kt \
        mobile/shared/src/commonTest/kotlin/com/idento/presentation/setup/SetupModeViewModelTest.kt
git commit -m "feat(mobile): setup-wizard mode step (2/4)"
```

---

### Task 6: `SetupDayZoneScreen` + `SetupDayZoneViewModel` (step 3/4, mode-branching)

**Files:**
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/setup/SetupDayZoneScreen.kt`
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/setup/SetupDayZoneViewModel.kt`
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/di/ViewModelModule.kt`
- Test: `mobile/shared/src/commonTest/kotlin/com/idento/presentation/setup/SetupDayZoneViewModelTest.kt`

**Interfaces:**
- Consumes: `EventRepository.getEvent(eventId): ApiResult<Event>` (for `startDate`/`endDate`) + `ZoneRepository.getEventDays(startDate, endDate): List<String>` (pure, already exists) for the day pills; `ZoneRepository.getStaffZones(eventId): ApiResult<List<EventZoneWithStats>>` for the work-point list, filtered by `isRegistrationZone` (see below); `SetupWizardDraft`.
- Produces: `draft.dayDate` (null for KIOSK) + `draft.workPointId`/`workPointName` set; screen's `onContinue` navigates to `Screen.SetupPrinter` UNLESS `draft.mode == StationMode.ZONE_CONTROL`, in which case it skips straight to the "Готово" step (Task 8) — per spec §6.3 branching rule "Контроль зоны пропускает шаг «Принтер»".

**Mode branching (exact rule, from spec §6.3):**
- `StationMode.KIOSK`: day pills are NOT shown at all ("Киоск вместо дня/зоны — только точка регистрации"); only the work-point picker, filtered to `isRegistrationZone == true`.
- `StationMode.REGISTRATION`: day pills + work-point picker filtered to `isRegistrationZone == true` ("вход").
- `StationMode.ZONE_CONTROL`: day pills + work-point picker showing all zones (any zone can be "controlled", including non-registration ones).

- [ ] **Step 1: Write the failing test**

```kotlin
package com.idento.presentation.setup

import com.idento.data.model.Event
import com.idento.data.model.EventZoneWithStats
import com.idento.data.model.StationMode
import com.idento.data.network.ApiResult
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class SetupDayZoneViewModelTest {

    private fun zone(id: String, isRegistration: Boolean) = EventZoneWithStats(
        id = id, eventId = "evt-1", name = "Zone $id", zoneType = "general", orderIndex = 0,
        isRegistrationZone = isRegistration, isActive = true,
    )

    @Test
    fun kioskModeSkipsDayPillsAndFiltersToRegistrationZonesOnly() = runTest {
        val draft = SetupWizardDraft().apply { eventId = "evt-1"; mode = StationMode.KIOSK }
        val zones = listOf(zone("z1", isRegistration = true), zone("z2", isRegistration = false))
        val viewModel = SetupDayZoneViewModel(
            eventRepository = FakeEventRepository(event = ApiResult.Success(Event(id = "evt-1", name = "E", startDate = "2026-07-10", endDate = "2026-07-12"))),
            zoneRepository = FakeZoneRepository(zones = ApiResult.Success(zones)),
            draft = draft,
        )

        viewModel.load()

        assertEquals(emptyList<String>(), viewModel.uiState.value.days) // no day pills for KIOSK
        assertEquals(listOf("z1"), viewModel.uiState.value.workPoints.map { it.id }) // registration-only
    }

    @Test
    fun zoneControlModeShowsDaysAndAllZones() = runTest {
        val draft = SetupWizardDraft().apply { eventId = "evt-1"; mode = StationMode.ZONE_CONTROL }
        val zones = listOf(zone("z1", isRegistration = true), zone("z2", isRegistration = false))
        val viewModel = SetupDayZoneViewModel(
            eventRepository = FakeEventRepository(event = ApiResult.Success(Event(id = "evt-1", name = "E", startDate = "2026-07-10", endDate = "2026-07-11"))),
            zoneRepository = FakeZoneRepository(zones = ApiResult.Success(zones)),
            draft = draft,
        )

        viewModel.load()

        assertTrue(viewModel.uiState.value.days.isNotEmpty())
        assertEquals(listOf("z1", "z2"), viewModel.uiState.value.workPoints.map { it.id })
    }

    @Test
    fun selectingDayAndWorkPointWritesToDraft() {
        val draft = SetupWizardDraft().apply { mode = StationMode.REGISTRATION }
        val viewModel = SetupDayZoneViewModel(FakeEventRepository(), FakeZoneRepository(), draft)

        viewModel.onDaySelected("2026-07-10")
        viewModel.onWorkPointSelected(id = "z1", name = "Главный вход")

        assertEquals("2026-07-10", draft.dayDate)
        assertEquals("z1", draft.workPointId)
        assertEquals("Главный вход", draft.workPointName)
    }
}
```

(As before: local fakes matching `StationRepositoryTest.kt`'s style; confirm `EventZoneWithStats`'s full constructor from `data/model/Zone.kt` — it has more required/defaulted fields than shown above, use the real ones.)

- [ ] **Step 2: Run test, verify it fails**

- [ ] **Step 3: Implement `SetupDayZoneViewModel`**

```kotlin
package com.idento.presentation.setup

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.idento.data.model.EventZoneWithStats
import com.idento.data.model.StationMode
import com.idento.data.network.ApiResult
import com.idento.data.repository.EventRepository
import com.idento.data.repository.ZoneRepository
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class SetupDayZoneUiState(
    val showDayPicker: Boolean = true,
    val days: List<String> = emptyList(),
    val selectedDay: String? = null,
    val workPoints: List<EventZoneWithStats> = emptyList(),
    val selectedWorkPointId: String? = null,
    val isLoading: Boolean = false,
    val error: String? = null,
)

class SetupDayZoneViewModel(
    private val eventRepository: EventRepository,
    private val zoneRepository: ZoneRepository,
    private val draft: SetupWizardDraft,
) : ViewModel() {

    private val _uiState = MutableStateFlow(SetupDayZoneUiState(showDayPicker = draft.mode != StationMode.KIOSK))
    val uiState: StateFlow<SetupDayZoneUiState> = _uiState.asStateFlow()

    private val exceptionHandler = CoroutineExceptionHandler { _, throwable ->
        _uiState.value = _uiState.value.copy(isLoading = false, error = throwable.message ?: "Unknown error")
    }

    fun load() {
        _uiState.value = _uiState.value.copy(isLoading = true, error = null)
        viewModelScope.launch(exceptionHandler) {
            val days = if (draft.mode == StationMode.KIOSK) {
                emptyList()
            } else {
                when (val eventResult = eventRepository.getEvent(draft.eventId)) {
                    is ApiResult.Success -> zoneRepository.getEventDays(
                        eventResult.data.startDate,
                        eventResult.data.endDate ?: eventResult.data.startDate,
                    )
                    is ApiResult.Error -> {
                        _uiState.value = _uiState.value.copy(isLoading = false, error = eventResult.message ?: "Could not load event")
                        return@launch
                    }
                    is ApiResult.Loading -> emptyList()
                }
            }

            when (val zonesResult = zoneRepository.getStaffZones(draft.eventId)) {
                is ApiResult.Success -> {
                    val filtered = if (draft.mode == StationMode.ZONE_CONTROL) {
                        zonesResult.data
                    } else {
                        zonesResult.data.filter { it.isRegistrationZone }
                    }
                    _uiState.value = _uiState.value.copy(isLoading = false, days = days, workPoints = filtered)
                }
                is ApiResult.Error -> _uiState.value = _uiState.value.copy(isLoading = false, error = zonesResult.message ?: "Could not load work points")
                is ApiResult.Loading -> {}
            }
        }
    }

    fun onDaySelected(day: String) {
        draft.dayDate = day
        _uiState.value = _uiState.value.copy(selectedDay = day)
    }

    fun onWorkPointSelected(id: String, name: String) {
        draft.workPointId = id
        draft.workPointName = name
        _uiState.value = _uiState.value.copy(selectedWorkPointId = id)
    }
}
```

- [ ] **Step 4: Run test, verify it passes**

- [ ] **Step 5: Build `SetupDayZoneScreen`** — day pills (a `Row` of pill-shaped `SelectableCard`-style chips, or reuse `FilterChips` from `presentation/components/redesign/FilterChips.kt` if its `FilterChipSpec(key, label, count)` shape fits a plain date-pill use case without a count — read that file to confirm before choosing between "reuse `FilterChips`" and "write a small local pill row", and only write new pill UI if `FilterChips` truly doesn't fit) shown only when `uiState.showDayPicker`; below that, a scrollable list of `SelectableCard`s for `uiState.workPoints`, title/subtitle per `SETUP_STEP_DAYZONE_TITLE` or `SETUP_STEP_WORKPOINT_ONLY_TITLE` (pick based on `uiState.showDayPicker`), empty state `SETUP_WORKPOINT_EMPTY`. `ActionStack` continue button navigates per the branching rule: `if (draft.mode == StationMode.ZONE_CONTROL) onNavigateToDone() else onNavigateToPrinter()` (both callbacks wired in Task 9).

- [ ] **Step 6: Register in Koin, run full gate, commit**

```bash
git add mobile/shared/src/commonMain/kotlin/com/idento/presentation/setup/SetupDayZoneScreen.kt \
        mobile/shared/src/commonMain/kotlin/com/idento/presentation/setup/SetupDayZoneViewModel.kt \
        mobile/shared/src/commonMain/kotlin/com/idento/di/ViewModelModule.kt \
        mobile/shared/src/commonTest/kotlin/com/idento/presentation/setup/SetupDayZoneViewModelTest.kt
git commit -m "feat(mobile): setup-wizard day+zone step (3/4), mode-branching (Kiosk skips days, Zone Control shows all zones)"
```

---

### Task 7: `SetupPrinterScreen` + `SetupPrinterViewModel` (step 4/4)

**Files:**
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/setup/SetupPrinterScreen.kt`
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/setup/SetupPrinterViewModel.kt`
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/di/ViewModelModule.kt`
- Test: `mobile/shared/src/commonTest/kotlin/com/idento/presentation/setup/SetupPrinterViewModelTest.kt`

**Interfaces:**
- Consumes: `BluetoothPrinterService` (`getPairedPrinters(): Result<List<BluetoothPrinterDevice>>`, `printTest(address): Result<Unit>`), `EthernetPrinterService` (`printTest(ip, port): Result<Unit>`), `CameraService` (for the QR-code printer-config tab — reuses the same `startScanning(): Flow<String>` already used in Task 3, this time expecting a JSON-encoded printer config rather than a provisioning token; if no such QR payload format currently exists anywhere in the codebase, encode/decode a minimal `{"name":"...","transport":"...","address":"..."}` matching `PrinterConfig`'s own `@Serializable` shape directly — do not invent a new DTO), `SetupWizardDraft`.
- Produces: `draft.printer`, `draft.autoPrint` set; screen's `onContinue` navigates to the "Готово" step (Task 8). **This screen is never reached for `StationMode.ZONE_CONTROL`** (Task 6 skips straight to Done for that mode) — no `ZONE_CONTROL` branch exists in this screen at all.

**Platform note (spec §7):** iOS has no Bluetooth printer transport ("только TCP:9100", "BT-SPP на iOS недоступен без MFi — принято дизайном"). Since `:shared`'s commonMain code cannot conditionally compile per-platform UI, hide the Bluetooth tab using `getPlatform()`-style runtime detection if one already exists in this codebase (grep for an existing `expect fun` that reports the current platform name/type before adding a new one), or default to showing all three tabs with the Bluetooth tab's pairing list simply always empty on iOS (`BluetoothPrinterService`'s iOS `actual` — check whether it already returns an empty list or an error on iOS; if it already fails gracefully, no special-casing is needed in this screen at all, only in the platform actuals which are out of scope for this plan). Confirm which is true before writing the screen, and prefer "no special UI casing" if the existing iOS actual already degrades safely.

- [ ] **Step 1: Confirm iOS `BluetoothPrinterService` behavior**

Read `mobile/shared/src/iosMain/kotlin/com/idento/platform/printer/PrinterService.ios.kt`'s `BluetoothPrinterService` actual. Report what `getPairedPrinters()`/`isBluetoothEnabled()` return on iOS (empty list vs. thrown error vs. something else) — this determines whether Step 6 needs any iOS-specific UI branching at all.

- [ ] **Step 2: Write the failing test**

```kotlin
package com.idento.presentation.setup

import com.idento.data.model.PrinterConfig
import kotlin.test.Test
import kotlin.test.assertEquals

class SetupPrinterViewModelTest {

    @Test
    fun selectingABluetoothPrinterWritesConfigToDraft() {
        val draft = SetupWizardDraft()
        val viewModel = SetupPrinterViewModel(
            bluetoothPrinterService = FakeBluetoothPrinterService(),
            ethernetPrinterService = FakeEthernetPrinterService(),
            draft = draft,
        )

        viewModel.onBluetoothPrinterSelected(name = "Zebra ZD421", address = "00:11:22:33:44:55")

        assertEquals(PrinterConfig(name = "Zebra ZD421", transport = "bluetooth", address = "00:11:22:33:44:55"), draft.printer)
    }

    @Test
    fun settingEthernetAddressWritesConfigToDraft() {
        val draft = SetupWizardDraft()
        val viewModel = SetupPrinterViewModel(FakeBluetoothPrinterService(), FakeEthernetPrinterService(), draft)

        viewModel.onEthernetAddressConfirmed(name = "Zebra ZD421", ip = "192.168.1.50", port = 9100)

        assertEquals(PrinterConfig(name = "Zebra ZD421", transport = "ethernet", address = "192.168.1.50:9100"), draft.printer)
    }

    @Test
    fun toggleAutoPrintWritesToDraft() {
        val draft = SetupWizardDraft()
        val viewModel = SetupPrinterViewModel(FakeBluetoothPrinterService(), FakeEthernetPrinterService(), draft)

        viewModel.onAutoPrintToggled(true)

        assertEquals(true, draft.autoPrint)
    }
}
```

- [ ] **Step 3: Run test, verify it fails**

- [ ] **Step 4: Implement `SetupPrinterViewModel`**

```kotlin
package com.idento.presentation.setup

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.idento.data.model.PrinterConfig
import com.idento.platform.printer.BluetoothPrinterDevice
import com.idento.platform.printer.BluetoothPrinterService
import com.idento.platform.printer.EthernetPrinterService
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class SetupPrinterUiState(
    val pairedPrinters: List<BluetoothPrinterDevice> = emptyList(),
    val autoPrint: Boolean = false,
    val testPrintResult: Boolean? = null, // null = not yet tried, true = sent, false = failed
    val isLoading: Boolean = false,
    val error: String? = null,
)

class SetupPrinterViewModel(
    private val bluetoothPrinterService: BluetoothPrinterService,
    private val ethernetPrinterService: EthernetPrinterService,
    private val draft: SetupWizardDraft,
) : ViewModel() {

    private val _uiState = MutableStateFlow(SetupPrinterUiState(autoPrint = draft.autoPrint))
    val uiState: StateFlow<SetupPrinterUiState> = _uiState.asStateFlow()

    private val exceptionHandler = CoroutineExceptionHandler { _, throwable ->
        _uiState.value = _uiState.value.copy(isLoading = false, error = throwable.message ?: "Unknown error")
    }

    fun loadPairedPrinters() {
        viewModelScope.launch(exceptionHandler) {
            bluetoothPrinterService.getPairedPrinters().onSuccess { devices ->
                _uiState.value = _uiState.value.copy(pairedPrinters = devices)
            }
        }
    }

    fun onBluetoothPrinterSelected(name: String, address: String) {
        draft.printer = PrinterConfig(name = name, transport = "bluetooth", address = address)
    }

    fun onEthernetAddressConfirmed(name: String, ip: String, port: Int) {
        draft.printer = PrinterConfig(name = name, transport = "ethernet", address = "$ip:$port")
    }

    fun onPrinterQrScanned(printerConfig: PrinterConfig) {
        draft.printer = printerConfig
    }

    fun onAutoPrintToggled(enabled: Boolean) {
        draft.autoPrint = enabled
        _uiState.value = _uiState.value.copy(autoPrint = enabled)
    }

    fun testPrint() {
        val printer = draft.printer ?: return
        _uiState.value = _uiState.value.copy(isLoading = true, testPrintResult = null)
        viewModelScope.launch(exceptionHandler) {
            val result = if (printer.transport == "bluetooth") {
                bluetoothPrinterService.printTest(printer.address)
            } else {
                val (ip, portText) = printer.address.split(":", limit = 2)
                ethernetPrinterService.printTest(ip, portText.toInt())
            }
            _uiState.value = _uiState.value.copy(isLoading = false, testPrintResult = result.isSuccess)
        }
    }
}
```

- [ ] **Step 5: Run test, verify it passes**

- [ ] **Step 6: Build `SetupPrinterScreen`** — three-tab layout (reuse `ModeSegmentedControl` from `presentation/components/redesign/ModeSegmentedControl.kt`, `options = listOf(Strings.get(StringKey.SETUP_PRINTER_TAB_BLUETOOTH), ..._TAB_ETHERNET, ..._TAB_QR)`) driven by local `remember { mutableStateOf(0) }` tab index; Bluetooth tab lists `uiState.pairedPrinters` as `SelectableCard`s (empty state `SETUP_PRINTER_NONE_PAIRED`), Ethernet tab has IP + port text fields (`IdentoTextField`) with a "confirm" action calling `onEthernetAddressConfirmed`, QR tab shows a `ScanReticle` + hint `SETUP_PRINTER_QR_HINT` wired to `CameraService.startScanning()` decoding a `PrinterConfig` JSON payload (per this task's Interfaces note); below the tabs, `IdentoToggle` for `SETUP_PRINTER_AUTOPRINT_TOGGLE` and a `SETUP_PRINTER_TEST_PRINT` button (disabled while `draft.printer == null`) showing `SETUP_PRINTER_TEST_PRINT_SENT`/`_FAILED` per `uiState.testPrintResult`. `ActionStack` continue → `onNavigateToDone()`.

- [ ] **Step 7: Register in Koin, run full gate, commit**

```bash
git add mobile/shared/src/commonMain/kotlin/com/idento/presentation/setup/SetupPrinterScreen.kt \
        mobile/shared/src/commonMain/kotlin/com/idento/presentation/setup/SetupPrinterViewModel.kt \
        mobile/shared/src/commonMain/kotlin/com/idento/di/ViewModelModule.kt \
        mobile/shared/src/commonTest/kotlin/com/idento/presentation/setup/SetupPrinterViewModelTest.kt
git commit -m "feat(mobile): setup-wizard printer step (4/4) — Bluetooth/Ethernet/QR tabs, autoprint, test print"
```

---

### Task 8: `SetupCompleteScreen` (station home placeholder) + "Выйти со станции"

**Files:**
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/setup/SetupCompleteScreen.kt`
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/setup/SetupCompleteViewModel.kt`
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/di/ViewModelModule.kt`
- Test: `mobile/shared/src/commonTest/kotlin/com/idento/presentation/setup/SetupCompleteViewModelTest.kt`

**Interfaces:**
- Consumes: `SetupWizardDraft.toStationConfig(...)` (Task 1), `StationConfigPreferences.save(config)`/`.clear()` (Task 1), `AuthPreferences.clearAuth()` (existing).
- Produces: the actual persisted `StationConfig` (this is where `Task 1`'s `save()` is finally called) and the app's real "station home" screen for M1b's purposes — later milestones (M1c Registration, M2 Zone Control, M3 Kiosk) will replace this with their own real mode-specific screens; this plan intentionally does not build those.

- [ ] **Step 1: Write the failing test**

```kotlin
package com.idento.presentation.setup

import com.idento.data.model.StationMode
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class SetupCompleteViewModelTest {

    @Test
    fun finishPersistsTheBuiltStationConfig() = runTest {
        val draft = SetupWizardDraft().apply {
            eventId = "evt-1"; eventName = "Технопром-2026"; mode = StationMode.KIOSK
            workPointId = "z1"; workPointName = "Холл"; deviceNumber = 4; staffName = "kiosk@idento.app"
        }
        val fakePreferences = FakeStationConfigPreferences()
        val viewModel = SetupCompleteViewModel(draft, fakePreferences, FakeAuthPreferences())

        viewModel.finish()

        assertEquals("evt-1", fakePreferences.saved?.eventId)
        assertTrue(viewModel.uiState.value.stationConfig != null)
    }

    @Test
    fun exitStationClearsPersistedConfigAndAuth() = runTest {
        val fakePreferences = FakeStationConfigPreferences()
        val fakeAuth = FakeAuthPreferences()
        val draft = SetupWizardDraft().apply {
            eventId = "evt-1"; mode = StationMode.KIOSK; workPointId = "z1"; workPointName = "Холл"
        }
        val viewModel = SetupCompleteViewModel(draft, fakePreferences, fakeAuth)
        viewModel.finish()

        viewModel.exitStation()

        assertTrue(fakePreferences.cleared)
        assertTrue(fakeAuth.authCleared)
    }
}
```

- [ ] **Step 2: Run test, verify it fails**

- [ ] **Step 3: Implement `SetupCompleteViewModel`**

```kotlin
package com.idento.presentation.setup

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.idento.data.model.StationConfig
import com.idento.data.preferences.AuthPreferences
import com.idento.data.preferences.StationConfigPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class SetupCompleteUiState(val stationConfig: StationConfig? = null, val exited: Boolean = false)

class SetupCompleteViewModel(
    private val draft: SetupWizardDraft,
    private val stationConfigPreferences: StationConfigPreferences,
    private val authPreferences: AuthPreferences,
) : ViewModel() {

    private val _uiState = MutableStateFlow(SetupCompleteUiState())
    val uiState: StateFlow<SetupCompleteUiState> = _uiState.asStateFlow()

    fun finish() {
        viewModelScope.launch {
            val config = draft.toStationConfig(deviceNumber = draft.deviceNumber, staffName = draft.staffName)
            stationConfigPreferences.save(config)
            draft.reset()
            _uiState.value = SetupCompleteUiState(stationConfig = config)
        }
    }

    fun exitStation() {
        viewModelScope.launch {
            stationConfigPreferences.clear()
            authPreferences.clearAuth()
            _uiState.value = _uiState.value.copy(exited = true)
        }
    }
}
```

(This assumes Task 3's suggested `SetupWizardDraft.deviceNumber`/`staffName` fields — reconfirm they exist with the exact names used here before writing this file.)

- [ ] **Step 4: Run test, verify it passes**

- [ ] **Step 5: Build `SetupCompleteScreen`** — `LaunchedEffect(Unit) { viewModel.finish() }` on entry; once `uiState.stationConfig != null`, show `StatusBar` (cells: mode, event, work point, device number) + `DetailTable` (rows: Event/Mode/Day/Work point/Printer/Auto-print, built from `uiState.stationConfig`'s fields) using `SETUP_STATION_HOME_DEVICE` for the device-number footer copy (interpolate `{n}` per the existing `OFFLINE_QUEUED_TEMPLATE`-style placeholder convention from M1a) + `SETUP_DONE_TITLE` as the screen's header; an outline "Выйти со станции" button (`SETUP_EXIT_STATION`) that shows a confirm dialog (`SETUP_EXIT_STATION_CONFIRM_TITLE`/`_BODY`) before calling `viewModel.exitStation()`; `LaunchedEffect(uiState.exited)` navigates back to `Screen.SetupLogin` (Task 9) when `true`, guarded against re-firing.

- [ ] **Step 6: Register in Koin, run full gate, commit**

```bash
git add mobile/shared/src/commonMain/kotlin/com/idento/presentation/setup/SetupCompleteScreen.kt \
        mobile/shared/src/commonMain/kotlin/com/idento/presentation/setup/SetupCompleteViewModel.kt \
        mobile/shared/src/commonMain/kotlin/com/idento/di/ViewModelModule.kt \
        mobile/shared/src/commonTest/kotlin/com/idento/presentation/setup/SetupCompleteViewModelTest.kt
git commit -m "feat(mobile): setup-wizard completion screen — persists StationConfig, wires Exit station"
```

---

### Task 9: Navigation graph + session-restore-on-launch

**Files:**
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/navigation/Screen.kt` (add `Screen.Setup*` routes)
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/presentation/navigation/IdentoNavHost.kt` (register the 5 new `composable(...)` blocks; wire all the navigation callbacks named in Tasks 3–8; add the session-restore start-destination logic)
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/App.kt` (compute the real start destination from `StationConfigPreferences`/`AuthPreferences` before calling `IdentoNavHost`)
- Test: `mobile/shared/src/commonTest/kotlin/com/idento/presentation/navigation/SetupStartDestinationTest.kt`

**Interfaces:**
- Consumes: every screen/ViewModel from Tasks 3–8; `StationConfigPreferences.stationConfig: Flow<StationConfig?>`, `AuthPreferences.isLoggedIn(): Boolean` (existing).
- Produces: the app's real entry point. This is the task that turns 6 previously-isolated screens into an actual working wizard flow.

- [ ] **Step 1: Add new routes to `Screen.kt`**

Append to the existing `sealed class Screen(val route: String)` (same file, same style — plain string routes, no path args needed since all wizard state lives in the shared `SetupWizardDraft`, not in nav args):

```kotlin
data object SetupLogin : Screen("setup_login")
data object SetupEvent : Screen("setup_event")
data object SetupMode : Screen("setup_mode")
data object SetupDayZone : Screen("setup_day_zone")
data object SetupPrinter : Screen("setup_printer")
data object SetupComplete : Screen("setup_complete")
```

- [ ] **Step 2: Write a pure test for the start-destination decision logic**

Extract the decision ("which route should the app start at?") into a small, pure, directly-testable function rather than burying it in a Composable:

```kotlin
package com.idento.presentation.navigation

import kotlin.test.Test
import kotlin.test.assertEquals

class SetupStartDestinationTest {

    @Test
    fun startsAtSetupLoginWhenNoStationConfigured() {
        assertEquals(Screen.SetupLogin.route, resolveStartDestination(hasStationConfig = false, isLoggedIn = false))
    }

    @Test
    fun startsAtSetupLoginWhenConfiguredButLoggedOut() {
        // token expired/revoked (spec §8: "Истечение/отзыв токена → на экран входа")
        assertEquals(Screen.SetupLogin.route, resolveStartDestination(hasStationConfig = true, isLoggedIn = false))
    }

    @Test
    fun startsAtSetupCompleteWhenFullyConfigured() {
        assertEquals(Screen.SetupComplete.route, resolveStartDestination(hasStationConfig = true, isLoggedIn = true))
    }
}
```

- [ ] **Step 3: Run test, verify it fails**

- [ ] **Step 4: Implement `resolveStartDestination`**

In `mobile/shared/src/commonMain/kotlin/com/idento/presentation/navigation/IdentoNavHost.kt` (top-level function, alongside the existing `IdentoNavHost` composable — do not put this inside the composable body, it must be plain and testable):

```kotlin
/**
 * Per spec §8: an expired/revoked token always routes back to Login, even if a StationConfig
 * is still persisted (queues survive and are re-delivered after signing back in — that's
 * SyncService's job, unrelated to this decision).
 */
fun resolveStartDestination(hasStationConfig: Boolean, isLoggedIn: Boolean): String =
    if (hasStationConfig && isLoggedIn) Screen.SetupComplete.route else Screen.SetupLogin.route
```

- [ ] **Step 5: Run test, verify it passes**

- [ ] **Step 6: Wire `App.kt` to compute the real start destination**

Read the current `App.kt` in full first (confirmed in research: it currently only loads `appPreferences.themeMode` in a `LaunchedEffect`, then calls `IdentoNavHost()` with no arguments). Add a startup check using `StationConfigPreferences.stationConfig` and `AuthPreferences.isLoggedIn()` (both already Koin-injectable via `koinInject()`, matching how `appPreferences` is already obtained in this file), compute the result of `resolveStartDestination(...)`, and pass it as `IdentoNavHost(startDestination = ...)` once resolved (show nothing / a blank surface while resolving, matching how the theme load is already handled — read the exact current loading-state pattern in `App.kt` and mirror it, do not invent a different one).

- [ ] **Step 7: Register the 5 new screens in `IdentoNavHost.kt`**

Add one `composable(Screen.X.route) { ... }` block per new screen (`SetupLogin`, `SetupEvent`, `SetupMode`, `SetupDayZone`, `SetupPrinter`, `SetupComplete` — 6 total), each instantiating its screen composable via `koinInject()` for the ViewModel (matching every existing `composable(...)` block's exact style in this file) and wiring the navigation callbacks named throughout Tasks 3–8:
- `SetupLogin`: `onNavigateToEvent = { navController.navigate(Screen.SetupEvent.route) }`, `onNavigateToMode = { navController.navigate(Screen.SetupMode.route) { popUpTo(Screen.SetupLogin.route) { inclusive = true } } }` (QR path skips Event — pop Login off the back stack so back-navigation from Mode doesn't return to a stale Login screen).
- `SetupEvent`: `onEventProvisioned = { navController.navigate(Screen.SetupMode.route) { popUpTo(Screen.SetupLogin.route) { inclusive = true } } }`.
- `SetupMode`: continue → `navController.navigate(Screen.SetupDayZone.route)`.
- `SetupDayZone`: continue → `navController.navigate(if (draft.mode == StationMode.ZONE_CONTROL) Screen.SetupComplete.route else Screen.SetupPrinter.route) { popUpTo(Screen.SetupLogin.route) { inclusive = false } }` — actually use plain `navController.navigate(...)` without `popUpTo` here (unlike the login step) since normal back-navigation through the wizard's own steps should work; only the Login→Event/Mode transition needed the back-stack pop (to prevent returning to a screen whose provisioning already happened). Inject `SetupWizardDraft` directly into `IdentoNavHost`'s scope (via `koinInject()`) to read `draft.mode` for this branch — do not duplicate the branching logic inside `SetupDayZoneViewModel` and here differently; the ViewModel's own `onContinue`/navigation-callback exposed to the screen should already encode this branch (revisit Task 6 Step 5's screen-level description: the screen itself decides `onNavigateToDone()` vs `onNavigateToPrinter()` based on `draft.mode`, so `IdentoNavHost` just wires both callbacks to their respective `navController.navigate(...)` calls, it does not re-derive the branch itself).
- `SetupPrinter`: continue → `navController.navigate(Screen.SetupComplete.route)`.
- `SetupComplete`: `LaunchedEffect(uiState.exited)` → `navController.navigate(Screen.SetupLogin.route) { popUpTo(0) { inclusive = true } }` (full stack clear — starting the wizard over from scratch).

- [ ] **Step 8: Run the full gate**

Run: `./gradlew :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:compileTestKotlinIosSimulatorArm64 :shared:testDebugUnitTest :shared:lintDebug` from `mobile/android-app`.
Expected: all PASS/BUILD SUCCESSFUL.

- [ ] **Step 9: Commit**

```bash
git add mobile/shared/src/commonMain/kotlin/com/idento/presentation/navigation/Screen.kt \
        mobile/shared/src/commonMain/kotlin/com/idento/presentation/navigation/IdentoNavHost.kt \
        mobile/shared/src/commonMain/kotlin/com/idento/App.kt \
        mobile/shared/src/commonTest/kotlin/com/idento/presentation/navigation/SetupStartDestinationTest.kt
git commit -m "feat(mobile): wire setup-wizard navigation graph + session-restore-on-launch"
```

---

### Task 10: Final verification + summary + PR

**Files:**
- Create: `docs/audit/mobile-redesign-m1b-setup-wizard-summary.md`

- [ ] **Step 1: Run the complete gate**

From `mobile/android-app`:
```bash
./gradlew :shared:compileDebugKotlinAndroid
./gradlew :shared:compileKotlinIosSimulatorArm64
./gradlew :shared:compileKotlinIosArm64
./gradlew :shared:compileTestKotlinIosSimulatorArm64
./gradlew :shared:testDebugUnitTest
./gradlew :shared:lintDebug
./gradlew :app:assembleDebug
./gradlew :app:lintDebug
```
All must pass. Record actual pass/fail and any warnings-count deltas vs. the M1a baseline (`docs/audit/mobile-redesign-m1a-foundation-summary.md`) in the summary doc.

- [ ] **Step 2: Manual smoke-check of the branching logic**

Since there's no UI test harness in this codebase (commonTest only, no Compose UI testing infra), manually trace through the code for each of the three modes and confirm the exact screen sequence matches spec §6.3:
- REGISTRATION: Login → (Event, manager path only) → Mode → DayZone (days + registration-zones-only) → Printer → Complete.
- ZONE_CONTROL: Login → (Event) → Mode → DayZone (days + all zones) → **Complete directly** (Printer skipped).
- KIOSK: Login → (Event) → Mode → DayZone (**no day pills**, registration-zones-only) → Printer → Complete.
Record this trace in the summary doc as explicit confirmation, not just "looks right".

- [ ] **Step 3: Write the summary doc**

Cover: what M1b added (mirror the M1a summary's table-per-task format), the two convergent login paths and why (QR fixes the event via the token; manager path picks one and self-provisions), the intentional `dayDate: String?` vs spec's `LocalDate?` deviation (carried over from M1a, reconfirmed here), the explicit decision to drop the runtime "server" field (with the date and reasoning), what `SetupCompleteScreen` is a placeholder for (M1c/M2/M3 will replace it with real mode home screens), and any gaps found during Step 1/2 (e.g. if the iOS Bluetooth-tab behavior from Task 7 Step 1 turned out to need special-casing after all, record what was actually done).

- [ ] **Step 4: Commit, push, open PR**

```bash
git add docs/audit/mobile-redesign-m1b-setup-wizard-summary.md
git commit -m "docs(audit): mobile M1b setup wizard summary"
git push -u origin redesign/m1b-setup-wizard
```
Open the PR against `main` with a summary mirroring M1a's PR description style (what changed, test plan checklist, explicit note on what's deferred to M1c/M2/M3).
