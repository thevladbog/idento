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
