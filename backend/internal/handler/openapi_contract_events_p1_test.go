package handler

import (
	"errors"
	"net/http"
	"testing"
	"time"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func p1Event(tenantID uuid.UUID, name string) *models.Event {
	now := time.Now()
	return &models.Event{ID: uuid.New(), TenantID: tenantID, Name: name, CreatedAt: now, UpdatedAt: now}
}

func TestContractDeleteEvent(t *testing.T) {
	tenantID := uuid.New()
	event := p1Event(tenantID, "Tech Summit")

	// 204: happy path — soft delete called with the event's id.
	var deletedID uuid.UUID
	h := New(&fakeStore{
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		softDeleteEvent: func(id uuid.UUID) error { deletedID = id; return nil },
	})
	e := echo.New()
	path := "/api/events/" + event.ID.String()
	c, rec := newAuthedContext(e, http.MethodDelete, path, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:id")
	c.SetParamNames("id")
	c.SetParamValues(event.ID.String())
	if err := h.DeleteEvent(c); err != nil {
		t.Fatalf("DeleteEvent: %v", err)
	}
	if rec.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if deletedID != event.ID {
		t.Fatalf("SoftDeleteEvent called with %s, want %s", deletedID, event.ID)
	}
	validateResponse(t, http.MethodDelete, path, rec)

	// 400: not a UUID.
	c, rec = newAuthedContext(e, http.MethodDelete, "/api/events/not-a-uuid", "", tenantID.String(), "admin")
	c.SetPath("/api/events/:id")
	c.SetParamNames("id")
	c.SetParamValues("not-a-uuid")
	if err := h.DeleteEvent(c); err != nil {
		t.Fatalf("DeleteEvent: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rec.Code)
	}
	validateResponse(t, http.MethodDelete, "/api/events/not-a-uuid", rec)

	// 404: foreign tenant (ownership resolves nil).
	foreign := p1Event(uuid.New(), "Other Org Event")
	hForeign := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return foreign, nil },
	})
	path = "/api/events/" + foreign.ID.String()
	c, rec = newAuthedContext(e, http.MethodDelete, path, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:id")
	c.SetParamNames("id")
	c.SetParamValues(foreign.ID.String())
	if err := hForeign.DeleteEvent(c); err != nil {
		t.Fatalf("DeleteEvent: %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", rec.Code)
	}
	validateResponse(t, http.MethodDelete, path, rec)

	// 500: store failure on the delete itself.
	hFail := New(&fakeStore{
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		softDeleteEvent: func(uuid.UUID) error { return errors.New("db down") },
	})
	path = "/api/events/" + event.ID.String()
	c, rec = newAuthedContext(e, http.MethodDelete, path, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:id")
	c.SetParamNames("id")
	c.SetParamValues(event.ID.String())
	if err := hFail.DeleteEvent(c); err != nil {
		t.Fatalf("DeleteEvent: %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d", rec.Code)
	}
	validateResponse(t, http.MethodDelete, path, rec)
}
