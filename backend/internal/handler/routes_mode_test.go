package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"idento/backend/internal/config"

	"github.com/labstack/echo/v4"
)

func registeredRoutes(mode string) (*echo.Echo, map[string]bool) {
	e := echo.New()
	h := &Handler{Store: &fakeStore{}}
	h.RegisterRoutes(e, mode)
	m := map[string]bool{}
	for _, r := range e.Routes() {
		m[r.Method+" "+r.Path] = true
	}
	return e, m
}

func TestOnPremDoesNotMountSaaSRoutes(t *testing.T) {
	e, routes := registeredRoutes(config.ModeOnPrem)
	if routes["POST /auth/register"] {
		t.Error("onprem must not mount POST /auth/register")
	}
	for key := range routes {
		if strings.Contains(key, "/super-admin") {
			t.Errorf("onprem mounted super-admin route: %s", key)
		}
	}
	// Register has no group middleware → clean 404 probe.
	req := httptest.NewRequest(http.MethodPost, "/auth/register", strings.NewReader(`{}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("onprem POST /auth/register = %d, want 404", rec.Code)
	}
	// JWT must protect /api in BOTH modes — regression guard for this fix.
	req2 := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	rec2 := httptest.NewRecorder()
	e.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusUnauthorized {
		t.Errorf("onprem GET /api/me without token = %d, want 401 (JWT must be active)", rec2.Code)
	}
}

func TestSaaSMountsRegisterAndSuperAdmin(t *testing.T) {
	_, routes := registeredRoutes(config.ModeSaaS)
	if !routes["POST /auth/register"] {
		t.Error("saas must mount POST /auth/register")
	}
	found := false
	for key := range routes {
		if strings.Contains(key, "/super-admin/plans") {
			found = true
		}
	}
	if !found {
		t.Error("saas must mount /super-admin routes")
	}
}
