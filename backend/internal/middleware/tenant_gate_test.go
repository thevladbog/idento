package middleware

import (
	"context"
	"errors"
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
	subErr    error
	calls     int
}

func (f *gateFakeStore) GetTenantStatus(_ context.Context, id uuid.UUID) (string, error) {
	f.calls++
	return f.status, f.statusErr
}
func (f *gateFakeStore) GetSubscriptionByTenantID(_ context.Context, id uuid.UUID) (*models.Subscription, error) {
	return f.sub, f.subErr
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

// Pins the EndDate-based branch on its own: a non-active status that is NOT
// in the expired/cancelled switch, with a past end_date, must block.
func TestGateBlocksPastEndDateNonActiveStatus(t *testing.T) {
	past := time.Now().Add(-24 * time.Hour)
	fs := &gateFakeStore{status: "active", sub: &models.Subscription{Status: "trial", EndDate: &past}}
	if rec := gateRequest(t, fs, 0, "/api/events"); rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (past end_date on non-active sub must block)", rec.Code)
	}
}

// An active-status subscription is never blocked by end_date (billing may
// lag); only non-active statuses combine with end_date.
func TestGateAllowsActiveSubPastEndDate(t *testing.T) {
	past := time.Now().Add(-24 * time.Hour)
	fs := &gateFakeStore{status: "active", sub: &models.Subscription{Status: "active", EndDate: &past}}
	if rec := gateRequest(t, fs, 0, "/api/events"); rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (active sub passes regardless of end_date)", rec.Code)
	}
}

// TestGateFailsClosedOnStatusLookupError pins the fail-closed branch: if the
// tenant-status lookup itself errors (e.g. DB unavailable), the gate must
// not let the request through — availability of the status check must not
// become a way to bypass suspension.
func TestGateFailsClosedOnStatusLookupError(t *testing.T) {
	fs := &gateFakeStore{statusErr: errors.New("db down")}
	rec := gateRequest(t, fs, 0, "/api/events")
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (fail closed on tenant status lookup error)", rec.Code)
	}
}

// TestGateFailsOpenOnSubscriptionLookupError pins the fail-open branch
// documented in IsTenantBlocked: a subscription lookup error must not lock
// out an active tenant, since the whole API's availability must not hinge
// on the billing table.
func TestGateFailsOpenOnSubscriptionLookupError(t *testing.T) {
	fs := &gateFakeStore{status: "active", subErr: errors.New("db down")}
	rec := gateRequest(t, fs, 0, "/api/events")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (fail open on subscription lookup error)", rec.Code)
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

func TestSweepExpiredLocked(t *testing.T) {
	now := time.Now()
	cache := map[string]gateEntry{
		"live":    {expires: now.Add(time.Minute)},
		"expired": {expires: now.Add(-time.Minute)},
	}
	sweepExpiredLocked(cache, now)
	if _, ok := cache["expired"]; ok {
		t.Error("expired entry survived sweep")
	}
	if _, ok := cache["live"]; !ok {
		t.Error("live entry was swept")
	}
}

func contains(s, sub string) bool { return len(s) >= len(sub) && strings.Contains(s, sub) }
