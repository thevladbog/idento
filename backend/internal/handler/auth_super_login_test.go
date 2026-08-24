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

// TestLoginMembershipFreeSuperAdmin closes the PR #58 known limitation: a
// super admin homed only in a since-purged tenant has zero user_tenants
// rows, and Login's blanket "no organizations found" 401 locked the
// platform operator out entirely. A super admin now gets a console-only
// session (the operator console re-checks IsSuperAdmin from the DB and
// ignores the tenant claim); the token's tenant claim is the nil UUID with
// the weakest role, so every tenant-scoped endpoint keeps failing closed.
func TestLoginMembershipFreeSuperAdmin(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret")

	t.Run("a super admin with zero memberships gets a console-only session", func(t *testing.T) {
		user := contractUser("root@op.io")
		user.IsSuperAdmin = true
		user.TenantID = uuid.Nil
		h := New(&fakeStore{
			getUserByEmail: func(string) (*models.User, error) { return user, nil },
			getUserTenants: func(uuid.UUID) ([]*models.Tenant, error) { return []*models.Tenant{}, nil },
		})
		e := echo.New()
		c, rec := newUnauthedContext(e, http.MethodPost, "/auth/login",
			`{"email":"root@op.io","password":"secret123"}`)
		if err := h.Login(c); err != nil {
			t.Fatalf("Login: %v", err)
		}
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d (body: %s)", rec.Code, http.StatusOK, rec.Body.String())
		}
		validateResponse(t, http.MethodPost, "/auth/login", rec)

		var body struct {
			Token         string            `json:"token"`
			Tenants       []json.RawMessage `json:"tenants"`
			CurrentTenant *json.RawMessage  `json:"current_tenant"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if body.Token == "" {
			t.Fatal("no token issued")
		}
		if body.Tenants == nil || len(body.Tenants) != 0 {
			t.Fatalf("tenants = %v, want an empty (non-null) list", body.Tenants)
		}
		if body.CurrentTenant != nil {
			t.Fatal("membership-free login must not fabricate a current_tenant")
		}

		claims := &models.JWTCustomClaims{}
		if _, err := jwt.ParseWithClaims(body.Token, claims, func(*jwt.Token) (interface{}, error) {
			return []byte("test-secret"), nil
		}); err != nil {
			t.Fatalf("parse token: %v", err)
		}
		if claims.TenantID != uuid.Nil.String() {
			t.Fatalf("token tenant claim = %q, want the nil UUID (no tenant scope)", claims.TenantID)
		}
		if claims.Role != "member" {
			t.Fatalf("token role claim = %q, want the weakest role %q", claims.Role, "member")
		}
	})

	t.Run("a regular user with zero memberships is still refused", func(t *testing.T) {
		user := contractUser("solo@org.io")
		h := New(&fakeStore{
			getUserByEmail: func(string) (*models.User, error) { return user, nil },
			getUserTenants: func(uuid.UUID) ([]*models.Tenant, error) { return []*models.Tenant{}, nil },
		})
		e := echo.New()
		c, rec := newUnauthedContext(e, http.MethodPost, "/auth/login",
			`{"email":"solo@org.io","password":"secret123"}`)
		if err := h.Login(c); err != nil {
			t.Fatalf("Login: %v", err)
		}
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
		}
		validateResponse(t, http.MethodPost, "/auth/login", rec)
	})
}
