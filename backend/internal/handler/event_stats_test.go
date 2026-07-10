package handler

import (
	"net/http"
	"testing"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func TestGetEventStats_RejectsZoneFromDifferentEvent(t *testing.T) {
	eventID := uuid.New()
	otherEventID := uuid.New()
	tenantID := uuid.New()
	zoneID := uuid.New()
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenantID}, nil
		},
		getEventZoneByID: func(id uuid.UUID) (*models.EventZone, error) {
			return &models.EventZone{ID: id, EventID: otherEventID}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/api/events/"+eventID.String()+"/stats?zone="+zoneID.String(), "", tenantID.String(), "admin")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())
	_ = h.GetEventStats(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for a zone belonging to a different event, got %d", rec.Code)
	}
}

func TestGetEventStats_ReturnsZoneBreakdown(t *testing.T) {
	eventID := uuid.New()
	tenantID := uuid.New()
	zoneID := uuid.New()
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenantID}, nil
		},
		getEventZoneByID: func(id uuid.UUID) (*models.EventZone, error) {
			return &models.EventZone{ID: id, EventID: eventID}, nil
		},
		getEventStats: func(_ uuid.UUID, zID *uuid.UUID) (*models.EventStatsResponse, error) {
			return &models.EventStatsResponse{
				TotalAttendees: 2480,
				CheckedIn:      412,
				ZoneStats:      &models.ZoneScanStats{Allowed: 268, NoAccess: 12, NotRegistered: 3},
			}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/api/events/"+eventID.String()+"/stats?zone="+zoneID.String(), "", tenantID.String(), "admin")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())
	if err := h.GetEventStats(c); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp models.EventStatsResponse
	if err := jsonUnmarshalBody(rec, &resp); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if resp.ZoneStats == nil || resp.ZoneStats.Allowed != 268 || resp.ZoneStats.NoAccess != 12 {
		t.Fatalf("unexpected zone stats: %+v", resp.ZoneStats)
	}
}
