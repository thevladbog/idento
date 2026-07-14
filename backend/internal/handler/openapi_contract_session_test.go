package handler

import (
	"errors"
	"net/http"
	"testing"
	"time"

	"idento/backend/internal/middleware"
	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func TestContractGetMe(t *testing.T) {
	h := New(&fakeStore{})
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/api/me", "", uuid.New().String(), "admin")
	if err := h.GetMe(c); err != nil {
		t.Fatalf("GetMe: %v", err)
	}
	validateResponse(t, http.MethodGet, "/api/me", rec)
}

func TestContractSwitchTenant(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret")
	callerTenant := uuid.New()
	targetTenant := contractTenant("Target Org")
	user := contractUser("switcher@org.io")
	h := New(&fakeStore{
		getUserTenantRole: func(_, tenantID uuid.UUID) (string, error) {
			if tenantID == targetTenant.ID {
				return "admin", nil
			}
			return "", errors.New("not a member of this tenant")
		},
		getUserByID:   func(uuid.UUID) (*models.User, error) { return user, nil },
		getTenantByID: func(id uuid.UUID) (*models.Tenant, error) { return targetTenant, nil },
	})
	e := echo.New()

	// 200: caller belongs to the target tenant.
	c, rec := newAuthedContext(e, http.MethodPost, "/api/auth/switch-tenant",
		`{"tenant_id":"`+targetTenant.ID.String()+`"}`, callerTenant.String(), "admin")
	if err := h.SwitchTenant(c); err != nil {
		t.Fatalf("SwitchTenant: %v", err)
	}
	validateResponse(t, http.MethodPost, "/api/auth/switch-tenant", rec)

	// 403: caller has no membership in the requested tenant.
	c, rec = newAuthedContext(e, http.MethodPost, "/api/auth/switch-tenant",
		`{"tenant_id":"`+uuid.New().String()+`"}`, callerTenant.String(), "admin")
	if err := h.SwitchTenant(c); err != nil {
		t.Fatalf("SwitchTenant: %v", err)
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, "/api/auth/switch-tenant", rec)
}

func TestContractGetUserTenants(t *testing.T) {
	tenant := contractTenant("Acme")
	h := New(&fakeStore{
		getUserTenants:    func(uuid.UUID) ([]*models.Tenant, error) { return []*models.Tenant{tenant}, nil },
		getUserTenantRole: func(_, _ uuid.UUID) (string, error) { return "admin", nil },
	})
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/api/tenants", "", tenant.ID.String(), "admin")
	if err := h.GetUserTenants(c); err != nil {
		t.Fatalf("GetUserTenants: %v", err)
	}
	validateResponse(t, http.MethodGet, "/api/tenants", rec)
}

func TestContractGetTenant(t *testing.T) {
	tenant := contractTenant("Acme")
	h := New(&fakeStore{
		getUserTenantRole: func(_, _ uuid.UUID) (string, error) { return "admin", nil },
		getTenantByID:     func(id uuid.UUID) (*models.Tenant, error) { return tenant, nil },
	})
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/api/tenants/"+tenant.ID.String(), "", tenant.ID.String(), "admin")
	c.SetPath("/api/tenants/:id")
	c.SetParamNames("id")
	c.SetParamValues(tenant.ID.String())
	if err := h.GetTenant(c); err != nil {
		t.Fatalf("GetTenant: %v", err)
	}
	validateResponse(t, http.MethodGet, "/api/tenants/"+tenant.ID.String(), rec)
}

func TestContractUpdateTenant(t *testing.T) {
	tenant := contractTenant("Acme")
	h := New(&fakeStore{
		getUserTenantRole: func(_, _ uuid.UUID) (string, error) { return "admin", nil },
		getTenantByID:     func(id uuid.UUID) (*models.Tenant, error) { return tenant, nil },
		updateTenant:      func(*models.Tenant) error { return nil },
	})
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodPut, "/api/tenants/"+tenant.ID.String(),
		`{"name":"Acme Renamed"}`, tenant.ID.String(), "admin")
	c.SetPath("/api/tenants/:id")
	c.SetParamNames("id")
	c.SetParamValues(tenant.ID.String())
	if err := h.UpdateTenant(c); err != nil {
		t.Fatalf("UpdateTenant: %v", err)
	}
	validateResponse(t, http.MethodPut, "/api/tenants/"+tenant.ID.String(), rec)
}

func TestContractGetUsers(t *testing.T) {
	tenantID := uuid.New()
	users := []*models.User{contractUser("a@b.c")}
	h := New(&fakeStore{
		getUsersByTenantID: func(uuid.UUID) ([]*models.User, error) { return users, nil },
	})
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/api/users", "", tenantID.String(), "admin")
	if err := h.GetUsers(c); err != nil {
		t.Fatalf("GetUsers: %v", err)
	}
	validateResponse(t, http.MethodGet, "/api/users", rec)
}

func TestContractCreateUser(t *testing.T) {
	tenantID := uuid.New()
	h := New(&fakeStore{
		createUser:      func(*models.User) error { return nil },
		addUserToTenant: func(*models.UserTenant) error { return nil },
		logUsage:        func(*models.UsageLog) error { return nil },
	})
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodPost, "/api/users",
		`{"email":"new@org.io","password":"secret123","role":"staff"}`, tenantID.String(), "admin")
	if err := h.CreateUser(c); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, "/api/users", rec)
}

// TestContractCreateUserLimitExceeded exercises middleware.CheckLimits directly
// (it wraps CreateUser as route-level middleware, not handler code) to prove the
// 403 body it produces when a tenant is at/over its "users" plan limit matches
// the LimitExceededError shape documented for POST /api/users.
func TestContractCreateUserLimitExceeded(t *testing.T) {
	tenantID := uuid.New()
	fs := &fakeStore{
		checkTenantLimit: func(uuid.UUID, string) (bool, int, int, error) { return false, 5, 5, nil },
	}
	mw := middleware.CheckLimits(fs, "users")
	next := func(c echo.Context) error {
		t.Fatal("next handler should not be called once the limit is exceeded")
		return nil
	}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodPost, "/api/users",
		`{"email":"x@y.z","password":"secret123","role":"staff"}`, tenantID.String(), "admin")
	if err := mw(next)(c); err != nil {
		t.Fatalf("CheckLimits: %v", err)
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, "/api/users", rec)
}

func TestContractGenerateQRToken(t *testing.T) {
	tenantID := uuid.New()
	targetUser := contractUser("staff@org.io")
	h := New(&fakeStore{
		getUserByID:       func(uuid.UUID) (*models.User, error) { return targetUser, nil },
		getUserTenantRole: func(_, _ uuid.UUID) (string, error) { return "staff", nil },
		updateUserQRToken: func(uuid.UUID, string, time.Time) error { return nil },
	})
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodPost, "/api/users/"+targetUser.ID.String()+"/qr-token", "", tenantID.String(), "admin")
	c.SetPath("/api/users/:id/qr-token")
	c.SetParamNames("id")
	c.SetParamValues(targetUser.ID.String())
	if err := h.GenerateQRToken(c); err != nil {
		t.Fatalf("GenerateQRToken: %v", err)
	}
	validateResponse(t, http.MethodPost, "/api/users/"+targetUser.ID.String()+"/qr-token", rec)
}
