package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func TestRegisterProvisionsAtomically(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret")
	e := echo.New()

	provisioned := false
	fs := &fakeStore{
		provisionTenantWithAdmin: func(tenantName, email, passwordHash string) (*models.Tenant, *models.User, error) {
			if tenantName != "Acme" || email != "owner@acme.test" || passwordHash == "" {
				t.Errorf("unexpected args: %q %q hash-empty=%v", tenantName, email, passwordHash == "")
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
