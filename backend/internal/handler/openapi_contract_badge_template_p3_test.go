package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
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
