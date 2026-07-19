package handler

import (
	"errors"
	"net/http"
	"testing"

	"idento/backend/internal/broker"
	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// --- P4.2 Task 4: MarkAttendeePrinted broker publish site ---

// TestMarkAttendeePrinted_PublishesOnlyWhenReprintLogged proves the
// narrowest of the four publish rules (P4.2 Task 4): a publish only
// happens when a 'reprint' checkin_actions row was ACTUALLY logged, not
// merely attempted — a no-body call (back-compat counter-only path) and an
// InsertCheckinAction failure both increment printed_count (200) without
// ever signaling the monitor.
func TestMarkAttendeePrinted_PublishesOnlyWhenReprintLogged(t *testing.T) {
	tests := []struct {
		name                string
		body                string
		insertCheckinAction func(eventID, attendeeID uuid.UUID, action string, stationID *uuid.UUID, staffUserID uuid.UUID) error
		wantPublish         bool
	}{
		{
			name: "reprint row logged successfully publishes",
			insertCheckinAction: func(uuid.UUID, uuid.UUID, string, *uuid.UUID, uuid.UUID) error {
				return nil
			},
			wantPublish: true,
		},
		{
			name: "InsertCheckinAction failure does not publish",
			insertCheckinAction: func(uuid.UUID, uuid.UUID, string, *uuid.UUID, uuid.UUID) error {
				return errors.New("boom")
			},
			wantPublish: false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			tenantID := uuid.New()
			event := contractEvent(tenantID, "Tech Summit")
			attendee := contractAttendee(event.ID)

			h := New(&fakeStore{
				getAttendeeByID:               func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
				getEventByID:                  func(uuid.UUID) (*models.Event, error) { return event, nil },
				incrementAttendeePrintedCount: func(uuid.UUID) (int, error) { return 1, nil },
				insertCheckinAction:           tc.insertCheckinAction,
			})
			mem := broker.NewMemBroker()
			h.Broker = mem
			ch, unsubscribe := mem.Subscribe(event.ID)
			defer unsubscribe()

			e := echo.New()
			path := markPrintedPath(attendee.ID)
			body := `{"event_id":"` + event.ID.String() + `"}`
			c, rec := newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "admin")
			setMarkPrintedPathParams(c, attendee.ID)

			if err := h.MarkAttendeePrinted(c); err != nil {
				t.Fatalf("MarkAttendeePrinted: %v", err)
			}
			if rec.Code != http.StatusOK {
				t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
			}
			if got := pendingSignal(ch); got != tc.wantPublish {
				t.Fatalf("publish signal = %v, want %v", got, tc.wantPublish)
			}
		})
	}
}

// TestMarkAttendeePrinted_NoBodyDoesNotPublish proves the pre-existing
// body-less badge-editor bulk-print path (no event_id, so no reprint row
// is even attempted) never signals the monitor.
func TestMarkAttendeePrinted_NoBodyDoesNotPublish(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := contractAttendee(event.ID)

	h := New(&fakeStore{
		getAttendeeByID:               func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
		getEventByID:                  func(uuid.UUID) (*models.Event, error) { return event, nil },
		incrementAttendeePrintedCount: func(uuid.UUID) (int, error) { return 1, nil },
	})
	mem := broker.NewMemBroker()
	h.Broker = mem
	ch, unsubscribe := mem.Subscribe(event.ID)
	defer unsubscribe()

	e := echo.New()
	path := markPrintedPath(attendee.ID)
	c, rec := newAuthedContext(e, http.MethodPost, path, "", tenantID.String(), "admin")
	setMarkPrintedPathParams(c, attendee.ID)

	if err := h.MarkAttendeePrinted(c); err != nil {
		t.Fatalf("MarkAttendeePrinted: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if pendingSignal(ch) {
		t.Fatal("publish signal = true, want false for a body-less call (no reprint row logged)")
	}
}
