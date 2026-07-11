package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
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
	if capturedChanges == nil {
		t.Fatalf("expected logAdminAction to be invoked with captured changes, got nil")
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

func TestGetAuditLog_TargetIDFilterPassedToStore(t *testing.T) {
	e := echo.New()
	var capturedFilters map[string]interface{}

	fs := &fakeStore{
		getAuditLog: func(filters map[string]interface{}, limit, offset int) ([]*models.AdminAuditLog, int, error) {
			capturedFilters = filters
			return nil, 0, nil
		},
	}
	h := &Handler{Store: fs}

	targetID := uuid.New()
	req := httptest.NewRequest(http.MethodGet, "/api/super-admin/audit-log?target_id="+targetID.String()+"&action=suspend_tenant", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := h.GetAuditLog(c); err != nil {
		t.Fatalf("GetAuditLog returned error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if capturedFilters["target_id"] != targetID {
		t.Fatalf("expected target_id filter %v, got %#v", targetID, capturedFilters["target_id"])
	}
	if capturedFilters["action"] != "suspend_tenant" {
		t.Fatalf("expected action filter preserved, got %#v", capturedFilters["action"])
	}
}

func TestGetAuditLog_InvalidTargetIDIgnoredNot400(t *testing.T) {
	e := echo.New()
	var capturedFilters map[string]interface{}

	fs := &fakeStore{
		getAuditLog: func(filters map[string]interface{}, limit, offset int) ([]*models.AdminAuditLog, int, error) {
			capturedFilters = filters
			return nil, 0, nil
		},
	}
	h := &Handler{Store: fs}

	req := httptest.NewRequest(http.MethodGet, "/api/super-admin/audit-log?target_id=not-a-uuid", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := h.GetAuditLog(c); err != nil {
		t.Fatalf("GetAuditLog returned error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 (invalid target_id must be ignored, not rejected), got %d", rec.Code)
	}
	if _, ok := capturedFilters["target_id"]; ok {
		t.Fatalf("expected no target_id key when param is invalid, got %#v", capturedFilters)
	}
}

func TestUpdateTenantSubscription_ReasonRequired(t *testing.T) {
	e := echo.New()
	tenantID := uuid.New()
	subID := uuid.New()

	fs := &fakeStore{
		getSubscriptionByTenantID: func(id uuid.UUID) (*models.Subscription, error) {
			return &models.Subscription{ID: subID, TenantID: tenantID, Status: "active"}, nil
		},
	}
	h := &Handler{Store: fs}

	body, _ := json.Marshal(map[string]string{"status": "active"})
	req := httptest.NewRequest(http.MethodPatch, "/api/super-admin/tenants/"+tenantID.String()+"/subscription", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(tenantID.String())

	if err := h.UpdateTenantSubscription(c); err != nil {
		t.Fatalf("UpdateTenantSubscription returned error: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 when reason is missing, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestUpdateTenantSubscription_LogsTenantTargetedWithReason(t *testing.T) {
	e := echo.New()
	tenantID := uuid.New()
	adminID := uuid.New()
	subID := uuid.New()
	var capturedTargetType string
	var capturedTargetID uuid.UUID
	var capturedChanges map[string]interface{}

	fs := &fakeStore{
		getSubscriptionByTenantID: func(id uuid.UUID) (*models.Subscription, error) {
			return &models.Subscription{ID: subID, TenantID: tenantID, Status: "trial"}, nil
		},
		updateSubscription: func(sub *models.Subscription) error { return nil },
		logAdminAction: func(_ uuid.UUID, _ string, targetType string, targetID uuid.UUID, changes interface{}, _, _ string) error {
			capturedTargetType = targetType
			capturedTargetID = targetID
			capturedChanges = changes.(map[string]interface{})
			return nil
		},
	}
	h := &Handler{Store: fs}

	body, _ := json.Marshal(map[string]string{"status": "active", "reason": "invoice #1042 paid"})
	req := httptest.NewRequest(http.MethodPatch, "/api/super-admin/tenants/"+tenantID.String()+"/subscription", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(tenantID.String())
	c.Set("user", &models.JWTCustomClaims{UserID: adminID.String(), TenantID: uuid.New().String(), Role: "admin"})

	if err := h.UpdateTenantSubscription(c); err != nil {
		t.Fatalf("UpdateTenantSubscription returned error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if capturedTargetType != "tenant" {
		t.Fatalf("expected target_type=tenant, got %q", capturedTargetType)
	}
	if capturedTargetID != tenantID {
		t.Fatalf("expected target_id=%v (tenant), got %v", tenantID, capturedTargetID)
	}
	if capturedChanges["reason"] != "invoice #1042 paid" {
		t.Fatalf("expected reason in audit changes, got %#v", capturedChanges)
	}
	if capturedChanges["old"] == nil || capturedChanges["new"] == nil {
		t.Fatalf("expected old/new diff preserved alongside reason, got %#v", capturedChanges)
	}
}

func TestImpersonateTenant_ReasonRequired(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret")
	e := echo.New()
	tenantID := uuid.New()

	fs := &fakeStore{
		getTenantStatus: func(id uuid.UUID) (string, error) { return "active", nil },
		logAdminAction: func(audID uuid.UUID, action, targetType string, targetID uuid.UUID, changes interface{}, ip, userAgent string) error {
			return nil
		},
	}
	h := &Handler{Store: fs}

	req := httptest.NewRequest(http.MethodPost, "/api/super-admin/tenants/"+tenantID.String()+"/impersonate", bytes.NewReader([]byte(`{}`)))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(tenantID.String())
	c.Set("user", &models.JWTCustomClaims{UserID: uuid.New().String(), TenantID: uuid.New().String(), Role: "admin"})

	if err := h.ImpersonateTenant(c); err != nil {
		t.Fatalf("ImpersonateTenant returned error: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 when reason is missing, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestImpersonateTenant_MalformedBodyReturnsInvalidRequest(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret")
	e := echo.New()
	tenantID := uuid.New()

	fs := &fakeStore{}
	h := &Handler{Store: fs}

	req := httptest.NewRequest(http.MethodPost, "/api/super-admin/tenants/"+tenantID.String()+"/impersonate", bytes.NewReader([]byte(`{not valid json`)))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(tenantID.String())
	c.Set("user", &models.JWTCustomClaims{UserID: uuid.New().String(), TenantID: uuid.New().String(), Role: "admin"})

	if err := h.ImpersonateTenant(c); err != nil {
		t.Fatalf("ImpersonateTenant returned error: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for malformed JSON body, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "Invalid request") {
		t.Fatalf("expected 'Invalid request' error for malformed body, got: %s", rec.Body.String())
	}
}
