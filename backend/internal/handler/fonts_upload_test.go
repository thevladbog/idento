package handler

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// newUploadContext builds a multipart/form-data POST request for
// UploadEventFont, with JWT claims already set under "user" like
// middleware.JWT does.
func newUploadContext(e *echo.Echo, tenantID string, userID uuid.UUID, fields map[string]string, fileField, fileName string, fileContent []byte) (echo.Context, *httptest.ResponseRecorder) {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	for k, v := range fields {
		_ = writer.WriteField(k, v)
	}
	if fileField != "" {
		part, _ := writer.CreateFormFile(fileField, fileName)
		_, _ = part.Write(fileContent)
	}
	_ = writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/", body)
	req.Header.Set(echo.HeaderContentType, writer.FormDataContentType())
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set("user", &models.JWTCustomClaims{
		UserID:   userID.String(),
		TenantID: tenantID,
		Role:     "admin",
	})
	return c, rec
}

func validFontFields() map[string]string {
	return map[string]string{
		"license_accepted": "true",
		"name":             "Roboto Bold",
		"family":           "Roboto",
	}
}

func TestUploadEventFont_Returns201OnSuccess(t *testing.T) {
	tenantID := uuid.New()
	userID := uuid.New()
	eventID := uuid.New()
	var savedFont *models.Font
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenantID}, nil
		},
		createFont: func(font *models.Font) error {
			savedFont = font
			return nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newUploadContext(e, tenantID.String(), userID, validFontFields(), "file", "font.ttf", []byte("fake-ttf-bytes"))
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())

	err := h.UploadEventFont(c)
	if err != nil {
		t.Fatalf("unexpected handler error: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	if savedFont == nil {
		t.Fatal("expected Store.CreateFont to be called")
	}
	if savedFont.UploadedBy != userID {
		t.Errorf("expected UploadedBy %s, got %s", userID, savedFont.UploadedBy)
	}
	if savedFont.EventID != eventID {
		t.Errorf("expected EventID %s, got %s", eventID, savedFont.EventID)
	}
	if savedFont.Format != "truetype" {
		t.Errorf("expected format truetype, got %s", savedFont.Format)
	}
}

func TestUploadEventFont_RejectsWithoutLicenseAccepted(t *testing.T) {
	tenantID := uuid.New()
	eventID := uuid.New()
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenantID}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	fields := validFontFields()
	delete(fields, "license_accepted")
	c, rec := newUploadContext(e, tenantID.String(), uuid.New(), fields, "file", "font.ttf", []byte("fake-ttf-bytes"))
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())

	_ = h.UploadEventFont(c)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestUploadEventFont_RejectsMissingName(t *testing.T) {
	tenantID := uuid.New()
	eventID := uuid.New()
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenantID}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	fields := validFontFields()
	delete(fields, "name")
	c, rec := newUploadContext(e, tenantID.String(), uuid.New(), fields, "file", "font.ttf", []byte("fake-ttf-bytes"))
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())

	_ = h.UploadEventFont(c)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestUploadEventFont_RejectsInvalidFormat(t *testing.T) {
	tenantID := uuid.New()
	eventID := uuid.New()
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenantID}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newUploadContext(e, tenantID.String(), uuid.New(), validFontFields(), "file", "font.txt", []byte("not-a-font"))
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())

	_ = h.UploadEventFont(c)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestUploadEventFont_ReturnsConflictOnDuplicate(t *testing.T) {
	tenantID := uuid.New()
	eventID := uuid.New()
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenantID}, nil
		},
		createFont: func(font *models.Font) error {
			return &pgUniqueViolationError{}
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newUploadContext(e, tenantID.String(), uuid.New(), validFontFields(), "file", "font.ttf", []byte("fake-ttf-bytes"))
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())

	_ = h.UploadEventFont(c)
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestUploadEventFont_ReturnsInternalServerErrorOnStoreFailure(t *testing.T) {
	tenantID := uuid.New()
	eventID := uuid.New()
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: tenantID}, nil
		},
		createFont: func(font *models.Font) error {
			return errBoom
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newUploadContext(e, tenantID.String(), uuid.New(), validFontFields(), "file", "font.ttf", []byte("fake-ttf-bytes"))
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())

	_ = h.UploadEventFont(c)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestUploadEventFont_ForbidsForeignTenant(t *testing.T) {
	ownerTenant := uuid.New()
	caller := uuid.New()
	eventID := uuid.New()
	fs := &fakeStore{
		getEventByID: func(id uuid.UUID) (*models.Event, error) {
			return &models.Event{ID: id, TenantID: ownerTenant}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newUploadContext(e, caller.String(), uuid.New(), validFontFields(), "file", "font.ttf", []byte("fake-ttf-bytes"))
	c.SetParamNames("event_id")
	c.SetParamValues(eventID.String())

	_ = h.UploadEventFont(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

type pgUniqueViolationError struct{}

func (e *pgUniqueViolationError) Error() string {
	return `pq: duplicate key value violates unique constraint "fonts_event_family_weight_style_key"`
}

var errBoom = &boomError{}

type boomError struct{}

func (e *boomError) Error() string { return "boom: connection reset" }
