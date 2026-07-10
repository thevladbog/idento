package handler

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func TestRequireEventOwnership_ForbidsForeignTenant(t *testing.T) {
	ownerTenant := uuid.New()
	callerTenant := uuid.New()
	eventID := uuid.New()

	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: ownerTenant}, nil
		},
	}
	h := &Handler{Store: fs}

	e := echo.New()
	c, _ := newAuthedContext(e, http.MethodGet, "/", "", callerTenant.String(), "admin")

	_, err := h.requireEventOwnership(c, eventID)
	if err == nil {
		t.Fatal("expected not-found error for foreign tenant, got nil")
	}
	he, ok := err.(*httpError)
	if !ok || he.status != http.StatusNotFound {
		t.Fatalf("expected 404 httpError, got %#v", err)
	}
	if he.msg != "Event not found" {
		t.Fatalf("expected 'Event not found' message, got %q", he.msg)
	}
}

func TestRequireEventOwnership_AllowsOwnTenant(t *testing.T) {
	tenant := uuid.New()
	eventID := uuid.New()
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenant}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, _ := newAuthedContext(e, http.MethodGet, "/", "", tenant.String(), "admin")

	ev, err := h.requireEventOwnership(c, eventID)
	if err != nil {
		t.Fatalf("expected nil error for own tenant, got %v", err)
	}
	if ev.TenantID != tenant {
		t.Fatalf("expected event tenant %s, got %s", tenant, ev.TenantID)
	}
}

func TestRequireZoneOwnership_ForbidsForeignTenant(t *testing.T) {
	ownerTenant := uuid.New()
	callerTenant := uuid.New()
	eventID := uuid.New()
	zoneID := uuid.New()

	fs := &fakeStore{
		getEventZoneByID: func(id uuid.UUID) (*models.EventZone, error) {
			return &models.EventZone{ID: id, EventID: eventID}, nil
		},
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: ownerTenant}, nil
		},
	}
	h := &Handler{Store: fs}

	e := echo.New()
	c, _ := newAuthedContext(e, http.MethodGet, "/", "", callerTenant.String(), "admin")

	_, _, err := h.requireZoneOwnership(c, zoneID)
	if err == nil {
		t.Fatal("expected not-found error for foreign tenant, got nil")
	}
	he, ok := err.(*httpError)
	if !ok || he.status != http.StatusNotFound {
		t.Fatalf("expected 404 httpError, got %#v", err)
	}
	if he.msg != "Event not found" {
		t.Fatalf("expected 'Event not found' message, got %q", he.msg)
	}
}

func TestRequireZoneOwnership_AllowsOwnTenant(t *testing.T) {
	tenant := uuid.New()
	eventID := uuid.New()
	zoneID := uuid.New()

	fs := &fakeStore{
		getEventZoneByID: func(id uuid.UUID) (*models.EventZone, error) {
			return &models.EventZone{ID: id, EventID: eventID}, nil
		},
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenant}, nil
		},
	}
	h := &Handler{Store: fs}

	e := echo.New()
	c, _ := newAuthedContext(e, http.MethodGet, "/", "", tenant.String(), "admin")

	zone, event, err := h.requireZoneOwnership(c, zoneID)
	if err != nil {
		t.Fatalf("expected nil error for own tenant, got %v", err)
	}
	if zone.EventID != eventID {
		t.Fatalf("expected zone event %s, got %s", eventID, zone.EventID)
	}
	if event.TenantID != tenant {
		t.Fatalf("expected event tenant %s, got %s", tenant, event.TenantID)
	}
}

func TestRequireZoneOwnership_ZoneNotFound(t *testing.T) {
	tenant := uuid.New()
	zoneID := uuid.New()

	fs := &fakeStore{
		getEventZoneByID: func(_ uuid.UUID) (*models.EventZone, error) {
			return nil, errors.New("not found")
		},
	}
	h := &Handler{Store: fs}

	e := echo.New()
	c, _ := newAuthedContext(e, http.MethodGet, "/", "", tenant.String(), "admin")

	_, _, err := h.requireZoneOwnership(c, zoneID)
	he, ok := err.(*httpError)
	if !ok || he.status != http.StatusNotFound {
		t.Fatalf("expected 404 httpError, got %#v", err)
	}
}

func TestWriteErr_HTTPError(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := writeErr(c, newHTTPError(http.StatusForbidden, "Access denied")); err != nil {
		t.Fatalf("writeErr returned error: %v", err)
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected status %d, got %d", http.StatusForbidden, rec.Code)
	}
	if body := rec.Body.String(); body != `{"error":"Access denied"}`+"\n" {
		t.Fatalf("unexpected body: %s", body)
	}
}

func TestWriteErr_UnknownError(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := writeErr(c, errors.New("boom")); err != nil {
		t.Fatalf("writeErr returned error: %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected status %d, got %d", http.StatusInternalServerError, rec.Code)
	}
	if body := rec.Body.String(); body != `{"error":"Internal error"}`+"\n" {
		t.Fatalf("unexpected body: %s", body)
	}
}
