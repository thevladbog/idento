package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"idento/backend/internal/models"
	"idento/backend/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

type impAuditFakeStore struct {
	store.Store
	logged []string
}

func (f *impAuditFakeStore) LogAdminAction(_ context.Context, adminID uuid.UUID, action, targetType string, targetID uuid.UUID, changes interface{}, ip, userAgent string) error {
	f.logged = append(f.logged, action)
	return nil
}

func impAuditRequest(t *testing.T, fs *impAuditFakeStore, method, impBy string) {
	t.Helper()
	e := echo.New()
	req := httptest.NewRequest(method, "/api/events", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set("user", &models.JWTCustomClaims{
		UserID: uuid.New().String(), TenantID: uuid.New().String(), Role: "admin",
		ImpersonatedBy: impBy,
	})
	h := ImpersonationAudit(fs)(func(c echo.Context) error { return c.NoContent(http.StatusOK) })
	if err := h(c); err != nil {
		t.Fatalf("middleware error: %v", err)
	}
}

func TestImpersonatedMutationIsAudited(t *testing.T) {
	fs := &impAuditFakeStore{}
	impAuditRequest(t, fs, http.MethodPost, uuid.New().String())
	if len(fs.logged) != 1 || fs.logged[0] != "impersonated_request" {
		t.Fatalf("logged = %v, want one impersonated_request", fs.logged)
	}
}

func TestImpersonatedReadIsNotAudited(t *testing.T) {
	fs := &impAuditFakeStore{}
	impAuditRequest(t, fs, http.MethodGet, uuid.New().String())
	if len(fs.logged) != 0 {
		t.Fatalf("GET must not be audited, logged = %v", fs.logged)
	}
}

func TestNonImpersonatedMutationIsNotAudited(t *testing.T) {
	fs := &impAuditFakeStore{}
	impAuditRequest(t, fs, http.MethodDelete, "")
	if len(fs.logged) != 0 {
		t.Fatalf("non-impersonated must not be audited, logged = %v", fs.logged)
	}
}
