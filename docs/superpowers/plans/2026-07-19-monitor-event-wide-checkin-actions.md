# Event-wide check-in actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the monitor's rate/peak/recent metrics event-wide by writing `checkin_actions` rows from the mobile batch, legacy attendee PUT, and SyncPush paths.

**Architecture:** A new `InsertCheckinActionAt` store method (explicit-`created_at` variant of the P4.1 insert; the existing statement stays byte-for-byte untouched). `ApplyBatchCheckin` wraps its guarded UPDATE + the new action insert in one transaction; the two legacy handlers insert after their `UpdateAttendee` succeeds, gated on an exact before/after `CheckinStatus` flip, log-don't-fail. Zero changes to any monitor query.

**Tech Stack:** Go (echo, pgx/v5, pgxmock/v4), Postgres.

**Spec:** `docs/superpowers/specs/2026-07-19-monitor-event-wide-checkin-actions-design.md`

## Global Constraints

- Non-station action rows: `station_id = NULL`, `action` only `'checkin'`/`'undo'`, `created_at` = the exact value the path persisted into `attendees.checked_in_at` (nil → SQL `DEFAULT`-equivalent `now()` via `COALESCE`).
- Insert ONLY on genuine state transitions: batch `BatchCheckinCreated` ∧ `kind == "checkin"`; handlers only when `CheckinStatus` actually flipped. No-ops/replays insert nothing.
- `kind=zone_entry` NEVER writes `checkin_actions`.
- Existing `checkinActionInsertSQL` and every monitor query in `pg_store_monitor.go` stay byte-for-byte unchanged.
- Handler inserts are log-don't-fail (state change already committed); they run BEFORE `publishCheckinEvent` so a publish-triggered refetch sees the row.
- Tests: pgxmock with real SQL text (house convention); integration tests gated on `TEST_DATABASE_URL` and SKIP when unset.
- Gates: `cd backend && go vet ./... && go test -race ./...` after every task; commit after each green task.
- `backend/openapi.yaml` untouched unless a description is now false; if edited at all, run `npm run generate:api -w panel` and commit the regen (CI drift gate).

---

### Task 1: Store method `InsertCheckinActionAt`

**Files:**
- Modify: `backend/internal/store/pg_store.go` (after `InsertCheckinAction`, ~line 976)
- Modify: `backend/internal/store/interface.go` (after the `InsertCheckinAction` declaration, ~line 244)
- Modify: `backend/internal/handler/testsupport_test.go` (fakeStore field ~line 76, method ~line 319)
- Create: `backend/internal/store/pg_store_checkin_action_at_test.go`

**Interfaces:**
- Consumes: existing `checkinActionExecutor` interface, `PGStore.db`.
- Produces (used by Tasks 2-4):
  - `func insertCheckinActionAt(ctx context.Context, exec checkinActionExecutor, eventID, attendeeID uuid.UUID, action string, stationID *uuid.UUID, staffUserID *uuid.UUID, at *time.Time) error` (package-private, tx-capable)
  - Store interface: `InsertCheckinActionAt(ctx context.Context, eventID, attendeeID uuid.UUID, action string, stationID *uuid.UUID, staffUserID *uuid.UUID, at *time.Time) error`
  - fakeStore hook: `insertCheckinActionAt func(eventID, attendeeID uuid.UUID, action string, stationID *uuid.UUID, staffUserID *uuid.UUID, at *time.Time) error`

- [ ] **Step 1: Write the failing test**

Create `backend/internal/store/pg_store_checkin_action_at_test.go`:

```go
package store

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	pgxmock "github.com/pashagolub/pgxmock/v4"
)

// checkinActionsInsertAtSQLPattern pins InsertCheckinActionAt's exact
// statement (2026-07-19 event-wide actions-feed design): identical to
// checkinActionInsertSQL except created_at is an explicit bind with a
// COALESCE($6, now()) fallback, and staff_user_id is bound as a nullable
// pointer. The original statement is deliberately NOT reused/extended —
// its byte-for-byte text is a P4.1 pgxmock contract, and its DEFAULT
// now() is load-bearing for the station path's transaction-stable
// checked_in_at == created_at equality.
const checkinActionsInsertAtSQLPattern = `INSERT INTO checkin_actions \(event_id, attendee_id, station_id, action, staff_user_id, created_at\) VALUES \(\$1, \$2, \$3, \$4, \$5, COALESCE\(\$6, now\(\)\)\)`

// TestInsertCheckinActionAt_ExplicitTimestamp proves the batch/legacy-path
// contract: a non-nil `at` is bound verbatim as $6 — the caller passes the
// exact value it persisted into attendees.checked_in_at, so the monitor's
// current-period predicate (ca.created_at >= a.checked_in_at) holds by
// equality with zero clock dependence.
func TestInsertCheckinActionAt_ExplicitTimestamp(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID, attendeeID, staffUserID := uuid.New(), uuid.New(), uuid.New()
	at := time.Date(2026, 7, 19, 9, 30, 0, 0, time.UTC)

	mock.ExpectExec(checkinActionsInsertAtSQLPattern).
		WithArgs(eventID, attendeeID, (*uuid.UUID)(nil), "checkin", &staffUserID, &at).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))

	s := &PGStore{db: mock}
	if err := s.InsertCheckinActionAt(context.Background(), eventID, attendeeID, "checkin", nil, &staffUserID, &at); err != nil {
		t.Fatalf("InsertCheckinActionAt: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestInsertCheckinActionAt_NilOptionalsFallBackToDefaults proves nil
// staff/at bind as SQL NULLs — COALESCE($6, now()) then stamps server time
// (the handler 'undo' rows' contract), and staff_user_id stays NULL for
// callers without a resolvable user.
func TestInsertCheckinActionAt_NilOptionalsFallBackToDefaults(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	eventID, attendeeID := uuid.New(), uuid.New()

	mock.ExpectExec(checkinActionsInsertAtSQLPattern).
		WithArgs(eventID, attendeeID, (*uuid.UUID)(nil), "undo", (*uuid.UUID)(nil), (*time.Time)(nil)).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))

	s := &PGStore{db: mock}
	if err := s.InsertCheckinActionAt(context.Background(), eventID, attendeeID, "undo", nil, nil, nil); err != nil {
		t.Fatalf("InsertCheckinActionAt: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/store/ -run TestInsertCheckinActionAt -v`
Expected: FAIL — compile error `s.InsertCheckinActionAt undefined`.

- [ ] **Step 3: Write minimal implementation**

In `backend/internal/store/pg_store.go`, directly after the `InsertCheckinAction` method (~line 976), add:

```go
// checkinActionInsertAtSQL is InsertCheckinActionAt's statement (2026-07-19
// event-wide actions-feed design): identical to checkinActionInsertSQL
// except created_at is an explicit bind with a COALESCE($6, now())
// fallback and staff_user_id is nullable. It is a SEPARATE statement, not
// an extension of checkinActionInsertSQL — that statement's byte-for-byte
// text is a P4.1 pgxmock contract, and its created_at DEFAULT now() is
// load-bearing for the station path (transaction-stable equality with
// checked_in_at = now() inside CheckInAttendee's tx).
const checkinActionInsertAtSQL = `INSERT INTO checkin_actions (event_id, attendee_id, station_id, action, staff_user_id, created_at) VALUES ($1, $2, $3, $4, $5, COALESCE($6, now()))`

// insertCheckinActionAt is the shared implementation behind
// PGStore.InsertCheckinActionAt and ApplyBatchCheckin's in-transaction
// 'checkin' row — mirroring how insertCheckinAction serves both the pool
// and open-tx callers via checkinActionExecutor.
func insertCheckinActionAt(ctx context.Context, exec checkinActionExecutor, eventID, attendeeID uuid.UUID, action string, stationID *uuid.UUID, staffUserID *uuid.UUID, at *time.Time) error {
	_, err := exec.Exec(ctx, checkinActionInsertAtSQL, eventID, attendeeID, stationID, action, staffUserID, at)
	return err
}

// InsertCheckinActionAt records one checkin_actions feed row standalone,
// against the pool, with an EXPLICIT created_at (nil → now()) — the
// non-station write paths' variant of InsertCheckinAction (2026-07-19
// event-wide actions-feed design). Callers pass `at` equal to the exact
// value they persisted into attendees.checked_in_at so the monitor's
// current-period predicate (ca.created_at >= a.checked_in_at) holds by
// equality regardless of app/db clock skew. Contract: like
// InsertCheckinAction, this never re-validates ids and callers treat a
// failure as best-effort/non-fatal (log-don't-fail) — the state-changing
// write it annotates has already committed.
func (s *PGStore) InsertCheckinActionAt(ctx context.Context, eventID, attendeeID uuid.UUID, action string, stationID *uuid.UUID, staffUserID *uuid.UUID, at *time.Time) error {
	return insertCheckinActionAt(ctx, s.db, eventID, attendeeID, action, stationID, staffUserID, at)
}
```

In `backend/internal/store/interface.go`, directly after the `InsertCheckinAction` declaration (~line 244), add:

```go
	// InsertCheckinActionAt is InsertCheckinAction's explicit-created_at,
	// nullable-staff variant (2026-07-19 event-wide actions-feed design),
	// used by the non-station write paths (mobile batch, legacy attendee
	// PUT, sync push) so the feed row's created_at exactly equals the
	// checked_in_at those paths persisted (nil at → now(); nil staffUserID
	// → NULL). Same contract as InsertCheckinAction otherwise: no
	// re-validation, callers treat failure as best-effort/non-fatal.
	InsertCheckinActionAt(ctx context.Context, eventID, attendeeID uuid.UUID, action string, stationID *uuid.UUID, staffUserID *uuid.UUID, at *time.Time) error
```

In `backend/internal/handler/testsupport_test.go`, after the `insertCheckinAction` field (~line 76), add the hook field:

```go
	insertCheckinActionAt         func(eventID, attendeeID uuid.UUID, action string, stationID *uuid.UUID, staffUserID *uuid.UUID, at *time.Time) error
```

and after the `InsertCheckinAction` method (~line 319), add:

```go
func (f *fakeStore) InsertCheckinActionAt(_ context.Context, eventID, attendeeID uuid.UUID, action string, stationID *uuid.UUID, staffUserID *uuid.UUID, at *time.Time) error {
	return f.insertCheckinActionAt(eventID, attendeeID, action, stationID, staffUserID, at)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./internal/store/ -run TestInsertCheckinActionAt -v && go build ./...`
Expected: both tests PASS; whole module compiles (handler package too).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/store/pg_store.go backend/internal/store/interface.go backend/internal/store/pg_store_checkin_action_at_test.go backend/internal/handler/testsupport_test.go
git commit -m "backend: add InsertCheckinActionAt store method (explicit created_at)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `ApplyBatchCheckin` — tx-wrapped guarded UPDATE + action row

**Files:**
- Modify: `backend/internal/store/pg_store_batch.go` (imports; the `case "checkin":` branch, lines ~68-111; the method doc comment lines ~44-52)
- Modify: `backend/internal/store/pg_store_batch_test.go` (the three tests that script the guarded UPDATE)

**Interfaces:**
- Consumes: `insertCheckinActionAt` (Task 1), `s.db.Begin` (already used by `CheckInAttendee`).
- Produces: no signature changes — `ApplyBatchCheckin` behavior only.

- [ ] **Step 1: Update the three affected tests to expect the transaction**

In `backend/internal/store/pg_store_batch_test.go`:

(1) `TestApplyBatchCheckin_CheckinPersistsDeviceAndPointName` — replace the guarded-UPDATE expectation block (lines ~59-64) with:

```go
	// The kind=checkin branch now runs inside ONE short transaction
	// (2026-07-19 event-wide actions-feed design): the guarded UPDATE and —
	// when it wins — the 'checkin' feed row commit atomically, mirroring
	// CheckInAttendee. The batch_checkin_log insert stays OUTSIDE the tx.
	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE attendees\s+SET checkin_status = true`).
		WithArgs(at, &staffUserID, &deviceNumber, &pointName, attendeeID).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	// The event-wide actions-feed row: station-less (NULL station), stamped
	// with created_at = item.At — the exact value the UPDATE above wrote
	// into checked_in_at, so the monitor's current-period predicate holds
	// by equality.
	mock.ExpectExec(`INSERT INTO checkin_actions \(event_id, attendee_id, station_id, action, staff_user_id, created_at\)`).
		WithArgs(eventID, attendeeID, (*uuid.UUID)(nil), "checkin", &staffUserID, &at).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))
	mock.ExpectCommit()
```

(2) `TestApplyBatchCheckin_AlreadyCheckedInByAnotherDeviceDoesNotRewrite` — replace its guarded-UPDATE expectation block (lines ~256-258) with:

```go
	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE attendees\s+SET checkin_status = true`).
		WithArgs(newAt, &staffUserID, &newDevice, &newPoint, attendeeID).
		WillReturnResult(pgxmock.NewResult("UPDATE", 0))
	// No checkin_actions insert is scripted: a 0-row guarded UPDATE means
	// no state change happened here — an implementation that inserted a
	// feed row anyway would fail on the unexpected exec before Commit.
	mock.ExpectCommit()
```

(3) `TestApplyBatchCheckin_ConcurrentCheckinsRaceSecondCallGetsAlreadyCheckedIn` — wrap BOTH calls' guarded UPDATEs the same way: the first call's block (lines ~412-414) becomes Begin → UPDATE(1 row) → checkin_actions INSERT (`WithArgs(eventID, attendeeID, (*uuid.UUID)(nil), "checkin", &staffUserID, &firstAt)`) → Commit; the second call's block (lines ~454-456) becomes Begin → UPDATE(0 rows) → Commit with no INSERT.

`TestApplyBatchCheckin_ZoneEntryDoesNotTouchCheckinDeviceOrPoint` and `TestApplyBatchCheckin_DuplicateClientUUIDReturnsDistinctOutcome` are untouched — neither reaches the checkin branch, and both would fail on any unexpected Begin/insert if the implementation leaked the tx or the feed row into their paths.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./internal/store/ -run TestApplyBatchCheckin -v`
Expected: the three updated tests FAIL (unexpected call: Exec instead of Begin); the two untouched tests PASS.

- [ ] **Step 3: Implement the transaction in `ApplyBatchCheckin`**

In `backend/internal/store/pg_store_batch.go`, extend imports:

```go
import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)
```

Replace the `case "checkin":` branch's guarded-UPDATE section (from `deviceNumber := item.DeviceNumber` through the `outcome = BatchCheckinAlreadyCheckedIn` close, lines ~92-111) with:

```go
		// The state transition itself must be atomic at the database level.
		// This single guarded UPDATE makes Postgres the sole arbiter of which
		// concurrent request (if any) actually performs the check-in: only
		// the request whose UPDATE flips checkin_status from false to true
		// affects a row. Any other concurrent request's guarded UPDATE
		// affects zero rows — it never overwrites the row that already won,
		// and is reported as BatchCheckinAlreadyCheckedIn rather than
		// (incorrectly) BatchCheckinCreated.
		//
		// The UPDATE and — when it wins — the event-wide actions-feed row
		// (2026-07-19 design) run in ONE short transaction, mirroring
		// CheckInAttendee: the feed row commits atomically with the state
		// change, and a failure rolls BOTH back so a client retry (whose
		// client_uuid was never logged) re-applies cleanly.
		deviceNumber := item.DeviceNumber
		tx, err := s.db.Begin(ctx)
		if err != nil {
			return BatchCheckinCreated, err
		}
		defer func() {
			if rbErr := tx.Rollback(ctx); rbErr != nil && !errors.Is(rbErr, pgx.ErrTxClosed) {
				log.Printf("rollback batch check-in: %v", rbErr)
			}
		}()
		tag, err := tx.Exec(ctx,
			`UPDATE attendees
			 SET checkin_status = true, checked_in_at = $1, checked_in_by = $2,
			     checked_in_device_number = $3, checked_in_point_name = $4, updated_at = NOW()
			 WHERE id = $5 AND checkin_status = false AND deleted_at IS NULL`,
			item.At, &staffUserID, &deviceNumber, item.PointName, item.AttendeeID,
		)
		if err != nil {
			return BatchCheckinCreated, err
		}
		if tag.RowsAffected() == 1 {
			outcome = BatchCheckinCreated
			// Event-wide actions feed (2026-07-19 design): a station-less
			// 'checkin' row stamped with created_at = item.At — the exact
			// value the UPDATE above wrote into checked_in_at, so the
			// monitor's current-period predicate (ca.created_at >=
			// a.checked_in_at) holds by equality with zero clock
			// dependence (the offline device's clock skew is a
			// pre-existing trust: checked_in_at already carries it).
			// NULL station_id lands the attendee in the monitor's
			// unattributed bucket via the existing join, preserving
			// sum(zones)+unattributed == checked_in by construction.
			if err := insertCheckinActionAt(ctx, tx, eventID, item.AttendeeID, "checkin", nil, &staffUserID, &item.At); err != nil {
				return BatchCheckinCreated, err
			}
		} else {
			// Someone else's check-in already landed for this attendee (or the
			// row was concurrently soft-deleted after the existence check
			// above) — no write was made here, and this request's data must
			// not silently overwrite whatever check-in already exists. No
			// feed row either: nothing changed.
			outcome = BatchCheckinAlreadyCheckedIn
		}
		if err := tx.Commit(ctx); err != nil {
			return BatchCheckinCreated, err
		}
```

Also update the method's doc comment sentence "This is intentionally NOT wrapped in one cross-call transaction" (lines ~44-52) to scope the claim, e.g.:

```go
// The batch_checkin_log insert is intentionally NOT in any shared
// transaction — each underlying write has its own uniqueness guarantee:
// the kind=checkin write is a single `UPDATE ... WHERE checkin_status =
// false` guarded update run in one short tx together with its
// event-wide actions-feed row (2026-07-19 design — the tx makes the feed
// row atomic with the state change, NOT the dedup), zone_checkins has a
// UNIQUE (attendee_id, zone_id, event_day) constraint, and
// batch_checkin_log's PRIMARY KEY on client_uuid means even a true
// concurrent-retry race can only produce one log row, which is what the
// mobile client's dedup depends on.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./internal/store/ -run TestApplyBatchCheckin -v`
Expected: all five PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/store/pg_store_batch.go backend/internal/store/pg_store_batch_test.go
git commit -m "backend: batch check-ins write event-wide checkin_actions rows atomically

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Legacy `PUT /api/attendees/{id}` — transition-gated action rows

**Files:**
- Modify: `backend/internal/handler/attendees.go` (`UpdateAttendeeHandler`, the publish block at lines ~355-359)
- Create: `backend/internal/handler/checkin_actions_feed_test.go`

**Interfaces:**
- Consumes: `h.Store.InsertCheckinActionAt(...)` (Task 1), existing `beforeCheckinStatus`, `userID` (both already in the handler), `fakeStore.insertCheckinActionAt` hook (Task 1).
- Produces: nothing new for later tasks (Task 4 uses the same store method independently).

- [ ] **Step 1: Write the failing tests**

Create `backend/internal/handler/checkin_actions_feed_test.go`:

```go
package handler

import (
	"errors"
	"net/http"
	"testing"
	"time"

	"idento/backend/internal/broker"
	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// --- 2026-07-19 event-wide checkin_actions design ---------------------------
//
// The monitor's rate_per_min / peak / recent feed aggregate from
// checkin_actions, but the legacy PUT /api/attendees/{id} (which is ALSO the
// mobile app's ONLINE check-in path) and POST /api/sync flip
// attendees.checkin_status without writing action rows — a mobile-only
// event's monitor showed checked_in rising while scans/min stayed 0. These
// tests pin the transition-gated, station-less, log-don't-fail inserts the
// two handlers now perform. See
// docs/superpowers/specs/2026-07-19-monitor-event-wide-checkin-actions-design.md.

// recordedAction captures one fakeStore.insertCheckinActionAt call.
type recordedAction struct {
	eventID     uuid.UUID
	attendeeID  uuid.UUID
	action      string
	stationID   *uuid.UUID
	staffUserID *uuid.UUID
	at          *time.Time
}

// TestUpdateAttendeeHandler_RecordsCheckinActionOnFlip proves the false ->
// true flip writes exactly one station-less 'checkin' row stamped with the
// EXACT checked_in_at the handler persisted (the current-period predicate's
// equality contract), attributed to the JWT user.
func TestUpdateAttendeeHandler_RecordsCheckinActionOnFlip(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)
	attendee.CheckinStatus = false
	staffUser := contractUser("staff@org.io")
	userID := uuid.New()

	var persistedCheckedInAt *time.Time
	var got []recordedAction

	h := New(&fakeStore{
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		getUserByID:     func(uuid.UUID) (*models.User, error) { return staffUser, nil },
		updateAttendee: func(a *models.Attendee) error {
			persistedCheckedInAt = a.CheckedInAt
			return nil
		},
		insertCheckinActionAt: func(eventID, attendeeID uuid.UUID, action string, stationID *uuid.UUID, staffUserID *uuid.UUID, at *time.Time) error {
			got = append(got, recordedAction{eventID, attendeeID, action, stationID, staffUserID, at})
			return nil
		},
	})
	h.Broker = broker.NewMemBroker()

	e := echo.New()
	c, rec := newAuthedContextWithUserID(e, http.MethodPut, "/api/attendees/"+attendee.ID.String(), `{"checkin_status":true}`, tenantID.String(), userID, "staff")
	c.SetPath("/api/attendees/:id")
	c.SetParamNames("id")
	c.SetParamValues(attendee.ID.String())

	if err := h.UpdateAttendeeHandler(c); err != nil {
		t.Fatalf("UpdateAttendeeHandler: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if len(got) != 1 {
		t.Fatalf("insertCheckinActionAt calls = %d, want exactly 1", len(got))
	}
	g := got[0]
	if g.action != "checkin" {
		t.Errorf("action = %q, want %q", g.action, "checkin")
	}
	if g.eventID != event.ID || g.attendeeID != attendee.ID {
		t.Errorf("ids = (%s, %s), want (%s, %s)", g.eventID, g.attendeeID, event.ID, attendee.ID)
	}
	if g.stationID != nil {
		t.Errorf("stationID = %v, want nil (legacy path has no station provenance)", g.stationID)
	}
	if g.staffUserID == nil || *g.staffUserID != userID {
		t.Errorf("staffUserID = %v, want JWT user %s", g.staffUserID, userID)
	}
	if g.at == nil || persistedCheckedInAt == nil || !g.at.Equal(*persistedCheckedInAt) {
		t.Errorf("at = %v, want the persisted CheckedInAt %v (equality is the current-period predicate's contract)", g.at, persistedCheckedInAt)
	}
}

// TestUpdateAttendeeHandler_RecordsUndoActionOnUncheck proves the true ->
// false flip writes exactly one station-less 'undo' row with nil at
// (created_at falls back to now(); checked_in_at is nulled, so no predicate
// involvement).
func TestUpdateAttendeeHandler_RecordsUndoActionOnUncheck(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)
	attendee.CheckinStatus = true
	was := attendee.UpdatedAt
	attendee.CheckedInAt = &was
	staffUser := contractUser("staff@org.io")
	userID := uuid.New()

	var got []recordedAction
	h := New(&fakeStore{
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		getUserByID:     func(uuid.UUID) (*models.User, error) { return staffUser, nil },
		updateAttendee:  func(*models.Attendee) error { return nil },
		insertCheckinActionAt: func(eventID, attendeeID uuid.UUID, action string, stationID *uuid.UUID, staffUserID *uuid.UUID, at *time.Time) error {
			got = append(got, recordedAction{eventID, attendeeID, action, stationID, staffUserID, at})
			return nil
		},
	})
	h.Broker = broker.NewMemBroker()

	e := echo.New()
	c, rec := newAuthedContextWithUserID(e, http.MethodPut, "/api/attendees/"+attendee.ID.String(), `{"checkin_status":false}`, tenantID.String(), userID, "staff")
	c.SetPath("/api/attendees/:id")
	c.SetParamNames("id")
	c.SetParamValues(attendee.ID.String())

	if err := h.UpdateAttendeeHandler(c); err != nil {
		t.Fatalf("UpdateAttendeeHandler: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if len(got) != 1 {
		t.Fatalf("insertCheckinActionAt calls = %d, want exactly 1", len(got))
	}
	g := got[0]
	if g.action != "undo" {
		t.Errorf("action = %q, want %q", g.action, "undo")
	}
	if g.stationID != nil {
		t.Errorf("stationID = %v, want nil", g.stationID)
	}
	if g.at != nil {
		t.Errorf("at = %v, want nil (undo rows use DEFAULT now())", g.at)
	}
	if g.staffUserID == nil || *g.staffUserID != userID {
		t.Errorf("staffUserID = %v, want JWT user %s", g.staffUserID, userID)
	}
}

// TestUpdateAttendeeHandler_NoActionRowWhenStatusUnchanged proves a no-op
// PUT (re-sending the same status) writes NOTHING — the same gate that
// already guards the monitor publish.
func TestUpdateAttendeeHandler_NoActionRowWhenStatusUnchanged(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)
	attendee.CheckinStatus = true
	was := attendee.UpdatedAt
	attendee.CheckedInAt = &was
	staffUser := contractUser("staff@org.io")

	var got []recordedAction
	h := New(&fakeStore{
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		getUserByID:     func(uuid.UUID) (*models.User, error) { return staffUser, nil },
		updateAttendee:  func(*models.Attendee) error { return nil },
		insertCheckinActionAt: func(eventID, attendeeID uuid.UUID, action string, stationID *uuid.UUID, staffUserID *uuid.UUID, at *time.Time) error {
			got = append(got, recordedAction{eventID, attendeeID, action, stationID, staffUserID, at})
			return nil
		},
	})
	h.Broker = broker.NewMemBroker()

	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodPut, "/api/attendees/"+attendee.ID.String(), `{"checkin_status":true}`, tenantID.String(), "staff")
	c.SetPath("/api/attendees/:id")
	c.SetParamNames("id")
	c.SetParamValues(attendee.ID.String())

	if err := h.UpdateAttendeeHandler(c); err != nil {
		t.Fatalf("UpdateAttendeeHandler: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if len(got) != 0 {
		t.Fatalf("insertCheckinActionAt calls = %d, want 0 for a no-op PUT", len(got))
	}
}

// TestUpdateAttendeeHandler_ActionInsertFailureIsNonFatal proves
// log-don't-fail: the attendee UPDATE already committed, so a failed feed
// insert must neither fail the request nor suppress the monitor publish.
func TestUpdateAttendeeHandler_ActionInsertFailureIsNonFatal(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)
	attendee.CheckinStatus = false
	staffUser := contractUser("staff@org.io")

	h := New(&fakeStore{
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		getUserByID:     func(uuid.UUID) (*models.User, error) { return staffUser, nil },
		updateAttendee:  func(*models.Attendee) error { return nil },
		insertCheckinActionAt: func(uuid.UUID, uuid.UUID, string, *uuid.UUID, *uuid.UUID, *time.Time) error {
			return errors.New("boom")
		},
	})
	mem := broker.NewMemBroker()
	h.Broker = mem
	ch, unsubscribe := mem.Subscribe(event.ID)
	defer unsubscribe()

	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodPut, "/api/attendees/"+attendee.ID.String(), `{"checkin_status":true}`, tenantID.String(), "staff")
	c.SetPath("/api/attendees/:id")
	c.SetParamNames("id")
	c.SetParamValues(attendee.ID.String())

	if err := h.UpdateAttendeeHandler(c); err != nil {
		t.Fatalf("UpdateAttendeeHandler: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200 despite feed-insert failure, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if !pendingSignal(ch) {
		t.Fatal("publish signal = false, want true — a failed feed insert must not suppress the monitor publish")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./internal/handler/ -run TestUpdateAttendeeHandler_Records -v && go test ./internal/handler/ -run 'TestUpdateAttendeeHandler_NoActionRow|TestUpdateAttendeeHandler_ActionInsertFailure' -v`
Expected: the two `Records` tests and the failure test FAIL (`insertCheckinActionAt` never called → `len(got) != 1` / nil-func panic is acceptable as a failure mode here); `NoActionRow` PASSES vacuously (that's fine — it's the regression guard).

- [ ] **Step 3: Implement in `UpdateAttendeeHandler`**

In `backend/internal/handler/attendees.go`, replace the publish block (lines ~355-359):

```go
	// Finding B3: publish only when checkin_status actually flipped — see
	// beforeCheckinStatus's doc comment above.
	if existingAttendee.CheckinStatus != beforeCheckinStatus {
		h.publishCheckinEvent(c.Request().Context(), existingAttendee.EventID)
	}
```

with:

```go
	// Finding B3: publish only when checkin_status actually flipped — see
	// beforeCheckinStatus's doc comment above. The same gate now also
	// writes the event-wide actions-feed row (2026-07-19 design): this
	// legacy PUT is the mobile app's ONLINE check-in path, and without a
	// feed row a mobile-only event's monitor showed checked_in rising
	// while scans/min stayed 0. The insert runs BEFORE the publish so a
	// publish-triggered snapshot refetch already sees the row, and is
	// log-don't-fail — the attendee UPDATE above already committed, so
	// failing the request here would report a write that DID happen as
	// failed.
	if existingAttendee.CheckinStatus != beforeCheckinStatus {
		if existingAttendee.CheckinStatus {
			// false -> true: station-less 'checkin' row stamped with the
			// EXACT CheckedInAt persisted above, so the monitor's
			// current-period predicate (ca.created_at >= a.checked_in_at)
			// holds by equality regardless of app/db clock skew.
			if err := h.Store.InsertCheckinActionAt(c.Request().Context(), existingAttendee.EventID, existingAttendee.ID, "checkin", nil, &userID, existingAttendee.CheckedInAt); err != nil {
				c.Logger().Errorf("attendee PUT: checkin feed row insert failed (event %s, attendee %s): %v", existingAttendee.EventID, existingAttendee.ID, err)
			}
		} else {
			// true -> false: symmetric 'undo' row (nil at -> now()); makes
			// legacy clears visible to the feed and to the monitor's
			// latest-state attribution directly.
			if err := h.Store.InsertCheckinActionAt(c.Request().Context(), existingAttendee.EventID, existingAttendee.ID, "undo", nil, &userID, nil); err != nil {
				c.Logger().Errorf("attendee PUT: undo feed row insert failed (event %s, attendee %s): %v", existingAttendee.EventID, existingAttendee.ID, err)
			}
		}
		h.publishCheckinEvent(c.Request().Context(), existingAttendee.EventID)
	}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./internal/handler/ -run 'TestUpdateAttendeeHandler' -v`
Expected: all UpdateAttendeeHandler tests PASS — the four new ones AND the three pre-existing publish tests in `legacy_publish_test.go` (their fakeStores don't set `insertCheckinActionAt`; the flip test there WILL now call it → **if it panics, add the no-op hook `insertCheckinActionAt: func(uuid.UUID, uuid.UUID, string, *uuid.UUID, *uuid.UUID, *time.Time) error { return nil }` to the fakeStores in `legacy_publish_test.go`'s two flipping UpdateAttendeeHandler tests** — the unchanged/no-op test needs nothing).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/handler/attendees.go backend/internal/handler/checkin_actions_feed_test.go backend/internal/handler/legacy_publish_test.go
git commit -m "backend: legacy attendee PUT writes event-wide checkin/undo feed rows

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `SyncPush` — transition-gated action rows

**Files:**
- Modify: `backend/internal/handler/sync.go` (the Updated-attendees loop, lines ~130-160)
- Modify: `backend/internal/handler/checkin_actions_feed_test.go` (append SyncPush tests)

**Interfaces:**
- Consumes: `h.Store.InsertCheckinActionAt(...)` (Task 1), `claimsFromContext` (authz.go), `fakeStore.insertCheckinActionAt` hook (Task 1), `recordedAction` (Task 3's test type, same file).
- Produces: nothing further.

- [ ] **Step 1: Write the failing tests**

Append to `backend/internal/handler/checkin_actions_feed_test.go` (add `"encoding/json"` to its imports):

```go
// syncPushBody marshals a one-attendee Updated push, the shape the legacy
// WatermelonDB-era mobile sync client sends.
func syncPushBody(t *testing.T, a models.Attendee) string {
	t.Helper()
	b, err := json.Marshal(SyncPushRequest{Changes: SyncPushChanges{Attendees: SyncPushEntityChanges{Updated: []models.Attendee{a}}}})
	if err != nil {
		t.Fatalf("marshal sync push body: %v", err)
	}
	return string(b)
}

// TestSyncPush_RecordsCheckinActionOnFlip proves a sync push that flips an
// attendee false -> true writes one station-less 'checkin' row stamped with
// the CLIENT-supplied CheckedInAt (the value UpdateAttendee persists
// verbatim), against the TRUSTED existing attendee's event id.
func TestSyncPush_RecordsCheckinActionOnFlip(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	existing := contractAttendee(event.ID)
	existing.CheckinStatus = false
	userID := uuid.New()
	clientAt := time.Date(2026, 7, 19, 9, 30, 0, 0, time.UTC)

	incoming := *existing
	incoming.CheckinStatus = true
	incoming.CheckedInAt = &clientAt

	var got []recordedAction
	h := New(&fakeStore{
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return existing, nil },
		updateAttendee:  func(*models.Attendee) error { return nil },
		insertCheckinActionAt: func(eventID, attendeeID uuid.UUID, action string, stationID *uuid.UUID, staffUserID *uuid.UUID, at *time.Time) error {
			got = append(got, recordedAction{eventID, attendeeID, action, stationID, staffUserID, at})
			return nil
		},
	})
	h.Broker = broker.NewMemBroker()

	e := echo.New()
	c, rec := newAuthedContextWithUserID(e, http.MethodPost, "/api/sync", syncPushBody(t, incoming), tenantID.String(), userID, "staff")

	if err := h.SyncPush(c); err != nil {
		t.Fatalf("SyncPush: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if len(got) != 1 {
		t.Fatalf("insertCheckinActionAt calls = %d, want exactly 1", len(got))
	}
	g := got[0]
	if g.action != "checkin" {
		t.Errorf("action = %q, want %q", g.action, "checkin")
	}
	if g.eventID != event.ID || g.attendeeID != existing.ID {
		t.Errorf("ids = (%s, %s), want trusted (%s, %s)", g.eventID, g.attendeeID, event.ID, existing.ID)
	}
	if g.stationID != nil {
		t.Errorf("stationID = %v, want nil", g.stationID)
	}
	if g.staffUserID == nil || *g.staffUserID != userID {
		t.Errorf("staffUserID = %v, want JWT user %s", g.staffUserID, userID)
	}
	if g.at == nil || !g.at.Equal(clientAt) {
		t.Errorf("at = %v, want client CheckedInAt %v", g.at, clientAt)
	}
}

// TestSyncPush_RecordsUndoActionOnUncheck proves the symmetric true ->
// false sync write produces one 'undo' row with nil at.
func TestSyncPush_RecordsUndoActionOnUncheck(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	existing := contractAttendee(event.ID)
	existing.CheckinStatus = true
	was := existing.UpdatedAt
	existing.CheckedInAt = &was
	userID := uuid.New()

	incoming := *existing
	incoming.CheckinStatus = false
	incoming.CheckedInAt = nil

	var got []recordedAction
	h := New(&fakeStore{
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return existing, nil },
		updateAttendee:  func(*models.Attendee) error { return nil },
		insertCheckinActionAt: func(eventID, attendeeID uuid.UUID, action string, stationID *uuid.UUID, staffUserID *uuid.UUID, at *time.Time) error {
			got = append(got, recordedAction{eventID, attendeeID, action, stationID, staffUserID, at})
			return nil
		},
	})
	h.Broker = broker.NewMemBroker()

	e := echo.New()
	c, rec := newAuthedContextWithUserID(e, http.MethodPost, "/api/sync", syncPushBody(t, incoming), tenantID.String(), userID, "staff")

	if err := h.SyncPush(c); err != nil {
		t.Fatalf("SyncPush: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if len(got) != 1 {
		t.Fatalf("insertCheckinActionAt calls = %d, want exactly 1", len(got))
	}
	if got[0].action != "undo" {
		t.Errorf("action = %q, want %q", got[0].action, "undo")
	}
	if got[0].at != nil {
		t.Errorf("at = %v, want nil (undo rows use DEFAULT now())", got[0].at)
	}
}

// TestSyncPush_NoActionRowWhenStatusUnchanged proves a sync update that
// leaves checkin_status as-is (e.g. a name edit) writes no feed row.
func TestSyncPush_NoActionRowWhenStatusUnchanged(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	existing := contractAttendee(event.ID)
	existing.CheckinStatus = true
	was := existing.UpdatedAt
	existing.CheckedInAt = &was

	incoming := *existing
	incoming.FirstName = "Renamed"

	var got []recordedAction
	h := New(&fakeStore{
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return existing, nil },
		updateAttendee:  func(*models.Attendee) error { return nil },
		insertCheckinActionAt: func(eventID, attendeeID uuid.UUID, action string, stationID *uuid.UUID, staffUserID *uuid.UUID, at *time.Time) error {
			got = append(got, recordedAction{eventID, attendeeID, action, stationID, staffUserID, at})
			return nil
		},
	})
	h.Broker = broker.NewMemBroker()

	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodPost, "/api/sync", syncPushBody(t, incoming), tenantID.String(), "staff")

	if err := h.SyncPush(c); err != nil {
		t.Fatalf("SyncPush: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if len(got) != 0 {
		t.Fatalf("insertCheckinActionAt calls = %d, want 0 when checkin_status did not change", len(got))
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./internal/handler/ -run 'TestSyncPush_Records|TestSyncPush_NoActionRow' -v`
Expected: the two `Records` tests FAIL (`len(got) = 0, want 1`); `NoActionRow` passes vacuously.

- [ ] **Step 3: Implement in `SyncPush`**

In `backend/internal/handler/sync.go`, after the `affectedEvents` declaration (~line 130), add:

```go
	// staffUserID attributes this push's event-wide actions-feed rows
	// (2026-07-19 design) to the syncing user. The route sits behind the
	// JWT middleware so claims are normally present; if the token's user
	// id is unparseable the rows carry NULL staff_user_id (the column is
	// nullable) rather than a fabricated id.
	var staffUserID *uuid.UUID
	if claims, err := claimsFromContext(c); err == nil {
		if uid, err := uuid.Parse(claims.UserID); err == nil {
			staffUserID = &uid
		}
	}
```

Then inside the Updated loop, capture the pre-write status right after the tenant-ownership check passes (after the `event == nil` continue, ~line 144):

```go
		// Captured BEFORE UpdateAttendee overwrites the row: the feed-row
		// gate below needs an exact before/after CheckinStatus compare,
		// same pattern as UpdateAttendeeHandler's beforeCheckinStatus.
		beforeCheckinStatus := existingAttendee.CheckinStatus
```

and after the successful `UpdateAttendee` (immediately before the `affectedEvents[...] = struct{}{}` line, ~line 159), add:

```go
		// Event-wide actions feed (2026-07-19 design): this raw sync write
		// is a legacy check-in path — without a feed row its check-ins are
		// invisible to the monitor's rate/peak/recent. Transition-gated
		// (no-op pushes write nothing), station-less, and log-don't-fail:
		// the attendee UPDATE above already succeeded, and sync
		// deliberately never fails the whole push for one attendee.
		if attendee.CheckinStatus != beforeCheckinStatus {
			if attendee.CheckinStatus {
				// created_at = the CLIENT-supplied CheckedInAt exactly as
				// UpdateAttendee just persisted it into checked_in_at (nil
				// → now(); a nil checked_in_at with status=true already
				// reads as unattributed via the overview's defensive
				// checked_in_at IS NOT NULL guard).
				if err := h.Store.InsertCheckinActionAt(c.Request().Context(), existingAttendee.EventID, existingAttendee.ID, "checkin", nil, staffUserID, attendee.CheckedInAt); err != nil {
					c.Logger().Errorf("sync: checkin feed row insert failed (event %s, attendee %s): %v", existingAttendee.EventID, existingAttendee.ID, err)
				}
			} else {
				if err := h.Store.InsertCheckinActionAt(c.Request().Context(), existingAttendee.EventID, existingAttendee.ID, "undo", nil, staffUserID, nil); err != nil {
					c.Logger().Errorf("sync: undo feed row insert failed (event %s, attendee %s): %v", existingAttendee.EventID, existingAttendee.ID, err)
				}
			}
		}
```

(`"github.com/google/uuid"` is already imported in sync.go.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./internal/handler/ -run 'TestSyncPush' -v`
Expected: the three new tests PASS, plus the pre-existing SyncPush publish tests in `legacy_publish_test.go` — **if any of those flip checkin_status and panic on the unset hook, add the no-op `insertCheckinActionAt` hook to their fakeStores exactly as in Task 3 Step 4.**

- [ ] **Step 5: Commit**

```bash
git add backend/internal/handler/sync.go backend/internal/handler/checkin_actions_feed_test.go backend/internal/handler/legacy_publish_test.go
git commit -m "backend: sync push writes event-wide checkin/undo feed rows

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Real-Postgres integration test, stale-comment sweep, full gates

**Files:**
- Create: `backend/internal/store/pg_store_actions_feed_integration_test.go`
- Modify: `backend/internal/store/pg_store_monitor.go` (comments ONLY — two stale phrases)
- Verify (expect no change): `backend/openapi.yaml`

**Interfaces:**
- Consumes: real `ApplyBatchCheckin`, `CountRecentCheckins`, `GetMonitorMinuteBuckets`, `GetCheckinActions`, `GetMonitorOverview`.
- Produces: nothing — verification.

- [ ] **Step 1: Write the integration test**

Create `backend/internal/store/pg_store_actions_feed_integration_test.go`:

```go
package store

import (
	"context"
	"os"
	"testing"
	"time"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestApplyBatchCheckin_RealPostgres_EventWideActionsFeed proves, against a
// REAL Postgres, the 2026-07-19 event-wide actions-feed contract for the
// mobile batch path end-to-end: a Created kind=checkin batch item (a) writes
// exactly one station-less 'checkin' action row whose created_at EQUALS both
// item.At and the attendees.checked_in_at the guarded UPDATE persisted (the
// monitor's current-period predicate holds by equality), (b) is counted by
// CountRecentCheckins and lands in its true historical minute bucket in
// GetMonitorMinuteBuckets, (c) appears in GetCheckinActions, and (d) lands in
// GetMonitorOverview's unattributed bucket with the zones+unattributed ==
// checked_in invariant intact — while replays (same client_uuid) and
// already-checked-in retries (new client_uuid) add NO further rows. pgxmock
// cannot prove any of this for real (same rationale as
// TestGetMonitorOverview_RealPostgres_InvariantHoldsByConstruction).
//
// Gated behind TEST_DATABASE_URL and SKIPS when unset. To run locally:
//
//	TEST_DATABASE_URL="postgres://idento:idento_password@localhost:5438/idento_db?sslmode=disable" \
//	  go test ./internal/store/ -run TestApplyBatchCheckin_RealPostgres -v
func TestApplyBatchCheckin_RealPostgres_EventWideActionsFeed(t *testing.T) {
	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping real-Postgres actions-feed test (see doc comment for how to run it)")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("Ping: %v", err)
	}

	s := &PGStore{db: pool}
	if err := s.RunMigrations(); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}

	tenantID, eventID, staffUserID, attendeeID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	zoneID := uuid.New()
	now := time.Now().UTC().Truncate(time.Second)
	at := now.Add(-2 * time.Minute) // "offline scan two minutes ago", flushed now

	if _, err := pool.Exec(ctx,
		`INSERT INTO tenants (id, name, created_at, updated_at) VALUES ($1, $2, $3, $3)`,
		tenantID, "Actions Feed Test Tenant "+tenantID.String(), now,
	); err != nil {
		t.Fatalf("insert tenant: %v", err)
	}
	t.Cleanup(func() {
		// Cascades through users/events -> attendees/checkin_actions/
		// batch_checkin_log/event_zones.
		cctx, ccancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer ccancel()
		if _, err := pool.Exec(cctx, `DELETE FROM tenants WHERE id = $1`, tenantID); err != nil {
			t.Logf("cleanup: failed to delete tenant %s: %v", tenantID, err)
		}
	})

	if _, err := pool.Exec(ctx,
		`INSERT INTO users (id, tenant_id, email, password_hash, role) VALUES ($1, $2, $3, 'x', 'staff')`,
		staffUserID, tenantID, staffUserID.String()+"@actions-feed.test",
	); err != nil {
		t.Fatalf("insert staff user: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO events (id, tenant_id, name, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)`,
		eventID, tenantID, "Actions Feed Test Event", now,
	); err != nil {
		t.Fatalf("insert event: %v", err)
	}
	// One zone with NO stations: mobile check-ins must never attribute to
	// it — it pins the zones side of the invariant at 0.
	if _, err := pool.Exec(ctx,
		`INSERT INTO event_zones (id, event_id, name, order_index, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)`,
		zoneID, eventID, "Zone One", 1, now,
	); err != nil {
		t.Fatalf("insert zone: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO attendees (id, event_id, first_name, last_name, code, checkin_status, created_at, updated_at)
		 VALUES ($1, $2, 'A', 'One', $3, false, $4, $4)`,
		attendeeID, eventID, "CODE-"+uuid.New().String()[:8], now,
	); err != nil {
		t.Fatalf("insert attendee: %v", err)
	}

	firstClientUUID := uuid.New()
	item := &models.BatchCheckinItem{
		ClientUUID:   firstClientUUID,
		AttendeeID:   attendeeID,
		At:           at,
		DeviceNumber: 7,
		Kind:         "checkin",
	}
	outcome, err := s.ApplyBatchCheckin(ctx, eventID, staffUserID, item)
	if err != nil {
		t.Fatalf("ApplyBatchCheckin: %v", err)
	}
	if outcome != BatchCheckinCreated {
		t.Fatalf("outcome = %v, want BatchCheckinCreated", outcome)
	}

	// (a) Exactly one station-less 'checkin' row, created_at == item.At ==
	// the persisted checked_in_at (equality is the predicate contract).
	var gotCreatedAt time.Time
	var gotStation, gotStaff *uuid.UUID
	if err := pool.QueryRow(ctx,
		`SELECT created_at, station_id, staff_user_id FROM checkin_actions WHERE event_id = $1 AND attendee_id = $2 AND action = 'checkin'`,
		eventID, attendeeID,
	).Scan(&gotCreatedAt, &gotStation, &gotStaff); err != nil {
		t.Fatalf("select action row: %v", err)
	}
	if !gotCreatedAt.Equal(at) {
		t.Errorf("action created_at = %v, want item.At %v", gotCreatedAt, at)
	}
	if gotStation != nil {
		t.Errorf("action station_id = %v, want NULL (no station provenance on the batch path)", gotStation)
	}
	if gotStaff == nil || *gotStaff != staffUserID {
		t.Errorf("action staff_user_id = %v, want %s", gotStaff, staffUserID)
	}
	var gotCheckedInAt time.Time
	if err := pool.QueryRow(ctx,
		`SELECT checked_in_at FROM attendees WHERE id = $1`, attendeeID,
	).Scan(&gotCheckedInAt); err != nil {
		t.Fatalf("select checked_in_at: %v", err)
	}
	if !gotCheckedInAt.Equal(gotCreatedAt) {
		t.Errorf("checked_in_at %v != action created_at %v — the current-period predicate's equality contract is broken", gotCheckedInAt, gotCreatedAt)
	}

	// (b) Rate window + minute buckets see the historical stamp.
	count, err := s.CountRecentCheckins(ctx, eventID, now.Add(-5*time.Minute))
	if err != nil {
		t.Fatalf("CountRecentCheckins: %v", err)
	}
	if count != 1 {
		t.Errorf("CountRecentCheckins = %d, want 1 (batch check-in inside the 5-minute window)", count)
	}
	buckets, err := s.GetMonitorMinuteBuckets(ctx, eventID, at.Add(-time.Minute))
	if err != nil {
		t.Fatalf("GetMonitorMinuteBuckets: %v", err)
	}
	wantMinute := at.Truncate(time.Minute)
	foundBucket := false
	for _, b := range buckets {
		if b.Minute.Equal(wantMinute) && b.Count == 1 {
			foundBucket = true
		}
	}
	if !foundBucket {
		t.Errorf("buckets = %+v, want one bucket at %v with count 1 (the scan's TRUE historical minute)", buckets, wantMinute)
	}

	// (c) The recent feed shows it.
	recent, err := s.GetCheckinActions(ctx, eventID, 20)
	if err != nil {
		t.Fatalf("GetCheckinActions: %v", err)
	}
	if len(recent) != 1 || recent[0].Action != "checkin" || recent[0].Attendee.ID != attendeeID {
		t.Errorf("GetCheckinActions = %+v, want exactly the one batch 'checkin' row for attendee %s", recent, attendeeID)
	}

	// (d) Overview: unattributed, invariant intact, zone untouched.
	total, checkedIn, zones, unattributed, err := s.GetMonitorOverview(ctx, eventID)
	if err != nil {
		t.Fatalf("GetMonitorOverview: %v", err)
	}
	if total != 1 || checkedIn != 1 {
		t.Errorf("total/checkedIn = %d/%d, want 1/1", total, checkedIn)
	}
	if unattributed != 1 {
		t.Errorf("unattributed = %d, want 1 (station-less rows never attribute)", unattributed)
	}
	zoneSum := 0
	for _, z := range zones {
		zoneSum += z.CheckedIn
	}
	if zoneSum != 0 {
		t.Errorf("sum(zones) = %d, want 0", zoneSum)
	}
	if zoneSum+unattributed != checkedIn {
		t.Errorf("invariant broken: sum(zones)+unattributed = %d, checked_in = %d", zoneSum+unattributed, checkedIn)
	}

	// Replay (same client_uuid) and a second device's retry (new
	// client_uuid, attendee already checked in) must add NO further rows.
	replayOutcome, err := s.ApplyBatchCheckin(ctx, eventID, staffUserID, item)
	if err != nil {
		t.Fatalf("replay ApplyBatchCheckin: %v", err)
	}
	if replayOutcome != BatchCheckinDuplicateClientUUID {
		t.Fatalf("replay outcome = %v, want BatchCheckinDuplicateClientUUID", replayOutcome)
	}
	secondDevice := &models.BatchCheckinItem{
		ClientUUID:   uuid.New(),
		AttendeeID:   attendeeID,
		At:           now,
		DeviceNumber: 8,
		Kind:         "checkin",
	}
	retryOutcome, err := s.ApplyBatchCheckin(ctx, eventID, staffUserID, secondDevice)
	if err != nil {
		t.Fatalf("second-device ApplyBatchCheckin: %v", err)
	}
	if retryOutcome != BatchCheckinAlreadyCheckedIn {
		t.Fatalf("second-device outcome = %v, want BatchCheckinAlreadyCheckedIn", retryOutcome)
	}
	var actionCount int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM checkin_actions WHERE event_id = $1`, eventID,
	).Scan(&actionCount); err != nil {
		t.Fatalf("count actions: %v", err)
	}
	if actionCount != 1 {
		t.Errorf("checkin_actions rows = %d, want exactly 1 — replays/already-checked-in retries must not pollute the feed", actionCount)
	}
}
```

- [ ] **Step 2: Run the integration test (skip locally is acceptable; run for real if the compose db is up)**

Run: `cd backend && go test ./internal/store/ -run TestApplyBatchCheckin_RealPostgres -v`
Expected: SKIP without `TEST_DATABASE_URL`; with the docker-compose db (`TEST_DATABASE_URL="postgres://idento:idento_password@localhost:5438/idento_db?sslmode=disable"`): PASS. Also re-run the existing fixtures: `go test ./internal/store/ -run 'RealPostgres' -v` — `TestGetMonitorOverview_RealPostgres_InvariantHoldsByConstruction` must still PASS unmodified.

- [ ] **Step 3: Stale-comment sweep in `pg_store_monitor.go` (comments only, zero SQL changes)**

Two phrases wrote the old contract into comments; scope them historically:

1. In the `monitorOverviewSQL` doc comment, part 2 (~line 36): change
   `(e.g. the legacy PUT /api/attendees/{id}, or a mobile batch write)`
   to
   `(e.g. rows predating the 2026-07-19 event-wide actions-feed change, or a legacy path whose log-don't-fail feed insert failed)`.
2. Same doc comment, part 3 (~lines 52-54): change
   `cleared via a LEGACY path that writes NO 'undo' row (e.g. attendee PUT, or a raw sync write), then re-checked-in via a path that ALSO writes no action row`
   to
   `cleared then re-checked-in via writes that produced NO action rows (pre-2026-07-19 legacy traffic, or feed inserts lost to log-don't-fail)`.
3. In `GetMonitorOverview`'s doc comment (~lines 133-135): change
   `(PR #81 round-3 convergence, Backend Finding 2: a legacy clear + legacy re-checkin, neither of which writes an action row, must not inherit attribution...)`
   to
   `(PR #81 round-3 convergence, Backend Finding 2: a clear + re-checkin that left no action rows — pre-2026-07-19 legacy traffic or lost log-don't-fail inserts — must not inherit attribution...)`.

Run: `cd backend && go build ./...` — comments only, must compile identically.

- [ ] **Step 4: Verify openapi.yaml needs no change**

Run: `grep -n 'rate_per_min\|recent\|scans' backend/openapi.yaml | head -30` and read the monitor-section descriptions.
Expected: descriptions speak of "checkin actions", not "station scans" — no edit. **If any description is now false, fix the prose AND run `npm run generate:api -w panel`, committing the regenerated client (CI drift gate).**

- [ ] **Step 5: Full gates**

Run: `cd backend && go vet ./... && go test -race ./...`
Expected: all green (integration tests skip without `TEST_DATABASE_URL`). If `golangci-lint` is installed locally, also run `golangci-lint run ./...`.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/store/pg_store_actions_feed_integration_test.go backend/internal/store/pg_store_monitor.go
git commit -m "backend: integration-prove event-wide actions feed; retire stale station-only comments

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
