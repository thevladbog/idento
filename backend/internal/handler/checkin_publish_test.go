package handler

import (
	"net/http"
	"testing"
	"time"

	"idento/backend/internal/broker"
	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// --- P4.2 Task 4: StationCheckin / UndoCheckin broker publish sites ---
//
// pendingSignal is a non-blocking drain of a MemBroker subscription
// channel: true means Publish fired for that event since the channel was
// created (or since the last drain), false means it didn't. Because
// MemBroker.Subscribe's channel is 1-buffered and coalescing (broker.go),
// this can't distinguish "published once" from "published N>1 times" —
// but every publish site in this package fires at most once per handler
// call, so 0-vs-"at least one" is exactly the distinction these tests
// need, using the real exported Broker API rather than reaching into
// MemBroker's unexported fields.
func pendingSignal(ch <-chan struct{}) bool {
	select {
	case <-ch:
		return true
	default:
		return false
	}
}

// TestStationCheckin_PublishesOnlyOnCheckedIn proves the outcome-gated
// publish rule (P4.2 Task 4, self-review notes): "checked_in" is the only
// outcome that changes monitor-visible state, so it's the only one that
// should wake up a monitor subscriber.
func TestStationCheckin_PublishesOnlyOnCheckedIn(t *testing.T) {
	now := time.Now()

	tests := []struct {
		name        string
		checkIn     func(eventID, attendeeID uuid.UUID, stationID *uuid.UUID, staffUserID uuid.UUID, staffEmail, stationName string) (string, *models.Attendee, error)
		blocked     bool
		wantOutcome string
		wantPublish bool
	}{
		{
			name: "checked_in publishes",
			checkIn: func(_, attendeeID uuid.UUID, _ *uuid.UUID, _ uuid.UUID, staffEmail, stationName string) (string, *models.Attendee, error) {
				return "checked_in", &models.Attendee{ID: attendeeID, CheckinStatus: true, CheckedInAt: &now, CheckedInByEmail: &staffEmail, CheckedInPointName: &stationName}, nil
			},
			wantOutcome: "checked_in",
			wantPublish: true,
		},
		{
			name: "already_checked_in does not publish",
			checkIn: func(_, attendeeID uuid.UUID, _ *uuid.UUID, _ uuid.UUID, staffEmail, stationName string) (string, *models.Attendee, error) {
				return "already_checked_in", &models.Attendee{ID: attendeeID, CheckinStatus: true, CheckedInAt: &now, CheckedInByEmail: &staffEmail, CheckedInPointName: &stationName}, nil
			},
			wantOutcome: "already_checked_in",
			wantPublish: false,
		},
		{
			name:        "blocked does not publish",
			blocked:     true,
			wantOutcome: "blocked",
			wantPublish: false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			tenantID := uuid.New()
			event := contractEvent(tenantID, "Tech Summit")
			attendee := contractAttendee(event.ID)
			attendee.Blocked = tc.blocked
			staffID := uuid.New()

			h := newStationCheckinHandler(event, attendee,
				func(uuid.UUID) (*models.User, error) {
					return &models.User{ID: staffID, Email: "staff@example.com"}, nil
				},
				nil,
				tc.checkIn,
				nil,
			)
			mem := broker.NewMemBroker()
			h.Broker = mem
			ch, unsubscribe := mem.Subscribe(event.ID)
			defer unsubscribe()

			e := echo.New()
			path := checkinPath(event.ID)
			body := `{"attendee_id":"` + attendee.ID.String() + `"}`
			c, rec := newAuthedContextWithUserID(e, http.MethodPost, path, body, tenantID.String(), staffID, "staff")
			setCheckinPathParams(c, event.ID)

			if err := h.StationCheckin(c); err != nil {
				t.Fatalf("StationCheckin: %v", err)
			}
			if rec.Code != http.StatusOK {
				t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
			}

			var got StationCheckinResponse
			if err := jsonUnmarshalBody(rec, &got); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if got.Outcome != tc.wantOutcome {
				t.Fatalf("outcome = %q, want %q", got.Outcome, tc.wantOutcome)
			}

			if got := pendingSignal(ch); got != tc.wantPublish {
				t.Fatalf("publish signal = %v, want %v for outcome %q", got, tc.wantPublish, tc.wantOutcome)
			}
		})
	}
}

// TestStationCheckin_NilBrokerDoesNotPanic proves the nil-safe guard: a
// Handler with no Broker set (the ~70 existing `&Handler{Store: fs}` test
// literals across this package) still completes a checked_in scan without
// panicking on a nil Broker.Publish call.
func TestStationCheckin_NilBrokerDoesNotPanic(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)
	staffID := uuid.New()
	now := time.Now()

	h := newStationCheckinHandler(event, attendee,
		func(uuid.UUID) (*models.User, error) {
			return &models.User{ID: staffID, Email: "staff@example.com"}, nil
		},
		nil,
		func(_, attendeeID uuid.UUID, _ *uuid.UUID, _ uuid.UUID, staffEmail, stationName string) (string, *models.Attendee, error) {
			return "checked_in", &models.Attendee{ID: attendeeID, CheckinStatus: true, CheckedInAt: &now, CheckedInByEmail: &staffEmail, CheckedInPointName: &stationName}, nil
		},
		nil,
	)
	// h.Broker intentionally left nil.

	e := echo.New()
	path := checkinPath(event.ID)
	body := `{"attendee_id":"` + attendee.ID.String() + `"}`
	c, rec := newAuthedContextWithUserID(e, http.MethodPost, path, body, tenantID.String(), staffID, "staff")
	setCheckinPathParams(c, event.ID)

	if err := h.StationCheckin(c); err != nil {
		t.Fatalf("StationCheckin: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
}

// TestUndoCheckin_PublishesOn200 proves UndoCheckin publishes unconditionally
// on every successful (200) call, including the idempotent already-clear
// case (P4.2 Task 4: "UndoCheckin (on 200)", no outcome-based carve-out
// unlike StationCheckin).
func TestUndoCheckin_PublishesOn200(t *testing.T) {
	tests := []struct {
		name string
		undo func(eventID, attendeeID uuid.UUID, stationID *uuid.UUID, staffUserID uuid.UUID) (*models.Attendee, error)
	}{
		{
			name: "clears an active checkin",
			undo: func(_, attendeeID uuid.UUID, _ *uuid.UUID, _ uuid.UUID) (*models.Attendee, error) {
				return &models.Attendee{ID: attendeeID, CheckinStatus: false}, nil
			},
		},
		{
			name: "idempotent already-clear undo still publishes",
			undo: func(_, attendeeID uuid.UUID, _ *uuid.UUID, _ uuid.UUID) (*models.Attendee, error) {
				return &models.Attendee{ID: attendeeID, CheckinStatus: false}, nil
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			tenantID := uuid.New()
			event := contractEvent(tenantID, "Tech Summit")
			attendee := contractAttendee(event.ID)

			h := newStationCheckinHandler(event, attendee, nil, nil, nil, tc.undo)
			mem := broker.NewMemBroker()
			h.Broker = mem
			ch, unsubscribe := mem.Subscribe(event.ID)
			defer unsubscribe()

			e := echo.New()
			path := checkinUndoPath(event.ID)
			body := `{"attendee_id":"` + attendee.ID.String() + `"}`
			c, rec := newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "staff")
			setCheckinUndoPathParams(c, event.ID)

			if err := h.UndoCheckin(c); err != nil {
				t.Fatalf("UndoCheckin: %v", err)
			}
			if rec.Code != http.StatusOK {
				t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
			}
			if !pendingSignal(ch) {
				t.Fatal("publish signal = false, want true on a successful undo")
			}
		})
	}
}

// TestUndoCheckin_UnknownAttendee404DoesNotPublish proves the 404 path
// never signals the monitor — nothing changed, so there's nothing for a
// subscriber to re-fetch.
func TestUndoCheckin_UnknownAttendee404DoesNotPublish(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")

	h := New(&fakeStore{
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return nil, nil },
	})
	mem := broker.NewMemBroker()
	h.Broker = mem
	ch, unsubscribe := mem.Subscribe(event.ID)
	defer unsubscribe()

	e := echo.New()
	path := checkinUndoPath(event.ID)
	body := `{"attendee_id":"` + uuid.New().String() + `"}`
	c, rec := newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "staff")
	setCheckinUndoPathParams(c, event.ID)

	if err := h.UndoCheckin(c); err != nil {
		t.Fatalf("UndoCheckin: %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if pendingSignal(ch) {
		t.Fatal("publish signal = true, want false on a 404")
	}
}
