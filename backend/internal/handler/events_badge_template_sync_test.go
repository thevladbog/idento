package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"testing"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// TestUpdateEventSyncsObjectTypedLegacyBadgeTemplate covers final-review
// Critical 1: the legacy web editor's PUT /api/events/{id} (handler/events.go's
// UpdateEvent) writes an object-typed custom_fields["badgeTemplate"] and this
// must be mirrored into the dedicated badge_template column via
// store.SyncBadgeTemplateFromLegacy, or the write is silently shadowed by
// effectiveBadgeTemplate's column-first rule once a column value already
// exists (badge_template.go).
func TestUpdateEventSyncsObjectTypedLegacyBadgeTemplate(t *testing.T) {
	tenantID := uuid.New()
	event := p1Event(tenantID, "Tech Summit")

	var syncedEventID uuid.UUID
	var syncedTemplate json.RawMessage
	h := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return event, nil },
		updateEvent:  func(*models.Event) error { return nil },
		syncBadgeTemplateFromLegacy: func(eventID uuid.UUID, template json.RawMessage) (int, error) {
			syncedEventID = eventID
			syncedTemplate = template
			return 1, nil
		},
	})
	e := echo.New()
	path := "/api/events/" + event.ID.String()
	body := `{"name":"Tech Summit","location":"Main Hall","custom_fields":{"badgeTemplate":{"width_mm":50,"height_mm":30,"dpi":203,"elements":[]}}}`
	c, rec := newAuthedContext(e, http.MethodPut, path, body, tenantID.String(), "admin")
	c.SetPath("/api/events/:id")
	c.SetParamNames("id")
	c.SetParamValues(event.ID.String())
	if err := h.UpdateEvent(c); err != nil {
		t.Fatalf("UpdateEvent: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if syncedEventID != event.ID {
		t.Fatalf("SyncBadgeTemplateFromLegacy called with event %s, want %s", syncedEventID, event.ID)
	}
	var got map[string]interface{}
	if err := json.Unmarshal(syncedTemplate, &got); err != nil {
		t.Fatalf("synced template not valid JSON: %v", err)
	}
	if got["width_mm"] != float64(50) {
		t.Fatalf("synced template missing width_mm: %+v", got)
	}
	validateResponse(t, http.MethodPut, path, rec)
}

// TestUpdateEventDoesNotSyncStringTypedLegacyBadgeTemplate covers the "do
// not touch the column" half of the fix: a STRING-typed badgeTemplate (the
// print-broken pre-P3.1 shape per migration 000018's own backfill guard)
// must never reach SyncBadgeTemplateFromLegacy. syncBadgeTemplateFromLegacy
// is deliberately left nil here — if UpdateEvent called it, the test would
// panic on the nil func value instead of silently passing.
func TestUpdateEventDoesNotSyncStringTypedLegacyBadgeTemplate(t *testing.T) {
	tenantID := uuid.New()
	event := p1Event(tenantID, "Tech Summit")

	var saved *models.Event
	h := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return event, nil },
		updateEvent:  func(e *models.Event) error { saved = e; return nil },
	})
	e := echo.New()
	path := "/api/events/" + event.ID.String()
	body := `{"name":"Tech Summit","location":"Main Hall","custom_fields":{"badgeTemplate":"legacy-string-template"}}`
	c, rec := newAuthedContext(e, http.MethodPut, path, body, tenantID.String(), "admin")
	c.SetPath("/api/events/:id")
	c.SetParamNames("id")
	c.SetParamValues(event.ID.String())
	if err := h.UpdateEvent(c); err != nil {
		t.Fatalf("UpdateEvent: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if saved == nil || saved.CustomFields["badgeTemplate"] != "legacy-string-template" {
		t.Fatalf("custom_fields not applied as usual: %+v", saved)
	}
	validateResponse(t, http.MethodPut, path, rec)
}

// TestUpdateEventDoesNotSyncWhenCustomFieldsAbsent covers the plain "no
// custom_fields in the body at all" case (e.g. the panel's own event-settings
// save, which never sends a badgeTemplate key) — same nil-panics-if-called
// technique as the string-typed case above.
func TestUpdateEventDoesNotSyncWhenCustomFieldsAbsent(t *testing.T) {
	tenantID := uuid.New()
	event := p1Event(tenantID, "Tech Summit")

	h := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return event, nil },
		updateEvent:  func(*models.Event) error { return nil },
	})
	e := echo.New()
	path := "/api/events/" + event.ID.String()
	body := `{"name":"Tech Summit","location":"Main Hall"}`
	c, rec := newAuthedContext(e, http.MethodPut, path, body, tenantID.String(), "admin")
	c.SetPath("/api/events/:id")
	c.SetParamNames("id")
	c.SetParamValues(event.ID.String())
	if err := h.UpdateEvent(c); err != nil {
		t.Fatalf("UpdateEvent: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPut, path, rec)
}

// TestUpdateEventSyncErrorDoesNotFailTheRequest covers the "log-don't-fail"
// contract: legacy PUT semantics must not regress just because the sync
// into the new column failed (e.g. transient DB issue) — the primary event
// update already succeeded, and the response must still be 200.
func TestUpdateEventSyncErrorDoesNotFailTheRequest(t *testing.T) {
	tenantID := uuid.New()
	event := p1Event(tenantID, "Tech Summit")

	h := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return event, nil },
		updateEvent:  func(*models.Event) error { return nil },
		syncBadgeTemplateFromLegacy: func(uuid.UUID, json.RawMessage) (int, error) {
			return 0, errors.New("db down")
		},
	})
	e := echo.New()
	path := "/api/events/" + event.ID.String()
	body := `{"name":"Tech Summit","location":"Main Hall","custom_fields":{"badgeTemplate":{"elements":[]}}}`
	c, rec := newAuthedContext(e, http.MethodPut, path, body, tenantID.String(), "admin")
	c.SetPath("/api/events/:id")
	c.SetParamNames("id")
	c.SetParamValues(event.ID.String())
	if err := h.UpdateEvent(c); err != nil {
		t.Fatalf("UpdateEvent: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200 even when sync fails, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPut, path, rec)
}
