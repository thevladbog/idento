package handler

import (
	"net/http"
	"testing"
	"time"

	"idento/backend/internal/middleware"
	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func contractEvent(tenantID uuid.UUID, name string) *models.Event {
	now := time.Now()
	return &models.Event{
		ID:        uuid.New(),
		TenantID:  tenantID,
		Name:      name,
		Location:  "Main Hall",
		CreatedAt: now,
		UpdatedAt: now,
	}
}

func TestContractGetEvents(t *testing.T) {
	tenantID := uuid.New()
	events := []*models.Event{contractEvent(tenantID, "Tech Summit")}
	h := New(&fakeStore{
		getEventsByTenantID: func(uuid.UUID) ([]*models.Event, error) { return events, nil },
	})
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/api/events", "", tenantID.String(), "admin")
	if err := h.GetEvents(c); err != nil {
		t.Fatalf("GetEvents: %v", err)
	}
	validateResponse(t, http.MethodGet, "/api/events", rec)
}

func TestContractCreateEvent(t *testing.T) {
	tenantID := uuid.New()
	h := New(&fakeStore{
		createEvent: func(*models.Event) error { return nil },
		logUsage:    func(*models.UsageLog) error { return nil },
	})
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodPost, "/api/events",
		`{"name":"Tech Summit","location":"Main Hall"}`, tenantID.String(), "admin")
	if err := h.CreateEvent(c); err != nil {
		t.Fatalf("CreateEvent: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, "/api/events", rec)
}

// TestContractCreateEventLimitExceeded exercises middleware.CheckLimits
// directly with resourceType "events_per_month" (it wraps CreateEvent as
// route-level middleware, not handler code — see handler.go's
// api.POST("/events", h.CreateEvent, middleware.CheckLimits(h.Store,
// "events_per_month"))) to prove its 403 body matches the same
// LimitExceededError shape already documented for POST /api/users:
// middleware.CheckLimits builds the response from resourceType generically
// (map literal with "limit_type": resourceType), so the shape never varies
// by resource — only the limit_type value does.
func TestContractCreateEventLimitExceeded(t *testing.T) {
	tenantID := uuid.New()
	fs := &fakeStore{
		checkTenantLimit: func(uuid.UUID, string) (bool, int, int, error) { return false, 3, 3, nil },
	}
	mw := middleware.CheckLimits(fs, "events_per_month")
	next := func(c echo.Context) error {
		t.Fatal("next handler should not be called once the limit is exceeded")
		return nil
	}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodPost, "/api/events",
		`{"name":"Tech Summit"}`, tenantID.String(), "admin")
	if err := mw(next)(c); err != nil {
		t.Fatalf("CheckLimits: %v", err)
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, "/api/events", rec)
}

func TestContractGetEvent(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	h := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return event, nil },
	})
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/api/events/"+event.ID.String(), "", tenantID.String(), "admin")
	c.SetPath("/api/events/:id")
	c.SetParamNames("id")
	c.SetParamValues(event.ID.String())
	if err := h.GetEvent(c); err != nil {
		t.Fatalf("GetEvent: %v", err)
	}
	validateResponse(t, http.MethodGet, "/api/events/"+event.ID.String(), rec)

	// 404: event exists but belongs to a different tenant (requireEventOwnership
	// masks "foreign" as "missing" — no existence oracle).
	c, rec = newAuthedContext(e, http.MethodGet, "/api/events/"+event.ID.String(), "", uuid.New().String(), "admin")
	c.SetPath("/api/events/:id")
	c.SetParamNames("id")
	c.SetParamValues(event.ID.String())
	if err := h.GetEvent(c); err != nil {
		t.Fatalf("GetEvent (foreign tenant): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, "/api/events/"+event.ID.String(), rec)
}

func TestContractUpdateEvent(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	h := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return event, nil },
		updateEvent:  func(*models.Event) error { return nil },
	})
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodPut, "/api/events/"+event.ID.String(),
		`{"name":"Tech Summit 2026","location":"Main Hall"}`, tenantID.String(), "admin")
	c.SetPath("/api/events/:id")
	c.SetParamNames("id")
	c.SetParamValues(event.ID.String())
	if err := h.UpdateEvent(c); err != nil {
		t.Fatalf("UpdateEvent: %v", err)
	}
	validateResponse(t, http.MethodPut, "/api/events/"+event.ID.String(), rec)
}

func TestContractBadgeZpl(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	attendee := &models.Attendee{
		ID:        uuid.New(),
		EventID:   event.ID,
		FirstName: "Ada",
		LastName:  "Lovelace",
		Code:      "ABC123",
	}
	h := New(&fakeStore{
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
	})
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodPost, "/api/events/"+event.ID.String()+"/badge-zpl",
		`{"attendee_id":"`+attendee.ID.String()+`"}`, tenantID.String(), "admin")
	c.SetPath("/api/events/:id/badge-zpl")
	c.SetParamNames("id")
	c.SetParamValues(event.ID.String())
	if err := h.BadgeZPL(c); err != nil {
		t.Fatalf("BadgeZPL: %v", err)
	}
	validateResponse(t, http.MethodPost, "/api/events/"+event.ID.String()+"/badge-zpl", rec)
}

func TestContractGetEventStats(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	zone := &models.EventZone{ID: uuid.New(), EventID: event.ID, Name: "Main Hall", ZoneType: "general"}
	stats := &models.EventStatsResponse{TotalAttendees: 100, CheckedIn: 42}
	statsWithZone := &models.EventStatsResponse{
		TotalAttendees: 100,
		CheckedIn:      42,
		ZoneStats:      &models.ZoneScanStats{Allowed: 10, NoAccess: 2, NotRegistered: 1},
	}
	h := New(&fakeStore{
		getEventByID:     func(uuid.UUID) (*models.Event, error) { return event, nil },
		getEventZoneByID: func(uuid.UUID) (*models.EventZone, error) { return zone, nil },
		getEventStats: func(_ uuid.UUID, zoneID *uuid.UUID) (*models.EventStatsResponse, error) {
			if zoneID != nil {
				return statsWithZone, nil
			}
			return stats, nil
		},
	})
	e := echo.New()

	// Event-level stats, no zone filter.
	c, rec := newAuthedContext(e, http.MethodGet, "/api/events/"+event.ID.String()+"/stats", "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/stats")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.GetEventStats(c); err != nil {
		t.Fatalf("GetEventStats: %v", err)
	}
	validateResponse(t, http.MethodGet, "/api/events/"+event.ID.String()+"/stats", rec)

	// Zone-filtered stats (adds zone_stats to the response).
	c, rec = newAuthedContext(e, http.MethodGet, "/api/events/"+event.ID.String()+"/stats?zone="+zone.ID.String(), "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/stats")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.GetEventStats(c); err != nil {
		t.Fatalf("GetEventStats (zone): %v", err)
	}
	validateResponse(t, http.MethodGet, "/api/events/"+event.ID.String()+"/stats", rec)
}

func TestContractGetEventStaff(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	staffUser := contractUser("staff@org.io")
	staffUser.TenantID = tenantID
	h := New(&fakeStore{
		getEventByID:  func(uuid.UUID) (*models.Event, error) { return event, nil },
		getEventStaff: func(uuid.UUID) ([]*models.User, error) { return []*models.User{staffUser}, nil },
	})
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/api/events/"+event.ID.String()+"/staff", "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/staff")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.GetEventStaff(c); err != nil {
		t.Fatalf("GetEventStaff: %v", err)
	}
	validateResponse(t, http.MethodGet, "/api/events/"+event.ID.String()+"/staff", rec)
}

func TestContractAssignStaffToEvent(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	targetUser := contractUser("staff@org.io")
	targetUser.TenantID = tenantID
	h := New(&fakeStore{
		getEventByID:       func(uuid.UUID) (*models.Event, error) { return event, nil },
		getUserByID:        func(uuid.UUID) (*models.User, error) { return targetUser, nil },
		getUserTenantRole:  func(uuid.UUID, uuid.UUID) (string, error) { return "staff", nil },
		assignStaffToEvent: func(*models.EventStaff) error { return nil },
	})
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodPost, "/api/events/"+event.ID.String()+"/staff",
		`{"user_id":"`+targetUser.ID.String()+`"}`, tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/staff")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.AssignStaffToEvent(c); err != nil {
		t.Fatalf("AssignStaffToEvent: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, "/api/events/"+event.ID.String()+"/staff", rec)
}

func TestContractCreateStationProvisioningToken(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	staffUser := contractUser("staff@org.io")
	staffUser.TenantID = tenantID
	h := New(&fakeStore{
		getEventByID:            func(uuid.UUID) (*models.Event, error) { return event, nil },
		getUserByID:             func(uuid.UUID) (*models.User, error) { return staffUser, nil },
		getUserTenantRole:       func(uuid.UUID, uuid.UUID) (string, error) { return "staff", nil },
		createProvisioningToken: func(*models.StationProvisioningToken) error { return nil },
	})
	e := echo.New()
	path := "/api/events/" + event.ID.String() + "/stations/provisioning-token"
	c, rec := newAuthedContext(e, http.MethodPost, path,
		`{"staff_user_id":"`+staffUser.ID.String()+`"}`, tenantID.String(), "manager")
	c.SetPath("/api/events/:event_id/stations/provisioning-token")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.CreateStationProvisioningToken(c); err != nil {
		t.Fatalf("CreateStationProvisioningToken: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)
}

func TestContractProvisionStation(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret")
	eventID := uuid.New()
	tenantID := uuid.New()
	staffUser := contractUser("staff@org.io")
	h := New(&fakeStore{
		consumeProvisioningToken: func(string) (*models.StationProvisioningToken, error) {
			return &models.StationProvisioningToken{Token: "tok", EventID: eventID, StaffUserID: staffUser.ID}, nil
		},
		getEventByID: func(uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: eventID, TenantID: tenantID, Name: "Tech Summit", CreatedAt: time.Now(), UpdatedAt: time.Now()}, nil
		},
		getUserByID:       func(uuid.UUID) (*models.User, error) { return staffUser, nil },
		getUserTenantRole: func(uuid.UUID, uuid.UUID) (string, error) { return "staff", nil },
		createStation: func(_, _ uuid.UUID, _ map[string]interface{}) (*models.Station, error) {
			return &models.Station{ID: uuid.New(), EventID: eventID, DeviceNumber: 1, CreatedAt: time.Now()}, nil
		},
	})
	e := echo.New()
	c, rec := newUnauthedContext(e, http.MethodPost, "/api/stations/provision", `{"token":"tok"}`)
	if err := h.ProvisionStation(c); err != nil {
		t.Fatalf("ProvisionStation: %v", err)
	}
	validateResponse(t, http.MethodPost, "/api/stations/provision", rec)

	// 401: invalid, expired, or already-consumed token — ConsumeProvisioningToken
	// returns (nil, nil) for all three (no existence oracle).
	h2 := New(&fakeStore{
		consumeProvisioningToken: func(string) (*models.StationProvisioningToken, error) { return nil, nil },
	})
	c, rec = newUnauthedContext(e, http.MethodPost, "/api/stations/provision", `{"token":"bogus"}`)
	if err := h2.ProvisionStation(c); err != nil {
		t.Fatalf("ProvisionStation (invalid token): %v", err)
	}
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, "/api/stations/provision", rec)
}
