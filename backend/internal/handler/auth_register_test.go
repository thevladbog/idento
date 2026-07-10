package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func TestRegisterProvisionsDefaultSubscription(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret")
	e := echo.New()

	provisioned := false
	fs := &fakeStore{
		createTenantWithDefaultSubscription: func(tenant *models.Tenant) error {
			tenant.ID = uuid.New()
			provisioned = true
			return nil
		},
		getUserByEmail:  func(email string) (*models.User, error) { return nil, nil },
		createUser:      func(u *models.User) error { u.ID = uuid.New(); return nil },
		addUserToTenant: func(ut *models.UserTenant) error { return nil },
		getUserTenants:  func(userID uuid.UUID) ([]*models.Tenant, error) { return nil, nil },
	}
	h := &Handler{Store: fs}

	req := httptest.NewRequest(http.MethodPost, "/auth/register",
		strings.NewReader(`{"tenant_name":"Acme","email":"owner@acme.test","password":"secret123"}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()

	if err := h.Register(e.NewContext(req, rec)); err != nil {
		t.Fatalf("Register returned error: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body: %s", rec.Code, rec.Body.String())
	}
	if !provisioned {
		t.Fatal("Register did not call CreateTenantWithDefaultSubscription")
	}
	var resp map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("response is not JSON: %v", err)
	}
	if resp["token"] == "" {
		t.Error("response has no token")
	}
}
