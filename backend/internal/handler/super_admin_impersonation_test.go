package handler

import (
	"encoding/json"
	"net/http"
	"testing"

	"idento/backend/internal/models"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func TestImpersonateActiveTenant(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret")
	e := echo.New()
	target := uuid.New()
	audited := ""
	fs := &fakeStore{
		getTenantStatus: func(id uuid.UUID) (string, error) { return "active", nil },
		logAdminAction: func(adminID uuid.UUID, action, targetType string, targetID uuid.UUID, changes interface{}, ip, userAgent string) error {
			audited = action
			return nil
		},
	}
	h := &Handler{Store: fs}
	c, rec := newAuthedContext(e, http.MethodPost, "/x", `{"reason":"test impersonation"}`, uuid.New().String(), "admin")
	c.SetParamNames("id")
	c.SetParamValues(target.String())

	if err := h.ImpersonateTenant(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusOK || audited != "impersonate_tenant" {
		t.Fatalf("status=%d audited=%q; want 200/impersonate_tenant; body: %s", rec.Code, audited, rec.Body.String())
	}
	var resp struct {
		Token    string `json:"token"`
		TenantID string `json:"tenant_id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil || resp.Token == "" {
		t.Fatalf("bad response: %v / %s", err, rec.Body.String())
	}
	// The minted token must carry imp_by and the target tenant.
	parsed, err := jwt.ParseWithClaims(resp.Token, &models.JWTCustomClaims{}, func(*jwt.Token) (interface{}, error) {
		return []byte("test-secret"), nil
	})
	if err != nil {
		t.Fatalf("minted token does not parse: %v", err)
	}
	claims := parsed.Claims.(*models.JWTCustomClaims)
	if claims.ImpersonatedBy == "" || claims.TenantID != target.String() || claims.Role != "admin" {
		t.Errorf("claims = %+v; want imp_by set, tenant %s, role admin", claims, target)
	}
	if claims.UserID != claims.ImpersonatedBy {
		t.Errorf("UserID (%s) must equal ImpersonatedBy (%s) — actions attribute to the operator", claims.UserID, claims.ImpersonatedBy)
	}
}

func TestImpersonateNonActiveTenantIs409(t *testing.T) {
	e := echo.New()
	fs := &fakeStore{getTenantStatus: func(id uuid.UUID) (string, error) { return "suspended", nil }}
	h := &Handler{Store: fs}
	c, rec := newAuthedContext(e, http.MethodPost, "/x", `{"reason":"test impersonation"}`, uuid.New().String(), "admin")
	c.SetParamNames("id")
	c.SetParamValues(uuid.New().String())
	if err := h.ImpersonateTenant(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 (reactivate before impersonating)", rec.Code)
	}
}

func TestImpersonateNestedIs403(t *testing.T) {
	e := echo.New()
	fs := &fakeStore{getTenantStatus: func(id uuid.UUID) (string, error) { return "active", nil }}
	h := &Handler{Store: fs}
	c, rec := newAuthedContext(e, http.MethodPost, "/x", "", uuid.New().String(), "admin")
	claims := c.Get("user").(*models.JWTCustomClaims)
	claims.ImpersonatedBy = uuid.New().String() // caller is already impersonating
	c.SetParamNames("id")
	c.SetParamValues(uuid.New().String())
	if err := h.ImpersonateTenant(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (no nested impersonation)", rec.Code)
	}
}

func TestSwitchTenantRejectsImpersonationToken(t *testing.T) {
	e := echo.New()
	h := &Handler{Store: &fakeStore{}}
	c, rec := newAuthedContext(e, http.MethodPost, "/x", `{"tenant_id":"`+uuid.New().String()+`"}`, uuid.New().String(), "admin")
	claims := c.Get("user").(*models.JWTCustomClaims)
	claims.ImpersonatedBy = uuid.New().String()
	if err := h.SwitchTenant(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (imp sessions are sealed)", rec.Code)
	}
}
