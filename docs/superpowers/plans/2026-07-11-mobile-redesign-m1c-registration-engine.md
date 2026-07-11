# Mobile Redesign M1c — Registration Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete data/service layer that Registration mode's screens will consume — verdict production from a scanned/entered code, idempotent check-in submission with conflict-safe "already checked in" detail, an offline queue for registration check-ins, a print queue with retry/backoff, ZPL special-character escaping, and a shared 3-second same-code debounce pipeline — fully unit-tested, with zero UI. The actual scan/search/list screens (spec §6.3 screens 3a/3c) are **out of scope for this plan** and become a follow-up milestone (M1d) built on top of this engine, mirroring how M1a (foundation) preceded M1b (wizard screens).

**Architecture:** New backend columns (`attendees.checked_in_device_number`, `attendees.checked_in_point_name`) populated by the existing idempotent batch-checkin write path, extended DTOs to carry a work-point name from the client's own `StationConfig`. A new `RegistrationCheckInService` (mobile/shared) that (1) looks up a scanned code via the existing `AttendeeRepository.getAttendeeByCode`, (2) infers a `RegistrationVerdict` from the attendee's own state (found/blocked/already-checked-in) without any write, and (3) on "proceed," submits via the existing `AttendeeRepository.submitBatchCheckins` (single-item batch, idempotent by `client_uuid`), re-fetching the attendee on a conflict response so the displayed already-checked-in detail is never stale. A new, independent offline queue (own SQLDelight table, own repository) for registration check-ins — built fresh rather than reworking the existing zone-check-in offline queue, which is hard-wired to a different repository and a different write path. A new print queue (own SQLDelight table, own repository) with retry/backoff, wired to the existing `BluetoothPrinterService`/`EthernetPrinterService` via the active `StationConfig.printer`. `SyncService` (currently dead code, registered in Koin but never started) is wired to actually run, driving both queues.

**Tech Stack:** Same as M1a/M1b — Kotlin 2.3.21, Koin 4.0.0, Ktor 3.5.1, kotlinx-serialization 1.11.0, kotlinx-datetime 0.6.1, SQLDelight 2.1.0. Backend: Go, existing `pg_store`/echo handler conventions from Phase B.

## Global Constraints

- **Backend changes are in scope for this milestone** (explicit user decision, 2026-07-11, made when this plan was being scoped): extending the `attendees` table with 2 nullable columns and the batch-checkin write path is approved. No other backend changes belong in this plan — everything else (auth, tenancy, other endpoints) is frozen, exactly as M1a/M1b treated the backend.
- **M1c is the engine only — no screens.** Spec §6.3's 3a (scan+verdicts) and 3c (search/list) screens, the `ModeSegmentedControl`/`VerdictBand`/`ListRow`/`FilterChips` UI wiring, and the `IdentoNavHost`/`SetupCompleteScreen` mode-branching to reach them, are all **M1d's job**, not this plan's. Every task in this plan produces `commonMain` service/repository classes and `commonTest` coverage — no new Composable screens.
- **Hardware scanner (spec §6.3 screen 3b) stays out of scope**, confirmed correctly deferred to M2 by the design spec's own phase table (§10: "M2: Контроль зоны + аппаратный/BT-сканер") — no `HardwareScanner` service exists yet, and this plan does not add one. The debounce pipeline this plan builds (Task 9) is deliberately source-agnostic (`Flow<String>` in, debounced `Flow<String>` out) so M2 can plug a hardware-scanner `Flow<String>` into the same pipeline later without changes here.
- **The old Login→Events→Checkin flow (`CheckinViewModel`, `AttendeeApiService.checkinAttendee` plain `PUT`) is not touched, not reused, and not extended.** Registration mode is built fresh against the idempotent batch-checkin contract (`POST /api/events/:event_id/checkins/batch`), per the design spec's explicit intent (§5.1 item 4) — the old plain-PUT endpoint has no idempotency and is being phased out.
- **The existing zone-check-in offline queue (`OfflineCheckInRepository`, `PendingCheckIn.sq`, `PendingZoneCheckIn`) is not modified.** It is hard-wired to `ZoneRepository.performZoneCheckIn` and belongs to Zone Control mode (M2), not Registration mode. This plan adds a **new, independent** SQLDelight table and repository for registration check-ins rather than generalizing the existing one — reworking shared, already-shipped, already-tested code for an unrelated mode is out of scope and risks regressing M2's future work.
- `RegistrationVerdict`/`VerdictAttendee`/`PrintState` (`data/model/RegistrationVerdict.kt`, shipped in M1a) are consumed exactly as shipped — this plan is their first real producer, not a redesign. Field names (`attendee`, not the spec's illustrative `a`) are unchanged.
- ZPL escaping (`\`, `^`, `~`) must be added to `BadgeTemplate.generateZPL` before this plan's print queue sends any ZPL to a real printer — per spec §5.2's explicit requirement and the existing WEB-SEC-02 escaping practice elsewhere in this codebase (reference that practice's exact character set, don't invent a different one).
- Every new suspend function wrapping a Ktor call must use the existing `apiRunCatching` helper (`data/network/ApiResult.kt`) — not bare `runCatching` — so coroutine cancellation propagates correctly (established M1a/M1b convention).
- **Testability seams**: every repository/service in this codebase that wraps a platform `expect`/`actual` singleton or the live Ktor `HttpClient` is a plain non-`open` class with zero mock-engine seam. Any new service/ViewModel-equivalent class in this plan that needs to be unit-tested against one of these must define a small local `fun interface`/interface seam (the established M1b pattern — one method per seam, adapted from the real class via Koin `single`/method-reference) rather than attempting to fake the concrete class directly.
- Verification gate for every task (run from `mobile/android-app`): `./gradlew :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:compileTestKotlinIosSimulatorArm64 :shared:testDebugUnitTest :shared:lintDebug` — both `:shared:lintDebug` and (for tasks touching `mobile/android-app`) `:app:lintDebug` must be run explicitly; `:app:lintDebug` alone does not exercise `:shared`'s own lint error gate (established M1a/M1b lesson, recorded in project memory `mobile-toolchain-ceiling`). Backend tasks additionally run `go test ./...` and `golangci-lint run` from `backend/`.

---

### Task 1: Backend — `attendees` migration + batch-checkin device/point persistence

**Files:**
- Create: `backend/migrations/000015_attendee_checkin_device_point.up.sql`
- Create: `backend/migrations/000015_attendee_checkin_device_point.down.sql`
- Modify: `backend/internal/models/models.go` (`Attendee` struct, `BatchCheckinItem` struct)
- Modify: `backend/internal/handler/checkins_batch.go` (`BatchCheckin` handler)
- Modify: `backend/internal/store/pg_store.go` (`ApplyBatchCheckin`, wherever it currently writes `checked_in_at`/`checked_in_by` — read the existing implementation first, extend the same write to also set the two new columns for `kind == "checkin"` only, not `zone_entry`)
- Modify: `backend/internal/store/interface.go` (if `ApplyBatchCheckin`'s signature needs the new `PointName` field — check whether it takes the whole `*models.BatchCheckinItem` already, in which case no interface signature change is needed)
- Test: `backend/internal/handler/checkins_batch_test.go` (extend existing tests, or create if none exist — read the file first)

**Interfaces:**
- Consumes: existing `attendees` table, existing `BatchCheckin` handler/`ApplyBatchCheckin` store method (read `backend/internal/store/pg_store.go`'s current `ApplyBatchCheckin` implementation in full before writing this task — the exact SQL/write pattern must be discovered, not guessed).
- Produces: `Attendee.CheckedInDeviceNumber *int json:"checked_in_device_number,omitempty"` and `Attendee.CheckedInPointName *string json:"checked_in_point_name,omitempty"` — read by Task 4/5's mobile-side attendee lookup and conflict re-fetch.

- [ ] **Step 1: Read the current `ApplyBatchCheckin` implementation**

Read `backend/internal/store/pg_store.go`'s `ApplyBatchCheckin` method in full (search for `func.*ApplyBatchCheckin`) to find the exact SQL statement(s) it runs for `kind == "checkin"` today (it currently sets `checkin_status`/`checked_in_at`/`checked_in_by` on the `attendees` row, and inserts into `batch_checkin_log` for the idempotency dedup — confirm the exact column list and statement structure before writing Step 3's migration/Step 4's extended write).

- [ ] **Step 2: Write the migration**

`backend/migrations/000015_attendee_checkin_device_point.up.sql`:
```sql
ALTER TABLE attendees ADD COLUMN IF NOT EXISTS checked_in_device_number INT;
ALTER TABLE attendees ADD COLUMN IF NOT EXISTS checked_in_point_name VARCHAR(120);
```

`backend/migrations/000015_attendee_checkin_device_point.down.sql`:
```sql
ALTER TABLE attendees DROP COLUMN IF EXISTS checked_in_device_number;
ALTER TABLE attendees DROP COLUMN IF EXISTS checked_in_point_name;
```

Run `go run ./cmd/migrate up` (or whatever this repo's existing migration-runner invocation is — check `backend/migrations/`'s existing README or a recent migration's own PR description for the exact command) against a local/test database to confirm the migration applies cleanly on top of all 14 existing migrations.

- [ ] **Step 3: Add `PointName` to `BatchCheckinItem` and the two new fields to `Attendee`**

In `backend/internal/models/models.go`, find `BatchCheckinItem` (the Go struct `BatchCheckin`'s handler binds request items into) and add:
```go
PointName *string `json:"point_name,omitempty"` // registration work-point name from the station's StationConfig; nil for kind=zone_entry
```

Find the `Attendee` struct (confirmed at `models.go:73-96` per current research) and add, alongside the existing `CheckedInBy`/`CheckedInByEmail` fields:
```go
CheckedInDeviceNumber *int    `json:"checked_in_device_number,omitempty"`
CheckedInPointName    *string `json:"checked_in_point_name,omitempty"`
```

- [ ] **Step 4: Extend `ApplyBatchCheckin`'s write to set the two new columns for `kind == "checkin"`**

Using the exact statement structure confirmed in Step 1, extend the `UPDATE attendees SET ...` (or equivalent) to also set `checked_in_device_number = $N, checked_in_point_name = $N` when `item.Kind == "checkin"` — using `item.DeviceNumber` (already present on every batch item) and `item.PointName` (new, from Step 3). For `kind == "zone_entry"`, leave both columns untouched (they're registration-specific; zone entries have their own separate tracking via `zone_scan_log`, unaffected by this plan).

- [ ] **Step 5: Write/extend the failing test**

Read `backend/internal/handler/checkins_batch_test.go` (or find wherever `BatchCheckin`'s existing tests live — search `_test.go` files for `BatchCheckin`) first to match its exact test-harness style (likely the Phase 2B `requireEventOwnership`/store-mock harness). Add a test case: submit a `kind=checkin` batch item with `device_number` and `point_name` set, then fetch the attendee and assert `CheckedInDeviceNumber`/`CheckedInPointName` match. Add a second case confirming a `kind=zone_entry` item does NOT set either field (regression guard for the "checkin only" rule in Step 4).

- [ ] **Step 6: Run test, verify it fails, implement, verify it passes**

Run: `cd backend && go test ./internal/handler/... ./internal/store/... -run TestBatchCheckin` (adjust the exact test names to whatever exists after Step 5).
Expected: FAIL before Step 4's implementation, PASS after.

- [ ] **Step 7: Run the full backend gate**

```bash
cd backend
go test ./...
golangci-lint run
gosec ./...
```
All must pass with no new findings.

- [ ] **Step 8: Commit**

```bash
git add backend/migrations/000015_attendee_checkin_device_point.up.sql \
        backend/migrations/000015_attendee_checkin_device_point.down.sql \
        backend/internal/models/models.go \
        backend/internal/handler/checkins_batch.go \
        backend/internal/store/pg_store.go \
        backend/internal/handler/checkins_batch_test.go
git commit -m "feat(backend): persist device/point on registration check-in for AlreadyChecked verdict detail"
```

---

### Task 2: Mobile DTOs — match the extended backend contract

**Files:**
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/data/model/CheckinDtos.kt` (`BatchCheckinItemDto`)
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/data/model/Attendee.kt` (`Attendee`)
- Test: `mobile/shared/src/commonTest/kotlin/com/idento/data/model/AttendeeCheckinFieldsTest.kt`

**Interfaces:**
- Consumes: Task 1's Go field names (`point_name`, `checked_in_device_number`, `checked_in_point_name`) — verify field-for-field against the actual merged Task 1 code, not this brief's guess, before writing `@SerialName` tags (this codebase's established M1a/M1b practice: cross-verify every new DTO field against the live Go struct).
- Produces: `Attendee.checkedInDeviceNumber: Int?`, `Attendee.checkedInPointName: String?` — read by Task 4 (verdict production) and Task 5 (conflict re-fetch).

- [ ] **Step 1: Extend `BatchCheckinItemDto`**

In `mobile/shared/src/commonMain/kotlin/com/idento/data/model/CheckinDtos.kt`, add to `BatchCheckinItemDto`:
```kotlin
@SerialName("point_name") val pointName: String? = null,
```
(Placed after `zoneId`, matching the Go struct's field order for readability — not load-bearing for serialization, just convention.)

- [ ] **Step 2: Extend `Attendee`**

In `mobile/shared/src/commonMain/kotlin/com/idento/data/model/Attendee.kt`, add alongside `checkedInBy`/`checkedInByEmail`:
```kotlin
@SerialName("checked_in_device_number") val checkedInDeviceNumber: Int? = null,
@SerialName("checked_in_point_name") val checkedInPointName: String? = null,
```

- [ ] **Step 3: Write a round-trip serialization test**

```kotlin
package com.idento.data.model

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals

class AttendeeCheckinFieldsTest {

    @Test
    fun decodesCheckedInDeviceNumberAndPointNameWhenPresent() {
        val json = """
            {
                "id": "att-1", "event_id": "evt-1", "first_name": "A", "last_name": "B",
                "code": "ABC-123", "checkin_status": true,
                "checked_in_device_number": 3, "checked_in_point_name": "Главный вход"
            }
        """.trimIndent()
        val attendee = Json { ignoreUnknownKeys = true }.decodeFromString(Attendee.serializer(), json)
        assertEquals(3, attendee.checkedInDeviceNumber)
        assertEquals("Главный вход", attendee.checkedInPointName)
    }

    @Test
    fun decodesNullWhenFieldsAbsent() {
        val json = """{"id": "att-1", "event_id": "evt-1", "first_name": "A", "last_name": "B", "code": "ABC-123"}"""
        val attendee = Json { ignoreUnknownKeys = true }.decodeFromString(Attendee.serializer(), json)
        assertEquals(null, attendee.checkedInDeviceNumber)
        assertEquals(null, attendee.checkedInPointName)
    }

    @Test
    fun batchCheckinItemDtoEncodesPointNameWhenSet() {
        val dto = BatchCheckinItemDto(
            clientUuid = "uuid-1", attendeeId = "att-1", at = "2026-07-11T10:00:00Z",
            deviceNumber = 3, kind = "checkin", pointName = "Главный вход",
        )
        val encoded = Json.encodeToString(BatchCheckinItemDto.serializer(), dto)
        assertEquals(true, encoded.contains("\"point_name\":\"Главный вход\""))
    }
}
```

- [ ] **Step 4: Run test, verify it fails (fields don't exist yet), implement, verify it passes**

- [ ] **Step 5: Run the full gate**

```bash
./gradlew :shared:testDebugUnitTest :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:lintDebug
```

- [ ] **Step 6: Commit**

```bash
git add mobile/shared/src/commonMain/kotlin/com/idento/data/model/CheckinDtos.kt \
        mobile/shared/src/commonMain/kotlin/com/idento/data/model/Attendee.kt \
        mobile/shared/src/commonTest/kotlin/com/idento/data/model/AttendeeCheckinFieldsTest.kt
git commit -m "feat(mobile): extend Attendee/BatchCheckinItemDto with device/point check-in detail"
```

---

### Task 3: ZPL special-character escaping in `BadgeTemplate.generateZPL`

**Files:**
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/data/model/BadgeTemplate.kt`
- Test: `mobile/shared/src/commonTest/kotlin/com/idento/data/model/BadgeTemplateZplEscapingTest.kt`

**Interfaces:**
- Consumes: nothing new.
- Produces: `generateZPL` output is now safe to send to a real printer even when attendee fields contain `\`, `^`, or `~` — read by Task 5 (check-in submission builds the print job from this) and Task 8 (print queue sends it as-is).

- [ ] **Step 1: Find this codebase's existing WEB-SEC-02 escaping practice**

Grep the whole repo for `WEB-SEC-02` (likely in `web/` or a security-audit doc under `docs/audit/`) to find the exact character-escaping convention already established elsewhere in this codebase (the M1a research confirmed this is referenced as an existing practice — find the actual prior instance rather than inventing a new escaping scheme). Match its exact escape-sequence choice (e.g. whether `\` becomes `\\5C` or a different ZPL-specific escape) if the found practice is ZPL-specific; if the found WEB-SEC-02 practice is for a different format (e.g. CSV), use it only as confirmation that "prefix with backslash, escape backslash first" is this codebase's general convention, and apply the correct ZPL-specific escape codes below regardless.

ZPL's `^` (format command prefix) and `~` (control command prefix) and `\` (escape character in `^FD` field-data blocks) are special when they appear inside `^FD...^FS` field-data blocks. The standard safe approach (Zebra ZPL II reference): escape a literal `\` as `\\`, and use the printer's configured "change caret"/"change tilde" commands is NOT the right approach for a shared multi-printer ZPL string (those commands are printer-state, not portable) — instead, escape `^` and `~` within field-data text by prefixing with `\` (ZPL treats `\^` and `\~` inside `^FD` blocks as literal characters, and `\\` as a literal backslash), which is the portable, no-printer-state-required approach. Implement exactly that: escape `\` → `\\`, `^` → `\^`, `~` → `\~`, and escape `\` FIRST (before the other two) so a literal `^` never accidentally becomes `\^` and then further escaped incorrectly.

- [ ] **Step 2: Write the failing test**

```kotlin
package com.idento.data.model

import kotlin.test.Test
import kotlin.test.assertEquals

class BadgeTemplateZplEscapingTest {

    private val attendee = Attendee(
        id = "att-1", eventId = "evt-1", code = "ABC-123",
        firstName = "O'Brien^Test", lastName = "Smith~Co",
        company = "A\\B Corp", position = null,
    )

    @Test
    fun escapesCaretTildeAndBackslashInFieldData() {
        val template = BadgeTemplate(zplTemplate = "^XA^FD{firstName} {lastName} {company}^FS^XZ")
        val zpl = template.generateZPL(attendee)
        assertEquals("^XA^FDO'Brien\\^Test Smith\\~Co A\\\\B Corp^FS^XZ", zpl)
    }

    @Test
    fun leavesPlainTextUnescaped() {
        val plain = attendee.copy(firstName = "John", lastName = "Doe", company = "Acme")
        val template = BadgeTemplate(zplTemplate = "^FD{firstName} {lastName} {company}^FS")
        assertEquals("^FDJohn Doe Acme^FS", template.generateZPL(plain))
    }
}
```

- [ ] **Step 2b: Run test, verify it fails**

- [ ] **Step 3: Implement the escaping**

In `BadgeTemplate.kt`, add a private escape function and apply it to every substituted value (not the template's own literal `^`/`~` command characters — only the attendee-derived substitution VALUES):

```kotlin
private fun escapeZpl(value: String): String =
    value.replace("\\", "\\\\").replace("^", "\\^").replace("~", "\\~")
```

Update `generateZPL` so every `.replace("{firstName}", attendee.firstName)`-style call wraps its replacement in `escapeZpl(...)`:
```kotlin
fun generateZPL(attendee: Attendee): String {
    var zpl = zplTemplate
    zpl = zpl.replace("{firstName}", escapeZpl(attendee.firstName))
    zpl = zpl.replace("{lastName}", escapeZpl(attendee.lastName))
    zpl = zpl.replace("{fullName}", escapeZpl(attendee.fullName))
    zpl = zpl.replace("{email}", escapeZpl(attendee.email ?: ""))
    zpl = zpl.replace("{company}", escapeZpl(attendee.company ?: ""))
    zpl = zpl.replace("{position}", escapeZpl(attendee.position ?: ""))
    zpl = zpl.replace("{code}", escapeZpl(attendee.code))
    attendee.customFieldsText().forEach { (key, value) -> zpl = zpl.replace("{$key}", escapeZpl(value)) }
    return zpl
}
```

- [ ] **Step 4: Run test, verify it passes**

- [ ] **Step 5: Run the full gate + commit**

```bash
./gradlew :shared:testDebugUnitTest :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:lintDebug
git add mobile/shared/src/commonMain/kotlin/com/idento/data/model/BadgeTemplate.kt \
        mobile/shared/src/commonTest/kotlin/com/idento/data/model/BadgeTemplateZplEscapingTest.kt
git commit -m "fix(mobile): escape ZPL special characters (\\ ^ ~) in badge field substitution"
```

---

### Task 4: `RegistrationVerdict` production — code lookup, no writes yet

**Files:**
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/data/registration/RegistrationVerdictMapper.kt`
- Test: `mobile/shared/src/commonTest/kotlin/com/idento/data/registration/RegistrationVerdictMapperTest.kt`

**Interfaces:**
- Consumes: `AttendeeRepository.getAttendeeByCode(eventId, code): ApiResult<Attendee>` (existing, unchanged), `Attendee`'s fields (`isBlocked`, `blockReason`, `isCheckedIn`, `checkedInAt`, `checkedInByEmail`, `checkedInDeviceNumber`, `checkedInPointName` — the last two from Task 2), `kotlinx.datetime.Instant` (parse `checkedInAt: String?` — an ISO-8601 string per the backend's `time.Time` JSON marshaling — into `Instant` via `Instant.parse(...)`, matching however other places in this codebase already parse backend timestamp strings; grep for an existing `Instant.parse` call site to match the exact parsing convention rather than inventing one).
- Produces: `class RegistrationVerdictMapper` with `suspend fun lookup(eventId: String, code: String): RegistrationVerdictLookup` where:
  ```kotlin
  sealed interface RegistrationVerdictLookup {
      data class Found(val attendee: Attendee) : RegistrationVerdictLookup    // eligible to proceed — Task 5 submits the check-in
      data class AlreadyChecked(val verdict: RegistrationVerdict.AlreadyChecked) : RegistrationVerdictLookup  // fully-formed verdict, no submission needed
      data class Denied(val verdict: RegistrationVerdict.Denied) : RegistrationVerdictLookup
      data class NotFound(val verdict: RegistrationVerdict.NotFound) : RegistrationVerdictLookup
      data class LookupFailed(val message: String) : RegistrationVerdictLookup  // network/API error, distinct from a legitimate NotFound
  }
  ```
  This is a *read-only* step — `Found` does not itself constitute a `RegistrationVerdict.Success` (that requires an actual check-in write, Task 5's job). Task 5 consumes `RegistrationVerdictLookup.Found` to attempt the submission and only THEN produces `RegistrationVerdict.Success`/`PrintError`.

**Verdict-inference rules (from the shipped `Attendee` model's fields, no new backend endpoint needed for this task):**
- Attendee not found for the code → `NotFound(RegistrationVerdict.NotFound(rawCode = code, hint = "..."))` — a not-found hint string; keep it simple (e.g. "Check the code and try again") since exact copy is a Task 10 (i18n)/M1d (UI) concern, not this task's.
- `attendee.isBlocked == true` → `Denied(RegistrationVerdict.Denied(attendee = toVerdictAttendee(attendee), reason = attendee.blockReason ?: "Access denied"))`.
- `attendee.isCheckedIn == true` (already checked in, from a PRIOR scan — this is the read path, not this scan's own write) → `AlreadyChecked(RegistrationVerdict.AlreadyChecked(attendee = toVerdictAttendee(attendee), firstAt = Instant.parse(attendee.checkedInAt!!), firstPoint = attendee.checkedInPointName ?: "Unknown", firstDevice = attendee.checkedInDeviceNumber ?: 0))`.
- Otherwise → `Found(attendee)` (eligible; Task 5 performs the actual check-in submission).

- [ ] **Step 1: Read `AttendeeRepository.getAttendeeByCode` and `Attendee`'s current full field list**

Confirm the exact `ApiResult<Attendee>` return type and error-message shape (`ApiResult.Error(exception, message)`) before writing the mapper.

- [ ] **Step 2: Write the failing tests**

```kotlin
package com.idento.data.registration

import com.idento.data.model.Attendee
import com.idento.data.network.ApiResult
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class RegistrationVerdictMapperTest {

    private fun attendee(
        isBlocked: Boolean = false,
        isCheckedIn: Boolean = false,
        checkedInAt: String? = null,
        checkedInPointName: String? = null,
        checkedInDeviceNumber: Int? = null,
        blockReason: String? = null,
    ) = Attendee(
        id = "att-1", eventId = "evt-1", firstName = "Иван", lastName = "Петров",
        company = "Acme", code = "ABC-123", checkinStatus = isCheckedIn,
        checkedInAt = checkedInAt, checkedInByEmail = null,
        checkedInDeviceNumber = checkedInDeviceNumber, checkedInPointName = checkedInPointName,
        isBlocked = isBlocked, blockReason = blockReason,
    )

    @Test
    fun foundEligibleAttendeeReturnsFound() = runTest {
        val mapper = RegistrationVerdictMapper(FakeAttendeeLookup(ApiResult.Success(attendee())))
        val result = mapper.lookup("evt-1", "ABC-123")
        assertTrue(result is RegistrationVerdictLookup.Found)
    }

    @Test
    fun blockedAttendeeReturnsDeniedWithReason() = runTest {
        val mapper = RegistrationVerdictMapper(FakeAttendeeLookup(ApiResult.Success(attendee(isBlocked = true, blockReason = "VIP list only"))))
        val result = mapper.lookup("evt-1", "ABC-123")
        assertTrue(result is RegistrationVerdictLookup.Denied)
        assertEquals("VIP list only", (result as RegistrationVerdictLookup.Denied).verdict.reason)
    }

    @Test
    fun alreadyCheckedInAttendeeReturnsAlreadyCheckedWithFullDetail() = runTest {
        val mapper = RegistrationVerdictMapper(FakeAttendeeLookup(ApiResult.Success(
            attendee(isCheckedIn = true, checkedInAt = "2026-07-11T10:00:00Z", checkedInPointName = "Главный вход", checkedInDeviceNumber = 3)
        )))
        val result = mapper.lookup("evt-1", "ABC-123")
        assertTrue(result is RegistrationVerdictLookup.AlreadyChecked)
        val verdict = (result as RegistrationVerdictLookup.AlreadyChecked).verdict
        assertEquals("Главный вход", verdict.firstPoint)
        assertEquals(3, verdict.firstDevice)
    }

    @Test
    fun notFoundCodeReturnsNotFound() = runTest {
        val mapper = RegistrationVerdictMapper(FakeAttendeeLookup(ApiResult.Error(RuntimeException("not found"), "Not found")))
        val result = mapper.lookup("evt-1", "ZZZ-999")
        assertTrue(result is RegistrationVerdictLookup.NotFound)
        assertEquals("ZZZ-999", (result as RegistrationVerdictLookup.NotFound).verdict.rawCode)
    }
}
```
(Write `FakeAttendeeLookup` as a small local `fun interface` test double per the established M1b seam pattern — see Step 3.)

- [ ] **Step 3: Run test, verify it fails, then implement**

```kotlin
package com.idento.data.registration

import com.idento.data.model.Attendee
import com.idento.data.model.RegistrationVerdict
import com.idento.data.model.VerdictAttendee
import com.idento.data.network.ApiResult
import kotlinx.datetime.Instant

/** Seam: AttendeeRepository is a plain non-open class wrapping a live Ktor HttpClient with no
 * mock-engine seam (established M1b pattern) — this interface is adapted from the real
 * repository via a method reference in Koin. */
fun interface AttendeeLookup {
    suspend fun getAttendeeByCode(eventId: String, code: String): ApiResult<Attendee>
}

sealed interface RegistrationVerdictLookup {
    data class Found(val attendee: Attendee) : RegistrationVerdictLookup
    data class AlreadyChecked(val verdict: RegistrationVerdict.AlreadyChecked) : RegistrationVerdictLookup
    data class Denied(val verdict: RegistrationVerdict.Denied) : RegistrationVerdictLookup
    data class NotFound(val verdict: RegistrationVerdict.NotFound) : RegistrationVerdictLookup
    data class LookupFailed(val message: String) : RegistrationVerdictLookup
}

class RegistrationVerdictMapper(private val attendeeLookup: AttendeeLookup) {

    suspend fun lookup(eventId: String, code: String): RegistrationVerdictLookup {
        return when (val result = attendeeLookup.getAttendeeByCode(eventId, code)) {
            is ApiResult.Success -> classify(result.data, code)
            is ApiResult.Error -> RegistrationVerdictLookup.NotFound(
                RegistrationVerdict.NotFound(rawCode = code, hint = "Check the code and try again")
            )
            is ApiResult.Loading -> RegistrationVerdictLookup.LookupFailed("Still loading")
        }
    }

    private fun classify(attendee: Attendee, code: String): RegistrationVerdictLookup {
        val verdictAttendee = toVerdictAttendee(attendee)
        return when {
            attendee.isBlocked -> RegistrationVerdictLookup.Denied(
                RegistrationVerdict.Denied(attendee = verdictAttendee, reason = attendee.blockReason ?: "Access denied")
            )
            attendee.isCheckedIn -> RegistrationVerdictLookup.AlreadyChecked(
                RegistrationVerdict.AlreadyChecked(
                    attendee = verdictAttendee,
                    firstAt = attendee.checkedInAt?.let { Instant.parse(it) } ?: Instant.DISTANT_PAST,
                    firstPoint = attendee.checkedInPointName ?: "Unknown",
                    firstDevice = attendee.checkedInDeviceNumber ?: 0,
                )
            )
            else -> RegistrationVerdictLookup.Found(attendee)
        }
    }
}

fun toVerdictAttendee(attendee: Attendee): VerdictAttendee = VerdictAttendee(
    id = attendee.id,
    fullName = attendee.fullName,
    company = attendee.company,
    category = attendee.position ?: "",
)
```
Confirm `Attendee.isCheckedIn`'s exact existing definition (`checkinStatus || checkedInAt != null`, per M1a) before relying on it — read the current file, don't assume the brief's memory is still accurate. Also confirm `Instant.DISTANT_PAST` exists in the `kotlinx-datetime` version pinned in this project (0.6.1) as a safe fallback for the (should-be-impossible-but-defensive) case of `isCheckedIn == true` with a null `checkedInAt`.

- [ ] **Step 4: Run test, verify it passes**

- [ ] **Step 5: Run the full gate + commit**

```bash
./gradlew :shared:testDebugUnitTest :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:lintDebug
git add mobile/shared/src/commonMain/kotlin/com/idento/data/registration/RegistrationVerdictMapper.kt \
        mobile/shared/src/commonTest/kotlin/com/idento/data/registration/RegistrationVerdictMapperTest.kt
git commit -m "feat(mobile): registration verdict production from attendee-code lookup"
```

---

### Task 5: Check-in submission — idempotent write + conflict-safe re-fetch + print-state kickoff

**Files:**
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/data/registration/RegistrationCheckInService.kt`
- Test: `mobile/shared/src/commonTest/kotlin/com/idento/data/registration/RegistrationCheckInServiceTest.kt`

**Interfaces:**
- Consumes: Task 4's `RegistrationVerdictLookup.Found`, `AttendeeRepository.submitBatchCheckins(eventId, items): ApiResult<List<BatchCheckinResultDto>>` (existing), `StationConfig` (for `deviceNumber`, `workPointName`), a UUID generator (check whether this codebase already has one — grep for `uuid()`/`Uuid`/a KMP UUID library already in `build.gradle.kts`'s dependencies; if none exists, this task needs a minimal one — Kotlin 2.3.21's stdlib includes `kotlin.uuid.Uuid` as a stable API since 2.0, check whether `-opt-in` is needed or it's already stable in this project's configured API level, and use that rather than adding a new dependency).
- Produces:
  ```kotlin
  class RegistrationCheckInService(...) {
      suspend fun checkIn(eventId: String, station: StationConfig, attendee: Attendee): RegistrationVerdict
  }
  ```
  Called by (future, M1d) UI only after `RegistrationVerdictMapper.lookup(...)` returns `Found` — this service performs the actual write and returns a fully-formed `RegistrationVerdict` (`Success`, `AlreadyChecked` on a race-losing conflict, or a verdict wrapping a failure — see Step 3 for the exact failure-handling shape).

**The conflict/race case this task must handle correctly:** between `RegistrationVerdictMapper.lookup` returning `Found` (attendee not yet checked in, as of that read) and this service's `submitBatchCheckins` call landing, another device could check the same attendee in first. The batch endpoint's idempotent dedup is by `client_uuid`, not by attendee — so a genuine race (two DIFFERENT client_uuids for the same attendee) is not deduped by the endpoint itself; instead, the backend's normal "attendee already checked in" business state (whatever the underlying `ApplyBatchCheckin` write does when the attendee is already checked in — read `pg_store.go`'s `ApplyBatchCheckin` from Task 1 once more to confirm: does it silently re-write checked_in_at, effectively "last write wins," or does it detect a pre-existing checked-in state and leave it unchanged, still reporting `"created"` since the CLIENT_UUID itself is new? This distinction changes whether Step 3's "re-fetch and check `isCheckedIn` again" logic needs to compare timestamps to determine which device actually "won"). Confirm this backend behavior before writing Step 3 — do not guess.

- [ ] **Step 1: Confirm the backend's already-checked-in write behavior**

Read `ApplyBatchCheckin` in `pg_store.go` (from Task 1, now merged) once more, specifically: what happens when `kind == "checkin"` is submitted for an attendee whose `checkin_status` is already `true`? Does the SQL use `WHERE checkin_status = false` (so a second submission is a no-op, `applied = false`... but note `applied` in the current handler governs `"created"` vs `"already_exists"` based on the `batch_checkin_log` INSERT's own conflict, which is `client_uuid`-scoped, NOT attendee-state-scoped) — or does it unconditionally overwrite? This determines whether a genuine cross-device race produces a silent overwrite (bug, would need a Task 1 follow-up fix) or a safe no-op. If it's a silent overwrite, treat this as a finding to report rather than silently work around client-side — flag it in this task's completion report rather than attempting a backend fix mid-task (Task 1 is already merged; a follow-up would need its own task/commit).

- [ ] **Step 2: Write the failing tests**

```kotlin
package com.idento.data.registration

import com.idento.data.model.*
import com.idento.data.network.ApiResult
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertIs
import kotlin.test.assertEquals

class RegistrationCheckInServiceTest {

    private val station = StationConfig(
        eventId = "evt-1", eventName = "Технопром-2026", mode = StationMode.REGISTRATION,
        dayDate = "2026-07-11", workPointId = "wp-1", workPointName = "Главный вход",
        printer = null, autoPrint = false, deviceNumber = 3, staffName = "staff@idento.app",
    )

    private val attendee = Attendee(
        id = "att-1", eventId = "evt-1", firstName = "Иван", lastName = "Петров", code = "ABC-123",
    )

    @Test
    fun successfulSubmissionReturnsSuccessVerdict() = runTest {
        val service = RegistrationCheckInService(
            batchSubmitter = { _, items -> ApiResult.Success(listOf(BatchCheckinResultDto(clientUuid = items.first().clientUuid, status = "created"))) },
        )
        val verdict = service.checkIn("evt-1", station, attendee)
        assertIs<RegistrationVerdict.Success>(verdict)
        assertEquals(true, verdict.firstTime)
    }

    @Test
    fun conflictResponseReturnsAlreadyCheckedNotSuccess() = runTest {
        val service = RegistrationCheckInService(
            batchSubmitter = { _, items -> ApiResult.Success(listOf(BatchCheckinResultDto(clientUuid = items.first().clientUuid, status = "already_exists"))) },
        )
        val verdict = service.checkIn("evt-1", station, attendee)
        assertIs<RegistrationVerdict.AlreadyChecked>(verdict)
    }

    @Test
    fun networkFailureDuringSubmissionEnqueuesOfflineAndReturnsQueuedSuccess() = runTest {
        val enqueued = mutableListOf<BatchCheckinItemDto>()
        val service = RegistrationCheckInService(
            batchSubmitter = { _, _ -> ApiResult.Error(RuntimeException("offline"), "offline") },
            offlineQueue = { _, item -> enqueued.add(item) },
        )
        val verdict = service.checkIn("evt-1", station, attendee)
        assertIs<RegistrationVerdict.Success>(verdict)
        assertEquals(PrintState.Queued, verdict.printState)
        assertEquals(1, enqueued.size)
        assertEquals(attendee.id, enqueued.first().attendeeId)
    }
}
```
The `batchSubmitter` seam above is illustrative — confirm the exact `AttendeeRepository.submitBatchCheckins` signature first and shape the seam's single method to match it exactly (`suspend fun submitBatchCheckins(eventId: String, items: List<BatchCheckinItemDto>): ApiResult<List<BatchCheckinResultDto>>`). `offlineQueue` above is `Task 5`'s own `RegistrationOfflineQueue` seam (`fun interface RegistrationOfflineQueue { suspend fun enqueue(eventId: String, item: BatchCheckinItemDto) }`) — a network failure never surfaces as an error verdict or a `PrintError`; it always hands off to the offline queue and returns `Success(printState = Queued)`, per spec §8's "офлайн → чек-ин в pending_checkins" rule (the same "don't block the operator" philosophy as print failures). This is the decided, final behavior — implement Step 3 to match this test exactly, not the other way around.

- [ ] **Step 3: Decide and implement the offline/failure path — this is the key design decision in this task**

When `submitBatchCheckins` fails (network error, `ApiResult.Error`), this service must **not** return a verdict claiming success or failure — the correct behavior (per spec §8: "Нет сети → вердикт по `attendee_cache`, чек-ин в `pending_checkins`") is to hand off to Task 6's offline queue and return a `RegistrationVerdict.Success` immediately with `printState` reflecting that the check-in is queued, not confirmed server-side yet. Design `RegistrationCheckInService`'s constructor to take an `offlineQueue: RegistrationOfflineQueue` seam (defined by this task, matched by Task 6's real implementation — see the `fun interface RegistrationOfflineQueue { suspend fun enqueue(eventId: String, item: BatchCheckinItemDto) }` declaration in Step 3's code below). On `ApiResult.Error` from `submitBatchCheckins`, call `offlineQueue.enqueue(eventId, item)` and return `RegistrationVerdict.Success(attendee = toVerdictAttendee(attendee), at = Clock.System.now(), firstTime = true, printState = PrintState.Queued)` — the check-in is optimistically treated as successful from the staff member's perspective (spec: "Ошибка печати не отменяет чек-ин" — the same "don't block the operator on a backend hiccup" philosophy extends to network failures for check-in itself, per §8's explicit "офлайн → чек-ин в pending_checkins" rule, not an error shown to the user).

Full implementation:
```kotlin
package com.idento.data.registration

import com.idento.data.model.*
import com.idento.data.network.ApiResult
import kotlin.time.Clock
import kotlin.uuid.Uuid   // or this project's confirmed KMP UUID source — verify before use, per this task's Interfaces note

fun interface BatchCheckinSubmitter {
    suspend fun submitBatchCheckins(eventId: String, items: List<BatchCheckinItemDto>): ApiResult<List<BatchCheckinResultDto>>
}

fun interface RegistrationOfflineQueue {
    suspend fun enqueue(eventId: String, item: BatchCheckinItemDto)
}

class RegistrationCheckInService(
    private val batchSubmitter: BatchCheckinSubmitter,
    private val offlineQueue: RegistrationOfflineQueue,
) {
    suspend fun checkIn(eventId: String, station: StationConfig, attendee: Attendee): RegistrationVerdict {
        val clientUuid = Uuid.random().toString()
        val now = Clock.System.now()
        val item = BatchCheckinItemDto(
            clientUuid = clientUuid,
            attendeeId = attendee.id,
            at = now.toString(),
            deviceNumber = station.deviceNumber,
            kind = "checkin",
            pointName = station.workPointName,
        )
        return when (val result = batchSubmitter.submitBatchCheckins(eventId, listOf(item))) {
            is ApiResult.Success -> {
                val itemResult = result.data.firstOrNull { it.clientUuid == clientUuid }
                when (itemResult?.status) {
                    "created" -> RegistrationVerdict.Success(
                        attendee = toVerdictAttendee(attendee), at = now, firstTime = true, printState = PrintState.Queued,
                    )
                    "already_exists" -> RegistrationVerdict.AlreadyChecked(
                        attendee = toVerdictAttendee(attendee),
                        firstAt = now, // conflict re-fetch for the ACCURATE original time/point/device is a known gap — see this step's note below
                        firstPoint = station.workPointName,
                        firstDevice = station.deviceNumber,
                    )
                    else -> {
                        offlineQueue.enqueue(eventId, item)
                        RegistrationVerdict.Success(toVerdictAttendee(attendee), now, firstTime = true, printState = PrintState.Queued)
                    }
                }
            }
            is ApiResult.Error -> {
                offlineQueue.enqueue(eventId, item)
                RegistrationVerdict.Success(toVerdictAttendee(attendee), now, firstTime = true, printState = PrintState.Queued)
            }
            is ApiResult.Loading -> RegistrationVerdict.Success(toVerdictAttendee(attendee), now, firstTime = true, printState = PrintState.Queued)
        }
    }
}
```

**Known gap the implementer must close, not leave as sketched above**: the `"already_exists"` branch above fills `firstAt`/`firstPoint`/`firstDevice` with THIS device's own submission data, which is wrong when a DIFFERENT device won the race (the whole point of re-fetching). Add a re-fetch: inject an `AttendeeLookup` (reuse Task 4's seam) into this service, and on `"already_exists"`, call `attendeeLookup.getAttendeeByCode(eventId, attendee.code)` (or a by-id lookup if one exists — check `AttendeeRepository` for a `getAttendee(attendeeId)` method, which is more precise than by-code) to get the now-authoritative `checkedInAt`/`checkedInPointName`/`checkedInDeviceNumber`, and build the `AlreadyChecked` verdict from THAT re-fetched data, falling back to this device's own submission values only if the re-fetch itself fails (better a locally-consistent guess than an error screen for a check-in the operator can see plainly worked).

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Run the full gate + commit**

```bash
./gradlew :shared:testDebugUnitTest :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:lintDebug
git add mobile/shared/src/commonMain/kotlin/com/idento/data/registration/RegistrationCheckInService.kt \
        mobile/shared/src/commonTest/kotlin/com/idento/data/registration/RegistrationCheckInServiceTest.kt
git commit -m "feat(mobile): idempotent registration check-in submission with conflict-safe re-fetch"
```

---

### Task 6: Registration offline queue (new SQLDelight table + repository)

**Files:**
- Create: `mobile/shared/src/commonMain/sqldelight/com/idento/db/PendingRegistrationCheckIn.sq`
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/data/registration/RegistrationOfflineQueueRepository.kt` (implements Task 5's `RegistrationOfflineQueue` interface)
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/di/AppModule.kt` (register the new repository; wire it as the `RegistrationOfflineQueue` implementation for `RegistrationCheckInService`)
- Test: `mobile/shared/src/androidUnitTest/kotlin/com/idento/data/registration/RegistrationOfflineQueueRepositoryTest.kt` (JVM/Android-only test source set — SQLDelight's JDBC test driver is JVM-only, established M1a convention; do NOT put this in `commonTest`, see this plan's Global Constraints and the M1a-session lesson about `sqlite-driver` breaking iOS test compilation when misplaced)

**Interfaces:**
- Consumes: `BatchCheckinItemDto` (Task 2), `AttendeeRepository.submitBatchCheckins` (existing).
- Produces:
  ```kotlin
  class RegistrationOfflineQueueRepository(...) : RegistrationOfflineQueue {
      override suspend fun enqueue(eventId: String, item: BatchCheckinItemDto)
      suspend fun getPending(): List<PendingRegistrationCheckIn>
      fun getPendingCountFlow(): Flow<Int>
      suspend fun flush(): FlushResult  // attempts submitBatchCheckins for every queued item, removes successes, updates attempt/error on failures
  }
  ```
  `flush()` is called by Task 7's `SyncService` wiring — read by Task 9's summary/final task, not by any screen in this plan.

- [ ] **Step 1: Write the SQLDelight schema**

`PendingRegistrationCheckIn.sq`:
```sql
CREATE TABLE PendingRegistrationCheckIn (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    clientUuid TEXT NOT NULL UNIQUE,
    eventId TEXT NOT NULL,
    attendeeId TEXT NOT NULL,
    at TEXT NOT NULL,
    deviceNumber INTEGER NOT NULL,
    pointName TEXT,
    attemptCount INTEGER NOT NULL DEFAULT 0,
    lastAttemptAt INTEGER,
    errorMessage TEXT
);

insert:
INSERT INTO PendingRegistrationCheckIn(clientUuid, eventId, attendeeId, at, deviceNumber, pointName, attemptCount, lastAttemptAt, errorMessage)
VALUES (?, ?, ?, ?, ?, ?, 0, NULL, NULL);

selectAll:
SELECT * FROM PendingRegistrationCheckIn ORDER BY id ASC;

updateAttempt:
UPDATE PendingRegistrationCheckIn SET attemptCount = ?, lastAttemptAt = ?, errorMessage = ? WHERE id = ?;

deleteById:
DELETE FROM PendingRegistrationCheckIn WHERE id = ?;

countAll:
SELECT COUNT(*) FROM PendingRegistrationCheckIn;
```
Note: `clientUuid` is the idempotency key here (matching the backend's own dedup key), not a composite `(attendeeCode, zoneId, eventDay)` like the unrelated zone-check-in table — a registration check-in for the same attendee twice in one session is legitimately two different events (e.g. re-entry) with two different `clientUuid`s, so no `UNIQUE` constraint beyond `clientUuid` itself is needed here (each `enqueue` call generates its own fresh `clientUuid` in Task 5, so accidental duplicate rows from a single logical check-in attempt can't occur the way they could for zone re-scans).

- [ ] **Step 2: Write the failing test** (JVM/androidUnitTest source set, matching the established `SqlDelightOfflineDatabaseTest.kt` pattern from M1a — read that file first for the exact `JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY)` setup style)

```kotlin
package com.idento.data.registration

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.idento.data.model.BatchCheckinItemDto
import com.idento.data.network.ApiResult
import com.idento.db.IdentoDatabase
import kotlinx.coroutines.test.runTest
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals

class RegistrationOfflineQueueRepositoryTest {

    private lateinit var driver: JdbcSqliteDriver
    private lateinit var repository: RegistrationOfflineQueueRepository

    @BeforeTest
    fun setUp() {
        driver = JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY)
        IdentoDatabase.Schema.create(driver)
        val database = IdentoDatabase(driver)
        repository = RegistrationOfflineQueueRepository(database.pendingRegistrationCheckInQueries, FakeBatchCheckinSubmitter())
    }

    @AfterTest
    fun tearDown() { driver.close() }

    @Test
    fun enqueueThenFlushSubmitsAndRemovesOnSuccess() = runTest {
        repository.enqueue("evt-1", BatchCheckinItemDto(clientUuid = "u1", attendeeId = "att-1", at = "2026-07-11T10:00:00Z", deviceNumber = 3, kind = "checkin", pointName = "Главный вход"))
        assertEquals(1, repository.getPending().size)

        repository.flush()

        assertEquals(0, repository.getPending().size)
    }

    @Test
    fun flushKeepsItemAndRecordsErrorOnFailure() = runTest {
        val failingRepo = RegistrationOfflineQueueRepository(
            IdentoDatabase(driver).pendingRegistrationCheckInQueries,
            { _, _ -> ApiResult.Error(RuntimeException("offline"), "offline") },
        )
        failingRepo.enqueue("evt-1", BatchCheckinItemDto(clientUuid = "u2", attendeeId = "att-2", at = "2026-07-11T10:00:00Z", deviceNumber = 3, kind = "checkin"))

        failingRepo.flush()

        val pending = failingRepo.getPending()
        assertEquals(1, pending.size)
        assertEquals(1, pending.first().attemptCount)
    }
}

private class FakeBatchCheckinSubmitter : com.idento.data.registration.BatchCheckinSubmitter {
    override suspend fun submitBatchCheckins(eventId: String, items: List<BatchCheckinItemDto>) =
        ApiResult.Success(items.map { com.idento.data.model.BatchCheckinResultDto(clientUuid = it.clientUuid, status = "created") })
}
```

- [ ] **Step 3: Run test, verify it fails, implement `RegistrationOfflineQueueRepository`, verify it passes**

Implement using the same `withContext(Dispatchers.Default)` pattern already established in `SqlDelightOfflineDatabase.kt` for every suspend method touching the SQLDelight queries object.

- [ ] **Step 4: Register in Koin**

In `AppModule.kt`, add (near the existing `single { SqlDelightOfflineDatabase(get()) as OfflineDatabase }` registration):
```kotlin
single { RegistrationOfflineQueueRepository(get<IdentoDatabase>().pendingRegistrationCheckInQueries, ...) }
```
Confirm whether `IdentoDatabase` itself is already exposed as a Koin-injectable singleton, or only wrapped classes are (`SqlDelightOfflineDatabase` constructs its own `IdentoDatabase(driverFactory.createDriver())` internally, per the current M1a code — read `SqlDelightOfflineDatabase.kt`'s constructor to confirm) — if `IdentoDatabase` isn't separately exposed, register it as its own `single { IdentoDatabase(get<SqlDriverFactory>().createDriver()) }` first, since both `SqlDelightOfflineDatabase` and this new repository need query-object access to the SAME single physical database file/connection (constructing two separate `IdentoDatabase(driverFactory.createDriver())` instances would work correctly with SQLDelight's Android driver, since it opens the same underlying `.db` file, but is wasteful — prefer a single shared `IdentoDatabase` instance if this can be done without disturbing `SqlDelightOfflineDatabase`'s already-shipped, already-tested constructor signature; if it can't be done cleanly without touching that already-shipped class, it's acceptable to construct a second `IdentoDatabase` instance backed by the same file, since SQLite supports multiple connections to one file — note this either way in the completion report).

- [ ] **Step 5: Run the full gate + commit**

```bash
./gradlew :shared:testDebugUnitTest :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:lintDebug
git add mobile/shared/src/commonMain/sqldelight/com/idento/db/PendingRegistrationCheckIn.sq \
        mobile/shared/src/commonMain/kotlin/com/idento/data/registration/RegistrationOfflineQueueRepository.kt \
        mobile/shared/src/commonMain/kotlin/com/idento/di/AppModule.kt \
        mobile/shared/src/androidUnitTest/kotlin/com/idento/data/registration/RegistrationOfflineQueueRepositoryTest.kt
git commit -m "feat(mobile): registration check-in offline queue (new SQLDelight table + repository)"
```

---

### Task 7: Wire `SyncService` to actually run

**Files:**
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/data/sync/SyncService.kt`
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/App.kt`
- Test: `mobile/shared/src/commonTest/kotlin/com/idento/data/sync/SyncServiceTest.kt` (extend if tests already exist — check first)

**Interfaces:**
- Consumes: Task 6's `RegistrationOfflineQueueRepository.flush()` (and, if it already exists, the zone-check-in `OfflineCheckInRepository.syncAll()` — read `SyncService.kt`'s CURRENT constructor first; the M1a research confirmed it's `SyncService(get(), get())` in Koin, meaning it already takes 2 dependencies — read the actual file to see what those are before assuming this task must add a brand-new dependency vs. extend an existing one).
- Produces: `SyncService.startAutoSync()` actually invoked once, at app startup, from `App.kt` — read by nothing further in this plan (M1d's offline banner will read `SyncService.syncState`/`getPendingCount()` to render the UI, out of scope here).

- [ ] **Step 1: Read the current `SyncService.kt` in full**

Confirm its exact current constructor dependencies, what `performSync()` currently does (which repository/repositories it calls), and whether it's already wired for the zone-check-in queue only, or is repository-agnostic. This determines whether Task 6's new registration queue needs a NEW constructor parameter on `SyncService`, or whether `SyncService` needs to become aware of multiple queues (a small `List<SyncableQueue>`-style abstraction) — do not guess, the actual current shape decides this.

- [ ] **Step 2: Extend `SyncService` to also flush the registration queue**

Based on Step 1's finding, either add `registrationOfflineQueue: RegistrationOfflineQueueRepository` as a new constructor parameter and call `.flush()` from `performSync()` alongside whatever it already does, or (if `SyncService` is already structured as `List<Syncable>`-style) implement whatever minimal common interface it expects and register the new queue the same way the existing one is registered — match the established shape, do not introduce a second, parallel sync-triggering mechanism.

- [ ] **Step 3: Start it from `App.kt`**

Read `App.kt`'s current `LaunchedEffect(Unit)` blocks (theme load, M1b's session-restore resolution) and add a THIRD, independent `LaunchedEffect(Unit)` (or fold into the session-restore one if that reads more naturally given the surrounding code — read it first and decide) that calls `syncService.startAutoSync()` once, unconditionally, at app launch (not gated on being logged in or having a StationConfig — per spec §8, "очереди... доливаются после входа," meaning sync should be running and ready to flush the moment a session becomes valid, not only after Registration mode's screens exist). Inject `SyncService` via `koinInject()`, matching how `appPreferences`/`stationConfigPreferences`/`authPreferences` are already injected in this same file.

- [ ] **Step 4: Write/extend a test confirming `startAutoSync()` triggers a flush path**

Read whatever `SyncServiceTest.kt` already covers (if it exists) and add/extend a test proving `performSync()` (or whatever `startAutoSync()` internally drives) calls the registration queue's `flush()` — using the same testability-seam approach as every other test in this plan (fake the queue interface, don't attempt to construct real SQLDelight/network objects for this specific test if the existing tests already avoid that).

- [ ] **Step 5: Run the full gate + commit**

```bash
./gradlew :shared:testDebugUnitTest :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:lintDebug
git add mobile/shared/src/commonMain/kotlin/com/idento/data/sync/SyncService.kt \
        mobile/shared/src/commonMain/kotlin/com/idento/App.kt \
        mobile/shared/src/commonTest/kotlin/com/idento/data/sync/SyncServiceTest.kt
git commit -m "fix(mobile): actually start SyncService at app launch, flush the registration offline queue"
```

---

### Task 8: Print queue (new SQLDelight table + repository + retry/backoff)

**Files:**
- Create: `mobile/shared/src/commonMain/sqldelight/com/idento/db/PrintJob.sq`
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/data/registration/PrintQueueRepository.kt`
- Modify: `mobile/shared/src/commonMain/kotlin/com/idento/di/AppModule.kt` (register)
- Test: `mobile/shared/src/androidUnitTest/kotlin/com/idento/data/registration/PrintQueueRepositoryTest.kt` (JVM-only, same reasoning as Task 6)

**Interfaces:**
- Consumes: `BadgeTemplate.generateZPL` (Task 3, escaped), `StationConfig.printer: PrinterConfig?` (existing), `BluetoothPrinterService`/`EthernetPrinterService` (existing, unchanged interfaces).
- Produces:
  ```kotlin
  class PrintQueueRepository(...) {
      suspend fun enqueue(zpl: String, printer: PrinterConfig): Long  // returns job id
      suspend fun getPending(): List<PrintJob>
      suspend fun markDone(id: Long)
      suspend fun markFailed(id: Long, reason: String)
      suspend fun retryNext(): PrintRetryResult  // attempts the oldest pending job with exponential backoff based on attemptCount
  }
  ```
  Consumed by (future, M1d) the verdict screen's "Retry print" button and this plan's Task 9's summary — not by any screen in this plan.

- [ ] **Step 1: Write the SQLDelight schema**

```sql
CREATE TABLE PrintJob (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    zpl TEXT NOT NULL,
    printerName TEXT NOT NULL,
    printerTransport TEXT NOT NULL,
    printerAddress TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attemptCount INTEGER NOT NULL DEFAULT 0,
    lastAttemptAt INTEGER,
    errorMessage TEXT,
    createdAt INTEGER NOT NULL
);

insert:
INSERT INTO PrintJob(zpl, printerName, printerTransport, printerAddress, status, attemptCount, lastAttemptAt, errorMessage, createdAt)
VALUES (?, ?, ?, ?, 'pending', 0, NULL, NULL, ?);

lastInsertRowId:
SELECT last_insert_rowid();

selectPending:
SELECT * FROM PrintJob WHERE status = 'pending' ORDER BY id ASC;

selectOldestPending:
SELECT * FROM PrintJob WHERE status = 'pending' ORDER BY id ASC LIMIT 1;

updateAttempt:
UPDATE PrintJob SET attemptCount = ?, lastAttemptAt = ?, errorMessage = ? WHERE id = ?;

markDone:
UPDATE PrintJob SET status = 'done' WHERE id = ?;

markFailed:
UPDATE PrintJob SET status = 'failed', errorMessage = ? WHERE id = ?;

deleteById:
DELETE FROM PrintJob WHERE id = ?;
```

- [ ] **Step 2: Write the failing test**

```kotlin
package com.idento.data.registration

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.idento.data.model.PrinterConfig
import com.idento.db.IdentoDatabase
import kotlinx.coroutines.test.runTest
import kotlin.test.*

class PrintQueueRepositoryTest {

    private lateinit var driver: JdbcSqliteDriver
    private lateinit var repository: PrintQueueRepository
    private var printAttempts = 0
    private var shouldPrintSucceed = true

    @BeforeTest
    fun setUp() {
        driver = JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY)
        IdentoDatabase.Schema.create(driver)
        repository = PrintQueueRepository(
            queries = IdentoDatabase(driver).printJobQueries,
            printSender = { _, _, _ -> printAttempts++; if (shouldPrintSucceed) Result.success(Unit) else Result.failure(RuntimeException("printer offline")) },
        )
    }

    @AfterTest
    fun tearDown() { driver.close() }

    @Test
    fun enqueueThenRetryNextSucceedsAndMarksDone() = runTest {
        val id = repository.enqueue("^XA^FDTest^FS^XZ", PrinterConfig(name = "Zebra", transport = "bluetooth", address = "00:11:22:33:44:55"))
        repository.retryNext()
        assertEquals(0, repository.getPending().size)
        assertEquals(1, printAttempts)
    }

    @Test
    fun retryNextIncrementsAttemptCountOnFailureAndKeepsJobPending() = runTest {
        shouldPrintSucceed = false
        repository.enqueue("^XA^FDTest^FS^XZ", PrinterConfig(name = "Zebra", transport = "bluetooth", address = "00:11:22:33:44:55"))
        repository.retryNext()
        val pending = repository.getPending()
        assertEquals(1, pending.size)
        assertEquals(1, pending.first().attemptCount)
        assertEquals("printer offline", pending.first().errorMessage)
    }
}
```

- [ ] **Step 3: Run test, verify it fails, implement `PrintQueueRepository`**

The `printSender` seam's signature must route to `BluetoothPrinterService.printWithAutoConnect(address, zpl)` when `transport == "bluetooth"`, `EthernetPrinterService.printWithAutoConnect(ip, port, zpl)` when `transport == "ethernet"` (reuse the exact same `address.split(":", limit=2)` safe-parsing approach already established and reviewed in `SetupPrinterViewModel.testPrint()` from M1b — read that method for the exact safe-parsing code and mirror it here, do not write a naive unguarded split). Backoff: a simple exponential delay based on `attemptCount` (e.g. `min(attemptCount * attemptCount, 300)` seconds before a job is eligible for `retryNext()` again) is sufficient — check `lastAttemptAt` against the current time in `retryNext()`'s query/logic to skip jobs still within their backoff window, rather than always retrying the single oldest pending job unconditionally regardless of how recently it failed.

- [ ] **Step 4: Run test, verify it passes**

- [ ] **Step 5: Register in Koin, run the full gate, commit**

```bash
./gradlew :shared:testDebugUnitTest :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:lintDebug
git add mobile/shared/src/commonMain/sqldelight/com/idento/db/PrintJob.sq \
        mobile/shared/src/commonMain/kotlin/com/idento/data/registration/PrintQueueRepository.kt \
        mobile/shared/src/commonMain/kotlin/com/idento/di/AppModule.kt \
        mobile/shared/src/androidUnitTest/kotlin/com/idento/data/registration/PrintQueueRepositoryTest.kt
git commit -m "feat(mobile): print queue with backoff retry (new SQLDelight table + repository)"
```

---

### Task 9: Debounced scan pipeline

**Files:**
- Create: `mobile/shared/src/commonMain/kotlin/com/idento/data/registration/DebouncedScanPipeline.kt`
- Test: `mobile/shared/src/commonTest/kotlin/com/idento/data/registration/DebouncedScanPipelineTest.kt`

**Interfaces:**
- Consumes: any `Flow<String>` source (this task takes a plain `Flow<String>` parameter, not `CameraService` directly — kept source-agnostic per this plan's Global Constraints, so M2's future hardware-scanner `Flow<String>` can be merged in later without touching this class).
- Produces:
  ```kotlin
  class DebouncedScanPipeline(private val debounceWindow: Duration = 3.seconds) {
      fun process(source: Flow<String>): Flow<String>  // same code within debounceWindow is dropped; different codes always pass through immediately
  }
  ```
  Consumed by (future, M1d) the scan screen's ViewModel, which will call `process(cameraService.startScanning())` and collect the result.

- [ ] **Step 1: Write the failing tests**

Use `kotlinx.coroutines.test`'s `TestCoroutineScheduler`/virtual time (`runTest` with explicit `advanceTimeBy(...)`, matching however this codebase's existing time-based tests already control virtual time — check if any prior test in this project already advances virtual time deliberately, e.g. anything testing a `delay()`, to match the established pattern rather than inventing a new one):

```kotlin
package com.idento.data.registration

import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.time.Duration.Companion.seconds

class DebouncedScanPipelineTest {

    @Test
    fun sameCodeWithinWindowIsDroppedDifferentCodeAlwaysPasses() = runTest {
        val pipeline = DebouncedScanPipeline(debounceWindow = 3.seconds)
        val source = flow {
            emit("ABC-123")
            emit("ABC-123") // immediate duplicate — dropped
            emit("XYZ-999") // different code — always passes
        }
        val results = pipeline.process(source).toList()
        assertEquals(listOf("ABC-123", "XYZ-999"), results)
    }

    @Test
    fun sameCodeAfterWindowExpiresPassesAgain() = runTest {
        // Confirm the pipeline uses a real elapsed-time check (kotlin.time.Clock or equivalent),
        // not virtual-scheduler-only timing that would be meaningless outside a test — since this
        // pipeline runs against REAL camera scan events in production, not a TestCoroutineScheduler.
        // Design this test to genuinely prove the 3-second window using the actual clock this class
        // is implemented against; do not fake this assertion by only checking flow ordering without
        // any real time gap.
    }
}
```

- [ ] **Step 2: Run test, verify it fails, implement**

Implementation must track "last-seen timestamp per code" using a real wall-clock source (`kotlin.time.Clock` — this codebase's established KMP-safe clock per project memory: "`kotlinx.datetime.Clock.System` fails on Native — use `kotlin.time.Clock`"; confirm this is still the correct guidance for this Kotlin version before using it, since this is a recorded project-memory note from an earlier migration, not necessarily unchanged), not `TestCoroutineScheduler` virtual time (which only exists inside `runTest`) — the pipeline must work correctly against a live `CameraService.startScanning()` `Flow<String>` in production, where there's no virtual scheduler. A `Map<String, Instant>` (or `ConcurrentHashMap`-equivalent — check if `kotlinx.atomicfu` is already available for thread-safety, per this codebase's existing use of `atomicfu` in `AuthPreferences.kt`) tracking last-seen time per code, filtering via `Flow.filter { code -> ... }`, is a reasonable approach — implement using `kotlinx.coroutines.flow` operators (`transform`/`filter` with a captured mutable map), not a naive `debounce()` operator (Kotlin's built-in `Flow.debounce()` suppresses ALL rapid emissions regardless of value — this spec explicitly wants a PER-CODE debounce, where a different code always passes through immediately even if it arrives 1ms after a different code, which `Flow.debounce()` does not do).

- [ ] **Step 3: Run test, verify it passes**

- [ ] **Step 4: Run the full gate + commit**

```bash
./gradlew :shared:testDebugUnitTest :shared:compileDebugKotlinAndroid :shared:compileKotlinIosSimulatorArm64 :shared:compileKotlinIosArm64 :shared:lintDebug
git add mobile/shared/src/commonMain/kotlin/com/idento/data/registration/DebouncedScanPipeline.kt \
        mobile/shared/src/commonTest/kotlin/com/idento/data/registration/DebouncedScanPipelineTest.kt
git commit -m "feat(mobile): per-code 3-second debounce for the unified scan pipeline"
```

---

### Task 10: Final verification + summary + PR

**Files:**
- Create: `docs/audit/mobile-redesign-m1c-registration-engine-summary.md`

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
From `backend`:
```bash
go test ./...
golangci-lint run
gosec ./...
```
All must pass. Compare `:app:lintDebug`'s warning count against the M1b baseline (`docs/audit/mobile-redesign-m1b-setup-wizard-summary.md` — 142 warnings) and record any drift.

- [ ] **Step 2: Write the summary doc**

Mirror the M1a/M1b summary docs' format (Russian, per-task table). Cover explicitly:
- What this plan built: the complete registration engine (backend device/point persistence, ZPL escaping, verdict production, idempotent submission with conflict-safe re-fetch, offline queue, print queue, SyncService actually running, debounced scan pipeline) — **and, prominently, that this plan builds zero screens**. State plainly that the app still cannot perform a real registration check-in through any UI after this plan merges — that's M1d's job, to be planned immediately after this.
- The backend migration (Task 1) and the exact reasoning for extending the `attendees` table rather than the alternatives considered (user decision, cite it).
- Task 5's confirmed answer to the "does a cross-device race overwrite silently or safely no-op" question (Step 1 of that task) — if it turned out to be a silent overwrite, flag this prominently as an open backend follow-up item, not something this plan's tests can fully cover.
- The `RegistrationVerdictLookup` vs `RegistrationVerdict` split (read-only classification vs. write-producing submission) and why it exists (a scan can determine AlreadyChecked/Denied/NotFound without ever writing; only the "proceed" action for an eligible attendee performs a write).
- Why a NEW, independent offline queue and print queue were built rather than reworking the existing zone-check-in queue (Global Constraints' reasoning, restated concretely).
- Any real bugs found and fixed during task review (pull from `.superpowers/sdd/progress.md`'s M1c section once populated during execution) — name them specifically, matching the M1a/M1b summary docs' honesty convention.
- Honest limitations: no UI test harness (unchanged from M1a/M1b), and this plan's own explicit non-goal of building any screen.

- [ ] **Step 3: Commit, push, open PR**

```bash
git add docs/audit/mobile-redesign-m1c-registration-engine-summary.md
git commit -m "docs(audit): mobile M1c registration engine summary"
git push -u origin redesign/m1c-registration-engine
```
Open the PR against `main`, explicitly noting in the PR description (mirroring how M1b's PR flagged its own known consequence) that this PR alone does not restore the app's ability to perform a real check-in — M1d (the actual scan/search/list screens) is required for that, and should follow immediately.
