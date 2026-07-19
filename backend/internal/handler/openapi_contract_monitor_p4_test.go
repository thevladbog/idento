package handler

import (
	"net/http"
	"testing"
	"time"

	"idento/backend/internal/models"
	"idento/backend/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func monitorPath(eventID uuid.UUID) string {
	return "/api/events/" + eventID.String() + "/monitor"
}

func setMonitorPathParams(c echo.Context, eventID uuid.UUID) {
	c.SetPath("/api/events/:event_id/monitor")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())
}

// TestOpenAPIContract_GetEventMonitor_SeededInvariantHolds proves a fully
// seeded snapshot validates against the schema AND that the
// zones+unattributed invariant (spec §3.1) holds in the wire response:
// sum(zones[].checked_in) + unattributed == totals.checked_in.
func TestOpenAPIContract_GetEventMonitor_SeededInvariantHolds(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")

	zoneAID := uuid.New()
	zoneBID := uuid.New()
	stationID := uuid.New()
	now := time.Now().UTC()

	recentRows := []store.CheckinActionRow{
		{
			ID:        uuid.New(),
			Action:    "checkin",
			StationID: &stationID,
			CreatedAt: now,
			Attendee:  store.CheckinActionAttendee{ID: uuid.New(), FirstName: "Ada", LastName: "Lovelace", Code: "CODE1"},
		},
	}

	h := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return event, nil },
		getMonitorOverview: func(eventID uuid.UUID) (int, int, []store.MonitorZoneCount, int, error) {
			if eventID != event.ID {
				t.Fatalf("GetMonitorOverview eventID = %s, want %s", eventID, event.ID)
			}
			// 25 + 30 + 5 (unattributed) == 60 (checked_in) — the
			// invariant the response is expected to preserve verbatim.
			return 100, 60, []store.MonitorZoneCount{
				{ZoneID: zoneAID, Name: "Zone A", CheckedIn: 25},
				{ZoneID: zoneBID, Name: "Zone B", CheckedIn: 30},
			}, 5, nil
		},
		getMonitorMinuteBuckets: func(eventID uuid.UUID, since time.Time) ([]store.MinuteBucket, error) {
			if eventID != event.ID {
				t.Fatalf("GetMonitorMinuteBuckets eventID = %s, want %s", eventID, event.ID)
			}
			return []store.MinuteBucket{{Minute: now.Add(-1 * time.Minute), Count: 4}}, nil
		},
		countRecentCheckins: func(eventID uuid.UUID, since time.Time) (int, error) {
			if eventID != event.ID {
				t.Fatalf("CountRecentCheckins eventID = %s, want %s", eventID, event.ID)
			}
			return 4, nil
		},
		getMonitorStations: func(eventID uuid.UUID) ([]store.MonitorStation, error) {
			if eventID != event.ID {
				t.Fatalf("GetMonitorStations eventID = %s, want %s", eventID, event.ID)
			}
			return []store.MonitorStation{
				{ID: stationID, Name: "Main Entrance", ZoneID: &zoneAID, LastSeenAt: now, CheckinCount: 30},
			}, nil
		},
		getCheckinActions: func(eventID uuid.UUID, limit int) ([]store.CheckinActionRow, error) {
			if eventID != event.ID {
				t.Fatalf("GetCheckinActions eventID = %s, want %s", eventID, event.ID)
			}
			if limit != 20 {
				t.Fatalf("GetCheckinActions limit = %d, want 20", limit)
			}
			return recentRows, nil
		},
	})

	e := echo.New()
	path := monitorPath(event.ID)
	c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "staff")
	setMonitorPathParams(c, event.ID)

	if err := h.GetEventMonitor(c); err != nil {
		t.Fatalf("GetEventMonitor: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}

	var got MonitorSnapshot
	if err := jsonUnmarshalBody(rec, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if got.Totals.CheckedIn != 60 || got.Totals.Total != 100 {
		t.Fatalf("totals = %+v, want checked_in=60 total=100", got.Totals)
	}
	if got.Unattributed != 5 {
		t.Fatalf("unattributed = %d, want 5", got.Unattributed)
	}
	if len(got.Zones) != 2 {
		t.Fatalf("zones = %+v, want 2 entries", got.Zones)
	}
	sum := got.Unattributed
	for _, z := range got.Zones {
		sum += z.CheckedIn
	}
	if sum != got.Totals.CheckedIn {
		t.Fatalf("sum(zones)+unattributed = %d, want == totals.checked_in %d", sum, got.Totals.CheckedIn)
	}
	if len(got.Stations) != 1 || got.Stations[0].Name != "Main Entrance" {
		t.Fatalf("stations = %+v, want the seeded station", got.Stations)
	}
	if len(got.Recent) != 1 || got.Recent[0].Action != "checkin" {
		t.Fatalf("recent = %+v, want the seeded checkin row", got.Recent)
	}

	validateResponse(t, http.MethodGet, path, rec)
}

// TestOpenAPIContract_GetEventMonitor_EmptyEventZerosAndNulls proves a
// brand-new event with no attendees/zones/stations/actions comes back as
// zeroed counts and null peak/est_done_at — never fabricated values.
func TestOpenAPIContract_GetEventMonitor_EmptyEventZerosAndNulls(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Fresh Event")

	h := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return event, nil },
		getMonitorOverview: func(uuid.UUID) (int, int, []store.MonitorZoneCount, int, error) {
			return 0, 0, nil, 0, nil
		},
		getMonitorMinuteBuckets: func(uuid.UUID, time.Time) ([]store.MinuteBucket, error) { return nil, nil },
		countRecentCheckins:     func(uuid.UUID, time.Time) (int, error) { return 0, nil },
		getMonitorStations:      func(uuid.UUID) ([]store.MonitorStation, error) { return nil, nil },
		getCheckinActions:       func(uuid.UUID, int) ([]store.CheckinActionRow, error) { return nil, nil },
	})

	e := echo.New()
	path := monitorPath(event.ID)
	c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "staff")
	setMonitorPathParams(c, event.ID)

	if err := h.GetEventMonitor(c); err != nil {
		t.Fatalf("GetEventMonitor: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}

	var got MonitorSnapshot
	if err := jsonUnmarshalBody(rec, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if got.Totals.CheckedIn != 0 || got.Totals.Total != 0 {
		t.Fatalf("totals = %+v, want zeros", got.Totals)
	}
	if got.Totals.RatePerMin != 0 {
		t.Fatalf("rate_per_min = %v, want 0", got.Totals.RatePerMin)
	}
	if got.Totals.Peak != nil {
		t.Fatalf("peak = %+v, want nil", got.Totals.Peak)
	}
	if got.Totals.EstDoneAt != nil {
		t.Fatalf("est_done_at = %v, want nil", got.Totals.EstDoneAt)
	}
	if got.Unattributed != 0 {
		t.Fatalf("unattributed = %d, want 0", got.Unattributed)
	}
	if len(got.Zones) != 0 {
		t.Fatalf("zones = %+v, want empty", got.Zones)
	}
	if len(got.Stations) != 0 {
		t.Fatalf("stations = %+v, want empty", got.Stations)
	}
	if len(got.Recent) != 0 {
		t.Fatalf("recent = %+v, want empty", got.Recent)
	}

	validateResponse(t, http.MethodGet, path, rec)
}

// TestOpenAPIContract_GetEventMonitor_ForeignEvent404 proves
// requireEventOwnership short-circuits before any monitor aggregation is
// queried — a cross-tenant caller gets a masked 404, not data.
func TestOpenAPIContract_GetEventMonitor_ForeignEvent404(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	foreignTenantID := uuid.New()

	h := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return event, nil },
		getMonitorOverview: func(uuid.UUID) (int, int, []store.MonitorZoneCount, int, error) {
			t.Fatalf("GetMonitorOverview should not be called for a foreign event")
			return 0, 0, nil, 0, nil
		},
	})

	e := echo.New()
	path := monitorPath(event.ID)
	c, rec := newAuthedContext(e, http.MethodGet, path, "", foreignTenantID.String(), "staff")
	setMonitorPathParams(c, event.ID)

	if err := h.GetEventMonitor(c); err != nil {
		t.Fatalf("GetEventMonitor: %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}

	validateResponse(t, http.MethodGet, path, rec)
}
