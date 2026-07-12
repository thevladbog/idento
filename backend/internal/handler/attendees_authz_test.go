package handler

import (
	"net/http"
	"testing"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func TestGetAttendees_ReturnsEmptyArrayNotNullWhenNoAttendees(t *testing.T) {
	tenantID := uuid.New()
	eventID := uuid.New()

	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenantID}, nil
		},
		getAttendeesByEventID: func(eventID uuid.UUID, code, search string) ([]*models.Attendee, error) {
			return nil, nil // simulates zero rows: store returns a nil slice
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/api/events/"+eventID.String()+"/attendees", "", tenantID.String(), "admin")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())

	if err := h.GetAttendees(c); err != nil {
		t.Fatalf("GetAttendees returned error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", rec.Code, rec.Body.String())
	}
	if body := rec.Body.String(); body != "[]\n" {
		t.Fatalf("body = %q, want %q (JSON null breaks frontend .forEach)", body, "[]\n")
	}
}

func TestGetAttendees_ForbidsForeignTenant(t *testing.T) {
	ownerTenant := uuid.New()
	caller := uuid.New()
	eventID := uuid.New()

	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: ownerTenant}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/api/events/"+eventID.String()+"/attendees", "", caller.String(), "admin")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())

	_ = h.GetAttendees(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for foreign tenant, got %d", rec.Code)
	}
}
