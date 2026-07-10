package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"idento/backend/internal/models"
	"idento/backend/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

type gateFakeStore struct {
	store.Store
	status    string
	statusErr error
	sub       *models.Subscription
	calls     int
}

func (f *gateFakeStore) GetTenantStatus(_ context.Context, id uuid.UUID) (string, error) {
	f.calls++
	return f.status, f.statusErr
}
func (f *gateFakeStore) GetSubscriptionByTenantID(_ context.Context, id uuid.UUID) (*models.Subscription, error) {
	return f.sub, nil
}

func gateRequest(t *testing.T, fs *gateFakeStore, ttl time.Duration, path string) *httptest.ResponseRecorder {
	t.Helper()
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, path, nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetPath(path)
	c.Set("user", &models.JWTCustomClaims{UserID: uuid.New().String(), TenantID: uuid.New().String(), Role: "admin"})
	handler := tenantGateWithTTL(fs, ttl)(func(c echo.Context) error {
		return c.NoContent(http.StatusOK)
	})
	if err := handler(c); err != nil {
		t.Fatalf("middleware error: %v", err)
	}
	return rec
}

func TestGateBlocksSuspendedTenant(t *testing.T) {
	fs := &gateFakeStore{status: "suspended"}
	rec := gateRequest(t, fs, 0, "/api/events")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
	if body := rec.Body.String(); !contains(body, `"code":"tenant_suspended"`) {
		t.Errorf("body %q missing machine-readable code", body)
	}
}

func TestGateAllowsActiveTenantWithActiveSub(t *testing.T) {
	fs := &gateFakeStore{status: "active", sub: &models.Subscription{Status: "active"}}
	if rec := gateRequest(t, fs, 0, "/api/events"); rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}

func TestGateBlocksExpiredSubscription(t *testing.T) {
	past := time.Now().Add(-24 * time.Hour)
	fs := &gateFakeStore{status: "active", sub: &models.Subscription{Status: "expired", EndDate: &past}}
	if rec := gateRequest(t, fs, 0, "/api/events"); rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
}

func TestGateSkipsExemptPaths(t *testing.T) {
	fs := &gateFakeStore{status: "suspended"}
	if rec := gateRequest(t, fs, 0, "/api/me"); rec.Code != http.StatusOK {
		t.Fatalf("/api/me status = %d, want 200 (exempt)", rec.Code)
	}
	if rec := gateRequest(t, fs, 0, "/api/super-admin/tenants"); rec.Code != http.StatusOK {
		t.Fatalf("super-admin status = %d, want 200 (exempt)", rec.Code)
	}
	if fs.calls != 0 {
		t.Errorf("store consulted %d times on exempt paths, want 0", fs.calls)
	}
}

func TestGateCachesDecision(t *testing.T) {
	fs := &gateFakeStore{status: "active", sub: &models.Subscription{Status: "active"}}
	gate := tenantGateWithTTL(fs, time.Minute)
	e := echo.New()
	tenantID := uuid.New().String()
	for i := 0; i < 3; i++ {
		req := httptest.NewRequest(http.MethodPost, "/api/events", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetPath("/api/events")
		c.Set("user", &models.JWTCustomClaims{UserID: uuid.New().String(), TenantID: tenantID, Role: "admin"})
		if err := gate(func(c echo.Context) error { return c.NoContent(http.StatusOK) })(c); err != nil {
			t.Fatalf("middleware error: %v", err)
		}
	}
	if fs.calls != 1 {
		t.Errorf("store consulted %d times for 3 requests within TTL, want 1", fs.calls)
	}
}

func contains(s, sub string) bool { return len(s) >= len(sub) && strings.Contains(s, sub) }
