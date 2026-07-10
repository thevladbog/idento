package handler

import (
	"net/http"
	"testing"
	"time"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func TestZoneScan_ForbidsForeignTenant(t *testing.T) {
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
	c, rec := newAuthedContext(e, http.MethodPost, "/api/zones/"+zoneID.String()+"/scan", `{"code":"ABCD1234"}`, caller.String(), "admin")
	c.SetParamNames("zone_id")
	c.SetParamValues(zoneID.String())
	_ = h.ZoneScan(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for foreign-tenant zone, got %d", rec.Code)
	}
}

func TestZoneScan_AllowedVerdictRecordsEntryAndScanLog(t *testing.T) {
	tenantID := uuid.New()
	eventID := uuid.New()
	zoneID := uuid.New()
	attendeeID := uuid.New()
	registeredAt := time.Now().Add(-time.Hour)

	var scanLogVerdict string
	var checkinCreated bool

	fs := &fakeStore{
		getEventZoneByID: func(id uuid.UUID) (*models.EventZone, error) {
			return &models.EventZone{ID: id, EventID: eventID, IsActive: true, RequiresRegistration: true}, nil
		},
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenantID}, nil
		},
		getAttendeeByCode: func(_ uuid.UUID, _ string) (*models.Attendee, error) {
			return &models.Attendee{ID: attendeeID, EventID: eventID, RegisteredAt: &registeredAt}, nil
		},
		checkZoneAccessAt: func(_, _ uuid.UUID, _ time.Time) (bool, string, error) {
			return true, "Access granted by category", nil
		},
		checkAttendeeZoneCheckin: func(_, _ uuid.UUID, _ time.Time) (*models.ZoneCheckin, error) {
			return nil, nil // first entry today
		},
		createZoneCheckin: func(_ *models.ZoneCheckin) error {
			checkinCreated = true
			return nil
		},
		createZoneScanLog: func(_ uuid.UUID, _ *uuid.UUID, verdict string) error {
			scanLogVerdict = verdict
			return nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodPost, "/api/zones/"+zoneID.String()+"/scan", `{"code":"ABCD1234"}`, tenantID.String(), "admin")
	c.SetParamNames("zone_id")
	c.SetParamValues(zoneID.String())
	if err := h.ZoneScan(c); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if !checkinCreated {
		t.Fatal("expected a zone checkin to be recorded for an allowed verdict")
	}
	if scanLogVerdict != "allowed" {
		t.Fatalf("expected scan log verdict 'allowed', got %q", scanLogVerdict)
	}
}

func TestZoneScan_NotRegisteredVerdict(t *testing.T) {
	tenantID := uuid.New()
	eventID := uuid.New()
	zoneID := uuid.New()
	attendeeID := uuid.New()

	fs := &fakeStore{
		getEventZoneByID: func(id uuid.UUID) (*models.EventZone, error) {
			return &models.EventZone{ID: id, EventID: eventID, IsActive: true, RequiresRegistration: true}, nil
		},
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenantID}, nil
		},
		getAttendeeByCode: func(_ uuid.UUID, _ string) (*models.Attendee, error) {
			return &models.Attendee{ID: attendeeID, EventID: eventID, RegisteredAt: nil}, nil
		},
		createZoneScanLog: func(_ uuid.UUID, _ *uuid.UUID, _ string) error {
			return nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodPost, "/api/zones/"+zoneID.String()+"/scan", `{"code":"ABCD1234"}`, tenantID.String(), "admin")
	c.SetParamNames("zone_id")
	c.SetParamValues(zoneID.String())
	if err := h.ZoneScan(c); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 (verdict is not an HTTP error), got %d", rec.Code)
	}
	var resp models.ZoneScanResponse
	if err := jsonUnmarshalBody(rec, &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.Verdict != "not_registered" {
		t.Fatalf("expected verdict 'not_registered', got %q", resp.Verdict)
	}
}
