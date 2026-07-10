package handler

import (
	"net/http"
	"testing"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

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
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for foreign tenant, got %d", rec.Code)
	}
}
