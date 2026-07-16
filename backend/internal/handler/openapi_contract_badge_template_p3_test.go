package handler

import (
	"bytes"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"idento/backend/internal/models"
	"idento/backend/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// newBadgeTemplateHandler builds a Handler whose event store returns event
// for any GetEventByID(ForTenant) lookup, wired to the given badge-template
// fake read/write functions.
func newBadgeTemplateHandler(
	event *models.Event,
	get func(eventID uuid.UUID) (json.RawMessage, int, error),
	update func(eventID uuid.UUID, template json.RawMessage, expectedVersion int) (int, error),
) *Handler {
	return New(&fakeStore{
		getEventByID:             func(uuid.UUID) (*models.Event, error) { return event, nil },
		getEventBadgeTemplate:    get,
		updateEventBadgeTemplate: update,
	})
}

func badgeTemplatePath(eventID uuid.UUID) string {
	return "/api/events/" + eventID.String() + "/badge-template"
}

func setBadgeTemplatePathParams(c echo.Context, eventID uuid.UUID) {
	c.SetPath("/api/events/:id/badge-template")
	c.SetParamNames("id")
	c.SetParamValues(eventID.String())
}

// GET with no template saved yet → {template: null, version: 0}.
func TestOpenAPIContract_GetBadgeTemplate_NoTemplateYet(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	h := newBadgeTemplateHandler(event,
		func(uuid.UUID) (json.RawMessage, int, error) { return nil, 0, nil },
		nil,
	)
	e := echo.New()
	path := badgeTemplatePath(event.ID)
	c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	setBadgeTemplatePathParams(c, event.ID)

	if err := h.GetBadgeTemplate(c); err != nil {
		t.Fatalf("GetBadgeTemplate: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	var got BadgeTemplateResponse
	if err := jsonUnmarshalBody(rec, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	// encoding/json invokes json.RawMessage.UnmarshalJSON even for a literal
	// null, storing the 4 bytes "null" rather than leaving the field nil —
	// so the correct "is it null" check is on the decoded text, not a nil
	// comparison.
	if string(bytes.TrimSpace(got.Template)) != "null" || got.Version != 0 {
		t.Fatalf("got template=%s version=%d, want null/0", got.Template, got.Version)
	}
	validateResponse(t, http.MethodGet, path, rec)
}

// GET after seeding → the stored object + its version, both echoed as-is.
func TestOpenAPIContract_GetBadgeTemplate_Seeded(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	stored := json.RawMessage(`{"width_mm":50,"height_mm":30,"dpi":203,"elements":[]}`)
	h := newBadgeTemplateHandler(event,
		func(uuid.UUID) (json.RawMessage, int, error) { return stored, 3, nil },
		nil,
	)
	e := echo.New()
	path := badgeTemplatePath(event.ID)
	c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	setBadgeTemplatePathParams(c, event.ID)

	if err := h.GetBadgeTemplate(c); err != nil {
		t.Fatalf("GetBadgeTemplate: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	var got BadgeTemplateResponse
	if err := jsonUnmarshalBody(rec, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Version != 3 {
		t.Fatalf("got version=%d, want 3", got.Version)
	}
	if !bytes.Equal(bytes.TrimSpace(got.Template), stored) {
		t.Fatalf("got template=%s, want %s", got.Template, stored)
	}
	validateResponse(t, http.MethodGet, path, rec)
}

// PUT happy path → 200 with version bumped by one, AND the fakeStore
// captured template bytes are byte-identical to the request's raw
// "template" bytes — the verbatim-storage proof. The fixture includes an
// unknown key ("customFont") that a parsed-and-re-marshaled copy would not
// necessarily reproduce byte-for-byte, so this also proves the handler
// never round-trips the value through its own JSON encoder.
func TestOpenAPIContract_PutBadgeTemplate_HappyPathIsVerbatim(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")

	var captured json.RawMessage
	var capturedExpectedVersion int
	h := newBadgeTemplateHandler(event,
		func(uuid.UUID) (json.RawMessage, int, error) { return nil, 2, nil },
		func(_ uuid.UUID, template json.RawMessage, expectedVersion int) (int, error) {
			captured = append(json.RawMessage(nil), template...)
			capturedExpectedVersion = expectedVersion
			return expectedVersion + 1, nil
		},
	)

	// customFont is not a field zpl.BadgeElement/Config knows about — the
	// handler must persist it anyway, since only a parsed COPY is used for
	// validation.
	requestBody := `{"template":{"width_mm":50,"height_mm":30,"dpi":203,"elements":[],"customFont":"X"},"version":2}`
	// The exact bytes of the "template" value within requestBody, as sent —
	// this is what must reach the store byte-for-byte.
	rawTemplateBytes := json.RawMessage(`{"width_mm":50,"height_mm":30,"dpi":203,"elements":[],"customFont":"X"}`)

	e := echo.New()
	path := badgeTemplatePath(event.ID)
	c, rec := newAuthedContext(e, http.MethodPut, path, requestBody, tenantID.String(), "admin")
	setBadgeTemplatePathParams(c, event.ID)

	if err := h.PutBadgeTemplate(c); err != nil {
		t.Fatalf("PutBadgeTemplate: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if capturedExpectedVersion != 2 {
		t.Fatalf("expectedVersion passed to store = %d, want 2", capturedExpectedVersion)
	}
	if !bytes.Equal(captured, rawTemplateBytes) {
		t.Fatalf("store captured template = %s, want byte-identical to %s (verbatim storage broken)", captured, rawTemplateBytes)
	}

	var got BadgeTemplateResponse
	if err := jsonUnmarshalBody(rec, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Version != 3 {
		t.Fatalf("got version=%d, want 3 (bumped from 2)", got.Version)
	}
	if !bytes.Equal(bytes.TrimSpace(got.Template), rawTemplateBytes) {
		t.Fatalf("response template = %s, want byte-identical to %s", got.Template, rawTemplateBytes)
	}
	validateResponse(t, http.MethodPut, path, rec)
}

// PUT with structural garbage (elements: 42, not an array) → 400 carrying
// zpl.ParseBadgeTemplate's own error message.
func TestOpenAPIContract_PutBadgeTemplate_StructuralGarbage400(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	h := newBadgeTemplateHandler(event,
		func(uuid.UUID) (json.RawMessage, int, error) { return nil, 0, nil },
		func(uuid.UUID, json.RawMessage, int) (int, error) {
			t.Fatalf("UpdateEventBadgeTemplate should not be called when the parsed template is structurally invalid")
			return 0, nil
		},
	)
	e := echo.New()
	path := badgeTemplatePath(event.ID)
	body := `{"template":{"width_mm":50,"height_mm":30,"dpi":203,"elements":42},"version":0}`
	c, rec := newAuthedContext(e, http.MethodPut, path, body, tenantID.String(), "admin")
	setBadgeTemplatePathParams(c, event.ID)

	if err := h.PutBadgeTemplate(c); err != nil {
		t.Fatalf("PutBadgeTemplate: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	var got struct {
		Error string `json:"error"`
	}
	if err := jsonUnmarshalBody(rec, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Error == "" || got.Error == "Invalid badge template: " {
		t.Fatalf("got error=%q, want the parser's own message included", got.Error)
	}
	validateResponse(t, http.MethodPut, path, rec)
}

// PUT with an element's x as a string (also a structural/type mismatch
// zpl.ParseBadgeTemplate rejects) → 400.
func TestOpenAPIContract_PutBadgeTemplate_ElementXWrongType400(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	h := newBadgeTemplateHandler(event,
		func(uuid.UUID) (json.RawMessage, int, error) { return nil, 0, nil },
		func(uuid.UUID, json.RawMessage, int) (int, error) {
			t.Fatalf("UpdateEventBadgeTemplate should not be called when the parsed template is structurally invalid")
			return 0, nil
		},
	)
	e := echo.New()
	path := badgeTemplatePath(event.ID)
	body := `{"template":{"elements":[{"id":"e1","type":"text","x":"not-a-number","y":1}]},"version":0}`
	c, rec := newAuthedContext(e, http.MethodPut, path, body, tenantID.String(), "admin")
	setBadgeTemplatePathParams(c, event.ID)

	if err := h.PutBadgeTemplate(c); err != nil {
		t.Fatalf("PutBadgeTemplate: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPut, path, rec)
}

// PUT with a stale version → 409 with current_version re-read from the store.
func TestOpenAPIContract_PutBadgeTemplate_StaleVersionConflict409(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	h := newBadgeTemplateHandler(event,
		func(uuid.UUID) (json.RawMessage, int, error) {
			return json.RawMessage(`{"elements":[]}`), 5, nil
		},
		func(uuid.UUID, json.RawMessage, int) (int, error) {
			return 0, store.ErrVersionConflict
		},
	)
	e := echo.New()
	path := badgeTemplatePath(event.ID)
	body := `{"template":{"elements":[]},"version":2}`
	c, rec := newAuthedContext(e, http.MethodPut, path, body, tenantID.String(), "admin")
	setBadgeTemplatePathParams(c, event.ID)

	if err := h.PutBadgeTemplate(c); err != nil {
		t.Fatalf("PutBadgeTemplate: %v", err)
	}
	if rec.Code != http.StatusConflict {
		t.Fatalf("want 409, got %d, body=%s", rec.Code, rec.Body.String())
	}
	var got BadgeTemplateConflict
	if err := jsonUnmarshalBody(rec, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.CurrentVersion != 5 {
		t.Fatalf("got current_version=%d, want 5", got.CurrentVersion)
	}
	if got.Error == "" {
		t.Fatalf("want a non-empty error message")
	}
	validateResponse(t, http.MethodPut, path, rec)
}

// PUT with version missing or negative → 400 (both checked in one test,
// each independently exercising the handler).
func TestOpenAPIContract_PutBadgeTemplate_VersionMissingOrNegative400(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	newHandler := func() *Handler {
		return newBadgeTemplateHandler(event,
			func(uuid.UUID) (json.RawMessage, int, error) { return nil, 0, nil },
			func(uuid.UUID, json.RawMessage, int) (int, error) {
				t.Fatalf("UpdateEventBadgeTemplate should not be called with an invalid version")
				return 0, nil
			},
		)
	}
	e := echo.New()
	path := badgeTemplatePath(event.ID)

	for name, body := range map[string]string{
		"missing":  `{"template":{"elements":[]}}`,
		"negative": `{"template":{"elements":[]},"version":-1}`,
	} {
		h := newHandler()
		c, rec := newAuthedContext(e, http.MethodPut, path, body, tenantID.String(), "admin")
		setBadgeTemplatePathParams(c, event.ID)
		if err := h.PutBadgeTemplate(c); err != nil {
			t.Fatalf("%s: PutBadgeTemplate: %v", name, err)
		}
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s: want 400, got %d, body=%s", name, rec.Code, rec.Body.String())
		}
		validateResponse(t, http.MethodPut, path, rec)
	}
}

// GET and PUT on a foreign event (different tenant) both 404 —
// requireEventOwnership masks "foreign" as "missing", and is checked before
// any store call so this never surfaces as a version conflict.
func TestOpenAPIContract_BadgeTemplate_ForeignEvent404(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	foreignTenantID := uuid.New()
	path := badgeTemplatePath(event.ID)

	t.Run("GET", func(t *testing.T) {
		h := newBadgeTemplateHandler(event,
			func(uuid.UUID) (json.RawMessage, int, error) {
				t.Fatalf("GetEventBadgeTemplate should not be called for a foreign event")
				return nil, 0, nil
			},
			nil,
		)
		e := echo.New()
		c, rec := newAuthedContext(e, http.MethodGet, path, "", foreignTenantID.String(), "admin")
		setBadgeTemplatePathParams(c, event.ID)
		if err := h.GetBadgeTemplate(c); err != nil {
			t.Fatalf("GetBadgeTemplate: %v", err)
		}
		if rec.Code != http.StatusNotFound {
			t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
		}
		validateResponse(t, http.MethodGet, path, rec)
	})

	t.Run("PUT", func(t *testing.T) {
		h := newBadgeTemplateHandler(event,
			func(uuid.UUID) (json.RawMessage, int, error) {
				t.Fatalf("GetEventBadgeTemplate should not be called for a foreign event")
				return nil, 0, nil
			},
			func(uuid.UUID, json.RawMessage, int) (int, error) {
				t.Fatalf("UpdateEventBadgeTemplate should not be called for a foreign event")
				return 0, nil
			},
		)
		e := echo.New()
		body := `{"template":{"elements":[]},"version":0}`
		c, rec := newAuthedContext(e, http.MethodPut, path, body, foreignTenantID.String(), "admin")
		setBadgeTemplatePathParams(c, event.ID)
		if err := h.PutBadgeTemplate(c); err != nil {
			t.Fatalf("PutBadgeTemplate: %v", err)
		}
		if rec.Code != http.StatusNotFound {
			t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
		}
		validateResponse(t, http.MethodPut, path, rec)
	})
}

// GET/PUT with a malformed event id (not a UUID) → 400, checked before
// ownership/body parsing.
func TestOpenAPIContract_BadgeTemplate_InvalidEventID400(t *testing.T) {
	tenantID := uuid.New()
	e := echo.New()
	badPath := "/api/events/not-a-uuid/badge-template"

	h := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) {
			t.Fatalf("GetEventByID should not be called when event id fails to parse")
			return nil, nil
		},
	})

	c, rec := newAuthedContext(e, http.MethodGet, badPath, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:id/badge-template")
	c.SetParamNames("id")
	c.SetParamValues("not-a-uuid")
	if err := h.GetBadgeTemplate(c); err != nil {
		t.Fatalf("GetBadgeTemplate: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("GET: want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, badPath, rec)

	c, rec = newAuthedContext(e, http.MethodPut, badPath, `{"template":{},"version":0}`, tenantID.String(), "admin")
	c.SetPath("/api/events/:id/badge-template")
	c.SetParamNames("id")
	c.SetParamValues("not-a-uuid")
	if err := h.PutBadgeTemplate(c); err != nil {
		t.Fatalf("PutBadgeTemplate: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("PUT: want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPut, badPath, rec)
}

// ---------------------------------------------------------------------------
// Column-first fallback reads (P3.1 Task 3): BadgeZPL and GetEventReadiness
// must both prefer the dedicated badge_template column over the legacy
// custom_fields["badgeTemplate"] key, via the shared effectiveBadgeTemplate
// helper (badge_template.go). PutBadgeTemplate never writes the legacy key
// back, so once a column value exists it is the only up-to-date source.
// ---------------------------------------------------------------------------

// wantPWDirective mirrors zpl.Generate/mmToDots's rounding so tests can
// assert on the exact "^PW<dots>" directive produced for a given width_mm —
// a value distinctive enough to prove which template (column vs. legacy) the
// handler actually rendered from.
func wantPWDirective(widthMM float64, dpi int) string {
	dots := int(math.Round((widthMM / 25.4) * float64(dpi)))
	return "^PW" + strconv.Itoa(dots)
}

// newBadgeZPLHandler builds a Handler whose event/attendee stores return the
// given fixtures for any GetEventByID(ForTenant)/GetAttendeeByID(ForTenant)
// lookup — enough to drive BadgeZPL's ownership checks and template read.
func newBadgeZPLHandler(event *models.Event, attendee *models.Attendee) *Handler {
	return New(&fakeStore{
		getEventByID:    func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAttendeeByID: func(uuid.UUID) (*models.Attendee, error) { return attendee, nil },
	})
}

func badgeZPLPath(eventID uuid.UUID) string {
	return "/api/events/" + eventID.String() + "/badge-zpl"
}

func newTestAttendee(eventID uuid.UUID) *models.Attendee {
	return &models.Attendee{ID: uuid.New(), EventID: eventID, FirstName: "Ada", LastName: "Lovelace", Code: "ABC123"}
}

// event with a column template and NO legacy key at all → BadgeZPL must
// generate from the column (brief Step 1, badge-zpl case 1).
func TestOpenAPIContract_BadgeZPL_UsesColumnTemplateWhenLegacyKeyAbsent(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	event.BadgeTemplate = json.RawMessage(`{"width_mm":40,"height_mm":20,"dpi":203,"elements":[]}`)
	event.BadgeTemplateVersion = 1
	// event.CustomFields is left nil — the legacy key is entirely absent.

	attendee := newTestAttendee(event.ID)
	h := newBadgeZPLHandler(event, attendee)
	e := echo.New()
	path := badgeZPLPath(event.ID)
	c, rec := newAuthedContext(e, http.MethodPost, path, `{"attendee_id":"`+attendee.ID.String()+`"}`, tenantID.String(), "admin")
	c.SetPath("/api/events/:id/badge-zpl")
	c.SetParamNames("id")
	c.SetParamValues(event.ID.String())

	if err := h.BadgeZPL(c); err != nil {
		t.Fatalf("BadgeZPL: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	var got BadgeZPLResponse
	if err := jsonUnmarshalBody(rec, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	want := wantPWDirective(40, 203)
	if !strings.Contains(got.ZPL, want) {
		t.Fatalf("ZPL = %q, want it to contain %q (column dims, width_mm=40) — column template not used", got.ZPL, want)
	}
	validateResponse(t, http.MethodPost, path, rec)
}

// event with NO column template (never saved via the P3.1 endpoint) but a
// legacy map template → BadgeZPL must still fall back and generate from it
// (brief Step 1, badge-zpl case 2).
func TestOpenAPIContract_BadgeZPL_FallsBackToLegacyMapWhenColumnAbsent(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	// event.BadgeTemplate left as its zero value (nil) — no column saved yet.
	event.CustomFields = map[string]interface{}{
		"badgeTemplate": map[string]interface{}{
			"width_mm":  float64(45),
			"height_mm": float64(25),
			"dpi":       float64(203),
			"elements":  []interface{}{},
		},
	}

	attendee := newTestAttendee(event.ID)
	h := newBadgeZPLHandler(event, attendee)
	e := echo.New()
	path := badgeZPLPath(event.ID)
	c, rec := newAuthedContext(e, http.MethodPost, path, `{"attendee_id":"`+attendee.ID.String()+`"}`, tenantID.String(), "admin")
	c.SetPath("/api/events/:id/badge-zpl")
	c.SetParamNames("id")
	c.SetParamValues(event.ID.String())

	if err := h.BadgeZPL(c); err != nil {
		t.Fatalf("BadgeZPL: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	var got BadgeZPLResponse
	if err := jsonUnmarshalBody(rec, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	want := wantPWDirective(45, 203)
	if !strings.Contains(got.ZPL, want) {
		t.Fatalf("ZPL = %q, want it to contain %q (legacy map dims, width_mm=45) — fallback broken", got.ZPL, want)
	}
	validateResponse(t, http.MethodPost, path, rec)
}

// readinessBadgeStep extracts the "badge" step's status (and the aggregate
// ready flag) from a recorded GetEventReadiness response.
func readinessBadgeStep(t *testing.T, rec *httptest.ResponseRecorder, path string) (string, bool) {
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

// TestContractGetEventReadinessBadgeTemplateColumn extends
// TestContractGetEventReadinessBadgeTemplateShapes (openapi_contract_events_p1_test.go)
// for the P3.1 dedicated badge_template column: the "badge" readiness step
// must read the column ahead of the legacy custom_fields map, applying the
// same "non-empty elements array" done-rule to it (brief Step 1, readiness
// cases 1-3).
func TestContractGetEventReadinessBadgeTemplateColumn(t *testing.T) {
	tenantID := uuid.New()
	fs := func(event *models.Event) *fakeStore {
		return &fakeStore{
			getEventByID:            func(uuid.UUID) (*models.Event, error) { return event, nil },
			countAttendeesByEventID: func(uuid.UUID) (int, error) { return 1, nil },
			getEventZones:           func(uuid.UUID) ([]*models.EventZone, error) { return nil, nil },
			getEventStaff:           func(uuid.UUID) ([]*models.User, error) { return []*models.User{{ID: uuid.New()}}, nil },
		}
	}
	e := echo.New()
	run := func(event *models.Event) (*httptest.ResponseRecorder, string) {
		path := "/api/events/" + event.ID.String() + "/readiness"
		c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
		c.SetPath("/api/events/:id/readiness")
		c.SetParamNames("id")
		c.SetParamValues(event.ID.String())
		if err := New(fs(event)).GetEventReadiness(c); err != nil {
			t.Fatalf("GetEventReadiness: %v", err)
		}
		return rec, path
	}

	// (1) Column template with a non-empty elements array → done.
	withElements := contractEvent(tenantID, "Column Template With Elements")
	withElements.BadgeTemplate = json.RawMessage(`{"width_mm":50,"height_mm":30,"dpi":203,"elements":[{"id":"e1","type":"text"}]}`)
	withElements.BadgeTemplateVersion = 1
	rec, path := run(withElements)
	if status, ready := readinessBadgeStep(t, rec, path); status != readinessDone || !ready {
		t.Fatalf("column template with elements must be badge=done, got status=%s ready=%v", status, ready)
	}

	// (2) Column NULL (never saved) + legacy map with elements → fallback,
	// still done.
	legacyOnly := contractEvent(tenantID, "Legacy Map Only")
	legacyOnly.CustomFields = map[string]interface{}{
		"badgeTemplate": map[string]interface{}{
			"width_mm":  float64(50),
			"height_mm": float64(30),
			"dpi":       float64(203),
			"elements":  []interface{}{map[string]interface{}{"id": "e1"}},
		},
	}
	rec, path = run(legacyOnly)
	if status, ready := readinessBadgeStep(t, rec, path); status != readinessDone || !ready {
		t.Fatalf("legacy map fallback (no column yet) must be badge=done, got status=%s ready=%v", status, ready)
	}

	// (3) Column NULL + no legacy value either → not done.
	neither := contractEvent(tenantID, "Neither Column Nor Legacy")
	rec, path = run(neither)
	if status, ready := readinessBadgeStep(t, rec, path); status != readinessNotDone || ready {
		t.Fatalf("no template anywhere must be badge=not_done, got status=%s ready=%v", status, ready)
	}
}

// TestContractBadgeTemplatePutThenReadinessRegression is the exact staleness
// bug this task exists to prevent (reconciliation #7/#8): an event has a
// "done"-looking legacy custom_fields map (elements present) from before
// P3.1. A PUT to /badge-template saves a brand-new column template with an
// EMPTY elements array (the shape a fresh badge-editor canvas produces).
// Readiness must flip to NOT done — the column, even though "emptier" than
// the legacy value, wins because it is the only value PutBadgeTemplate keeps
// current. A regression here means readiness/badge_zpl silently serve stale
// pre-P3.1 data forever after the first column save.
func TestContractBadgeTemplatePutThenReadinessRegression(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Stale Legacy After Column PUT")
	event.CustomFields = map[string]interface{}{
		"badgeTemplate": map[string]interface{}{
			"width_mm":  float64(50),
			"height_mm": float64(30),
			"dpi":       float64(203),
			"elements":  []interface{}{map[string]interface{}{"id": "old-el"}},
		},
	}

	h := New(&fakeStore{
		getEventByID:            func(uuid.UUID) (*models.Event, error) { return event, nil },
		countAttendeesByEventID: func(uuid.UUID) (int, error) { return 1, nil },
		getEventZones:           func(uuid.UUID) ([]*models.EventZone, error) { return nil, nil },
		getEventStaff:           func(uuid.UUID) ([]*models.User, error) { return []*models.User{{ID: uuid.New()}}, nil },
		getEventBadgeTemplate: func(uuid.UUID) (json.RawMessage, int, error) {
			return event.BadgeTemplate, event.BadgeTemplateVersion, nil
		},
		updateEventBadgeTemplate: func(_ uuid.UUID, template json.RawMessage, expectedVersion int) (int, error) {
			if expectedVersion != event.BadgeTemplateVersion {
				return 0, store.ErrVersionConflict
			}
			event.BadgeTemplate = template
			event.BadgeTemplateVersion++
			return event.BadgeTemplateVersion, nil
		},
	})
	e := echo.New()
	readinessPath := "/api/events/" + event.ID.String() + "/readiness"
	getReadiness := func() *httptest.ResponseRecorder {
		c, rec := newAuthedContext(e, http.MethodGet, readinessPath, "", tenantID.String(), "admin")
		c.SetPath("/api/events/:id/readiness")
		c.SetParamNames("id")
		c.SetParamValues(event.ID.String())
		if err := h.GetEventReadiness(c); err != nil {
			t.Fatalf("GetEventReadiness: %v", err)
		}
		return rec
	}

	// Precondition: before any column PUT, readiness reads the legacy map
	// fallback and reports done.
	rec := getReadiness()
	if status, ready := readinessBadgeStep(t, rec, readinessPath); status != readinessDone || !ready {
		t.Fatalf("precondition failed: legacy map must read as done before any column PUT, got status=%s ready=%v", status, ready)
	}

	// PUT a fresh, empty-elements column template — version 0 since none has
	// been saved via this endpoint yet.
	putPath := "/api/events/" + event.ID.String() + "/badge-template"
	c, rec := newAuthedContext(e, http.MethodPut, putPath,
		`{"template":{"width_mm":50,"height_mm":30,"dpi":203,"elements":[]},"version":0}`, tenantID.String(), "admin")
	c.SetPath("/api/events/:id/badge-template")
	c.SetParamNames("id")
	c.SetParamValues(event.ID.String())
	if err := h.PutBadgeTemplate(c); err != nil {
		t.Fatalf("PutBadgeTemplate: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("PutBadgeTemplate: want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}

	// The regression check: readiness must now report NOT done.
	rec = getReadiness()
	if status, ready := readinessBadgeStep(t, rec, readinessPath); status != readinessNotDone || ready {
		t.Fatalf("after PUTting an empty-elements column template, badge must be not_done (column must win over the stale, done-looking legacy map), got status=%s ready=%v", status, ready)
	}
}
