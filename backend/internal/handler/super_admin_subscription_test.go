package handler

import (
	"net/http"
	"testing"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func TestUpdateTenantSubscriptionCreatesWhenMissing(t *testing.T) {
	e := echo.New()
	tenantID := uuid.New()
	planID := uuid.New()

	var created *models.Subscription
	fs := &fakeStore{
		getSubscriptionByTenantID: func(id uuid.UUID) (*models.Subscription, error) { return nil, nil },
		upsertSubscription: func(sub *models.Subscription) error {
			created = sub
			return nil
		},
		logAdminAction: func(adminID uuid.UUID, action, targetType string, targetID uuid.UUID, changes interface{}) error {
			return nil
		},
	}
	h := &Handler{Store: fs}

	body := `{"plan_id":"` + planID.String() + `","status":"active"}`
	c, rec := newAuthedContext(e, http.MethodPatch, "/api/super-admin/tenants/"+tenantID.String()+"/subscription", body, uuid.New().String(), "admin")
	c.SetParamNames("id")
	c.SetParamValues(tenantID.String())

	if err := h.UpdateTenantSubscription(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", rec.Code, rec.Body.String())
	}
	if created == nil {
		t.Fatal("UpsertSubscription was not called for a tenant with no subscription")
	}
	if created.TenantID != tenantID || created.PlanID == nil || *created.PlanID != planID {
		t.Errorf("created subscription = %+v, want tenant %s plan %s", created, tenantID, planID)
	}
}

func TestUpdateTenantSubscriptionRequiresPlanWhenMissing(t *testing.T) {
	e := echo.New()
	fs := &fakeStore{
		getSubscriptionByTenantID: func(id uuid.UUID) (*models.Subscription, error) { return nil, nil },
	}
	h := &Handler{Store: fs}

	c, rec := newAuthedContext(e, http.MethodPatch, "/x", `{"status":"active"}`, uuid.New().String(), "admin")
	c.SetParamNames("id")
	c.SetParamValues(uuid.New().String())

	if err := h.UpdateTenantSubscription(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (no subscription and no plan_id); body: %s", rec.Code, rec.Body.String())
	}
}
