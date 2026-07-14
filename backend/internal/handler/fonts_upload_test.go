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
func newUploadContext(t *testing.T, e *echo.Echo, tenantID string, userID uuid.UUID, fields map[string]string, fileField, fileName string, fileContent []byte) (echo.Context, *httptest.ResponseRecorder) {
	t.Helper()
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	for k, v := range fields {
		if err := writer.WriteField(k, v); err != nil {
			t.Fatalf("WriteField(%q): %v", k, err)
		}
	}
	if fileField != "" {
		part, err := writer.CreateFormFile(fileField, fileName)
		if err != nil {
			t.Fatalf("CreateFormFile(%q, %q): %v", fileField, fileName, err)
		}
		if _, err := part.Write(fileContent); err != nil {
			t.Fatalf("part.Write: %v", err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("writer.Close: %v", err)
	}

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

func TestUploadEventFont(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name         string
		mutateFields func(fields map[string]string)
		fileName     string
		fileContent  []byte
		storeErr     error
		foreignOwner bool // caller's tenant differs from the event's owner tenant
		wantStatus   int
		validate     func(t *testing.T, saved *models.Font, eventID, userID uuid.UUID)
	}{
		{
			name:        "success",
			fileName:    "font.ttf",
			fileContent: []byte("fake-ttf-bytes"),
			wantStatus:  http.StatusCreated,
			validate: func(t *testing.T, saved *models.Font, eventID, userID uuid.UUID) {
				if saved == nil {
					t.Fatal("expected Store.CreateFont to be called")
				}
				if saved.UploadedBy != userID {
					t.Errorf("expected UploadedBy %s, got %s", userID, saved.UploadedBy)
				}
				if saved.EventID != eventID {
					t.Errorf("expected EventID %s, got %s", eventID, saved.EventID)
				}
				if saved.Format != "truetype" {
					t.Errorf("expected format truetype, got %s", saved.Format)
				}
			},
		},
		{
			name:         "rejects without license accepted",
			mutateFields: func(fields map[string]string) { delete(fields, "license_accepted") },
			fileName:     "font.ttf",
			fileContent:  []byte("fake-ttf-bytes"),
			wantStatus:   http.StatusBadRequest,
		},
		{
			name:         "rejects missing name",
			mutateFields: func(fields map[string]string) { delete(fields, "name") },
			fileName:     "font.ttf",
			fileContent:  []byte("fake-ttf-bytes"),
			wantStatus:   http.StatusBadRequest,
		},
		{
			name:        "rejects invalid format",
			fileName:    "font.txt",
			fileContent: []byte("not-a-font"),
			wantStatus:  http.StatusBadRequest,
		},
		{
			name:        "returns conflict on duplicate",
			fileName:    "font.ttf",
			fileContent: []byte("fake-ttf-bytes"),
			storeErr:    &pgUniqueViolationError{},
			wantStatus:  http.StatusConflict,
		},
		{
			name:        "returns internal server error on store failure",
			fileName:    "font.ttf",
			fileContent: []byte("fake-ttf-bytes"),
			storeErr:    errBoom,
			wantStatus:  http.StatusInternalServerError,
		},
		{
			name:         "forbids foreign tenant",
			fileName:     "font.ttf",
			fileContent:  []byte("fake-ttf-bytes"),
			foreignOwner: true,
			wantStatus:   http.StatusNotFound,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			tenantID := uuid.New()
			ownerTenant := tenantID
			if tc.foreignOwner {
				ownerTenant = uuid.New()
			}
			userID := uuid.New()
			eventID := uuid.New()

			var savedFont *models.Font
			fs := &fakeStore{
				getEventByID: func(id uuid.UUID) (*models.Event, error) {
					return &models.Event{ID: id, TenantID: ownerTenant}, nil
				},
				createFont: func(font *models.Font) error {
					if tc.storeErr != nil {
						return tc.storeErr
					}
					savedFont = font
					return nil
				},
			}
			h := &Handler{Store: fs}
			e := echo.New()

			fields := validFontFields()
			if tc.mutateFields != nil {
				tc.mutateFields(fields)
			}

			c, rec := newUploadContext(t, e, tenantID.String(), userID, fields, "file", tc.fileName, tc.fileContent)
			c.SetParamNames("event_id")
			c.SetParamValues(eventID.String())

			if err := h.UploadEventFont(c); err != nil {
				t.Fatalf("unexpected handler error: %v", err)
			}
			if rec.Code != tc.wantStatus {
				t.Fatalf("expected %d, got %d: %s", tc.wantStatus, rec.Code, rec.Body.String())
			}
			if tc.validate != nil {
				tc.validate(t, savedFont, eventID, userID)
			}
		})
	}
}

type pgUniqueViolationError struct{}

func (e *pgUniqueViolationError) Error() string {
	return `pq: duplicate key value violates unique constraint "fonts_event_family_weight_style_key"`
}

var errBoom = &boomError{}

type boomError struct{}

func (e *boomError) Error() string { return "boom: connection reset" }
