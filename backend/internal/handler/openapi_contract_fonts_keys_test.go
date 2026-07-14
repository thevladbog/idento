package handler

import (
	"bytes"
	"errors"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func contractFont() *models.FontListItem {
	return &models.FontListItem{
		ID:        uuid.New(),
		Name:      "Roboto Bold",
		Family:    "Roboto",
		Weight:    "bold",
		Style:     "normal",
		Format:    "truetype",
		Size:      12345,
		CreatedAt: time.Now(),
	}
}

func contractAPIKey(eventID uuid.UUID) *models.APIKey {
	return &models.APIKey{
		ID:         uuid.New(),
		EventID:    eventID,
		Name:       "Zapier integration",
		KeyPreview: "ab12cd34...",
		CreatedAt:  time.Now(),
	}
}

// newAuthedMultipartContext builds a multipart/form-data POST request (the
// shape UploadEventFont expects) with a JWT already set under "user",
// mirroring newAuthedContext's JSON-body counterpart.
func newAuthedMultipartContext(e *echo.Echo, path string, fields map[string]string, fileField, fileName string, fileContent []byte, tenantID, role string) (echo.Context, *httptest.ResponseRecorder) {
	body := &bytes.Buffer{}
	w := multipart.NewWriter(body)
	for k, v := range fields {
		if err := w.WriteField(k, v); err != nil {
			panic(err)
		}
	}
	if fileField != "" {
		fw, err := w.CreateFormFile(fileField, fileName)
		if err != nil {
			panic(err)
		}
		if _, err := fw.Write(fileContent); err != nil {
			panic(err)
		}
	}
	if err := w.Close(); err != nil {
		panic(err)
	}
	req := httptest.NewRequest(http.MethodPost, path, body)
	req.Header.Set(echo.HeaderContentType, w.FormDataContentType())
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set("user", &models.JWTCustomClaims{
		UserID:   uuid.New().String(),
		TenantID: tenantID,
		Role:     role,
	})
	return c, rec
}

// TestContractGetEventFonts covers GET /api/events/{event_id}/fonts,
// including the nil-slice-becomes-[] guard: Store.GetFontsByEventID's real
// (PGStore) implementation declares `var fonts []*models.FontListItem`
// (nil until appended), so a zero-row result is a nil slice — the handler
// must convert that to [] before serializing, never emitting a literal
// JSON null for a 200.
func TestContractGetEventFonts(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	font := contractFont()
	h := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return event, nil },
		getFontsByEventID: func(uuid.UUID) ([]*models.FontListItem, error) {
			return []*models.FontListItem{font}, nil
		},
	})
	e := echo.New()
	path := "/api/events/" + event.ID.String() + "/fonts"
	c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/fonts")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.GetEventFonts(c); err != nil {
		t.Fatalf("GetEventFonts: %v", err)
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 200: Store.GetFontsByEventID returns a nil slice — must still render
	// as a JSON array, not null.
	hNil := New(&fakeStore{
		getEventByID:      func(uuid.UUID) (*models.Event, error) { return event, nil },
		getFontsByEventID: func(uuid.UUID) ([]*models.FontListItem, error) { return nil, nil },
	})
	c, rec = newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/fonts")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := hNil.GetEventFonts(c); err != nil {
		t.Fatalf("GetEventFonts (nil fonts): %v", err)
	}
	if got := rec.Body.String(); got != "[]\n" {
		t.Fatalf("want literal [] body for a nil fonts slice, got %q", got)
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 400: event_id is not a UUID.
	badPath := "/api/events/not-a-uuid/fonts"
	c, rec = newAuthedContext(e, http.MethodGet, badPath, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/fonts")
	c.SetParamNames("event_id")
	c.SetParamValues("not-a-uuid")
	if err := h.GetEventFonts(c); err != nil {
		t.Fatalf("GetEventFonts (bad event id): %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, badPath, rec)

	// 404: event does not exist / belongs to a different tenant.
	c, rec = newAuthedContext(e, http.MethodGet, path, "", uuid.New().String(), "admin")
	c.SetPath("/api/events/:event_id/fonts")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.GetEventFonts(c); err != nil {
		t.Fatalf("GetEventFonts (foreign tenant): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 500: a raw store error resolving event ownership.
	hOwnershipFail := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return nil, errors.New("db unavailable") },
	})
	c, rec = newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/fonts")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := hOwnershipFail.GetEventFonts(c); err != nil {
		t.Fatalf("GetEventFonts (ownership store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 500: Store.GetFontsByEventID itself fails.
	hFetchFail := New(&fakeStore{
		getEventByID:      func(uuid.UUID) (*models.Event, error) { return event, nil },
		getFontsByEventID: func(uuid.UUID) ([]*models.FontListItem, error) { return nil, errors.New("query failed") },
	})
	c, rec = newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/fonts")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := hFetchFail.GetEventFonts(c); err != nil {
		t.Fatalf("GetEventFonts (fetch store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)
}

// TestContractUploadEventFont covers POST /api/events/{event_id}/fonts,
// including every branch that used to be dead code behind a bug where
// UploadEventFont re-extracted the caller's identity via
// `c.Get("user").(*jwt.Token)` — a type middleware.JWT() never stores there
// — and so unconditionally 401'd right after every ownership check that
// passed (see git history for the fix: it now reuses claimsFromContext,
// same as every other handler).
func TestContractUploadEventFont(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	e := echo.New()
	path := "/api/events/" + event.ID.String() + "/fonts"
	fields := map[string]string{
		"license_accepted": "true",
		"name":             "Roboto Bold",
		"family":           "Roboto",
		"weight":           "bold",
		"style":            "normal",
	}

	// 201: a fully valid upload succeeds and reaches Store.CreateFont.
	var savedFont *models.Font
	h := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return event, nil },
		createFont:   func(f *models.Font) error { savedFont = f; return nil },
	})
	c, rec := newAuthedMultipartContext(e, path, fields, "file", "roboto-bold.ttf", []byte("fake-ttf-bytes"), tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/fonts")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.UploadEventFont(c); err != nil {
		t.Fatalf("UploadEventFont: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if savedFont == nil {
		t.Fatal("expected Store.CreateFont to be called")
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 400: event_id is not a UUID (checked before ownership).
	badPath := "/api/events/not-a-uuid/fonts"
	c, rec = newAuthedMultipartContext(e, badPath, fields, "file", "roboto-bold.ttf", []byte("fake-ttf-bytes"), tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/fonts")
	c.SetParamNames("event_id")
	c.SetParamValues("not-a-uuid")
	if err := h.UploadEventFont(c); err != nil {
		t.Fatalf("UploadEventFont (bad event id): %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, badPath, rec)

	// 404: event does not exist / belongs to a different tenant.
	c, rec = newAuthedMultipartContext(e, path, fields, "file", "roboto-bold.ttf", []byte("fake-ttf-bytes"), uuid.New().String(), "admin")
	c.SetPath("/api/events/:event_id/fonts")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.UploadEventFont(c); err != nil {
		t.Fatalf("UploadEventFont (foreign tenant): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 500: a raw store error resolving event ownership.
	hOwnershipFail := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return nil, errors.New("db unavailable") },
	})
	c, rec = newAuthedMultipartContext(e, path, fields, "file", "roboto-bold.ttf", []byte("fake-ttf-bytes"), tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/fonts")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := hOwnershipFail.UploadEventFont(c); err != nil {
		t.Fatalf("UploadEventFont (ownership store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 400: license_accepted is missing (newly reachable post-fix).
	hValid := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return event, nil },
	})
	noLicenseFields := map[string]string{"name": "Roboto Bold", "family": "Roboto"}
	c, rec = newAuthedMultipartContext(e, path, noLicenseFields, "file", "roboto-bold.ttf", []byte("fake-ttf-bytes"), tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/fonts")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := hValid.UploadEventFont(c); err != nil {
		t.Fatalf("UploadEventFont (no license): %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 400: name is missing (newly reachable post-fix).
	noNameFields := map[string]string{"license_accepted": "true", "family": "Roboto"}
	c, rec = newAuthedMultipartContext(e, path, noNameFields, "file", "roboto-bold.ttf", []byte("fake-ttf-bytes"), tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/fonts")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := hValid.UploadEventFont(c); err != nil {
		t.Fatalf("UploadEventFont (no name): %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 400: family is missing (newly reachable post-fix).
	noFamilyFields := map[string]string{"license_accepted": "true", "name": "Roboto Bold"}
	c, rec = newAuthedMultipartContext(e, path, noFamilyFields, "file", "roboto-bold.ttf", []byte("fake-ttf-bytes"), tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/fonts")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := hValid.UploadEventFont(c); err != nil {
		t.Fatalf("UploadEventFont (no family): %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 400: unrecognized file extension (newly reachable post-fix).
	c, rec = newAuthedMultipartContext(e, path, fields, "file", "roboto-bold.txt", []byte("not-a-font"), tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/fonts")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := hValid.UploadEventFont(c); err != nil {
		t.Fatalf("UploadEventFont (bad extension): %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 409: a font with the same family/weight/style already exists
	// (newly reachable post-fix).
	hDuplicate := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return event, nil },
		createFont: func(*models.Font) error {
			return errors.New(`pq: duplicate key value violates unique constraint "fonts_event_family_weight_style_key"`)
		},
	})
	c, rec = newAuthedMultipartContext(e, path, fields, "file", "roboto-bold.ttf", []byte("fake-ttf-bytes"), tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/fonts")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := hDuplicate.UploadEventFont(c); err != nil {
		t.Fatalf("UploadEventFont (duplicate): %v", err)
	}
	if rec.Code != http.StatusConflict {
		t.Fatalf("want 409, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 500: Store.CreateFont fails with a non-duplicate-key error (newly
	// reachable post-fix).
	hCreateFail := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return event, nil },
		createFont:   func(*models.Font) error { return errors.New("insert failed") },
	})
	c, rec = newAuthedMultipartContext(e, path, fields, "file", "roboto-bold.ttf", []byte("fake-ttf-bytes"), tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/fonts")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := hCreateFail.UploadEventFont(c); err != nil {
		t.Fatalf("UploadEventFont (store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)
}

// TestContractGetEventFontCss covers GET /api/events/{event_id}/fonts/css:
// text/css content with fonts present, and the no-fonts case (still 200,
// just the leading comment — never an error).
func TestContractGetEventFontCss(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	font := contractFont()
	h := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return event, nil },
		getFontsByEventID: func(uuid.UUID) ([]*models.FontListItem, error) {
			return []*models.FontListItem{font}, nil
		},
	})
	e := echo.New()
	path := "/api/events/" + event.ID.String() + "/fonts/css"
	c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/fonts/css")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.GetEventFontCSS(c); err != nil {
		t.Fatalf("GetEventFontCSS: %v", err)
	}
	if ct := rec.Header().Get(echo.HeaderContentType); ct != "text/css; charset=utf-8" {
		t.Fatalf("want text/css; charset=utf-8, got %q", ct)
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte("@font-face")) {
		t.Fatalf("expected @font-face in body, got %q", rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 200: no fonts for the event — still a plain 200 with just the header comment.
	hNoFonts := New(&fakeStore{
		getEventByID:      func(uuid.UUID) (*models.Event, error) { return event, nil },
		getFontsByEventID: func(uuid.UUID) ([]*models.FontListItem, error) { return nil, nil },
	})
	c, rec = newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/fonts/css")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := hNoFonts.GetEventFontCSS(c); err != nil {
		t.Fatalf("GetEventFontCSS (no fonts): %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200 even with no fonts, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 400: event_id is not a UUID.
	badPath := "/api/events/not-a-uuid/fonts/css"
	c, rec = newAuthedContext(e, http.MethodGet, badPath, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/fonts/css")
	c.SetParamNames("event_id")
	c.SetParamValues("not-a-uuid")
	if err := h.GetEventFontCSS(c); err != nil {
		t.Fatalf("GetEventFontCSS (bad event id): %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, badPath, rec)

	// 404: event does not exist / belongs to a different tenant.
	c, rec = newAuthedContext(e, http.MethodGet, path, "", uuid.New().String(), "admin")
	c.SetPath("/api/events/:event_id/fonts/css")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.GetEventFontCSS(c); err != nil {
		t.Fatalf("GetEventFontCSS (foreign tenant): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 500: a raw store error resolving event ownership.
	hOwnershipFail := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return nil, errors.New("db unavailable") },
	})
	c, rec = newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/fonts/css")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := hOwnershipFail.GetEventFontCSS(c); err != nil {
		t.Fatalf("GetEventFontCSS (ownership store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 500: Store.GetFontsByEventID itself fails.
	hFetchFail := New(&fakeStore{
		getEventByID:      func(uuid.UUID) (*models.Event, error) { return event, nil },
		getFontsByEventID: func(uuid.UUID) ([]*models.FontListItem, error) { return nil, errors.New("query failed") },
	})
	c, rec = newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/fonts/css")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := hFetchFail.GetEventFontCSS(c); err != nil {
		t.Fatalf("GetEventFontCSS (fetch store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)
}

// TestContractDeleteEventFont covers DELETE
// /api/events/{event_id}/fonts/{font_id}, including the 403 "wrong event"
// branch: Store.GetFontByID looks a font up by ID alone (not scoped by
// event_id), so the handler must separately check font.EventID == eventID
// and reject with 403 (not 404) when it doesn't match.
func TestContractDeleteEventFont(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	font := &models.Font{ID: uuid.New(), EventID: event.ID, MimeType: "font/ttf"}
	h := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return event, nil },
		getFontByID:  func(uuid.UUID) (*models.Font, error) { return font, nil },
		deleteFont:   func(uuid.UUID) error { return nil },
	})
	e := echo.New()
	path := "/api/events/" + event.ID.String() + "/fonts/" + font.ID.String()
	c, rec := newAuthedContext(e, http.MethodDelete, path, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/fonts/:font_id")
	c.SetParamNames("event_id", "font_id")
	c.SetParamValues(event.ID.String(), font.ID.String())
	if err := h.DeleteEventFont(c); err != nil {
		t.Fatalf("DeleteEventFont: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodDelete, path, rec)

	// 400: event_id or font_id is not a UUID.
	badPath := "/api/events/" + event.ID.String() + "/fonts/not-a-uuid"
	c, rec = newAuthedContext(e, http.MethodDelete, badPath, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/fonts/:font_id")
	c.SetParamNames("event_id", "font_id")
	c.SetParamValues(event.ID.String(), "not-a-uuid")
	if err := h.DeleteEventFont(c); err != nil {
		t.Fatalf("DeleteEventFont (bad font id): %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodDelete, badPath, rec)

	// 404: event does not exist / belongs to a different tenant.
	c, rec = newAuthedContext(e, http.MethodDelete, path, "", uuid.New().String(), "admin")
	c.SetPath("/api/events/:event_id/fonts/:font_id")
	c.SetParamNames("event_id", "font_id")
	c.SetParamValues(event.ID.String(), font.ID.String())
	if err := h.DeleteEventFont(c); err != nil {
		t.Fatalf("DeleteEventFont (foreign tenant): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodDelete, path, rec)

	// 500: a raw store error resolving event ownership.
	hOwnershipFail := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return nil, errors.New("db unavailable") },
	})
	c, rec = newAuthedContext(e, http.MethodDelete, path, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/fonts/:font_id")
	c.SetParamNames("event_id", "font_id")
	c.SetParamValues(event.ID.String(), font.ID.String())
	if err := hOwnershipFail.DeleteEventFont(c); err != nil {
		t.Fatalf("DeleteEventFont (ownership store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodDelete, path, rec)

	// 404: font_id does not resolve (Store.GetFontByID failing, e.g. no rows).
	hFontMissing := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return event, nil },
		getFontByID:  func(uuid.UUID) (*models.Font, error) { return nil, errors.New("not found") },
	})
	c, rec = newAuthedContext(e, http.MethodDelete, path, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/fonts/:font_id")
	c.SetParamNames("event_id", "font_id")
	c.SetParamValues(event.ID.String(), font.ID.String())
	if err := hFontMissing.DeleteEventFont(c); err != nil {
		t.Fatalf("DeleteEventFont (font missing): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodDelete, path, rec)

	// 403: font exists but belongs to a different event than event_id.
	otherEventFont := &models.Font{ID: font.ID, EventID: uuid.New(), MimeType: "font/ttf"}
	hWrongEvent := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return event, nil },
		getFontByID:  func(uuid.UUID) (*models.Font, error) { return otherEventFont, nil },
	})
	c, rec = newAuthedContext(e, http.MethodDelete, path, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/fonts/:font_id")
	c.SetParamNames("event_id", "font_id")
	c.SetParamValues(event.ID.String(), font.ID.String())
	if err := hWrongEvent.DeleteEventFont(c); err != nil {
		t.Fatalf("DeleteEventFont (wrong event): %v", err)
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodDelete, path, rec)

	// 500: Store.DeleteFont itself fails.
	hDeleteFail := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return event, nil },
		getFontByID:  func(uuid.UUID) (*models.Font, error) { return font, nil },
		deleteFont:   func(uuid.UUID) error { return errors.New("delete failed") },
	})
	c, rec = newAuthedContext(e, http.MethodDelete, path, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/fonts/:font_id")
	c.SetParamNames("event_id", "font_id")
	c.SetParamValues(event.ID.String(), font.ID.String())
	if err := hDeleteFail.DeleteEventFont(c); err != nil {
		t.Fatalf("DeleteEventFont (store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodDelete, path, rec)
}

// TestContractGetFontFile covers GET /api/fonts/{id}/file. Despite the
// "Public font file endpoint" comment on its route registration
// (handler.go), it is registered on the `api` group AFTER
// api.Use(middleware.JWT()), so it requires a Bearer JWT like every other
// /api/* route — this test goes through the same newAuthedContext helper as
// every other operation in this file, and the foreign-tenant case below
// proves requireEventOwnership is genuinely enforced, not bypassed.
func TestContractGetFontFile(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	font := &models.Font{
		ID:       uuid.New(),
		EventID:  event.ID,
		MimeType: "font/ttf",
		Data:     []byte("fake-ttf-bytes"),
	}
	h := New(&fakeStore{
		getFontByID:  func(uuid.UUID) (*models.Font, error) { return font, nil },
		getEventByID: func(uuid.UUID) (*models.Event, error) { return event, nil },
	})
	e := echo.New()
	path := "/api/fonts/" + font.ID.String() + "/file"
	c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/fonts/:id/file")
	c.SetParamNames("id")
	c.SetParamValues(font.ID.String())
	if err := h.GetFontFile(c); err != nil {
		t.Fatalf("GetFontFile: %v", err)
	}
	if ct := rec.Header().Get(echo.HeaderContentType); ct != "font/ttf" {
		t.Fatalf("want font/ttf, got %q", ct)
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 400: id is not a UUID.
	badPath := "/api/fonts/not-a-uuid/file"
	c, rec = newAuthedContext(e, http.MethodGet, badPath, "", tenantID.String(), "admin")
	c.SetPath("/api/fonts/:id/file")
	c.SetParamNames("id")
	c.SetParamValues("not-a-uuid")
	if err := h.GetFontFile(c); err != nil {
		t.Fatalf("GetFontFile (bad id): %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, badPath, rec)

	// 404: font_id does not resolve at all.
	hFontMissing := New(&fakeStore{
		getFontByID: func(uuid.UUID) (*models.Font, error) { return nil, errors.New("not found") },
	})
	c, rec = newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/fonts/:id/file")
	c.SetParamNames("id")
	c.SetParamValues(font.ID.String())
	if err := hFontMissing.GetFontFile(c); err != nil {
		t.Fatalf("GetFontFile (font missing): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 404: the font exists but its event belongs to a different tenant.
	c, rec = newAuthedContext(e, http.MethodGet, path, "", uuid.New().String(), "admin")
	c.SetPath("/api/fonts/:id/file")
	c.SetParamNames("id")
	c.SetParamValues(font.ID.String())
	if err := h.GetFontFile(c); err != nil {
		t.Fatalf("GetFontFile (foreign tenant): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 500: a raw store error resolving the font's event ownership.
	hOwnershipFail := New(&fakeStore{
		getFontByID:  func(uuid.UUID) (*models.Font, error) { return font, nil },
		getEventByID: func(uuid.UUID) (*models.Event, error) { return nil, errors.New("db unavailable") },
	})
	c, rec = newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/fonts/:id/file")
	c.SetParamNames("id")
	c.SetParamValues(font.ID.String())
	if err := hOwnershipFail.GetFontFile(c); err != nil {
		t.Fatalf("GetFontFile (ownership store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)
}

// TestContractGetAPIKeys covers GET /api/events/{event_id}/api-keys.
func TestContractGetAPIKeys(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	key := contractAPIKey(event.ID)
	h := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAPIKeysByEventID: func(uuid.UUID) ([]*models.APIKey, error) {
			return []*models.APIKey{key}, nil
		},
	})
	e := echo.New()
	path := "/api/events/" + event.ID.String() + "/api-keys"
	c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/api-keys")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.GetAPIKeys(c); err != nil {
		t.Fatalf("GetAPIKeys: %v", err)
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 400: event_id is not a UUID.
	badPath := "/api/events/not-a-uuid/api-keys"
	c, rec = newAuthedContext(e, http.MethodGet, badPath, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/api-keys")
	c.SetParamNames("event_id")
	c.SetParamValues("not-a-uuid")
	if err := h.GetAPIKeys(c); err != nil {
		t.Fatalf("GetAPIKeys (bad event id): %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, badPath, rec)

	// 404: event does not exist / belongs to a different tenant.
	c, rec = newAuthedContext(e, http.MethodGet, path, "", uuid.New().String(), "admin")
	c.SetPath("/api/events/:event_id/api-keys")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.GetAPIKeys(c); err != nil {
		t.Fatalf("GetAPIKeys (foreign tenant): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 500: a raw store error resolving event ownership.
	hOwnershipFail := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return nil, errors.New("db unavailable") },
	})
	c, rec = newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/api-keys")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := hOwnershipFail.GetAPIKeys(c); err != nil {
		t.Fatalf("GetAPIKeys (ownership store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)

	// 500: Store.GetAPIKeysByEventID itself fails.
	hFetchFail := New(&fakeStore{
		getEventByID:        func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAPIKeysByEventID: func(uuid.UUID) ([]*models.APIKey, error) { return nil, errors.New("query failed") },
	})
	c, rec = newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/api-keys")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := hFetchFail.GetAPIKeys(c); err != nil {
		t.Fatalf("GetAPIKeys (fetch store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)
}

// TestContractCreateAPIKey covers POST /api/events/{event_id}/api-keys.
func TestContractCreateAPIKey(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	h := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return event, nil },
		createAPIKey: func(*models.APIKey) error { return nil },
	})
	e := echo.New()
	path := "/api/events/" + event.ID.String() + "/api-keys"
	body := `{"name":"Zapier integration"}`
	c, rec := newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/api-keys")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.CreateAPIKey(c); err != nil {
		t.Fatalf("CreateAPIKey: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 400: event_id is not a UUID.
	badPath := "/api/events/not-a-uuid/api-keys"
	c, rec = newAuthedContext(e, http.MethodPost, badPath, body, tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/api-keys")
	c.SetParamNames("event_id")
	c.SetParamValues("not-a-uuid")
	if err := h.CreateAPIKey(c); err != nil {
		t.Fatalf("CreateAPIKey (bad event id): %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, badPath, rec)

	// 404: event does not exist / belongs to a different tenant.
	c, rec = newAuthedContext(e, http.MethodPost, path, body, uuid.New().String(), "admin")
	c.SetPath("/api/events/:event_id/api-keys")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.CreateAPIKey(c); err != nil {
		t.Fatalf("CreateAPIKey (foreign tenant): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 500: a raw store error resolving event ownership.
	hOwnershipFail := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return nil, errors.New("db unavailable") },
	})
	c, rec = newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/api-keys")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := hOwnershipFail.CreateAPIKey(c); err != nil {
		t.Fatalf("CreateAPIKey (ownership store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 400: malformed body fails c.Bind.
	c, rec = newAuthedContext(e, http.MethodPost, path, `not json`, tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/api-keys")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.CreateAPIKey(c); err != nil {
		t.Fatalf("CreateAPIKey (malformed body): %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 400: expires_at is in the past.
	pastBody := `{"name":"Zapier integration","expires_at":"2020-01-01T00:00:00Z"}`
	c, rec = newAuthedContext(e, http.MethodPost, path, pastBody, tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/api-keys")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := h.CreateAPIKey(c); err != nil {
		t.Fatalf("CreateAPIKey (expired): %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)

	// 500: Store.CreateAPIKey itself fails.
	hCreateFail := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return event, nil },
		createAPIKey: func(*models.APIKey) error { return errors.New("insert failed") },
	})
	c, rec = newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/api-keys")
	c.SetParamNames("event_id")
	c.SetParamValues(event.ID.String())
	if err := hCreateFail.CreateAPIKey(c); err != nil {
		t.Fatalf("CreateAPIKey (store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)
}

// TestContractRevokeAPIKey covers DELETE
// /api/events/{event_id}/api-keys/{key_id}, including the cross-tenant IDOR
// guard: key_id must actually appear in event_id's own key list, or the
// handler returns 404 without ever calling Store.RevokeAPIKey.
func TestContractRevokeAPIKey(t *testing.T) {
	tenantID := uuid.New()
	event := contractEvent(tenantID, "Tech Summit")
	key := contractAPIKey(event.ID)
	h := New(&fakeStore{
		getEventByID:        func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAPIKeysByEventID: func(uuid.UUID) ([]*models.APIKey, error) { return []*models.APIKey{key}, nil },
		revokeAPIKey:        func(uuid.UUID) error { return nil },
	})
	e := echo.New()
	path := "/api/events/" + event.ID.String() + "/api-keys/" + key.ID.String()
	c, rec := newAuthedContext(e, http.MethodDelete, path, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/api-keys/:key_id")
	c.SetParamNames("event_id", "key_id")
	c.SetParamValues(event.ID.String(), key.ID.String())
	if err := h.RevokeAPIKey(c); err != nil {
		t.Fatalf("RevokeAPIKey: %v", err)
	}
	validateResponse(t, http.MethodDelete, path, rec)

	// 400: event_id is not a UUID.
	badPath := "/api/events/not-a-uuid/api-keys/" + key.ID.String()
	c, rec = newAuthedContext(e, http.MethodDelete, badPath, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/api-keys/:key_id")
	c.SetParamNames("event_id", "key_id")
	c.SetParamValues("not-a-uuid", key.ID.String())
	if err := h.RevokeAPIKey(c); err != nil {
		t.Fatalf("RevokeAPIKey (bad event id): %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodDelete, badPath, rec)

	// 400: key_id is not a UUID (checked AFTER ownership succeeds).
	badKeyPath := "/api/events/" + event.ID.String() + "/api-keys/not-a-uuid"
	c, rec = newAuthedContext(e, http.MethodDelete, badKeyPath, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/api-keys/:key_id")
	c.SetParamNames("event_id", "key_id")
	c.SetParamValues(event.ID.String(), "not-a-uuid")
	if err := h.RevokeAPIKey(c); err != nil {
		t.Fatalf("RevokeAPIKey (bad key id): %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodDelete, badKeyPath, rec)

	// 404: event does not exist / belongs to a different tenant.
	c, rec = newAuthedContext(e, http.MethodDelete, path, "", uuid.New().String(), "admin")
	c.SetPath("/api/events/:event_id/api-keys/:key_id")
	c.SetParamNames("event_id", "key_id")
	c.SetParamValues(event.ID.String(), key.ID.String())
	if err := h.RevokeAPIKey(c); err != nil {
		t.Fatalf("RevokeAPIKey (foreign tenant): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodDelete, path, rec)

	// 500: a raw store error resolving event ownership.
	hOwnershipFail := New(&fakeStore{
		getEventByID: func(uuid.UUID) (*models.Event, error) { return nil, errors.New("db unavailable") },
	})
	c, rec = newAuthedContext(e, http.MethodDelete, path, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/api-keys/:key_id")
	c.SetParamNames("event_id", "key_id")
	c.SetParamValues(event.ID.String(), key.ID.String())
	if err := hOwnershipFail.RevokeAPIKey(c); err != nil {
		t.Fatalf("RevokeAPIKey (ownership store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodDelete, path, rec)

	// 500: Store.GetAPIKeysByEventID itself fails while running the IDOR guard.
	hFetchFail := New(&fakeStore{
		getEventByID:        func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAPIKeysByEventID: func(uuid.UUID) ([]*models.APIKey, error) { return nil, errors.New("query failed") },
	})
	c, rec = newAuthedContext(e, http.MethodDelete, path, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/api-keys/:key_id")
	c.SetParamNames("event_id", "key_id")
	c.SetParamValues(event.ID.String(), key.ID.String())
	if err := hFetchFail.RevokeAPIKey(c); err != nil {
		t.Fatalf("RevokeAPIKey (fetch store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodDelete, path, rec)

	// 404: key_id does not belong to event_id's own key list (cross-tenant IDOR guard).
	foreignKeyID := uuid.New()
	revokeCalled := false
	hForeignKey := New(&fakeStore{
		getEventByID:        func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAPIKeysByEventID: func(uuid.UUID) ([]*models.APIKey, error) { return []*models.APIKey{key}, nil },
		revokeAPIKey:        func(uuid.UUID) error { revokeCalled = true; return nil },
	})
	foreignPath := "/api/events/" + event.ID.String() + "/api-keys/" + foreignKeyID.String()
	c, rec = newAuthedContext(e, http.MethodDelete, foreignPath, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/api-keys/:key_id")
	c.SetParamNames("event_id", "key_id")
	c.SetParamValues(event.ID.String(), foreignKeyID.String())
	if err := hForeignKey.RevokeAPIKey(c); err != nil {
		t.Fatalf("RevokeAPIKey (foreign key): %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if revokeCalled {
		t.Fatal("expected Store.RevokeAPIKey NOT to be called for a key outside the owned event")
	}
	validateResponse(t, http.MethodDelete, path, rec)

	// 500: Store.RevokeAPIKey itself fails.
	hRevokeFail := New(&fakeStore{
		getEventByID:        func(uuid.UUID) (*models.Event, error) { return event, nil },
		getAPIKeysByEventID: func(uuid.UUID) ([]*models.APIKey, error) { return []*models.APIKey{key}, nil },
		revokeAPIKey:        func(uuid.UUID) error { return errors.New("update failed") },
	})
	c, rec = newAuthedContext(e, http.MethodDelete, path, "", tenantID.String(), "admin")
	c.SetPath("/api/events/:event_id/api-keys/:key_id")
	c.SetParamNames("event_id", "key_id")
	c.SetParamValues(event.ID.String(), key.ID.String())
	if err := hRevokeFail.RevokeAPIKey(c); err != nil {
		t.Fatalf("RevokeAPIKey (store failure): %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodDelete, path, rec)
}
