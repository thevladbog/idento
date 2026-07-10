package handler

import (
	"errors"
	"net/http"
	"testing"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// Table-driven cross-tenant isolation suite (P0.2/P0.6): every handler that
// takes an event or attendee id must 404 when the resource belongs to another
// tenant — indistinguishable from "does not exist".
func TestCrossTenantAccessIs404(t *testing.T) {
	e := echo.New()
	ownerTenant := uuid.New()
	strangerTenant := uuid.New()
	eventID := uuid.New()
	attendeeID := uuid.New()

	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			if id == eventID {
				return &models.Event{ID: eventID, TenantID: ownerTenant}, nil
			}
			return nil, nil
		},
		getAttendeeByID: func(id uuid.UUID) (*models.Attendee, error) {
			if id == attendeeID {
				return &models.Attendee{ID: attendeeID, EventID: eventID}, nil
			}
			return nil, nil
		},
	}
	h := &Handler{Store: fs}

	cases := []struct {
		name    string
		method  string
		body    string
		param   string
		paramID string
		call    func(c echo.Context) error
	}{
		{"GetEvent", http.MethodGet, "", "id", eventID.String(), h.GetEvent},
		{"UpdateEvent", http.MethodPut, `{"name":"x"}`, "id", eventID.String(), h.UpdateEvent},
		{"UpdateAttendeeInfo", http.MethodPatch, `{"first_name":"x"}`, "id", attendeeID.String(), h.UpdateAttendeeInfo},
		{"BlockAttendee", http.MethodPost, `{"reason":"x"}`, "id", attendeeID.String(), h.BlockAttendee},
		{"UnblockAttendee", http.MethodPost, "", "id", attendeeID.String(), h.UnblockAttendee},
		{"DeleteAttendee", http.MethodDelete, "", "id", attendeeID.String(), h.DeleteAttendee},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, rec := newAuthedContext(e, tc.method, "/x", tc.body, strangerTenant.String(), "admin")
			c.SetParamNames(tc.param)
			c.SetParamValues(tc.paramID)
			if err := tc.call(c); err != nil {
				t.Fatalf("handler error: %v", err)
			}
			if rec.Code != http.StatusNotFound {
				t.Errorf("%s cross-tenant: status = %d, want 404; body: %s", tc.name, rec.Code, rec.Body.String())
			}
		})
	}
}

// GetEvent must not panic for a nonexistent id (pre-P0.2 nil-dereference bug).
func TestGetEventMissingIs404NotPanic(t *testing.T) {
	e := echo.New()
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) { return nil, nil },
	}
	h := &Handler{Store: fs}
	c, rec := newAuthedContext(e, http.MethodGet, "/x", "", uuid.New().String(), "admin")
	c.SetParamNames("id")
	c.SetParamValues(uuid.New().String())
	if err := h.GetEvent(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}

// Store failures must surface as 500, not be masked as 404 — a DB outage is
// not "event not found" (PR #23 review).
func TestStoreErrorIs500Not404(t *testing.T) {
	e := echo.New()
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return nil, errors.New("connection refused")
		},
	}
	h := &Handler{Store: fs}
	c, rec := newAuthedContext(e, http.MethodGet, "/x", "", uuid.New().String(), "admin")
	c.SetParamNames("id")
	c.SetParamValues(uuid.New().String())
	if err := h.GetEvent(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500 (store error must not read as not-found)", rec.Code)
	}
}

// Bulk import must validate the batch size against the plan limit before inserting.
func TestBulkImportRejectsOverLimitBatch(t *testing.T) {
	e := echo.New()
	tenant := uuid.New()
	eventID := uuid.New()
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: eventID, TenantID: tenant}, nil
		},
		checkAttendeeLimit: func(_, _ uuid.UUID, adding int) (bool, int, int, error) {
			return false, 45, 50, nil
		},
	}
	h := &Handler{Store: fs}
	body := `{"attendees":[{"first_name":"a"},{"first_name":"b"},{"first_name":"c"},{"first_name":"d"},{"first_name":"e"},{"first_name":"f"}]}`
	c, rec := newAuthedContext(e, http.MethodPost, "/x", body, tenant.String(), "admin")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())
	if err := h.BulkCreateAttendees(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (batch over limit)", rec.Code)
	}
}
