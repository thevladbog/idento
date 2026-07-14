package handler

import (
	"net/http"
	"testing"
	"time"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/bcrypt"
)

func contractUser(email string) *models.User {
	now := time.Now()
	hash, _ := bcrypt.GenerateFromPassword([]byte("secret123"), bcrypt.MinCost)
	return &models.User{
		ID:           uuid.New(),
		TenantID:     uuid.New(),
		Email:        email,
		PasswordHash: string(hash),
		Role:         "admin",
		CreatedAt:    now,
		UpdatedAt:    now,
	}
}

func contractTenant(name string) *models.Tenant {
	now := time.Now()
	return &models.Tenant{ID: uuid.New(), Name: name, Status: "active", CreatedAt: now, UpdatedAt: now}
}

func TestContractLogin(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret")
	user := contractUser("a@b.c")
	tenant := contractTenant("Acme")
	user.TenantID = tenant.ID
	h := New(&fakeStore{
		getUserByEmail:    func(string) (*models.User, error) { return user, nil },
		getUserTenants:    func(uuid.UUID) ([]*models.Tenant, error) { return []*models.Tenant{tenant}, nil },
		getUserTenantRole: func(_, _ uuid.UUID) (string, error) { return "admin", nil },
	})
	e := echo.New()

	c, rec := newUnauthedContext(e, http.MethodPost, "/auth/login",
		`{"email":"a@b.c","password":"secret123"}`)
	if err := h.Login(c); err != nil {
		t.Fatalf("Login: %v", err)
	}
	validateResponse(t, http.MethodPost, "/auth/login", rec)

	// 401 branch: wrong password
	c, rec = newUnauthedContext(e, http.MethodPost, "/auth/login",
		`{"email":"a@b.c","password":"wrong"}`)
	if err := h.Login(c); err != nil {
		t.Fatalf("Login: %v", err)
	}
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rec.Code)
	}
	validateResponse(t, http.MethodPost, "/auth/login", rec)
}

func TestContractRegister(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret")
	tenant := contractTenant("NewOrg")
	user := contractUser("new@org.io")
	h := New(&fakeStore{
		provisionTenantWithAdmin: func(_, _, _ string) (*models.Tenant, *models.User, error) {
			return tenant, user, nil
		},
		getUserTenants: func(uuid.UUID) ([]*models.Tenant, error) { return []*models.Tenant{tenant}, nil },
	})
	e := echo.New()
	c, rec := newUnauthedContext(e, http.MethodPost, "/auth/register",
		`{"tenant_name":"NewOrg","email":"new@org.io","password":"secret123"}`)
	if err := h.Register(c); err != nil {
		t.Fatalf("Register: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d", rec.Code)
	}
	validateResponse(t, http.MethodPost, "/auth/register", rec)
}

func TestContractLoginWithQR(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret")
	user := contractUser("staff@org.io")
	h := New(&fakeStore{
		getUserByQRToken: func(string) (*models.User, error) { return user, nil },
	})
	e := echo.New()
	c, rec := newUnauthedContext(e, http.MethodPost, "/auth/login-qr", `{"qr_token":"tok"}`)
	if err := h.LoginWithQR(c); err != nil {
		// echo.NewHTTPError branches return an error; render it like echo would
		e.HTTPErrorHandler(err, c)
	}
	validateResponse(t, http.MethodPost, "/auth/login-qr", rec)
}
