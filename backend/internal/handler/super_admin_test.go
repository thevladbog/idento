package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func TestSetTenantStatus_ReasonPersistedToAuditChanges(t *testing.T) {
	e := echo.New()
	tenantID := uuid.New()
	adminID := uuid.New()
	var capturedChanges map[string]interface{}

	fs := &fakeStore{
		getTenantStatus: func(id uuid.UUID) (string, error) {
			if id == tenantID {
				return "active", nil
			}
			return "", nil
		},
		updateTenantStatus: func(id uuid.UUID, status string) error {
			return nil
		},
		logAdminAction: func(audID uuid.UUID, action, targetType string, targetID uuid.UUID, changes interface{}, ip, userAgent string) error {
			capturedChanges = changes.(map[string]interface{})
			return nil
		},
	}

	h := &Handler{Store: fs}
	body, _ := json.Marshal(map[string]string{"reason": "Spring Summit 2026, approved by JR"})
	req := httptest.NewRequest(http.MethodPost, "/api/super-admin/tenants/"+tenantID.String()+"/suspend", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(tenantID.String())
	c.Set("user", &models.JWTCustomClaims{
		UserID:   adminID.String(),
		TenantID: uuid.New().String(),
		Role:     "admin",
	})

	if err := h.SuspendTenant(c); err != nil {
		t.Fatalf("SuspendTenant returned error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if capturedChanges == nil {
		t.Fatalf("expected changes to be captured, got nil")
	}
	if capturedChanges["reason"] != "Spring Summit 2026, approved by JR" {
		t.Fatalf("expected reason in audit changes, got %#v", capturedChanges)
	}
	if capturedChanges["from"] != "active" || capturedChanges["to"] != "suspended" {
		t.Fatalf("expected from/to preserved alongside reason, got %#v", capturedChanges)
	}
}

func TestSetTenantStatus_NoBodyStillWorks(t *testing.T) {
	e := echo.New()
	tenantID := uuid.New()
	adminID := uuid.New()
	var capturedChanges map[string]interface{}

	fs := &fakeStore{
		getTenantStatus: func(id uuid.UUID) (string, error) {
			if id == tenantID {
				return "suspended", nil
			}
			return "", nil
		},
		updateTenantStatus: func(id uuid.UUID, status string) error {
			return nil
		},
		logAdminAction: func(audID uuid.UUID, action, targetType string, targetID uuid.UUID, changes interface{}, ip, userAgent string) error {
			capturedChanges = changes.(map[string]interface{})
			return nil
		},
	}

	h := &Handler{Store: fs}
	req := httptest.NewRequest(http.MethodPost, "/api/super-admin/tenants/"+tenantID.String()+"/reactivate", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(tenantID.String())
	c.Set("user", &models.JWTCustomClaims{
		UserID:   adminID.String(),
		TenantID: uuid.New().String(),
		Role:     "admin",
	})

	if err := h.ReactivateTenant(c); err != nil {
		t.Fatalf("ReactivateTenant returned error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if _, hasReason := capturedChanges["reason"]; hasReason {
		t.Fatalf("expected no reason key when body omits it, got %#v", capturedChanges)
	}
}

func TestImpersonateTenant_ReasonPersistedToAuditChanges(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret")
	e := echo.New()
	tenantID := uuid.New()
	adminID := uuid.New()
	var capturedChanges map[string]interface{}

	fs := &fakeStore{
		getTenantStatus: func(id uuid.UUID) (string, error) {
			if id == tenantID {
				return "active", nil
			}
			return "", nil
		},
		logAdminAction: func(audID uuid.UUID, action, targetType string, targetID uuid.UUID, changes interface{}, ip, userAgent string) error {
			capturedChanges = changes.(map[string]interface{})
			return nil
		},
	}

	h := &Handler{Store: fs}
	body, _ := json.Marshal(map[string]string{"reason": "Reproduce badge-print bug for support ticket #4821"})
	req := httptest.NewRequest(http.MethodPost, "/api/super-admin/tenants/"+tenantID.String()+"/impersonate", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(tenantID.String())
	c.Set("user", &models.JWTCustomClaims{
		UserID:   adminID.String(),
		TenantID: uuid.New().String(),
		Role:     "admin",
	})

	if err := h.ImpersonateTenant(c); err != nil {
		t.Fatalf("ImpersonateTenant returned error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if capturedChanges == nil {
		t.Fatalf("expected changes to be captured, got nil")
	}
	if capturedChanges["reason"] != "Reproduce badge-print bug for support ticket #4821" {
		t.Fatalf("expected reason in audit changes, got %#v", capturedChanges)
	}
}
