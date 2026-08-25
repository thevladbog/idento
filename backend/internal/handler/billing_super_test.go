package handler

import (
	"net/http"
	"testing"
	"time"

	"idento/backend/internal/models"
	"idento/backend/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// --- Catalog kind-validation 400s (CreateCatalogItemSuper) ---

func TestCatalogSuperCreate_ServiceWithPlanID_400(t *testing.T) {
	e := echo.New()
	h := &Handler{Store: &fakeStore{}}
	planID := uuid.New().String()
	body := `{"kind":"service","name":"Onboarding","price":10,"plan_id":"` + planID + `"}`
	c, rec := newAuthedContext(e, http.MethodPost, "/x", body, uuid.New().String(), "admin")
	if err := h.CreateCatalogItemSuper(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s; want 400", rec.Code, rec.Body.String())
	}
}

func TestCatalogSuperCreate_AddonWithoutLimitKey_400(t *testing.T) {
	e := echo.New()
	h := &Handler{Store: &fakeStore{}}
	body := `{"kind":"addon","name":"Boost","price":5,"limit_delta":10,"validity":"until_period_end"}`
	c, rec := newAuthedContext(e, http.MethodPost, "/x", body, uuid.New().String(), "admin")
	if err := h.CreateCatalogItemSuper(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s; want 400", rec.Code, rec.Body.String())
	}
}

func TestCatalogSuperCreate_FixedDaysWithoutValidityDays_400(t *testing.T) {
	e := echo.New()
	h := &Handler{Store: &fakeStore{}}
	body := `{"kind":"addon","name":"Boost","price":5,"limit_key":"users","limit_delta":10,"validity":"fixed_days"}`
	c, rec := newAuthedContext(e, http.MethodPost, "/x", body, uuid.New().String(), "admin")
	if err := h.CreateCatalogItemSuper(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s; want 400", rec.Code, rec.Body.String())
	}
}

func TestCatalogSuperCreate_VATRateZero_400(t *testing.T) {
	e := echo.New()
	h := &Handler{Store: &fakeStore{}}
	body := `{"kind":"service","name":"Onboarding","price":10,"vat_rate":0}`
	c, rec := newAuthedContext(e, http.MethodPost, "/x", body, uuid.New().String(), "admin")
	if err := h.CreateCatalogItemSuper(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s; want 400", rec.Code, rec.Body.String())
	}
}

func TestCatalogSuperCreate_ValidAddon_Created(t *testing.T) {
	e := echo.New()
	var gotAction string
	fs := &fakeStore{
		createCatalogItem: func(item *models.BillingCatalogItem) error {
			item.ID = uuid.New()
			item.CreatedAt = time.Now()
			item.UpdatedAt = time.Now()
			return nil
		},
		logAdminAction: func(adminID uuid.UUID, action, targetType string, targetID uuid.UUID, changes interface{}, ip, userAgent string) error {
			gotAction = action
			return nil
		},
	}
	h := &Handler{Store: fs}
	body := `{"kind":"addon","name":"Boost","price":5,"limit_key":"users","limit_delta":10,"validity":"fixed_days","validity_days":30}`
	c, rec := newAuthedContext(e, http.MethodPost, "/x", body, uuid.New().String(), "admin")
	if err := h.CreateCatalogItemSuper(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s; want 201", rec.Code, rec.Body.String())
	}
	if gotAction != "create_catalog_item" {
		t.Errorf("audit action=%q; want create_catalog_item", gotAction)
	}
}

// --- UpdateCatalogItemSuper ---

func TestCatalogSuperUpdate_UnknownID_404(t *testing.T) {
	e := echo.New()
	fs := &fakeStore{
		getCatalogItemByID: func(id uuid.UUID) (*models.BillingCatalogItem, error) {
			return nil, nil
		},
	}
	h := &Handler{Store: fs}
	body := `{"kind":"service","name":"Onboarding","price":10}`
	c, rec := newAuthedContext(e, http.MethodPut, "/x", body, uuid.New().String(), "admin")
	c.SetParamNames("id")
	c.SetParamValues(uuid.New().String())
	if err := h.UpdateCatalogItemSuper(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status=%d body=%s; want 404", rec.Code, rec.Body.String())
	}
}

// TestCatalogSuperUpdate_HappyPath_PreservesCreatedAt covers the bug found in
// review of 23a6dc4: the handler binds `item` from the PUT body (whose
// created_at is always the zero value — clients don't send it), loads `old`
// for the 404 check/audit diff, but never copied old.CreatedAt onto item
// before persisting/echoing it back. UpdateCatalogItem's RETURNING only
// refreshes UpdatedAt, so the 200 response echoed a zeroed created_at.
func TestCatalogSuperUpdate_HappyPath_PreservesCreatedAt(t *testing.T) {
	e := echo.New()
	id := uuid.New()
	oldCreatedAt := time.Now().Add(-72 * time.Hour).Truncate(time.Second)
	oldItem := &models.BillingCatalogItem{
		ID:        id,
		Kind:      "service",
		Name:      "Onboarding",
		Price:     10,
		CreatedAt: oldCreatedAt,
		UpdatedAt: oldCreatedAt,
	}
	var gotAction string
	var gotChanges interface{}
	fs := &fakeStore{
		getCatalogItemByID: func(gotID uuid.UUID) (*models.BillingCatalogItem, error) {
			if gotID != id {
				t.Fatalf("unexpected id %v", gotID)
			}
			return oldItem, nil
		},
		updateCatalogItem: func(item *models.BillingCatalogItem) error {
			item.UpdatedAt = time.Now()
			return nil
		},
		logAdminAction: func(adminID uuid.UUID, action, targetType string, targetID uuid.UUID, changes interface{}, ip, userAgent string) error {
			gotAction = action
			gotChanges = changes
			return nil
		},
	}
	h := &Handler{Store: fs}
	body := `{"kind":"service","name":"Onboarding","price":15}`
	c, rec := newAuthedContext(e, http.MethodPut, "/x", body, uuid.New().String(), "admin")
	c.SetParamNames("id")
	c.SetParamValues(id.String())
	if err := h.UpdateCatalogItemSuper(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s; want 200", rec.Code, rec.Body.String())
	}
	var resp models.BillingCatalogItem
	if err := jsonUnmarshalBody(rec, &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.CreatedAt.IsZero() {
		t.Fatal("created_at is zero; want it preserved from the old item")
	}
	if !resp.CreatedAt.Equal(oldCreatedAt) {
		t.Errorf("created_at=%v; want %v (old item's CreatedAt)", resp.CreatedAt, oldCreatedAt)
	}
	if gotAction != "update_catalog_item" {
		t.Errorf("audit action=%q; want update_catalog_item", gotAction)
	}
	if gotChanges == nil {
		t.Error("audit changes missing")
	} else {
		m, ok := gotChanges.(map[string]interface{})
		if !ok {
			t.Fatalf("changes not map[string]interface{}: %T", gotChanges)
		}
		if _, ok := m["old"]; !ok {
			t.Error("changes missing old")
		}
		if _, ok := m["new"]; !ok {
			t.Error("changes missing new")
		}
	}
}

// --- MarkInvoicePaidSuper sentinel mappings ---

func TestMarkInvoicePaidSuper_NotFound(t *testing.T) {
	e := echo.New()
	fs := &fakeStore{
		applyInvoicePayment: func(id uuid.UUID, now time.Time) (*models.Invoice, []store.AppliedLineEffect, error) {
			return nil, nil, store.ErrInvoiceNotFound
		},
	}
	h := &Handler{Store: fs}
	c, rec := newAuthedContext(e, http.MethodPost, "/x", "{}", uuid.New().String(), "admin")
	c.SetParamNames("id")
	c.SetParamValues(uuid.New().String())
	if err := h.MarkInvoicePaidSuper(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status=%d body=%s; want 404", rec.Code, rec.Body.String())
	}
}

func TestMarkInvoicePaidSuper_NotIssued_409ExactMessage(t *testing.T) {
	e := echo.New()
	fs := &fakeStore{
		applyInvoicePayment: func(id uuid.UUID, now time.Time) (*models.Invoice, []store.AppliedLineEffect, error) {
			return nil, nil, store.ErrInvoiceNotIssued
		},
	}
	h := &Handler{Store: fs}
	c, rec := newAuthedContext(e, http.MethodPost, "/x", "{}", uuid.New().String(), "admin")
	c.SetParamNames("id")
	c.SetParamValues(uuid.New().String())
	if err := h.MarkInvoicePaidSuper(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusConflict {
		t.Fatalf("status=%d body=%s; want 409", rec.Code, rec.Body.String())
	}
	var resp map[string]string
	if err := jsonUnmarshalBody(rec, &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	want := "invoice is not payable in its current status"
	if resp["error"] != want {
		t.Errorf("error=%q; want %q", resp["error"], want)
	}
}

func TestMarkInvoicePaidSuper_BoostNeedsEndDate_409ExactMessage(t *testing.T) {
	e := echo.New()
	fs := &fakeStore{
		applyInvoicePayment: func(id uuid.UUID, now time.Time) (*models.Invoice, []store.AppliedLineEffect, error) {
			return nil, nil, store.ErrBoostNeedsEndDate
		},
	}
	h := &Handler{Store: fs}
	c, rec := newAuthedContext(e, http.MethodPost, "/x", "{}", uuid.New().String(), "admin")
	c.SetParamNames("id")
	c.SetParamValues(uuid.New().String())
	if err := h.MarkInvoicePaidSuper(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusConflict {
		t.Fatalf("status=%d body=%s; want 409", rec.Code, rec.Body.String())
	}
	var resp map[string]string
	if err := jsonUnmarshalBody(rec, &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	want := "addon requires the subscription to have an end date — fix the subscription or use a fixed-days addon"
	if resp["error"] != want {
		t.Errorf("error=%q; want %q", resp["error"], want)
	}
}

func TestMarkInvoicePaidSuper_HappyPath_EffectsAndAudit(t *testing.T) {
	e := echo.New()
	invoiceID := uuid.New()
	tenantID := uuid.New()
	lineID := uuid.New()
	var gotAction, gotTargetType string
	var gotTargetID uuid.UUID
	var gotChanges interface{}
	fs := &fakeStore{
		applyInvoicePayment: func(id uuid.UUID, now time.Time) (*models.Invoice, []store.AppliedLineEffect, error) {
			return &models.Invoice{ID: id, Number: "СЧ-2026-0001", TenantID: tenantID, Status: "paid"},
				[]store.AppliedLineEffect{{LineID: lineID, Kind: "addon", Effect: "boost users +5 until 2026-12-01"}},
				nil
		},
		logAdminAction: func(adminID uuid.UUID, action, targetType string, targetID uuid.UUID, changes interface{}, ip, userAgent string) error {
			gotAction, gotTargetType, gotTargetID, gotChanges = action, targetType, targetID, changes
			return nil
		},
	}
	h := &Handler{Store: fs}
	c, rec := newAuthedContext(e, http.MethodPost, "/x", `{"reason":"bank confirmed"}`, uuid.New().String(), "admin")
	c.SetParamNames("id")
	c.SetParamValues(invoiceID.String())
	if err := h.MarkInvoicePaidSuper(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s; want 200", rec.Code, rec.Body.String())
	}
	var resp struct {
		Invoice models.Invoice            `json:"invoice"`
		Effects []store.AppliedLineEffect `json:"effects"`
	}
	if err := jsonUnmarshalBody(rec, &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Invoice.Status != "paid" || len(resp.Effects) != 1 || resp.Effects[0].LineID != lineID {
		t.Errorf("unexpected response: %+v", resp)
	}
	if gotAction != "invoice_paid" || gotTargetType != "invoice" || gotTargetID != invoiceID {
		t.Errorf("audit attribution wrong: action=%q targetType=%q targetID=%v", gotAction, gotTargetType, gotTargetID)
	}
	if gotChanges == nil {
		t.Error("audit changes missing")
	}
}

// --- CancelInvoiceSuper guard ---

func TestCancelInvoiceSuper_NotIssued_409(t *testing.T) {
	e := echo.New()
	fs := &fakeStore{
		cancelInvoice: func(id uuid.UUID) error { return store.ErrInvoiceNotIssued },
	}
	h := &Handler{Store: fs}
	c, rec := newAuthedContext(e, http.MethodPost, "/x", "", uuid.New().String(), "admin")
	c.SetParamNames("id")
	c.SetParamValues(uuid.New().String())
	if err := h.CancelInvoiceSuper(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusConflict {
		t.Fatalf("status=%d body=%s; want 409", rec.Code, rec.Body.String())
	}
}

func TestCancelInvoiceSuper_NotFound_404(t *testing.T) {
	e := echo.New()
	fs := &fakeStore{
		cancelInvoice: func(id uuid.UUID) error { return store.ErrInvoiceNotFound },
	}
	h := &Handler{Store: fs}
	c, rec := newAuthedContext(e, http.MethodPost, "/x", "", uuid.New().String(), "admin")
	c.SetParamNames("id")
	c.SetParamValues(uuid.New().String())
	if err := h.CancelInvoiceSuper(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status=%d body=%s; want 404", rec.Code, rec.Body.String())
	}
}

func TestCancelInvoiceSuper_HappyPath(t *testing.T) {
	e := echo.New()
	var gotAction string
	var gotChanges interface{}
	fs := &fakeStore{
		cancelInvoice: func(id uuid.UUID) error { return nil },
		logAdminAction: func(adminID uuid.UUID, action, targetType string, targetID uuid.UUID, changes interface{}, ip, userAgent string) error {
			gotAction = action
			gotChanges = changes
			return nil
		},
	}
	h := &Handler{Store: fs}
	c, rec := newAuthedContext(e, http.MethodPost, "/x", `{"reason":"дубль счёта"}`, uuid.New().String(), "admin")
	c.SetParamNames("id")
	c.SetParamValues(uuid.New().String())
	if err := h.CancelInvoiceSuper(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s; want 200", rec.Code, rec.Body.String())
	}
	if gotAction != "invoice_cancelled" {
		t.Errorf("audit action=%q; want invoice_cancelled", gotAction)
	}
	changesMap, ok := gotChanges.(map[string]interface{})
	if !ok || changesMap["reason"] != "дубль счёта" {
		t.Errorf("audit changes=%#v; want reason recorded", gotChanges)
	}
}

// --- GetTenantStats includes active_boosts ---

func TestGetTenantStatsSuper_IncludesActiveBoosts(t *testing.T) {
	e := echo.New()
	tenantID := uuid.New()
	boost := &models.LimitBoost{ID: uuid.New(), TenantID: tenantID, LimitKey: "users", Delta: 5, ValidUntil: time.Now().Add(24 * time.Hour)}
	fs := &fakeStore{
		getTenantStats: func(id uuid.UUID) (*models.TenantWithStats, error) {
			return &models.TenantWithStats{UsersCount: 3}, nil
		},
		getActiveLimitBoosts: func(id uuid.UUID) ([]*models.LimitBoost, error) {
			return []*models.LimitBoost{boost}, nil
		},
	}
	h := &Handler{Store: fs}
	c, rec := newAuthedContext(e, http.MethodGet, "/x", "", uuid.New().String(), "admin")
	c.SetParamNames("id")
	c.SetParamValues(tenantID.String())
	if err := h.GetTenantStats(c); err != nil {
		t.Fatalf("handler error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s; want 200", rec.Code, rec.Body.String())
	}
	var resp models.TenantWithStats
	if err := jsonUnmarshalBody(rec, &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.ActiveBoosts) != 1 || resp.ActiveBoosts[0].LimitKey != "users" {
		t.Errorf("active_boosts missing/wrong: %+v", resp.ActiveBoosts)
	}
}
