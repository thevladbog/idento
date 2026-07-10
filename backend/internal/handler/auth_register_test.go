package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"idento/backend/internal/models"
	"idento/backend/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func TestRegisterProvisionsAtomically(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret")
	e := echo.New()

	provisioned := false
	fs := &fakeStore{
		provisionTenantWithAdmin: func(tenantName, email, password string) (*models.Tenant, *models.User, error) {
			if tenantName != "Acme" || email != "owner@acme.test" || password != "secret123" {
				t.Errorf("unexpected args: %q %q password=%q", tenantName, email, password)
			}
			provisioned = true
			tenant := &models.Tenant{ID: uuid.New(), Name: tenantName}
			user := &models.User{ID: uuid.New(), TenantID: tenant.ID, Email: email, Role: "admin"}
			return tenant, user, nil
		},
		getUserTenants: func(userID uuid.UUID) ([]*models.Tenant, error) { return nil, nil },
	}
	h := &Handler{Store: fs}

	req := httptest.NewRequest(http.MethodPost, "/auth/register",
		strings.NewReader(`{"tenant_name":"Acme","email":"owner@acme.test","password":"secret123"}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	if err := h.Register(e.NewContext(req, rec)); err != nil {
		t.Fatalf("Register returned error: %v", err)
	}
	if rec.Code != http.StatusCreated || !provisioned {
		t.Fatalf("status=%d provisioned=%v; body: %s", rec.Code, provisioned, rec.Body.String())
	}
}

// Registering with an EXISTING email and the wrong password must not mint a
// token for that account (PR #26 review — SEC).
func TestRegisterExistingEmailWrongPasswordIs401(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret")
	e := echo.New()

	fs := &fakeStore{
		provisionTenantWithAdmin: func(tenantName, email, password string) (*models.Tenant, *models.User, error) {
			return nil, nil, store.ErrInvalidCredentials
		},
	}
	h := &Handler{Store: fs}

	req := httptest.NewRequest(http.MethodPost, "/auth/register",
		strings.NewReader(`{"tenant_name":"Evil Org","email":"victim@acme.test","password":"wrong"}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	if err := h.Register(e.NewContext(req, rec)); err != nil {
		t.Fatalf("Register returned error: %v", err)
	}
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401; body: %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "token") {
		t.Fatalf("response must not contain a token: %s", rec.Body.String())
	}
}
