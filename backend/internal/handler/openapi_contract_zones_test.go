package handler

import (
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func contractZone(eventID uuid.UUID) *models.EventZone {
	now := time.Now()
	return &models.EventZone{
		ID:                   uuid.New(),
		EventID:              eventID,
		Name:                 "Main Hall",
		ZoneType:             "general",
		OrderIndex:           1,
		IsRegistrationZone:   false,
		RequiresRegistration: false,
		IsActive:             true,
		CreatedAt:            now,
		UpdatedAt:            now,
	}
}

func contractAccessRule(zoneID uuid.UUID) *models.ZoneAccessRule {
	return &models.ZoneAccessRule{
		ID:        uuid.New(),
		ZoneID:    zoneID,
		Category:  "vip",
		Allowed:   true,
		CreatedAt: time.Now(),
	}
}

func TestContractCreateEventZone(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	h := New(&fakeStore{
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		createEventZone: func(*models.EventZone) error { return nil },
	})
	e := echo.New()
	path := "/api/events/" + event.ID.String() + "/zones"
	c, rec := newAuthedContext(e, http.MethodPost, path, `{"name":"Main Hall","zone_type":"general"}`, tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/zones")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.CreateEventZone(c); err != nil {
		t.Fatalf("CreateEventZone: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 404: event exists but belongs to a different tenant (requireEventOwnership
	// masks "foreign" as "missing").
	c, rec = newAuthedContext(e, http.MethodPost, path, `{"name":"Main Hall"}`, uuid.New().String(), "admin")
	c.SetPath("/api/events/:event_id/zones")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.CreateEventZone(c); err != nil {
		t.Fatalf("CreateEventZone (foreign tenant): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 500: a raw (non-*httpError) store error from GetEventByIDForTenant
	// propagates out of requireEventOwnership and hits writeErr's fallback
	// branch ({"error": "Internal error"}).
	hOwnershipFail := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return nil, errors.New("db unavailable") },
	})
	c, rec = newAuthedContext(e, http.MethodPost, path, `{"name":"Main Hall"}`, tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/zones")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := hOwnershipFail.CreateEventZone(c); err != nil {
		t.Fatalf("CreateEventZone (ownership store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 500: Store.CreateEventZone itself fails ("Failed to create zone").
	hCreateFail := New(&fakeStore{
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		createEventZone: func(*models.EventZone) error { return errors.New("insert failed") },
	})
	c, rec = newAuthedContext(e, http.MethodPost, path, `{"name":"Main Hall"}`, tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/zones")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := hCreateFail.CreateEventZone(c); err != nil {
		t.Fatalf("CreateEventZone (store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)
}

func TestContractGetEventZones(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	zone := contractZone(event.ID)
	zones := []*models.EventZone{zone}
	zonesWithStats := []*models.EventZoneWithStats{
		{Zone: zone, TotalCheckins: 10, TodayCheckins: 2, AssignedStaff: 1, AccessRulesCount: 3},
	}
	h := New(&fakeStore{
		getEventByID:           func(uuid.UUID) (*models.Event, error) { return event, nil },
		getEventZones:          func(uuid.UUID) ([]*models.EventZone, error) { return zones, nil },
		getEventZonesWithStats: func(uuid.UUID) ([]*models.EventZoneWithStats, error) { return zonesWithStats, nil },
	})
	e := echo.New()
	path := "/api/events/" + event.ID.String() + "/zones"

	// 200: plain array of EventZone (with_stats absent).
	c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/zones")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.GetEventZones(c); err != nil {
		t.Fatalf("GetEventZones: %v", err)
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 200: with_stats=true switches the response to []EventZoneWithStats.
	c, rec = newAuthedContext(e, http.MethodGet, path+"?with_stats=true", "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/zones")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.GetEventZones(c); err != nil {
		t.Fatalf("GetEventZones (with_stats): %v", err)
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 404: event exists but belongs to a different tenant.
	c, rec = newAuthedContext(e, http.MethodGet, path, "", uuid.New().String(), "admin")
	c.SetPath("/api/events/:event_id/zones")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.GetEventZones(c); err != nil {
		t.Fatalf("GetEventZones (foreign tenant): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 500: Store.GetEventZones fails on the plain (non-stats) path.
	hFetchFail := New(&fakeStore{
		getEventByID:  func(uuid.UUID) (*models.Event, error) { return event, nil },
		getEventZones: func(uuid.UUID) ([]*models.EventZone, error) { return nil, errors.New("query failed") },
	})
	c, rec = newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/zones")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := hFetchFail.GetEventZones(c); err != nil {
		t.Fatalf("GetEventZones (store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)
}

func TestContractGetEventZone(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	zone := contractZone(event.ID)
	h := New(&fakeStore{
		getEventByID:     func(uuid.UUID) (*models.Event, error) { return event, nil },
		getEventZoneByID: func(uuid.UUID) (*models.EventZone, error) { return zone, nil },
	})
	e := echo.New()
	path := "/api/zones/" + zone.ID.String()
	c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/zones/:id")
	c.SetParamNames("id")
	c.SetParamValues(zone.ID.String())
	if err := h.GetEventZone(c); err != nil {
		t.Fatalf("GetEventZone: %v", err)
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 404: the zone itself does not exist (requireZoneOwnership's own "Zone
	// not found" — also covers a GetEventZoneByID store failure, which is
	// masked identically since the helper checks `err != nil || zone == nil`).
	hMissing := New(&fakeStore{
		getEventZoneByID: func(uuid.UUID) (*models.EventZone, error) { return nil, nil },
	})
	c, rec = newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/zones/:id")
	c.SetParamNames("id")
	c.SetParamValues(zone.ID.String())
	if err := hMissing.GetEventZone(c); err != nil {
		t.Fatalf("GetEventZone (zone missing): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 404: the zone exists but its parent event belongs to a different
	// tenant (nested requireEventOwnership call, "Event not found").
	c, rec = newAuthedContext(e, http.MethodGet, path, "", uuid.New().String(), "admin")
	c.SetPath("/api/zones/:id")
	c.SetParamNames("id")
	c.SetParamValues(zone.ID.String())
	if err := h.GetEventZone(c); err != nil {
		t.Fatalf("GetEventZone (foreign tenant): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 500: a raw store error resolving the zone's event ownership propagates
	// out of the nested requireEventOwnership call inside requireZoneOwnership.
	hOwnershipFail := New(&fakeStore{
		getEventZoneByID: func(uuid.UUID) (*models.EventZone, error) { return zone, nil },
		getEventByID:     func(uuid.UUID) (*models.Event, error) { return nil, errors.New("db unavailable") },
	})
	c, rec = newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/zones/:id")
	c.SetParamNames("id")
	c.SetParamValues(zone.ID.String())
	if err := hOwnershipFail.GetEventZone(c); err != nil {
		t.Fatalf("GetEventZone (ownership store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)
}

func TestContractUpdateEventZone(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	zone := contractZone(event.ID)
	h := New(&fakeStore{
		getEventByID:     func(uuid.UUID) (*models.Event, error) { return event, nil },
		getEventZoneByID: func(uuid.UUID) (*models.EventZone, error) { return zone, nil },
		updateEventZone:  func(*models.EventZone) error { return nil },
	})
	e := echo.New()
	path := "/api/zones/" + zone.ID.String()
	c, rec := newAuthedContext(e, http.MethodPut, path, `{"name":"Main Hall 2","zone_type":"vip","is_active":true}`, tenantID.String(), "admin")
	c.SetPath("/api/zones/:id")
	c.SetParamNames("id")
	c.SetParamValues(zone.ID.String())
	if err := h.UpdateEventZone(c); err != nil {
		t.Fatalf("UpdateEventZone: %v", err)
	}
	validateResponse(t, http.MethodPut, path, rec)

	// 404: zone does not exist.
	hMissing := New(&fakeStore{
		getEventZoneByID: func(uuid.UUID) (*models.EventZone, error) { return nil, nil },
	})
	c, rec = newAuthedContext(e, http.MethodPut, path, `{"name":"Main Hall 2"}`, tenantID.String(), "admin")
	c.SetPath("/api/zones/:id")
	c.SetParamNames("id")
	c.SetParamValues(zone.ID.String())
	if err := hMissing.UpdateEventZone(c); err != nil {
		t.Fatalf("UpdateEventZone (zone missing): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPut, path, rec)

	// 500: Store.UpdateEventZone itself fails ("Failed to update zone").
	hUpdateFail := New(&fakeStore{
		getEventByID:     func(uuid.UUID) (*models.Event, error) { return event, nil },
		getEventZoneByID: func(uuid.UUID) (*models.EventZone, error) { return zone, nil },
		updateEventZone:  func(*models.EventZone) error { return errors.New("update failed") },
	})
	c, rec = newAuthedContext(e, http.MethodPut, path, `{"name":"Main Hall 2"}`, tenantID.String(), "admin")
	c.SetPath("/api/zones/:id")
	c.SetParamNames("id")
	c.SetParamValues(zone.ID.String())
	if err := hUpdateFail.UpdateEventZone(c); err != nil {
		t.Fatalf("UpdateEventZone (store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPut, path, rec)
}

func TestContractDeleteEventZone(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	zone := contractZone(event.ID)
	h := New(&fakeStore{
		getEventByID:     func(uuid.UUID) (*models.Event, error) { return event, nil },
		getEventZoneByID: func(uuid.UUID) (*models.EventZone, error) { return zone, nil },
		deleteEventZone:  func(uuid.UUID) error { return nil },
	})
	e := echo.New()
	path := "/api/zones/" + zone.ID.String()
	c, rec := newAuthedContext(e, http.MethodDelete, path, "", tenantID.String(), "admin")
	c.SetPath("/api/zones/:id")
	c.SetParamNames("id")
	c.SetParamValues(zone.ID.String())
	if err := h.DeleteEventZone(c); err != nil {
		t.Fatalf("DeleteEventZone: %v", err)
	}
	validateResponse(t, http.MethodDelete, path, rec)

	// 500: Store.DeleteEventZone itself fails ("Failed to delete zone").
	hDeleteFail := New(&fakeStore{
		getEventByID:     func(uuid.UUID) (*models.Event, error) { return event, nil },
		getEventZoneByID: func(uuid.UUID) (*models.EventZone, error) { return zone, nil },
		deleteEventZone:  func(uuid.UUID) error { return errors.New("delete failed") },
	})
	c, rec = newAuthedContext(e, http.MethodDelete, path, "", tenantID.String(), "admin")
	c.SetPath("/api/zones/:id")
	c.SetParamNames("id")
	c.SetParamValues(zone.ID.String())
	if err := hDeleteFail.DeleteEventZone(c); err != nil {
		t.Fatalf("DeleteEventZone (store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodDelete, path, rec)
}

// TestContractGetZoneQRCode covers the 200 (image/png) happy path plus a
// 404 (zone missing) and a genuinely reachable 500 from qrcode.Encode
// rejecting a payload too long to fit a QR symbol at this recovery level —
// same class of failure as Task 5's TestContractGetAttendeeQR, triggered
// here by an overlong zone name instead of an overlong attendee code.
func TestContractGetZoneQRCode(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	zone := contractZone(event.ID)
	h := New(&fakeStore{
		getEventByID:     func(uuid.UUID) (*models.Event, error) { return event, nil },
		getEventZoneByID: func(uuid.UUID) (*models.EventZone, error) { return zone, nil },
	})
	e := echo.New()
	path := "/api/zones/" + zone.ID.String() + "/qr"
	c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/zones/:id/qr")
	c.SetParamNames("id")
	c.SetParamValues(zone.ID.String())
	if err := h.GetZoneQRCode(c); err != nil {
		t.Fatalf("GetZoneQRCode: %v", err)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "image/png" {
		t.Fatalf("want image/png, got %s", ct)
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 404: the zone itself does not exist.
	hMissing := New(&fakeStore{
		getEventZoneByID: func(uuid.UUID) (*models.EventZone, error) { return nil, nil },
	})
	c, rec = newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/zones/:id/qr")
	c.SetParamNames("id")
	c.SetParamValues(zone.ID.String())
	if err := hMissing.GetZoneQRCode(c); err != nil {
		t.Fatalf("GetZoneQRCode (zone missing): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 500: qrcode.Encode fails because the zone name is too long to fit a QR
	// symbol at Medium recovery / 256px (empirically >~3300 bytes for this
	// library, same threshold Task 5 found for attendee codes).
	longZone := contractZone(event.ID)
	longZone.Name = strings.Repeat("A", 4000)
	hLongName := New(&fakeStore{
		getEventByID:     func(uuid.UUID) (*models.Event, error) { return event, nil },
		getEventZoneByID: func(uuid.UUID) (*models.EventZone, error) { return longZone, nil },
	})
	longPath := "/api/zones/" + longZone.ID.String() + "/qr"
	c, rec = newAuthedContext(e, http.MethodGet, longPath, "", tenantID.String(), "admin")
	c.SetPath("/api/zones/:id/qr")
	c.SetParamNames("id")
	c.SetParamValues(longZone.ID.String())
	if err := hLongName.GetZoneQRCode(c); err != nil {
		t.Fatalf("GetZoneQRCode (long name): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)
}

func TestContractCreateZoneAccessRule(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	zone := contractZone(event.ID)
	h := New(&fakeStore{
		getEventByID:         func(uuid.UUID) (*models.Event, error) { return event, nil },
		getEventZoneByID:     func(uuid.UUID) (*models.EventZone, error) { return zone, nil },
		createZoneAccessRule: func(*models.ZoneAccessRule) error { return nil },
	})
	e := echo.New()
	path := "/api/zones/" + zone.ID.String() + "/access-rules"
	c, rec := newAuthedContext(e, http.MethodPost, path, `{"category":"vip","allowed":true}`, tenantID.String(), "admin")
	c.SetPath("/api/zones/:zone_id/access-rules")
	c.SetParamNames("zone_id")
	c.SetParamValues(zone.ID.String())
	if err := h.CreateZoneAccessRule(c); err != nil {
		t.Fatalf("CreateZoneAccessRule: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 404: zone does not exist.
	hMissing := New(&fakeStore{
		getEventZoneByID: func(uuid.UUID) (*models.EventZone, error) { return nil, nil },
	})
	c, rec = newAuthedContext(e, http.MethodPost, path, `{"category":"vip","allowed":true}`, tenantID.String(), "admin")
	c.SetPath("/api/zones/:zone_id/access-rules")
	c.SetParamNames("zone_id")
	c.SetParamValues(zone.ID.String())
	if err := hMissing.CreateZoneAccessRule(c); err != nil {
		t.Fatalf("CreateZoneAccessRule (zone missing): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 500: Store.CreateZoneAccessRule itself fails ("Failed to create access rule").
	hCreateFail := New(&fakeStore{
		getEventByID:         func(uuid.UUID) (*models.Event, error) { return event, nil },
		getEventZoneByID:     func(uuid.UUID) (*models.EventZone, error) { return zone, nil },
		createZoneAccessRule: func(*models.ZoneAccessRule) error { return errors.New("insert failed") },
	})
	c, rec = newAuthedContext(e, http.MethodPost, path, `{"category":"vip","allowed":true}`, tenantID.String(), "admin")
	c.SetPath("/api/zones/:zone_id/access-rules")
	c.SetParamNames("zone_id")
	c.SetParamValues(zone.ID.String())
	if err := hCreateFail.CreateZoneAccessRule(c); err != nil {
		t.Fatalf("CreateZoneAccessRule (store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)
}

func TestContractGetZoneAccessRules(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	zone := contractZone(event.ID)
	rule := contractAccessRule(zone.ID)
	h := New(&fakeStore{
		getEventByID:       func(uuid.UUID) (*models.Event, error) { return event, nil },
		getEventZoneByID:   func(uuid.UUID) (*models.EventZone, error) { return zone, nil },
		getZoneAccessRules: func(uuid.UUID) ([]*models.ZoneAccessRule, error) { return []*models.ZoneAccessRule{rule}, nil },
	})
	e := echo.New()
	path := "/api/zones/" + zone.ID.String() + "/access-rules"
	c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/zones/:zone_id/access-rules")
	c.SetParamNames("zone_id")
	c.SetParamValues(zone.ID.String())
	if err := h.GetZoneAccessRules(c); err != nil {
		t.Fatalf("GetZoneAccessRules: %v", err)
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 500: Store.GetZoneAccessRules itself fails ("Failed to get access rules").
	hFetchFail := New(&fakeStore{
		getEventByID:       func(uuid.UUID) (*models.Event, error) { return event, nil },
		getEventZoneByID:   func(uuid.UUID) (*models.EventZone, error) { return zone, nil },
		getZoneAccessRules: func(uuid.UUID) ([]*models.ZoneAccessRule, error) { return nil, errors.New("query failed") },
	})
	c, rec = newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/zones/:zone_id/access-rules")
	c.SetParamNames("zone_id")
	c.SetParamValues(zone.ID.String())
	if err := hFetchFail.GetZoneAccessRules(c); err != nil {
		t.Fatalf("GetZoneAccessRules (store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)
}

// TestContractBulkUpdateZoneAccessRules exercises PUT
// /api/zones/{zone_id}/access-rules: the request body is an array of rules
// (delete-then-insert of the whole set for the zone), but unlike the
// singular POST on this same collection, the 200 response is a plain
// confirmation message, NOT the array of rules that were written.
func TestContractBulkUpdateZoneAccessRules(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	zone := contractZone(event.ID)
	h := New(&fakeStore{
		getEventByID:              func(uuid.UUID) (*models.Event, error) { return event, nil },
		getEventZoneByID:          func(uuid.UUID) (*models.EventZone, error) { return zone, nil },
		bulkUpdateZoneAccessRules: func(uuid.UUID, []*models.ZoneAccessRule) error { return nil },
	})
	e := echo.New()
	path := "/api/zones/" + zone.ID.String() + "/access-rules"
	body := `[{"category":"vip","allowed":true},{"category":"general","allowed":false,"time_from":"09:00","time_to":"17:00"}]`
	c, rec := newAuthedContext(e, http.MethodPut, path, body, tenantID.String(), "admin")
	c.SetPath("/api/zones/:zone_id/access-rules")
	c.SetParamNames("zone_id")
	c.SetParamValues(zone.ID.String())
	if err := h.BulkUpdateZoneAccessRules(c); err != nil {
		t.Fatalf("BulkUpdateZoneAccessRules: %v", err)
	}
	validateResponse(t, http.MethodPut, path, rec)

	// 500: Store.BulkUpdateZoneAccessRules itself fails ("Failed to update access rules").
	hUpdateFail := New(&fakeStore{
		getEventByID:              func(uuid.UUID) (*models.Event, error) { return event, nil },
		getEventZoneByID:          func(uuid.UUID) (*models.EventZone, error) { return zone, nil },
		bulkUpdateZoneAccessRules: func(uuid.UUID, []*models.ZoneAccessRule) error { return errors.New("tx failed") },
	})
	c, rec = newAuthedContext(e, http.MethodPut, path, body, tenantID.String(), "admin")
	c.SetPath("/api/zones/:zone_id/access-rules")
	c.SetParamNames("zone_id")
	c.SetParamValues(zone.ID.String())
	if err := hUpdateFail.BulkUpdateZoneAccessRules(c); err != nil {
		t.Fatalf("BulkUpdateZoneAccessRules (store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPut, path, rec)
}
