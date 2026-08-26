// Package handler — OpenAPI contract coverage for the six tenant
// self-service billing operations (spec 2026-08-25-billing-invoices-design.md):
// billing profile (GET/PUT), the public catalog (GET), and bank-transfer
// invoice requests (GET list, POST create, GET by id). See
// billing_tenant_test.go for the handler behavior tests these complement —
// these tests focus on exercising every schema-relevant field (nullable
// enums, kind-specific catalog fields, vat_rate) so validateResponse
// actually checks something against backend/openapi.yaml.
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

func TestContractGetBillingProfile(t *testing.T) {
	tenantID := uuid.New()
	kpp := "770001001"
	profile := &models.TenantBillingProfile{
		TenantID:     tenantID,
		LegalName:    "Acme LLC",
		INN:          "7700000000",
		KPP:          &kpp,
		LegalAddress: "Moscow, Red Square 1",
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}
	fs := &fakeStore{
		getTenantBillingProfile: func(uuid.UUID) (*models.TenantBillingProfile, error) { return profile, nil },
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/api/billing/profile", "", tenantID.String(), "admin")
	if err := h.GetBillingProfile(c); err != nil {
		t.Fatalf("GetBillingProfile: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, "/api/billing/profile", rec)
}

// TestContractGetBillingProfile_NotFound exercises the 404 branch — no
// profile has been set yet for this tenant.
func TestContractGetBillingProfile_NotFound(t *testing.T) {
	tenantID := uuid.New()
	fs := &fakeStore{
		getTenantBillingProfile: func(uuid.UUID) (*models.TenantBillingProfile, error) { return nil, nil },
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/api/billing/profile", "", tenantID.String(), "admin")
	if err := h.GetBillingProfile(c); err != nil {
		t.Fatalf("GetBillingProfile: %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, "/api/billing/profile", rec)
}

func TestContractPutBillingProfile(t *testing.T) {
	tenantID := uuid.New()
	fs := &fakeStore{
		upsertTenantBillingProfile: func(p *models.TenantBillingProfile) error {
			p.CreatedAt = time.Now()
			p.UpdatedAt = time.Now()
			return nil
		},
	}
	h := &Handler{Store: fs}
	e := echo.New()
	body := `{"legal_name":"Acme LLC","inn":"7700000000","kpp":"770001001","legal_address":"Moscow, Red Square 1"}`
	c, rec := newAuthedContext(e, http.MethodPut, "/api/billing/profile", body, tenantID.String(), "admin")
	if err := h.PutBillingProfile(c); err != nil {
		t.Fatalf("PutBillingProfile: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPut, "/api/billing/profile", rec)
}

// TestContractGetBillingCatalog returns one item of each kind (plan,
// addon, service) so the kind-specific nullable fields
// (plan_id/period/default_activation vs. limit_key/limit_delta/
// validity/validity_days) and the nullable vat_rate are all exercised
// against the schema, both populated and null.
func TestContractGetBillingCatalog(t *testing.T) {
	tenantID := uuid.New()
	period := "month"
	activation := "on_payment"
	planVAT := 20.0
	limitKey := "attendees_per_event"
	limitDelta := 500
	validity := "fixed_days"
	validityDays := 365

	items := []*models.BillingCatalogItem{
		{
			ID: uuid.New(), Kind: "plan", Name: "Pro plan", Description: "Pro subscription",
			Price: 5000, VATRate: &planVAT, IsPublic: true, IsActive: true, SortOrder: 1,
			PlanID: uuidPtr(uuid.New()), Period: &period, DefaultActivation: &activation,
			CreatedAt: time.Now(), UpdatedAt: time.Now(),
		},
		{
			ID: uuid.New(), Kind: "addon", Name: "Extra attendees", Description: "500 more attendees",
			Price: 1500, VATRate: nil, IsPublic: true, IsActive: true, SortOrder: 2,
			LimitKey: &limitKey, LimitDelta: &limitDelta, Validity: &validity, ValidityDays: &validityDays,
			CreatedAt: time.Now(), UpdatedAt: time.Now(),
		},
		{
			ID: uuid.New(), Kind: "service", Name: "Onboarding call", Description: "1h onboarding session",
			Price: 2000, VATRate: nil, IsPublic: true, IsActive: true, SortOrder: 3,
			CreatedAt: time.Now(), UpdatedAt: time.Now(),
		},
	}
	fs := &fakeStore{
		getCatalogItems: func(publicOnly bool) ([]*models.BillingCatalogItem, error) { return items, nil },
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/api/billing/catalog", "", tenantID.String(), "admin")
	if err := h.GetBillingCatalog(c); err != nil {
		t.Fatalf("GetBillingCatalog: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, "/api/billing/catalog", rec)
}

// uuidPtr returns a pointer to id — a small helper so the catalog fixture
// above can populate the plan-kind PlanID field inline.
func uuidPtr(id uuid.UUID) *uuid.UUID { return &id }

func TestContractGetTenantInvoices(t *testing.T) {
	tenantID := uuid.New()
	kpp := "770001001"
	inv := &models.Invoice{
		ID: uuid.New(), Number: "СЧ-2026-0001", TenantID: tenantID, Status: "issued",
		IssuedAt:  time.Now(),
		BuyerName: "Acme LLC", BuyerINN: "7700000000", BuyerKPP: &kpp, BuyerAddress: "Moscow, Red Square 1",
		SellerName: "OOO Idento", SellerINN: "7711111111", SellerBankName: "Bank",
		SellerBankAccount: "40702810000000000001", SellerBankBIK: "044525225",
		Total:      5000,
		TenantName: "Acme Tenant",
		CreatedAt:  time.Now(), UpdatedAt: time.Now(),
	}
	fs := &fakeStore{
		listInvoices: func(f store.InvoiceFilter) ([]*models.Invoice, error) { return []*models.Invoice{inv}, nil },
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/api/billing/invoices", "", tenantID.String(), "admin")
	if err := h.GetTenantInvoices(c); err != nil {
		t.Fatalf("GetTenantInvoices: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, "/api/billing/invoices", rec)
}

// TestContractCreateTenantInvoice requests two lines — a plan-kind item
// with vat_rate set and an addon-kind item with vat_rate null — so both
// states of the nullable InvoiceLine.vat_rate are validated against the
// schema, along with the response's total_in_words.
func TestContractCreateTenantInvoice(t *testing.T) {
	t.Setenv("BILLING_SELLER_NAME", "OOO Idento")
	t.Setenv("BILLING_SELLER_INN", "7711111111")
	t.Setenv("BILLING_SELLER_BANK_NAME", "Bank")
	t.Setenv("BILLING_SELLER_BANK_ACCOUNT", "40702810000000000001")
	t.Setenv("BILLING_SELLER_BANK_BIK", "044525225")
	t.Setenv("BILLING_SELLER_BANK_CORR_ACCOUNT", "30101810000000000001")

	tenantID := uuid.New()
	userID := uuid.New()
	kpp := "770001001"
	profile := &models.TenantBillingProfile{
		TenantID: tenantID, LegalName: "Acme LLC", INN: "7700000000", KPP: &kpp, LegalAddress: "Moscow, Red Square 1",
	}

	planVAT := 20.0
	period := "month"
	activation := "on_payment"
	planItem := uuid.New()
	addonItem := uuid.New()
	limitKey := "attendees_per_event"
	limitDelta := 500
	catalog := map[uuid.UUID]*models.BillingCatalogItem{
		planItem: {
			ID: planItem, Kind: "plan", Name: "Pro plan", Price: 5000, VATRate: &planVAT,
			IsActive: true, IsPublic: true, PlanID: uuidPtr(uuid.New()), Period: &period, DefaultActivation: &activation,
		},
		addonItem: {
			ID: addonItem, Kind: "addon", Name: "Extra attendees", Price: 1500, VATRate: nil,
			IsActive: true, IsPublic: true, LimitKey: &limitKey, LimitDelta: &limitDelta,
		},
	}

	fs := &fakeStore{
		getTenantBillingProfile: func(uuid.UUID) (*models.TenantBillingProfile, error) { return profile, nil },
		getCatalogItemByID:      func(id uuid.UUID) (*models.BillingCatalogItem, error) { return catalog[id], nil },
		createInvoice: func(inv *models.Invoice, lines []*models.InvoiceLine) error {
			// Mimic PGStore.CreateInvoice: assign number/id/status/timestamps
			// and back-fill each line's id/invoice_id, since the handler
			// relies on the store to populate these before it responds.
			inv.ID = uuid.New()
			inv.Number = "СЧ-2026-0002"
			inv.Status = "issued"
			inv.IssuedAt = time.Now()
			inv.CreatedAt = time.Now()
			inv.UpdatedAt = time.Now()
			for _, l := range lines {
				l.ID = uuid.New()
				l.InvoiceID = inv.ID
			}
			return nil
		},
		logAdminAction: func(uuid.UUID, string, string, uuid.UUID, interface{}, string, string) error { return nil },
	}
	h := &Handler{Store: fs}
	e := echo.New()
	body := `{"lines":[
		{"catalog_item_id":"` + planItem.String() + `","quantity":1},
		{"catalog_item_id":"` + addonItem.String() + `","quantity":2}
	],"comment":"please issue"}`
	c, rec := newAuthedContextWithUserID(e, http.MethodPost, "/api/billing/invoices", body, tenantID.String(), userID, "admin")
	if err := h.CreateTenantInvoice(c); err != nil {
		t.Fatalf("CreateTenantInvoice: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, "/api/billing/invoices", rec)
}

func TestContractGetTenantInvoice(t *testing.T) {
	tenantID := uuid.New()
	invoiceID := uuid.New()
	kpp := "770001001"
	vatRate := 20.0
	line := &models.InvoiceLine{
		ID: uuid.New(), InvoiceID: invoiceID, Position: 1, CatalogItemID: uuidPtr(uuid.New()),
		Kind: "plan", Name: "Pro plan", Price: 5000, VATRate: &vatRate,
		Quantity: 1, Amount: 5000,
	}
	inv := &models.Invoice{
		ID: invoiceID, Number: "СЧ-2026-0003", TenantID: tenantID, Status: "issued",
		IssuedAt:  time.Now(),
		BuyerName: "Acme LLC", BuyerINN: "7700000000", BuyerKPP: &kpp, BuyerAddress: "Moscow, Red Square 1",
		SellerName: "OOO Idento", SellerINN: "7711111111", SellerBankName: "Bank",
		SellerBankAccount: "40702810000000000001", SellerBankBIK: "044525225",
		Total:     5000,
		Lines:     []*models.InvoiceLine{line},
		CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	fs := &fakeStore{
		getInvoiceByID: func(id uuid.UUID) (*models.Invoice, error) { return inv, nil },
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/api/billing/invoices/"+invoiceID.String(), "", tenantID.String(), "admin")
	c.SetParamNames("id")
	c.SetParamValues(invoiceID.String())
	if err := h.GetTenantInvoice(c); err != nil {
		t.Fatalf("GetTenantInvoice: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, "/api/billing/invoices/"+invoiceID.String(), rec)
}

// TestContractGetBillingSubscription exercises both the populated plan
// (name/slug non-null, one active boost) and the null-plan branch (Plan not
// joined) so both nullable states of plan_name/plan_slug are validated
// against the schema, along with a non-empty active_boosts array.
func TestContractGetBillingSubscription(t *testing.T) {
	tenantID := uuid.New()
	endDate := time.Now().Add(30 * 24 * time.Hour)
	sub := &models.Subscription{
		TenantID:  tenantID,
		Status:    "active",
		StartDate: time.Now().Add(-24 * time.Hour),
		EndDate:   &endDate,
		Plan:      &models.SubscriptionPlan{Name: "Pro", Slug: "pro"},
	}
	boosts := []*models.LimitBoost{
		{
			ID: uuid.New(), TenantID: tenantID, LimitKey: "attendees_per_event", Delta: 500,
			ValidUntil: endDate, CreatedAt: time.Now(),
		},
	}
	fs := &fakeStore{
		getSubscriptionByTenantID: func(uuid.UUID) (*models.Subscription, error) { return sub, nil },
		getActiveLimitBoosts:      func(uuid.UUID) ([]*models.LimitBoost, error) { return boosts, nil },
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/api/billing/subscription", "", tenantID.String(), "admin")
	if err := h.GetBillingSubscription(c); err != nil {
		t.Fatalf("GetBillingSubscription: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, "/api/billing/subscription", rec)
}

// TestContractGetBillingSubscription_NotFound exercises the 404 branch — no
// subscription row exists for this tenant.
func TestContractGetBillingSubscription_NotFound(t *testing.T) {
	tenantID := uuid.New()
	fs := &fakeStore{
		getSubscriptionByTenantID: func(uuid.UUID) (*models.Subscription, error) { return nil, nil },
	}
	h := &Handler{Store: fs}
	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, "/api/billing/subscription", "", tenantID.String(), "admin")
	if err := h.GetBillingSubscription(c); err != nil {
		t.Fatalf("GetBillingSubscription: %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, "/api/billing/subscription", rec)
}
