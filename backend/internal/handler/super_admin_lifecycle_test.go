package handler

import (
	"net/http"
	"testing"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func lifecycleCtx(t *testing.T, fs *fakeStore, target uuid.UUID, action string) (*Handler, echo.Context, func() int) {
	t.Helper()
	e := echo.New()
	h := &Handler{Store: fs}
	c, rec := newAuthedContext(e, http.MethodPost, "/x", "", uuid.New().String(), "admin")
	c.SetParamNames("id")
	c.SetParamValues(target.String())
	_ = action
	return h, c, func() int { return rec.Code }
}

func TestSuspendTenantFromActive(t *testing.T) {
	target := uuid.New()
	var saved string
	var gotAction, gotIP, gotUA string
	fs := &fakeStore{
		getTenantStatus:    func(id uuid.UUID) (string, error) { return "active", nil },
		updateTenantStatus: func(id uuid.UUID, s string) error { saved = s; return nil },
		logAdminAction: func(adminID uuid.UUID, action, targetType string, targetID uuid.UUID, changes interface{}, ip, userAgent string) error {
			gotAction, gotIP, gotUA = action, ip, userAgent
			return nil
		},
	}
	h, c, code := lifecycleCtx(t, fs, target, "suspend")
	if err := h.SuspendTenant(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if code() != http.StatusOK || saved != "suspended" {
		t.Fatalf("status=%d saved=%q; want 200/suspended", code(), saved)
	}
	if gotAction != "suspend_tenant" || gotIP == "" || gotUA == "" {
		t.Errorf("audit attribution missing: action=%q ip=%q ua=%q", gotAction, gotIP, gotUA)
	}
}

func TestArchiveRequiresSuspended(t *testing.T) {
	target := uuid.New()
	fs := &fakeStore{
		getTenantStatus: func(id uuid.UUID) (string, error) { return "active", nil },
	}
	h, c, code := lifecycleCtx(t, fs, target, "archive")
	if err := h.ArchiveTenant(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if code() != http.StatusConflict {
		t.Fatalf("status=%d; want 409 (archive only from suspended)", code())
	}
}

func TestCreateTenantSuper(t *testing.T) {
	e := echo.New()
	created := false
	fs := &fakeStore{
		createTenantWithDefaultSubscription: func(tenant *models.Tenant) error {
			tenant.ID = uuid.New()
			created = true
			return nil
		},
		logAdminAction: func(adminID uuid.UUID, action, targetType string, targetID uuid.UUID, changes interface{}, ip, userAgent string) error {
			return nil
		},
	}
	h := &Handler{Store: fs}
	c, rec := newAuthedContext(e, http.MethodPost, "/x", `{"name":"Ops Created Org"}`, uuid.New().String(), "admin")
	if err := h.CreateTenantSuper(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusCreated || !created {
		t.Fatalf("status=%d created=%v; want 201 + store call", rec.Code, created)
	}
}
