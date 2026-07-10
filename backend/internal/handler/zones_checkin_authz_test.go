package handler

import (
	"net/http"
	"testing"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func TestZoneCheckIn_ForbidsForeignTenant(t *testing.T) {
	ownerTenant := uuid.New()
	caller := uuid.New()
	zoneID := uuid.New()
	eventID := uuid.New()

	fs := &fakeStore{
		getEventZoneByID: func(id uuid.UUID) (*models.EventZone, error) {
			return &models.EventZone{ID: id, EventID: eventID, IsActive: true}, nil
		},
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: ownerTenant}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	body := `{"zone_id":"` + zoneID.String() + `","attendee_code":"ABCD1234"}`
	c, rec := newAuthedContext(e, http.MethodPost, "/api/zones/checkin", body, caller.String(), "admin")

	_ = h.ZoneCheckIn(c)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for foreign-tenant zone check-in, got %d", rec.Code)
	}
}
