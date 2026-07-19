package handler

import (
	"encoding/json"
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
		transitionAttendeeCheckin: func(uuid.UUID, bool, *time.Time, *uuid.UUID) (bool, error) { return true, nil },
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
		getEventByID:              func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeByID:           func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		getUserByID:               func(uuid.UUID) (*models.User, error) { return staffUser, nil },
		updateAttendee:            func(*models.Attendee) error { return nil },
		transitionAttendeeCheckin: func(uuid.UUID, bool, *time.Time, *uuid.UUID) (bool, error) { return true, nil },
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
		// Already checked in + target true: the guarded claim affects 0
		// rows — the DB, not a Go compare, says nothing flipped.
		transitionAttendeeCheckin: func(uuid.UUID, bool, *time.Time, *uuid.UUID) (bool, error) { return false, nil },
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
		getEventByID:              func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeByID:           func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		getUserByID:               func(uuid.UUID) (*models.User, error) { return staffUser, nil },
		updateAttendee:            func(*models.Attendee) error { return nil },
		transitionAttendeeCheckin: func(uuid.UUID, bool, *time.Time, *uuid.UUID) (bool, error) { return true, nil },
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
		getEventByID:              func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeByID:           func(uuid.UUID) (*models.Attendee, error) { return existing, nil },
		updateAttendee:            func(*models.Attendee) error { return nil },
		transitionAttendeeCheckin: func(uuid.UUID, bool, *time.Time, *uuid.UUID) (bool, error) { return true, nil },
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
		getEventByID:              func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeByID:           func(uuid.UUID) (*models.Attendee, error) { return existing, nil },
		updateAttendee:            func(*models.Attendee) error { return nil },
		transitionAttendeeCheckin: func(uuid.UUID, bool, *time.Time, *uuid.UUID) (bool, error) { return true, nil },
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

// TestUpdateAttendeeHandler_LostRaceWritesNoActionRow is the direct
// regression test for the PR #82 bot-round race: the pre-loaded attendee
// reads checkin_status=false (so the OLD Go-level before/after compare
// would see a flip), but the guarded transition claim affects 0 rows — a
// concurrent request's check-in already landed by the time this request's
// UPDATE was evaluated. This request must write NO feed row and NO
// publish: the concurrent winner already did both.
func TestUpdateAttendeeHandler_LostRaceWritesNoActionRow(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)
	attendee.CheckinStatus = false // the stale pre-read: still unchecked
	staffUser := contractUser("staff@org.io")

	var got []recordedAction
	h := New(&fakeStore{
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		getUserByID:     func(uuid.UUID) (*models.User, error) { return staffUser, nil },
		updateAttendee:  func(*models.Attendee) error { return nil },
		// The concurrent winner's check-in committed between this
		// request's pre-read and its guarded UPDATE: 0 rows affected.
		transitionAttendeeCheckin: func(uuid.UUID, bool, *time.Time, *uuid.UUID) (bool, error) { return false, nil },
		insertCheckinActionAt: func(eventID, attendeeID uuid.UUID, action string, stationID *uuid.UUID, staffUserID *uuid.UUID, at *time.Time) error {
			got = append(got, recordedAction{eventID, attendeeID, action, stationID, staffUserID, at})
			return nil
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
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if len(got) != 0 {
		t.Fatalf("insertCheckinActionAt calls = %d, want 0 — the lost race must not duplicate the winner's feed row", len(got))
	}
	if pendingSignal(ch) {
		t.Fatal("publish signal = true, want false — this request performed no monitor-visible transition")
	}
}

// TestSyncPush_LostRaceWritesNoActionRow is the sync-path twin of the
// race regression above: the client pushes checkin_status=true against a
// pre-read of false, but the guarded claim reports no flip (a station
// scan or another push already checked the attendee in) — no feed row.
func TestSyncPush_LostRaceWritesNoActionRow(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	existing := contractAttendee(event.ID)
	existing.CheckinStatus = false // the stale pre-read

	incoming := *existing
	incoming.CheckinStatus = true

	var got []recordedAction
	h := New(&fakeStore{
		getEventByID:              func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeByID:           func(uuid.UUID) (*models.Attendee, error) { return existing, nil },
		updateAttendee:            func(*models.Attendee) error { return nil },
		transitionAttendeeCheckin: func(uuid.UUID, bool, *time.Time, *uuid.UUID) (bool, error) { return false, nil },
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
		t.Fatalf("insertCheckinActionAt calls = %d, want 0 — the lost race must not duplicate the winner's feed row", len(got))
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
		// Same status pushed: the guarded claim affects 0 rows.
		transitionAttendeeCheckin: func(uuid.UUID, bool, *time.Time, *uuid.UUID) (bool, error) { return false, nil },
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
