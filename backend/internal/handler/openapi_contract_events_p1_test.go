package handler

import (
	"errors"
	"net/http"
	"net/http/httptest"
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

func TestContractPatchEvent(t *testing.T) {
	tenantID := uuid.New()
	start := time.Now().Add(24 * time.Hour)
	event := p1Event(tenantID, "Original Name")
	event.Location = "Original Hall"
	event.StartDate = &start
	event.CustomFields = map[string]interface{}{"badgeTemplate": "KEEP-ME"}

	var saved *models.Event
	h := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return event, nil },
		updateEvent:  func(e *models.Event) error { saved = e; return nil },
	})
	e := echo.New()
	path := "/api/events/" + event.ID.String()

	// 200: only name provided — location/start_date/custom_fields untouched.
	c, rec := newAuthedContext(e, http.MethodPatch, path, `{"name":"Renamed"}`, tenantID.String(), "admin")
	c.SetPath("/api/events/:id")
	c.SetParamNames("id")
	c.SetParamValues(event.ID.String())
	if err := h.PatchEvent(c); err != nil {
		t.Fatalf("PatchEvent: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if saved == nil || saved.Name != "Renamed" {
		t.Fatalf("name not applied: %+v", saved)
	}
	if saved.Location != "Original Hall" {
		t.Fatalf("location clobbered: %q", saved.Location)
	}
	if saved.StartDate == nil || !saved.StartDate.Equal(start) {
		t.Fatalf("start_date clobbered: %v", saved.StartDate)
	}
	if saved.CustomFields["badgeTemplate"] != "KEEP-ME" {
		t.Fatalf("custom_fields clobbered: %+v", saved.CustomFields)
	}
	validateResponse(t, http.MethodPatch, path, rec)

	// custom_fields in the body must be IGNORED (not applied, not an error).
	c, rec = newAuthedContext(e, http.MethodPatch, path,
		`{"location":"New Hall","custom_fields":{"badgeTemplate":"EVIL"}}`, tenantID.String(), "admin")
	c.SetPath("/api/events/:id")
	c.SetParamNames("id")
	c.SetParamValues(event.ID.String())
	if err := h.PatchEvent(c); err != nil {
		t.Fatalf("PatchEvent: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	if saved.Location != "New Hall" {
		t.Fatalf("location not applied: %q", saved.Location)
	}
	if saved.CustomFields["badgeTemplate"] != "KEEP-ME" {
		t.Fatalf("custom_fields must be immune to PATCH: %+v", saved.CustomFields)
	}
	validateResponse(t, http.MethodPatch, path, rec)

	// 400: not a UUID.
	c, rec = newAuthedContext(e, http.MethodPatch, "/api/events/nope", `{}`, tenantID.String(), "admin")
	c.SetPath("/api/events/:id")
	c.SetParamNames("id")
	c.SetParamValues("nope")
	if err := h.PatchEvent(c); err != nil {
		t.Fatalf("PatchEvent: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rec.Code)
	}
	validateResponse(t, http.MethodPatch, "/api/events/nope", rec)
}

func TestContractGetEventReadiness(t *testing.T) {
	tenantID := uuid.New()

	fullStore := func(event *models.Event, attendees int, zones, staff int, equipmentTested bool) *fakeStore {
		zoneList := make([]*models.EventZone, zones)
		for i := range zoneList {
			zoneList[i] = &models.EventZone{ID: uuid.New(), EventID: event.ID}
		}
		staffList := make([]*models.User, staff)
		for i := range staffList {
			staffList[i] = &models.User{ID: uuid.New()}
		}
		return &fakeStore{
			getEventByID:            func(uuid.UUID) (*models.Event, error) { return event, nil },
			countAttendeesByEventID: func(uuid.UUID) (int, error) { return attendees, nil },
			getEventZones:           func(uuid.UUID) ([]*models.EventZone, error) { return zoneList, nil },
			getEventStaff:           func(uuid.UUID) ([]*models.User, error) { return staffList, nil },
			tenantHasTestedDefaultPrinter: func(uuid.UUID) (bool, error) {
				return equipmentTested, nil
			},
		}
	}
	e := echo.New()
	run := func(h *Handler, event *models.Event) (*httptest.ResponseRecorder, string) {
		path := "/api/events/" + event.ID.String() + "/readiness"
		c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
		c.SetPath("/api/events/:id/readiness")
		c.SetParamNames("id")
		c.SetParamValues(event.ID.String())
		if err := h.GetEventReadiness(c); err != nil {
			t.Fatalf("GetEventReadiness: %v", err)
		}
		return rec, path
	}

	// Fully ready: attendees+badge+staff done, zones done too. Equipment
	// has no tested default printer yet — must be not_done but must not
	// affect ready (equipment never blocks launch, spec §4.3).
	ready := p1Event(tenantID, "Ready Event")
	ready.CustomFields = map[string]interface{}{"badgeTemplate": "{...}"}
	rec, path := run(New(fullStore(ready, 340, 2, 3, false)), ready)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Ready bool `json:"ready"`
		Steps []struct {
			Key    string `json:"key"`
			Status string `json:"status"`
			Count  *int   `json:"count"`
		} `json:"steps"`
	}
	if err := jsonUnmarshalBody(rec, &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !resp.Ready {
		t.Fatalf("want ready=true: %+v", resp)
	}
	wantOrder := []string{"attendees", "badge", "zones", "staff", "equipment"}
	if len(resp.Steps) != 5 {
		t.Fatalf("want 5 steps, got %d", len(resp.Steps))
	}
	for i, s := range resp.Steps {
		if s.Key != wantOrder[i] {
			t.Fatalf("step %d = %s, want %s", i, s.Key, wantOrder[i])
		}
	}
	if resp.Steps[4].Status != "not_done" {
		t.Fatalf("equipment must be not_done when no tested default printer exists, got %s", resp.Steps[4].Status)
	}
	if resp.Steps[0].Count == nil || *resp.Steps[0].Count != 340 {
		t.Fatalf("attendees count wrong: %+v", resp.Steps[0])
	}
	validateResponse(t, http.MethodGet, path, rec)

	// Draft: nothing done — zones skipped (not blocking), ready=false.
	draft := p1Event(tenantID, "Draft Event")
	rec, path = run(New(fullStore(draft, 0, 0, 0, false)), draft)
	if err := jsonUnmarshalBody(rec, &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.Ready {
		t.Fatal("draft must not be ready")
	}
	if resp.Steps[2].Status != "skipped" {
		t.Fatalf("zones with 0 zones must be skipped, got %s", resp.Steps[2].Status)
	}
	validateResponse(t, http.MethodGet, path, rec)

	// Zones present but staff missing: zones done, ready still false.
	partial := p1Event(tenantID, "Partial Event")
	partial.CustomFields = map[string]interface{}{"badgeTemplate": "{...}"}
	rec, path = run(New(fullStore(partial, 12, 1, 0, false)), partial)
	if err := jsonUnmarshalBody(rec, &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.Ready {
		t.Fatal("missing staff must block ready")
	}
	if resp.Steps[2].Status != "done" {
		t.Fatalf("zones with 1 zone must be done, got %s", resp.Steps[2].Status)
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 500: count failure.
	broken := New(&fakeStore{
		getEventByID:            func(uuid.UUID) (*models.Event, error) { return ready, nil },
		countAttendeesByEventID: func(uuid.UUID) (int, error) { return 0, errors.New("db down") },
	})
	rec, path = run(broken, ready)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d", rec.Code)
	}
	validateResponse(t, http.MethodGet, path, rec)

	// Equipment done: a tested default printer exists tenant-wide. Other
	// steps are also done, so ready stays true either way — this proves
	// equipment is read from the new store method, not just defaulted.
	equipmentReady := p1Event(tenantID, "Equipment Ready Event")
	equipmentReady.CustomFields = map[string]interface{}{"badgeTemplate": "{...}"}
	rec, path = run(New(fullStore(equipmentReady, 5, 0, 1, true)), equipmentReady)
	if err := jsonUnmarshalBody(rec, &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.Steps[4].Status != "done" {
		t.Fatalf("equipment must be done when the tenant has a tested default printer, got %s", resp.Steps[4].Status)
	}
	if !resp.Ready {
		t.Fatal("want ready=true (attendees+badge+staff done)")
	}
	validateResponse(t, http.MethodGet, path, rec)

	// Equipment not done: no tested default printer. ready must still be
	// true — equipment never blocks launch (spec §4.3).
	equipmentNotReady := p1Event(tenantID, "Equipment Not Ready Event")
	equipmentNotReady.CustomFields = map[string]interface{}{"badgeTemplate": "{...}"}
	rec, path = run(New(fullStore(equipmentNotReady, 5, 0, 1, false)), equipmentNotReady)
	if err := jsonUnmarshalBody(rec, &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.Steps[4].Status != "not_done" {
		t.Fatalf("equipment must be not_done when no tested default printer exists, got %s", resp.Steps[4].Status)
	}
	if !resp.Ready {
		t.Fatal("want ready=true — equipment not_done must not block ready (attendees+badge+staff done)")
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 500: TenantHasTestedDefaultPrinter store failure gets the house 500
	// shape, same as every other readiness sub-query.
	equipmentBroken := New(&fakeStore{
		getEventByID:            func(uuid.UUID) (*models.Event, error) { return ready, nil },
		countAttendeesByEventID: func(uuid.UUID) (int, error) { return 1, nil },
		getEventZones:           func(uuid.UUID) ([]*models.EventZone, error) { return nil, nil },
		getEventStaff:           func(uuid.UUID) ([]*models.User, error) { return []*models.User{{ID: uuid.New()}}, nil },
		tenantHasTestedDefaultPrinter: func(uuid.UUID) (bool, error) {
			return false, errors.New("db down")
		},
	})
	rec, path = run(equipmentBroken, ready)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d", rec.Code)
	}
	validateResponse(t, http.MethodGet, path, rec)
}

// TestContractGetEventReadinessBadgeTemplateShapes covers the badge-readiness
// shapes that actually occur in production. The shipped badge editor
// (web/src/pages/BadgeTemplateEditorV2.tsx's handleSave) always PUTs
// custom_fields with badgeTemplate as a JS object
// ({width_mm, height_mm, dpi, elements}); Postgres JSONB round-trips that
// back out as map[string]interface{} (see pg_store.go), never as a string.
// These cases exercise that real map shape — with a non-empty, empty, and
// absent "elements" array — alongside the string-based shapes the original
// TestContractGetEventReadiness scenarios already cover, to lock in the fix
// for the "any non-nil, non-string value counts as done" bug in
// GetEventReadiness.
func TestContractGetEventReadinessBadgeTemplateShapes(t *testing.T) {
	tenantID := uuid.New()

	// attendees=1, zones=0 (skipped, never blocks), staff=1: isolates
	// "ready" so it hinges entirely on the badge step under test.
	store := func(event *models.Event) *fakeStore {
		return &fakeStore{
			getEventByID:            func(uuid.UUID) (*models.Event, error) { return event, nil },
			countAttendeesByEventID: func(uuid.UUID) (int, error) { return 1, nil },
			getEventZones:           func(uuid.UUID) ([]*models.EventZone, error) { return nil, nil },
			getEventStaff:           func(uuid.UUID) ([]*models.User, error) { return []*models.User{{ID: uuid.New()}}, nil },
			tenantHasTestedDefaultPrinter: func(uuid.UUID) (bool, error) {
				return false, nil
			},
		}
	}
	e := echo.New()
	run := func(event *models.Event) (*httptest.ResponseRecorder, string) {
		path := "/api/events/" + event.ID.String() + "/readiness"
		c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
		c.SetPath("/api/events/:id/readiness")
		c.SetParamNames("id")
		c.SetParamValues(event.ID.String())
		if err := New(store(event)).GetEventReadiness(c); err != nil {
			t.Fatalf("GetEventReadiness: %v", err)
		}
		return rec, path
	}
	badgeStatus := func(t *testing.T, rec *httptest.ResponseRecorder, path string) (string, bool) {
		t.Helper()
		var resp struct {
			Ready bool `json:"ready"`
			Steps []struct {
				Key    string `json:"key"`
				Status string `json:"status"`
			} `json:"steps"`
		}
		if err := jsonUnmarshalBody(rec, &resp); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		validateResponse(t, http.MethodGet, path, rec)
		for _, s := range resp.Steps {
			if s.Key == "badge" {
				return s.Status, resp.Ready
			}
		}
		t.Fatal("badge step missing from response")
		return "", false
	}

	// (a) Map-shaped template with a non-empty elements array — the real
	// shape written by BadgeTemplateEditorV2's handleSave — must be done.
	withElements := p1Event(tenantID, "Map Template With Elements")
	withElements.CustomFields = map[string]interface{}{
		"badgeTemplate": map[string]interface{}{
			"width_mm":  float64(50),
			"height_mm": float64(30),
			"dpi":       float64(203),
			"elements": []interface{}{
				map[string]interface{}{"type": "text", "id": "el-1"},
			},
		},
	}
	rec, path := run(withElements)
	if status, ready := badgeStatus(t, rec, path); status != readinessDone || !ready {
		t.Fatalf("map template with elements must be badge=done and not block ready, got status=%s ready=%v", status, ready)
	}

	// (b) Map-shaped template with an empty elements array — a freshly
	// created blank canvas — is not print-ready and must be not_done.
	emptyElements := p1Event(tenantID, "Map Template Empty Elements")
	emptyElements.CustomFields = map[string]interface{}{
		"badgeTemplate": map[string]interface{}{
			"width_mm":  float64(50),
			"height_mm": float64(30),
			"dpi":       float64(203),
			"elements":  []interface{}{},
		},
	}
	rec, path = run(emptyElements)
	if status, ready := badgeStatus(t, rec, path); status != readinessNotDone || ready {
		t.Fatalf("blank-canvas map template (empty elements) must be badge=not_done and block ready, got status=%s ready=%v", status, ready)
	}

	// (b2) Map-shaped template with no "elements" key at all behaves the
	// same as an empty array — not_done.
	absentElements := p1Event(tenantID, "Map Template Absent Elements")
	absentElements.CustomFields = map[string]interface{}{
		"badgeTemplate": map[string]interface{}{
			"width_mm":  float64(50),
			"height_mm": float64(30),
			"dpi":       float64(203),
		},
	}
	rec, path = run(absentElements)
	if status, ready := badgeStatus(t, rec, path); status != readinessNotDone || ready {
		t.Fatalf("map template without an elements key must be badge=not_done and block ready, got status=%s ready=%v", status, ready)
	}

	// (c) Existing string-based "done" scenario (as used elsewhere in the
	// contract tests) must keep working under the new type-aware check.
	stringTemplate := p1Event(tenantID, "String Template")
	stringTemplate.CustomFields = map[string]interface{}{"badgeTemplate": "{...}"}
	rec, path = run(stringTemplate)
	if status, ready := badgeStatus(t, rec, path); status != readinessDone || !ready {
		t.Fatalf("non-empty string template must be badge=done and not block ready, got status=%s ready=%v", status, ready)
	}

	// (c2) An empty string must remain not_done — it never counted as done
	// and the fix must not change that.
	emptyString := p1Event(tenantID, "Empty String Template")
	emptyString.CustomFields = map[string]interface{}{"badgeTemplate": ""}
	rec, path = run(emptyString)
	if status, ready := badgeStatus(t, rec, path); status != readinessNotDone || ready {
		t.Fatalf("empty string template must be badge=not_done and block ready, got status=%s ready=%v", status, ready)
	}
}
