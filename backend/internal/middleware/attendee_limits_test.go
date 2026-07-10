package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"idento/backend/internal/models"
	"idento/backend/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

type limitFakeStore struct {
	store.Store
	allowed      bool
	current, max int
}

func (f *limitFakeStore) CheckAttendeeLimit(_ context.Context, tenantID, eventID uuid.UUID, adding int) (bool, int, int, error) {
	return f.allowed, f.current, f.max, nil
}

func attendeeLimitRequest(t *testing.T, fs *limitFakeStore) *httptest.ResponseRecorder {
	t.Helper()
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/x", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("event_id")
	c.SetParamValues(uuid.New().String())
	c.Set("user", &models.JWTCustomClaims{UserID: uuid.New().String(), TenantID: uuid.New().String(), Role: "admin"})
	h := CheckAttendeeLimits(fs)(func(c echo.Context) error { return c.NoContent(http.StatusCreated) })
	if err := h(c); err != nil {
		t.Fatalf("middleware error: %v", err)
	}
	return rec
}

func TestAttendeeLimitBlocksWhenFull(t *testing.T) {
	rec := attendeeLimitRequest(t, &limitFakeStore{allowed: false, current: 50, max: 50})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
}

func TestAttendeeLimitPassesWhenUnderLimit(t *testing.T) {
	rec := attendeeLimitRequest(t, &limitFakeStore{allowed: true, current: 3, max: 50})
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201", rec.Code)
	}
}
