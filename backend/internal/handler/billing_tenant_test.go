package handler

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"idento/backend/internal/models"
	"idento/backend/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// clearBillingSellerEnv sets every BILLING_SELLER_* var to "" so
// config.Seller() reports Configured=false regardless of the surrounding
// environment (t.Setenv restores the previous value after the test).
func clearBillingSellerEnv(t *testing.T) {
	t.Helper()
	for _, k := range []string{
		"BILLING_SELLER_NAME",
		"BILLING_SELLER_INN",
		"BILLING_SELLER_BANK_NAME",
		"BILLING_SELLER_BANK_ACCOUNT",
		"BILLING_SELLER_BANK_BIK",
		"BILLING_SELLER_BANK_CORR_ACCOUNT",
	} {
		t.Setenv(k, "")
	}
}

// setBillingSellerEnv configures every required BILLING_SELLER_* var so
// config.Seller() reports Configured=true.
func setBillingSellerEnv(t *testing.T) {
	t.Helper()
	t.Setenv("BILLING_SELLER_NAME", "OOO Idento")
	// Deliberately distinct from the "7700000000" buyer INN used throughout
	// this file's fixtures, so seller-INN assertions can't pass by
	// accidentally matching the buyer INN instead.
	t.Setenv("BILLING_SELLER_INN", "771234567890")
	t.Setenv("BILLING_SELLER_BANK_NAME", "Bank")
	t.Setenv("BILLING_SELLER_BANK_ACCOUNT", "40702810000000000001")
	t.Setenv("BILLING_SELLER_BANK_BIK", "044525225")
	t.Setenv("BILLING_SELLER_BANK_CORR_ACCOUNT", "30101810000000000001")
}

// TestBillingEndpoints_NonAdminForbidden verifies every billing endpoint's
// shared requireTenantAdminForBilling guard rejects non-admin roles with
// the brief's exact 403 error string, before touching the store.
func TestBillingEndpoints_NonAdminForbidden(t *testing.T) {
	clearBillingSellerEnv(t)
	tenantID := uuid.New()
	invoiceID := uuid.New()

	cases := []struct {
		name   string
		method string
		path   string
		body   string
		setup  func(c echo.Context)
		call   func(h *Handler, c echo.Context) error
	}{
		{
			name:   "GetBillingProfile",
			method: http.MethodGet,
			path:   "/api/billing/profile",
			call:   func(h *Handler, c echo.Context) error { return h.GetBillingProfile(c) },
		},
		{
			name:   "PutBillingProfile",
			method: http.MethodPut,
			path:   "/api/billing/profile",
			body:   `{"legal_name":"Acme","inn":"7700000000","legal_address":"Addr"}`,
			call:   func(h *Handler, c echo.Context) error { return h.PutBillingProfile(c) },
		},
		{
			name:   "GetBillingCatalog",
			method: http.MethodGet,
			path:   "/api/billing/catalog",
			call:   func(h *Handler, c echo.Context) error { return h.GetBillingCatalog(c) },
		},
		{
			name:   "GetTenantInvoices",
			method: http.MethodGet,
			path:   "/api/billing/invoices",
			call:   func(h *Handler, c echo.Context) error { return h.GetTenantInvoices(c) },
		},
		{
			name:   "CreateTenantInvoice",
			method: http.MethodPost,
			path:   "/api/billing/invoices",
			body:   `{"lines":[{"catalog_item_id":"` + uuid.New().String() + `","quantity":1}]}`,
			call:   func(h *Handler, c echo.Context) error { return h.CreateTenantInvoice(c) },
		},
		{
			name:   "GetTenantInvoice",
			method: http.MethodGet,
			path:   "/api/billing/invoices/" + invoiceID.String(),
			setup: func(c echo.Context) {
				c.SetParamNames("id")
				c.SetParamValues(invoiceID.String())
			},
			call: func(h *Handler, c echo.Context) error { return h.GetTenantInvoice(c) },
		},
		{
			name:   "GetBillingSubscription",
			method: http.MethodGet,
			path:   "/api/billing/subscription",
			call:   func(h *Handler, c echo.Context) error { return h.GetBillingSubscription(c) },
		},
	}

	for _, role := range []string{"manager", "staff"} {
		for _, tc := range cases {
			t.Run(tc.name+"/"+role, func(t *testing.T) {
				h := &Handler{Store: &fakeStore{}}
				e := echo.New()
				c, rec := newAuthedContext(e, tc.method, tc.path, tc.body, tenantID.String(), role)
				if tc.setup != nil {
					tc.setup(c)
				}
				_ = tc.call(h, c)
				if rec.Code != http.StatusForbidden {
					t.Fatalf("expected 403, got %d: %s", rec.Code, rec.Body.String())
				}
				var body map[string]string
				if err := jsonUnmarshalBody(rec, &body); err != nil {
					t.Fatalf("unmarshal response: %v", err)
				}
				if body["error"] != "Billing requires the admin role" {
					t.Fatalf("expected error %q, got %q", "Billing requires the admin role", body["error"])
				}
			})
		}
	}
}

func TestGetBillingProfile_NotSet(t *testing.T) {
	tenantID := uuid.New()
	fs := &fakeStore{
		getTenantBillingProfile: func(id uuid.UUID) (*models.TenantBillingProfile, error) {
			return nil, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/api/billing/profile", "", tenantID.String(), "admin")
	_ = h.GetBillingProfile(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", rec.Code, rec.Body.String())
	}
	var body map[string]string
	_ = jsonUnmarshalBody(rec, &body)
	if body["error"] != "Billing profile is not set" {
		t.Fatalf("unexpected error message: %q", body["error"])
	}
}

func TestGetBillingProfile_Found(t *testing.T) {
	tenantID := uuid.New()
	profile := &models.TenantBillingProfile{TenantID: tenantID, LegalName: "Acme", INN: "7700000000", LegalAddress: "Addr"}
	fs := &fakeStore{
		getTenantBillingProfile: func(id uuid.UUID) (*models.TenantBillingProfile, error) {
			return profile, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/api/billing/profile", "", tenantID.String(), "admin")
	if err := h.GetBillingProfile(c); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestPutBillingProfile_RejectsBadINN(t *testing.T) {
	tenantID := uuid.New()
	called := false
	fs := &fakeStore{
		upsertTenantBillingProfile: func(p *models.TenantBillingProfile) error {
			called = true
			return nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	body := `{"legal_name":"Acme","inn":"12345678901","legal_address":"Addr"}` // 11 digits
	c, rec := newAuthedContext(e, http.MethodPut, "/api/billing/profile", body, tenantID.String(), "admin")
	_ = h.PutBillingProfile(c)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
	var respBody map[string]string
	_ = jsonUnmarshalBody(rec, &respBody)
	if respBody["error"] != "inn must be 10 or 12 digits" {
		t.Fatalf("unexpected error message: %q", respBody["error"])
	}
	if called {
		t.Fatal("expected upsert not to be called on validation failure")
	}
}

func TestPutBillingProfile_AcceptsTenDigitINN(t *testing.T) {
	tenantID := uuid.New()
	var upserted *models.TenantBillingProfile
	fs := &fakeStore{
		upsertTenantBillingProfile: func(p *models.TenantBillingProfile) error {
			upserted = p
			return nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	body := `{"legal_name":"Acme","inn":"7700000000","legal_address":"Addr"}`
	c, rec := newAuthedContext(e, http.MethodPut, "/api/billing/profile", body, tenantID.String(), "admin")
	if err := h.PutBillingProfile(c); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if upserted == nil {
		t.Fatal("expected upsert to be called")
	}
	if upserted.TenantID != tenantID {
		t.Fatalf("expected tenant %s, got %s", tenantID, upserted.TenantID)
	}
}

func TestPutBillingProfile_RejectsBlankLegalName(t *testing.T) {
	tenantID := uuid.New()
	h := &Handler{Store: &fakeStore{}}
	e := echo.New()
	body := `{"legal_name":"   ","inn":"7700000000","legal_address":"Addr"}`
	c, rec := newAuthedContext(e, http.MethodPut, "/api/billing/profile", body, tenantID.String(), "admin")
	_ = h.PutBillingProfile(c)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestPutBillingProfile_RejectsBadKPP(t *testing.T) {
	tenantID := uuid.New()
	h := &Handler{Store: &fakeStore{}}
	e := echo.New()
	body := `{"legal_name":"Acme","inn":"7700000000","kpp":"12345","legal_address":"Addr"}`
	c, rec := newAuthedContext(e, http.MethodPut, "/api/billing/profile", body, tenantID.String(), "admin")
	_ = h.PutBillingProfile(c)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestGetBillingCatalog_ReturnsPublicOnly(t *testing.T) {
	tenantID := uuid.New()
	var gotPublicOnly bool
	fs := &fakeStore{
		getCatalogItems: func(publicOnly bool) ([]*models.BillingCatalogItem, error) {
			gotPublicOnly = publicOnly
			return []*models.BillingCatalogItem{{ID: uuid.New(), Name: "Plan"}}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/api/billing/catalog", "", tenantID.String(), "admin")
	if err := h.GetBillingCatalog(c); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if !gotPublicOnly {
		t.Fatal("expected GetCatalogItems to be called with publicOnly=true")
	}
}

func TestCreateTenantInvoice_UnconfiguredSeller(t *testing.T) {
	clearBillingSellerEnv(t)
	tenantID := uuid.New()
	h := &Handler{Store: &fakeStore{}}
	e := echo.New()
	body := `{"lines":[{"catalog_item_id":"` + uuid.New().String() + `","quantity":1}]}`
	c, rec := newAuthedContext(e, http.MethodPost, "/api/billing/invoices", body, tenantID.String(), "admin")
	_ = h.CreateTenantInvoice(c)
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", rec.Code, rec.Body.String())
	}
	var respBody map[string]string
	_ = jsonUnmarshalBody(rec, &respBody)
	if respBody["error"] != "Seller requisites are not configured" {
		t.Fatalf("unexpected error message: %q", respBody["error"])
	}
}

func TestCreateTenantInvoice_NoProfile(t *testing.T) {
	setBillingSellerEnv(t)
	tenantID := uuid.New()
	fs := &fakeStore{
		getTenantBillingProfile: func(id uuid.UUID) (*models.TenantBillingProfile, error) {
			return nil, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	body := `{"lines":[{"catalog_item_id":"` + uuid.New().String() + `","quantity":1}]}`
	c, rec := newAuthedContext(e, http.MethodPost, "/api/billing/invoices", body, tenantID.String(), "admin")
	_ = h.CreateTenantInvoice(c)
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", rec.Code, rec.Body.String())
	}
	var respBody map[string]string
	_ = jsonUnmarshalBody(rec, &respBody)
	if respBody["error"] != "Billing profile is required before requesting an invoice" {
		t.Fatalf("unexpected error message: %q", respBody["error"])
	}
}

func TestCreateTenantInvoice_InactiveItem(t *testing.T) {
	setBillingSellerEnv(t)
	tenantID := uuid.New()
	profile := &models.TenantBillingProfile{TenantID: tenantID, LegalName: "Acme", INN: "7700000000", LegalAddress: "Addr"}
	itemID := uuid.New()
	fs := &fakeStore{
		getTenantBillingProfile: func(id uuid.UUID) (*models.TenantBillingProfile, error) {
			return profile, nil
		},
		getCatalogItemByID: func(id uuid.UUID) (*models.BillingCatalogItem, error) {
			return &models.BillingCatalogItem{ID: itemID, Name: "Plan", Price: 100, IsActive: false, IsPublic: true}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	body := `{"lines":[{"catalog_item_id":"` + itemID.String() + `","quantity":1}]}`
	c, rec := newAuthedContext(e, http.MethodPost, "/api/billing/invoices", body, tenantID.String(), "admin")
	_ = h.CreateTenantInvoice(c)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
	var respBody map[string]string
	_ = jsonUnmarshalBody(rec, &respBody)
	if respBody["error"] != "Unknown or unavailable catalog item" {
		t.Fatalf("unexpected error message: %q", respBody["error"])
	}
}

func TestCreateTenantInvoice_TooManyLines(t *testing.T) {
	setBillingSellerEnv(t)
	tenantID := uuid.New()
	profile := &models.TenantBillingProfile{TenantID: tenantID, LegalName: "Acme", INN: "7700000000", LegalAddress: "Addr"}
	itemID := uuid.New()
	getCatalogItemCalls := 0
	fs := &fakeStore{
		getTenantBillingProfile: func(id uuid.UUID) (*models.TenantBillingProfile, error) {
			return profile, nil
		},
		getCatalogItemByID: func(id uuid.UUID) (*models.BillingCatalogItem, error) {
			getCatalogItemCalls++
			return &models.BillingCatalogItem{ID: itemID, Name: "Plan", Price: 100, IsActive: true, IsPublic: true}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	var linesJSON strings.Builder
	for i := 0; i < 51; i++ {
		if i > 0 {
			linesJSON.WriteString(",")
		}
		linesJSON.WriteString(`{"catalog_item_id":"` + itemID.String() + `","quantity":1}`)
	}
	body := `{"lines":[` + linesJSON.String() + `]}`
	c, rec := newAuthedContext(e, http.MethodPost, "/api/billing/invoices", body, tenantID.String(), "admin")
	_ = h.CreateTenantInvoice(c)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
	var respBody map[string]string
	_ = jsonUnmarshalBody(rec, &respBody)
	if respBody["error"] != "an invoice can have at most 50 lines" {
		t.Fatalf("unexpected error message: %q", respBody["error"])
	}
	if getCatalogItemCalls != 0 {
		t.Fatalf("expected the line cap to reject before any catalog lookups, got %d calls", getCatalogItemCalls)
	}
}

func TestCreateTenantInvoice_HappyPath(t *testing.T) {
	setBillingSellerEnv(t)
	tenantID := uuid.New()
	userID := uuid.New()
	profile := &models.TenantBillingProfile{TenantID: tenantID, LegalName: "Acme", INN: "7700000000", LegalAddress: "Addr"}
	item1 := uuid.New()
	item2 := uuid.New()
	activation := "on_payment"
	catalog := map[uuid.UUID]*models.BillingCatalogItem{
		item1: {ID: item1, Kind: "plan", Name: "Pro", Price: 1000, IsActive: true, IsPublic: true, DefaultActivation: &activation},
		item2: {ID: item2, Kind: "addon", Name: "Extra users", Price: 250.5, IsActive: true, IsPublic: true},
	}

	var createdInv *models.Invoice
	var createdLines []*models.InvoiceLine
	var gotAction, gotTargetType string
	var gotAdminID, gotTargetID uuid.UUID
	var gotChanges interface{}
	fs := &fakeStore{
		getTenantBillingProfile: func(id uuid.UUID) (*models.TenantBillingProfile, error) {
			return profile, nil
		},
		getCatalogItemByID: func(id uuid.UUID) (*models.BillingCatalogItem, error) {
			return catalog[id], nil
		},
		createInvoice: func(inv *models.Invoice, lines []*models.InvoiceLine) error {
			createdInv = inv
			createdLines = lines
			inv.ID = uuid.New()
			inv.Number = "СЧ-2026-0001"
			return nil
		},
		logAdminAction: func(adminID uuid.UUID, action, targetType string, targetID uuid.UUID, changes interface{}, ip, userAgent string) error {
			gotAdminID = adminID
			gotAction = action
			gotTargetType = targetType
			gotTargetID = targetID
			gotChanges = changes
			return nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	body := `{"lines":[
		{"catalog_item_id":"` + item1.String() + `","quantity":1},
		{"catalog_item_id":"` + item2.String() + `","quantity":3}
	],"comment":"please issue"}`
	c, rec := newAuthedContextWithUserID(e, http.MethodPost, "/api/billing/invoices", body, tenantID.String(), userID, "admin")
	if err := h.CreateTenantInvoice(c); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	if createdInv == nil {
		t.Fatal("expected CreateInvoice to be called")
	}
	if createdInv.TenantID != tenantID {
		t.Fatalf("expected tenant %s, got %s", tenantID, createdInv.TenantID)
	}
	if createdInv.BuyerName != "Acme" || createdInv.BuyerINN != "7700000000" || createdInv.BuyerAddress != "Addr" {
		t.Fatalf("buyer snapshot not filled from profile: %+v", createdInv)
	}
	if createdInv.SellerName != "OOO Idento" || createdInv.SellerINN != "771234567890" {
		t.Fatalf("seller snapshot not filled from config: %+v", createdInv)
	}
	if createdInv.CreatedBy == nil || *createdInv.CreatedBy != userID {
		t.Fatalf("expected CreatedBy %s, got %v", userID, createdInv.CreatedBy)
	}
	wantTotal := 1000.0 + 250.5*3
	if createdInv.Total != wantTotal {
		t.Fatalf("expected total %v, got %v", wantTotal, createdInv.Total)
	}
	if len(createdLines) != 2 {
		t.Fatalf("expected 2 lines, got %d", len(createdLines))
	}
	if createdLines[0].Position != 1 || createdLines[1].Position != 2 {
		t.Fatalf("expected 1-based positions, got %d, %d", createdLines[0].Position, createdLines[1].Position)
	}
	if createdLines[0].Amount != 1000.0 {
		t.Fatalf("expected line1 amount 1000, got %v", createdLines[0].Amount)
	}
	if createdLines[0].Activation == nil || *createdLines[0].Activation != "on_payment" {
		t.Fatalf("expected activation copied from catalog item, got %v", createdLines[0].Activation)
	}
	if createdLines[1].Amount != 751.5 {
		t.Fatalf("expected line2 amount 751.5, got %v", createdLines[1].Amount)
	}

	var respBody map[string]interface{}
	if err := jsonUnmarshalBody(rec, &respBody); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	twStr, _ := respBody["total_in_words"].(string)
	if twStr == "" {
		t.Fatal("expected non-empty total_in_words in response")
	}

	if gotAction != "create_invoice_self_service" {
		t.Errorf("audit action=%q; want create_invoice_self_service", gotAction)
	}
	if gotTargetType != "invoice" {
		t.Errorf("audit target_type=%q; want invoice", gotTargetType)
	}
	if gotTargetID != createdInv.ID {
		t.Errorf("audit target_id=%v; want %v", gotTargetID, createdInv.ID)
	}
	if gotAdminID != userID {
		t.Errorf("audit admin_id=%v; want %v (the acting tenant admin)", gotAdminID, userID)
	}
	changes, ok := gotChanges.(map[string]interface{})
	if !ok {
		t.Fatalf("audit changes not map[string]interface{}: %T", gotChanges)
	}
	if changes["number"] != createdInv.Number {
		t.Errorf("audit changes[number]=%v; want %v", changes["number"], createdInv.Number)
	}
	if changes["tenant_id"] != tenantID {
		t.Errorf("audit changes[tenant_id]=%v; want %v", changes["tenant_id"], tenantID)
	}
	if changes["total"] != createdInv.Total {
		t.Errorf("audit changes[total]=%v; want %v", changes["total"], createdInv.Total)
	}
}

// --- GetBillingSubscription ---

func TestGetBillingSubscription_NoSubscription_404(t *testing.T) {
	tenantID := uuid.New()
	fs := &fakeStore{
		getSubscriptionByTenantID: func(id uuid.UUID) (*models.Subscription, error) {
			return nil, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/api/billing/subscription", "", tenantID.String(), "admin")
	_ = h.GetBillingSubscription(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", rec.Code, rec.Body.String())
	}
	var respBody map[string]string
	_ = jsonUnmarshalBody(rec, &respBody)
	if respBody["error"] != "No subscription" {
		t.Fatalf("unexpected error message: %q", respBody["error"])
	}
}

func TestGetBillingSubscription_HappyPath(t *testing.T) {
	tenantID := uuid.New()
	startDate := time.Now().Add(-24 * time.Hour)
	endDate := time.Now().Add(30 * 24 * time.Hour)
	sub := &models.Subscription{
		TenantID:  tenantID,
		Status:    "active",
		StartDate: startDate,
		EndDate:   &endDate,
		Plan:      &models.SubscriptionPlan{Name: "Pro", Slug: "pro"},
	}
	boosts := []*models.LimitBoost{
		{ID: uuid.New(), TenantID: tenantID, LimitKey: "attendees_per_event", Delta: 500, ValidUntil: endDate},
	}
	fs := &fakeStore{
		getSubscriptionByTenantID: func(id uuid.UUID) (*models.Subscription, error) {
			if id != tenantID {
				t.Fatalf("unexpected tenant id %v", id)
			}
			return sub, nil
		},
		getActiveLimitBoosts: func(id uuid.UUID) ([]*models.LimitBoost, error) {
			return boosts, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/api/billing/subscription", "", tenantID.String(), "admin")
	if err := h.GetBillingSubscription(c); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp billingSubscriptionResponse
	if err := jsonUnmarshalBody(rec, &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.PlanName == nil || *resp.PlanName != "Pro" {
		t.Fatalf("plan_name=%v; want Pro", resp.PlanName)
	}
	if resp.PlanSlug == nil || *resp.PlanSlug != "pro" {
		t.Fatalf("plan_slug=%v; want pro", resp.PlanSlug)
	}
	if resp.Status != "active" {
		t.Fatalf("status=%q; want active", resp.Status)
	}
	if len(resp.ActiveBoosts) != 1 || resp.ActiveBoosts[0].LimitKey != "attendees_per_event" {
		t.Fatalf("active_boosts=%+v; want 1 boost with limit_key attendees_per_event", resp.ActiveBoosts)
	}
}

// TestGetBillingSubscription_EmptyBoostsIsEmptyArray pins that
// active_boosts serializes as [] rather than null when the tenant has no
// active boosts (GetActiveLimitBoosts returns an empty, non-nil slice in
// production, but a fake/mocked store could return nil — the handler must
// normalize either shape to []).
func TestGetBillingSubscription_EmptyBoostsIsEmptyArray(t *testing.T) {
	tenantID := uuid.New()
	sub := &models.Subscription{TenantID: tenantID, Status: "trial", StartDate: time.Now()}
	fs := &fakeStore{
		getSubscriptionByTenantID: func(id uuid.UUID) (*models.Subscription, error) {
			return sub, nil
		},
		getActiveLimitBoosts: func(id uuid.UUID) ([]*models.LimitBoost, error) {
			return nil, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/api/billing/subscription", "", tenantID.String(), "admin")
	if err := h.GetBillingSubscription(c); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"active_boosts":[]`) {
		t.Fatalf("expected active_boosts to serialize as [], got body=%s", rec.Body.String())
	}
	if resp := rec.Body.String(); resp == "" {
		t.Fatal("empty response body")
	}
}

func TestGetTenantInvoices_ScopesToTenant(t *testing.T) {
	tenantID := uuid.New()
	var gotFilter store.InvoiceFilter
	fs := &fakeStore{
		listInvoices: func(f store.InvoiceFilter) ([]*models.Invoice, error) {
			gotFilter = f
			return []*models.Invoice{}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/api/billing/invoices", "", tenantID.String(), "admin")
	if err := h.GetTenantInvoices(c); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if gotFilter.TenantID == nil || *gotFilter.TenantID != tenantID {
		t.Fatalf("expected filter scoped to tenant %s, got %+v", tenantID, gotFilter)
	}
}

func TestGetTenantInvoice_OtherTenantIs404(t *testing.T) {
	tenantID := uuid.New()
	otherTenantID := uuid.New()
	invoiceID := uuid.New()
	fs := &fakeStore{
		getInvoiceByID: func(id uuid.UUID) (*models.Invoice, error) {
			return &models.Invoice{ID: invoiceID, TenantID: otherTenantID, Total: 100}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/api/billing/invoices/"+invoiceID.String(), "", tenantID.String(), "admin")
	c.SetParamNames("id")
	c.SetParamValues(invoiceID.String())
	_ = h.GetTenantInvoice(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestGetTenantInvoice_Found(t *testing.T) {
	tenantID := uuid.New()
	invoiceID := uuid.New()
	fs := &fakeStore{
		getInvoiceByID: func(id uuid.UUID) (*models.Invoice, error) {
			return &models.Invoice{ID: invoiceID, TenantID: tenantID, Total: 100}, nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/api/billing/invoices/"+invoiceID.String(), "", tenantID.String(), "admin")
	c.SetParamNames("id")
	c.SetParamValues(invoiceID.String())
	if err := h.GetTenantInvoice(c); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var respBody map[string]interface{}
	_ = jsonUnmarshalBody(rec, &respBody)
	twStr, _ := respBody["total_in_words"].(string)
	if twStr == "" {
		t.Fatal("expected non-empty total_in_words")
	}
}
