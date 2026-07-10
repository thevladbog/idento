package handler

import (
	"net/http"
	"testing"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// TestSyncPushSkipsCreationsOverAttendeeLimit mirrors
// TestExternalImportRejectsOverLimitBatch (api_keys_authz_test.go) but for
// the offline mobile sync push path (POST /api/sync). Without this guard, a
// mobile client that queues attendee creations offline and pushes them
// through /api/sync could create attendees past attendees_per_event even
// though the JWT-authed bulk-create and API-key import paths both enforce
// it. SyncPush must apply the same limit, skipping (not erroring) creations
// for an event that's already at/over its cap — consistent with the
// handler's established silent-skip semantics for the rest of sync.
func TestSyncPushSkipsCreationsOverAttendeeLimit(t *testing.T) {
	tenant := uuid.New()
	eventID := uuid.New()
	attendeeID := uuid.New()

	checkAttendeeLimitCalled := false
	createAttendeeCalled := false
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: eventID, TenantID: tenant}, nil
		},
		checkAttendeeLimit: func(tenantID, eventID uuid.UUID, adding int) (bool, int, int, error) {
			checkAttendeeLimitCalled = true
			return false, 50, 50, nil
		},
		createAttendee: func(attendee *models.Attendee) error {
			createAttendeeCalled = true
			return nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()

	body := `{"changes":{"attendees":{"created":[` +
		`{"id":"` + attendeeID.String() + `","event_id":"` + eventID.String() + `","first_name":"a","last_name":"b","email":"a@x.com"}` +
		`]}},"lastPulledAt":0}`
	c, rec := newAuthedContext(e, http.MethodPost, "/api/sync", body, tenant.String(), "staff")

	if err := h.SyncPush(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (sync push still succeeds when an item is skipped); body: %s", rec.Code, rec.Body.String())
	}
	if !checkAttendeeLimitCalled {
		t.Fatal("expected Store.CheckAttendeeLimit to be called")
	}
	if createAttendeeCalled {
		t.Fatal("expected Store.CreateAttendee NOT to be called when the event is over its attendees_per_event limit")
	}
}

// TestSyncPushCreatesAttendeeWhenUnderLimit is the happy-path complement:
// creations for an event still under its attendees_per_event limit must go
// through as before, so the new guard doesn't over-block legitimate offline
// check-ins.
func TestSyncPushCreatesAttendeeWhenUnderLimit(t *testing.T) {
	tenant := uuid.New()
	eventID := uuid.New()
	attendeeID := uuid.New()

	createAttendeeCalled := false
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: eventID, TenantID: tenant}, nil
		},
		checkAttendeeLimit: func(tenantID, eventID uuid.UUID, adding int) (bool, int, int, error) {
			return true, 3, 50, nil
		},
		createAttendee: func(attendee *models.Attendee) error {
			createAttendeeCalled = true
			if attendee.ID != attendeeID {
				t.Fatalf("expected attendee %s, got %s", attendeeID, attendee.ID)
			}
			return nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()

	body := `{"changes":{"attendees":{"created":[` +
		`{"id":"` + attendeeID.String() + `","event_id":"` + eventID.String() + `","first_name":"a","last_name":"b","email":"a@x.com"}` +
		`]}},"lastPulledAt":0}`
	c, rec := newAuthedContext(e, http.MethodPost, "/api/sync", body, tenant.String(), "staff")

	if err := h.SyncPush(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !createAttendeeCalled {
		t.Fatal("expected Store.CreateAttendee to be called when under the attendees_per_event limit")
	}
}
