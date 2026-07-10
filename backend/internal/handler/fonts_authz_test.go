package handler

import (
	"net/http"
	"testing"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func TestGetEventFonts_ForbidsForeignTenant(t *testing.T) {
	owner := uuid.New()
	caller := uuid.New()
	eventID := uuid.New()
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: owner}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/", "", caller.String(), "admin")
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())

	_ = h.GetEventFonts(c)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", rec.Code)
	}
}

func TestGetFontFile_ForbidsForeignTenant(t *testing.T) {
	ownerTenant := uuid.New()
	caller := uuid.New()
	eventID := uuid.New()
	fontID := uuid.New()
	fs := &fakeStore{
		getFontByID: func(id uuid.UUID) (*models.Font, error) {
			return &models.Font{ID: id, EventID: eventID, MimeType: "font/woff2"}, nil
		},
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: ownerTenant}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/", "", caller.String(), "admin")
	c.SetParamNames("id")
	c.SetParamValues(fontID.String())

	_ = h.GetFontFile(c)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", rec.Code)
	}
}

func TestDeleteEventFont_ForbidsForeignTenant(t *testing.T) {
	ownerTenant := uuid.New()
	caller := uuid.New()
	eventID := uuid.New()
	fontID := uuid.New()
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: ownerTenant}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodDelete, "/", "", caller.String(), "admin")
	c.SetParamNames("event_id", "font_id")
	c.SetParamValues(eventID.String(), fontID.String())

	_ = h.DeleteEventFont(c)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", rec.Code)
	}
}
