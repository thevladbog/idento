package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"idento/backend/internal/models"
	"idento/backend/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// dualWriteStore is a small stateful fake around one *models.Event that
// models the actual database semantics the final-review dual-write fix
// depends on: PutBadgeTemplate's optimistic-concurrency guard, and
// SyncBadgeTemplateFromLegacy's unconditional bump. A single shared
// *models.Event plays the role of the row across multiple handler calls in
// one test — the func-per-call fakeStore used elsewhere in this package
// can't model that without this bit of extra state.
type dualWriteStore struct {
	store.Store
	event *models.Event
}

func (s *dualWriteStore) GetEventByID(context.Context, uuid.UUID) (*models.Event, error) {
	return s.event, nil
}
func (s *dualWriteStore) GetEventByIDForTenant(_ context.Context, _ uuid.UUID, tenantID uuid.UUID) (*models.Event, error) {
	if s.event.TenantID != tenantID {
		return nil, nil
	}
	return s.event, nil
}
func (s *dualWriteStore) UpdateEvent(_ context.Context, event *models.Event) error {
	// The handler mutates the SAME pointer requireEventOwnership returned,
	// so there is nothing to copy here — this only needs to not error.
	return nil
}
func (s *dualWriteStore) GetEventBadgeTemplate(context.Context, uuid.UUID) (json.RawMessage, int, error) {
	return s.event.BadgeTemplate, s.event.BadgeTemplateVersion, nil
}
func (s *dualWriteStore) UpdateEventBadgeTemplate(_ context.Context, _ uuid.UUID, template json.RawMessage, expectedVersion int) (int, error) {
	if expectedVersion != s.event.BadgeTemplateVersion {
		return 0, store.ErrVersionConflict
	}
	s.event.BadgeTemplate = template
	s.event.BadgeTemplateVersion++
	return s.event.BadgeTemplateVersion, nil
}
func (s *dualWriteStore) SyncBadgeTemplateFromLegacy(_ context.Context, _ uuid.UUID, template json.RawMessage) (int, error) {
	s.event.BadgeTemplate = template
	s.event.BadgeTemplateVersion++
	return s.event.BadgeTemplateVersion, nil
}

// TestContractLegacyPutMakesTemplateVisibleViaGetBadgeTemplate is contract
// test (a) from the final review: PUT /api/events/{id} with an object-typed
// badgeTemplate in custom_fields must make a subsequent GET
// /api/events/{id}/badge-template return it, with a bumped version — proving
// the dual-write closes the "silently shadowed" gap (effectiveBadgeTemplate
// prefers the column once ANY column value exists).
func TestContractLegacyPutMakesTemplateVisibleViaGetBadgeTemplate(t *testing.T) {
	tenantID := uuid.New()
	event := p1Event(tenantID, "Tech Summit")
	dw := &dualWriteStore{event: event}
	h := New(dw)
	e := echo.New()

	eventPath := "/api/events/" + event.ID.String()
	putBody := `{"name":"Tech Summit","location":"Main Hall","custom_fields":{"badgeTemplate":{"width_mm":50,"height_mm":30,"dpi":203,"elements":[{"id":"e1","type":"text"}]}}}`
	c, rec := newAuthedContext(e, http.MethodPut, eventPath, putBody, tenantID.String(), "admin")
	c.SetPath("/api/events/:id")
	c.SetParamNames("id")
	c.SetParamValues(event.ID.String())
	if err := h.UpdateEvent(c); err != nil {
		t.Fatalf("UpdateEvent: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("UpdateEvent want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPut, eventPath, rec)

	btPath := badgeTemplatePath(event.ID)
	c, rec = newAuthedContext(e, http.MethodGet, btPath, "", tenantID.String(), "admin")
	setBadgeTemplatePathParams(c, event.ID)
	if err := h.GetBadgeTemplate(c); err != nil {
		t.Fatalf("GetBadgeTemplate: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("GetBadgeTemplate want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	var resp BadgeTemplateResponse
	if err := jsonUnmarshalBody(rec, &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.Version != 1 {
		t.Fatalf("version = %d, want 1 (bumped from 0 by the sync)", resp.Version)
	}
	var tmpl map[string]interface{}
	if err := json.Unmarshal(resp.Template, &tmpl); err != nil {
		t.Fatalf("template not valid JSON: %v", err)
	}
	if tmpl["width_mm"] != float64(50) {
		t.Fatalf("template missing synced content: %+v", tmpl)
	}
	validateResponse(t, http.MethodGet, btPath, rec)
}

// TestContractPanelWebPanelSequenceSecondPanelSave409s is contract test (b):
// a panel save, then a legacy web save, then a second panel save (using the
// version the panel client still has from its OWN last save, now stale)
// must 409 — proof that SyncBadgeTemplateFromLegacy's deliberate,
// unconditional version bump produces correct cross-editor conflict
// semantics rather than a silent overwrite.
func TestContractPanelWebPanelSequenceSecondPanelSave409s(t *testing.T) {
	tenantID := uuid.New()
	event := p1Event(tenantID, "Tech Summit")
	dw := &dualWriteStore{event: event}
	h := New(dw)
	e := echo.New()
	btPath := badgeTemplatePath(event.ID)

	// 1) Panel save: version 0 -> 1.
	c, rec := newAuthedContext(e, http.MethodPut, btPath,
		`{"template":{"width_mm":90,"height_mm":55,"dpi":300,"elements":[]},"version":0}`,
		tenantID.String(), "admin")
	setBadgeTemplatePathParams(c, event.ID)
	if err := h.PutBadgeTemplate(c); err != nil {
		t.Fatalf("PutBadgeTemplate (panel #1): %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("panel save #1 want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if event.BadgeTemplateVersion != 1 {
		t.Fatalf("version after panel save #1 = %d, want 1", event.BadgeTemplateVersion)
	}

	// 2) Legacy web save: object-typed custom_fields["badgeTemplate"] via PUT
	// /api/events/{id} -- unconditionally bumps 1 -> 2, with no version
	// check at all (the legacy editor never sent one).
	eventPath := "/api/events/" + event.ID.String()
	webPutBody := `{"name":"Tech Summit","location":"Main Hall","custom_fields":{"badgeTemplate":{"width_mm":90,"height_mm":55,"dpi":300,"elements":[{"id":"web-1","type":"text"}]}}}`
	c, rec = newAuthedContext(e, http.MethodPut, eventPath, webPutBody, tenantID.String(), "admin")
	c.SetPath("/api/events/:id")
	c.SetParamNames("id")
	c.SetParamValues(event.ID.String())
	if err := h.UpdateEvent(c); err != nil {
		t.Fatalf("UpdateEvent (legacy web save): %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("legacy web save want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if event.BadgeTemplateVersion != 2 {
		t.Fatalf("version after legacy web save = %d, want 2", event.BadgeTemplateVersion)
	}

	// 3) Second panel save: the panel client still only knows about version 1
	// (its own last successful save) — it has no idea the web editor bumped
	// to 2 underneath it — so this PUT must 409, not silently overwrite the
	// web editor's newer template.
	c, rec = newAuthedContext(e, http.MethodPut, btPath,
		`{"template":{"width_mm":90,"height_mm":55,"dpi":300,"elements":[{"id":"panel-2","type":"text"}]},"version":1}`,
		tenantID.String(), "admin")
	setBadgeTemplatePathParams(c, event.ID)
	if err := h.PutBadgeTemplate(c); err != nil {
		t.Fatalf("PutBadgeTemplate (panel #2): %v", err)
	}
	if rec.Code != http.StatusConflict {
		t.Fatalf("panel save #2 want 409, got %d, body=%s", rec.Code, rec.Body.String())
	}
	var conflict BadgeTemplateConflict
	if err := jsonUnmarshalBody(rec, &conflict); err != nil {
		t.Fatalf("unmarshal conflict body: %v", err)
	}
	if conflict.CurrentVersion != 2 {
		t.Fatalf("conflict current_version = %d, want 2", conflict.CurrentVersion)
	}
	validateResponse(t, http.MethodPut, btPath, rec)
}

// TestContractStringBadgeTemplateDoesNotTouchColumn is contract test (c): a
// STRING-typed custom_fields["badgeTemplate"] (the pre-P3.1, print-broken
// shape — migration 000018's own backfill deliberately skips it) must NOT
// reach the badge_template column at all.
func TestContractStringBadgeTemplateDoesNotTouchColumn(t *testing.T) {
	tenantID := uuid.New()
	event := p1Event(tenantID, "Tech Summit")
	dw := &dualWriteStore{event: event}
	h := New(dw)
	e := echo.New()

	eventPath := "/api/events/" + event.ID.String()
	putBody := `{"name":"Tech Summit","location":"Main Hall","custom_fields":{"badgeTemplate":"legacy-string-template"}}`
	c, rec := newAuthedContext(e, http.MethodPut, eventPath, putBody, tenantID.String(), "admin")
	c.SetPath("/api/events/:id")
	c.SetParamNames("id")
	c.SetParamValues(event.ID.String())
	if err := h.UpdateEvent(c); err != nil {
		t.Fatalf("UpdateEvent: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("UpdateEvent want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPut, eventPath, rec)

	btPath := badgeTemplatePath(event.ID)
	c, rec = newAuthedContext(e, http.MethodGet, btPath, "", tenantID.String(), "admin")
	setBadgeTemplatePathParams(c, event.ID)
	if err := h.GetBadgeTemplate(c); err != nil {
		t.Fatalf("GetBadgeTemplate: %v", err)
	}
	var resp BadgeTemplateResponse
	if err := jsonUnmarshalBody(rec, &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.Version != 0 {
		t.Fatalf("version = %d, want 0 (string-typed legacy value must not touch the column)", resp.Version)
	}
	// json.RawMessage round-trips a JSON `null` as the 4 literal bytes
	// "null", not a nil slice -- BadgeTemplateResponse.Template is only nil
	// when the field is entirely ABSENT from the response body, which never
	// happens here (GetBadgeTemplate always includes it).
	if string(resp.Template) != "null" {
		t.Fatalf("template = %s, want null", resp.Template)
	}
	validateResponse(t, http.MethodGet, btPath, rec)
}
