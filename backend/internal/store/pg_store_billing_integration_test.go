package store

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestBillingProfileUpsertRoundTrip and its siblings below exercise the new
// billing-profile/catalog store methods (Task 2 of the billing-invoices
// plan) against a REAL Postgres database — the DB CHECK constraints on
// billing_catalog_items (kind-specific column consistency) cannot be proven
// by pgxmock.
//
// Gated behind TEST_DATABASE_URL and SKIPS, not fails, when unset (the
// established idiom of this package). To run locally against the
// docker-compose db:
//
//	TEST_DATABASE_URL="postgres://idento:idento_password@localhost:5438/idento_db?sslmode=disable" \
//	  go test ./internal/store/ -run 'TestBillingProfile|TestCatalog' -v
func newBillingTestStore(t *testing.T) (*PGStore, *pgxpool.Pool, context.Context) {
	t.Helper()
	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping real-Postgres billing test (see doc comment for how to run it)")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	t.Cleanup(cancel)

	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("Ping: %v", err)
	}

	s := &PGStore{db: pool}
	if err := s.RunMigrations(); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}
	if err := s.EnsureSeedData(ctx, "saas"); err != nil {
		t.Fatalf("EnsureSeedData: %v", err)
	}

	return s, pool, ctx
}

func createBillingTestTenant(t *testing.T, s *PGStore, pool *pgxpool.Pool, ctx context.Context) uuid.UUID {
	t.Helper()
	tenantID := uuid.New()
	if _, err := pool.Exec(ctx,
		`INSERT INTO tenants (id, name, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())`,
		tenantID, "Billing Test Tenant "+tenantID.String()); err != nil {
		t.Fatalf("insert tenant: %v", err)
	}
	t.Cleanup(func() {
		cctx, ccancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer ccancel()
		if _, err := pool.Exec(cctx, `DELETE FROM tenants WHERE id = $1`, tenantID); err != nil {
			t.Logf("cleanup: failed to delete tenant: %v", err)
		}
	})
	return tenantID
}

func TestBillingProfileUpsertRoundTrip(t *testing.T) {
	s, pool, ctx := newBillingTestStore(t)
	tenantID := createBillingTestTenant(t, s, pool, ctx)

	kpp := "770101001"
	profile := &models.TenantBillingProfile{
		TenantID:     tenantID,
		LegalName:    "ООО Ромашка",
		INN:          "7701234567",
		KPP:          &kpp,
		LegalAddress: "г. Москва, ул. Ленина, д. 1",
	}
	if err := s.UpsertTenantBillingProfile(ctx, profile); err != nil {
		t.Fatalf("UpsertTenantBillingProfile (insert): %v", err)
	}

	got, err := s.GetTenantBillingProfile(ctx, tenantID)
	if err != nil {
		t.Fatalf("GetTenantBillingProfile: %v", err)
	}
	if got == nil {
		t.Fatal("GetTenantBillingProfile returned nil, want a profile")
	}
	if got.LegalName != "ООО Ромашка" || got.INN != "7701234567" || got.KPP == nil || *got.KPP != kpp || got.LegalAddress != profile.LegalAddress {
		t.Fatalf("GetTenantBillingProfile = %+v, want fields matching %+v", got, profile)
	}
	if got.CreatedAt.IsZero() || got.UpdatedAt.IsZero() {
		t.Fatalf("GetTenantBillingProfile CreatedAt/UpdatedAt should be set, got %+v", got)
	}
	firstUpdatedAt := got.UpdatedAt

	// Upsert again with a changed LegalName -> update, UpdatedAt advances.
	time.Sleep(10 * time.Millisecond)
	profile.LegalName = "ООО Ромашка Плюс"
	if err := s.UpsertTenantBillingProfile(ctx, profile); err != nil {
		t.Fatalf("UpsertTenantBillingProfile (update): %v", err)
	}
	got2, err := s.GetTenantBillingProfile(ctx, tenantID)
	if err != nil {
		t.Fatalf("GetTenantBillingProfile after update: %v", err)
	}
	if got2.LegalName != "ООО Ромашка Плюс" {
		t.Fatalf("LegalName after update = %q, want %q", got2.LegalName, "ООО Ромашка Плюс")
	}
	if !got2.UpdatedAt.After(firstUpdatedAt) {
		t.Fatalf("UpdatedAt did not advance: first=%v, second=%v", firstUpdatedAt, got2.UpdatedAt)
	}
	if !got2.CreatedAt.Equal(got.CreatedAt) {
		t.Fatalf("CreatedAt changed on update: first=%v, second=%v", got.CreatedAt, got2.CreatedAt)
	}

	// A tenant with no profile -> (nil, nil).
	otherTenant := createBillingTestTenant(t, s, pool, ctx)
	none, err := s.GetTenantBillingProfile(ctx, otherTenant)
	if err != nil {
		t.Fatalf("GetTenantBillingProfile (no profile): %v", err)
	}
	if none != nil {
		t.Fatalf("GetTenantBillingProfile (no profile) = %+v, want nil", none)
	}
}

func TestCatalogItemCRUDAndFiltering(t *testing.T) {
	s, _, ctx := newBillingTestStore(t)

	plans, err := s.GetSubscriptionPlans(ctx, true)
	if err != nil {
		t.Fatalf("GetSubscriptionPlans: %v", err)
	}
	if len(plans) == 0 {
		t.Fatal("GetSubscriptionPlans returned no plans; EnsureSeedData should have seeded some")
	}
	planID := plans[0].ID

	vat := 20.0
	period := "month"
	activation := "on_payment"
	planItem := &models.BillingCatalogItem{
		Kind:              "plan",
		Name:              "B Plan Item " + uuid.NewString(),
		Description:       "Plan catalog item",
		Price:             1999.99,
		VATRate:           &vat,
		IsPublic:          true,
		IsActive:          true,
		SortOrder:         2,
		PlanID:            &planID,
		Period:            &period,
		DefaultActivation: &activation,
	}
	if err := s.CreateCatalogItem(ctx, planItem); err != nil {
		t.Fatalf("CreateCatalogItem (plan): %v", err)
	}
	if planItem.ID == uuid.Nil {
		t.Fatal("CreateCatalogItem (plan) did not populate ID")
	}

	serviceItem := &models.BillingCatalogItem{
		Kind:        "service",
		Name:        "A Service Item " + uuid.NewString(),
		Description: "Service catalog item",
		Price:       500,
		VATRate:     nil,
		IsPublic:    true,
		IsActive:    true,
		SortOrder:   1,
	}
	if err := s.CreateCatalogItem(ctx, serviceItem); err != nil {
		t.Fatalf("CreateCatalogItem (service): %v", err)
	}

	limitKey := "attendees_per_event"
	limitDelta := 50
	validity := "until_period_end"
	addonItem := &models.BillingCatalogItem{
		Kind:        "addon",
		Name:        "C Addon Item " + uuid.NewString(),
		Description: "Addon catalog item",
		Price:       300,
		VATRate:     nil,
		IsPublic:    false,
		IsActive:    true,
		SortOrder:   3,
		LimitKey:    &limitKey,
		LimitDelta:  &limitDelta,
		Validity:    &validity,
	}
	if err := s.CreateCatalogItem(ctx, addonItem); err != nil {
		t.Fatalf("CreateCatalogItem (addon): %v", err)
	}

	t.Cleanup(func() {
		cctx, ccancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer ccancel()
		for _, id := range []uuid.UUID{planItem.ID, serviceItem.ID, addonItem.ID} {
			if _, err := s.db.Exec(cctx, `DELETE FROM billing_catalog_items WHERE id = $1`, id); err != nil {
				t.Logf("cleanup: failed to delete catalog item %s: %v", id, err)
			}
		}
	})

	all, err := s.GetCatalogItems(ctx, false)
	if err != nil {
		t.Fatalf("GetCatalogItems(false): %v", err)
	}
	var gotIDs []uuid.UUID
	for _, item := range all {
		if item.ID == serviceItem.ID || item.ID == planItem.ID || item.ID == addonItem.ID {
			gotIDs = append(gotIDs, item.ID)
		}
	}
	wantOrder := []uuid.UUID{serviceItem.ID, planItem.ID, addonItem.ID} // sort_order 1,2,3
	if len(gotIDs) != len(wantOrder) {
		t.Fatalf("GetCatalogItems(false) returned %d of our 3 fixture items, want 3 (got all=%d)", len(gotIDs), len(all))
	}
	for i, id := range wantOrder {
		if gotIDs[i] != id {
			t.Fatalf("GetCatalogItems(false) order[%d] = %s, want %s (ORDER BY sort_order, name)", i, gotIDs[i], id)
		}
	}

	// Flip addonItem to is_public=false/is_active=false (already is_public
	// false; also flip is_active) and confirm the public view excludes it,
	// plus flip serviceItem's is_public off to prove BOTH flags are checked.
	addonItem.IsActive = false
	if err := s.UpdateCatalogItem(ctx, addonItem); err != nil {
		t.Fatalf("UpdateCatalogItem (addon deactivate): %v", err)
	}
	serviceItem.IsPublic = false
	if err := s.UpdateCatalogItem(ctx, serviceItem); err != nil {
		t.Fatalf("UpdateCatalogItem (service unpublish): %v", err)
	}

	publicOnly, err := s.GetCatalogItems(ctx, true)
	if err != nil {
		t.Fatalf("GetCatalogItems(true): %v", err)
	}
	for _, item := range publicOnly {
		if item.ID == addonItem.ID {
			t.Fatalf("GetCatalogItems(true) included inactive addonItem %s", item.ID)
		}
		if item.ID == serviceItem.ID {
			t.Fatalf("GetCatalogItems(true) included non-public serviceItem %s", item.ID)
		}
	}
	found := false
	for _, item := range publicOnly {
		if item.ID == planItem.ID {
			found = true
		}
	}
	if !found {
		t.Fatalf("GetCatalogItems(true) did not include public+active planItem %s", planItem.ID)
	}

	// UpdateCatalogItem changes price and Get reflects it.
	planItem.Price = 2499.50
	if err := s.UpdateCatalogItem(ctx, planItem); err != nil {
		t.Fatalf("UpdateCatalogItem (price): %v", err)
	}
	byID, err := s.GetCatalogItemByID(ctx, planItem.ID)
	if err != nil {
		t.Fatalf("GetCatalogItemByID: %v", err)
	}
	if byID == nil {
		t.Fatal("GetCatalogItemByID returned nil for existing item")
	}
	if byID.Price != 2499.50 {
		t.Fatalf("GetCatalogItemByID.Price = %v, want 2499.50", byID.Price)
	}
	if byID.PlanID == nil || *byID.PlanID != planID {
		t.Fatalf("GetCatalogItemByID.PlanID = %v, want %v", byID.PlanID, planID)
	}

	// Random UUID -> (nil, nil).
	missing, err := s.GetCatalogItemByID(ctx, uuid.New())
	if err != nil {
		t.Fatalf("GetCatalogItemByID (missing): %v", err)
	}
	if missing != nil {
		t.Fatalf("GetCatalogItemByID (missing) = %+v, want nil", missing)
	}
}

func TestCatalogKindChecksRejectInconsistentRows(t *testing.T) {
	s, _, ctx := newBillingTestStore(t)

	planID := uuid.New()
	bad := &models.BillingCatalogItem{
		Kind:        "service",
		Name:        "Inconsistent Service " + uuid.NewString(),
		Description: "should be rejected",
		Price:       100,
		IsPublic:    true,
		IsActive:    true,
		PlanID:      &planID, // service must NOT have plan_id -> CHECK violation
	}
	if err := s.CreateCatalogItem(ctx, bad); err == nil {
		t.Fatal("CreateCatalogItem with kind=service and non-nil PlanID succeeded, want a CHECK-constraint error")
	}
}

// --- Invoices (Task 3 of the billing-invoices plan) ---
//
// TestCreateInvoiceAssignsSequentialNumbers, TestGetInvoiceByIDLoadsLinesInOrder
// and TestListInvoicesFilters exercise CreateInvoice/GetInvoiceByID/ListInvoices
// against a real Postgres DB — the invoice_counters per-year UPSERT semantics
// and the invoice_lines FK/CHECK constraints cannot be proven by pgxmock.
//
// Other tests share this long-lived dev DB, so numbering assertions below are
// relative (second == first+1), never absolute.

// fetchAnyPlanID returns an existing subscription plan ID (invoice_lines.plan_id
// is FK-constrained to subscription_plans, so tests must reuse a seeded plan
// rather than inventing a random UUID).
func fetchAnyPlanID(t *testing.T, s *PGStore, ctx context.Context) uuid.UUID {
	t.Helper()
	plans, err := s.GetSubscriptionPlans(ctx, true)
	if err != nil {
		t.Fatalf("GetSubscriptionPlans: %v", err)
	}
	if len(plans) == 0 {
		t.Fatal("GetSubscriptionPlans returned no plans; EnsureSeedData should have seeded some")
	}
	return plans[0].ID
}

// newTestInvoice builds a fully-populated Invoice (buyer/seller requisites
// snapshot) ready for CreateInvoice, minus Number/ID/IssuedAt/timestamps
// which CreateInvoice fills in.
func newTestInvoice(tenantID uuid.UUID) *models.Invoice {
	kpp := "770101001"
	corr := "30101810400000000225"
	comment := "test invoice"
	return &models.Invoice{
		TenantID:              tenantID,
		Status:                "issued",
		BuyerName:             "ООО Покупатель " + uuid.NewString(),
		BuyerINN:              "7701234567",
		BuyerKPP:              &kpp,
		BuyerAddress:          "г. Москва, ул. Тестовая, д. 1",
		SellerName:            "ООО Идento",
		SellerINN:             "9701234567",
		SellerBankName:        "ПАО Тестбанк",
		SellerBankAccount:     "40702810900000012345",
		SellerBankBIK:         "044525225",
		SellerBankCorrAccount: &corr,
		Total:                 1500,
		Comment:               &comment,
	}
}

// newTestInvoiceLines builds one line per kind (plan/service/addon) at
// positions 1..3, with VATRate populated on the plan line only.
func newTestInvoiceLines(planID uuid.UUID) []*models.InvoiceLine {
	vat := 20.0
	period := "month"
	activation := "on_payment"
	limitKey := "attendees_per_event"
	limitDelta := 50
	validity := "until_period_end"
	return []*models.InvoiceLine{
		{
			Position:   1,
			Kind:       "plan",
			Name:       "План Профи",
			Price:      1000,
			VATRate:    &vat,
			PlanID:     &planID,
			Period:     &period,
			Activation: &activation,
			Quantity:   1,
			Amount:     1000,
		},
		{
			Position: 2,
			Kind:     "service",
			Name:     "Настройка мероприятия",
			Price:    200,
			Quantity: 1,
			Amount:   200,
		},
		{
			Position:   3,
			Kind:       "addon",
			Name:       "Доп. участники",
			Price:      300,
			LimitKey:   &limitKey,
			LimitDelta: &limitDelta,
			Validity:   &validity,
			Quantity:   1,
			Amount:     300,
		},
	}
}

func TestCreateInvoiceAssignsSequentialNumbers(t *testing.T) {
	s, pool, ctx := newBillingTestStore(t)
	tenantID := createBillingTestTenant(t, s, pool, ctx)
	planID := fetchAnyPlanID(t, s, ctx)

	inv1 := newTestInvoice(tenantID)
	if err := s.CreateInvoice(ctx, inv1, newTestInvoiceLines(planID)); err != nil {
		t.Fatalf("CreateInvoice (1): %v", err)
	}
	if inv1.ID == uuid.Nil {
		t.Fatal("CreateInvoice did not populate ID")
	}
	if inv1.IssuedAt.IsZero() {
		t.Fatal("CreateInvoice did not populate IssuedAt")
	}

	year := inv1.IssuedAt.Year()
	prefix := fmt.Sprintf("СЧ-%d-", year)
	if !strings.HasPrefix(inv1.Number, prefix) {
		t.Fatalf("Number = %q, want prefix %q", inv1.Number, prefix)
	}
	n1, err := strconv.Atoi(strings.TrimPrefix(inv1.Number, prefix))
	if err != nil {
		t.Fatalf("parse number suffix of %q: %v", inv1.Number, err)
	}

	inv2 := newTestInvoice(tenantID)
	if err := s.CreateInvoice(ctx, inv2, newTestInvoiceLines(planID)); err != nil {
		t.Fatalf("CreateInvoice (2): %v", err)
	}
	if !strings.HasPrefix(inv2.Number, prefix) {
		t.Fatalf("Number = %q, want prefix %q", inv2.Number, prefix)
	}
	n2, err := strconv.Atoi(strings.TrimPrefix(inv2.Number, prefix))
	if err != nil {
		t.Fatalf("parse number suffix of %q: %v", inv2.Number, err)
	}
	if n2 != n1+1 {
		t.Fatalf("second invoice number suffix = %d, want %d (first+1)", n2, n1+1)
	}

	// Pin the counter UPSERT's increment semantics directly: pre-seed year
	// 2001 with last_value=41, exercise the exact SQL from the brief, expect 42.
	if _, err := pool.Exec(ctx, `INSERT INTO invoice_counters (year, last_value) VALUES (2001, 41)
		ON CONFLICT (year) DO UPDATE SET last_value = EXCLUDED.last_value`); err != nil {
		t.Fatalf("seed invoice_counters year 2001: %v", err)
	}
	t.Cleanup(func() {
		cctx, ccancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer ccancel()
		if _, err := pool.Exec(cctx, `DELETE FROM invoice_counters WHERE year = 2001`); err != nil {
			t.Logf("cleanup: failed to delete invoice_counters year 2001: %v", err)
		}
	})

	var n int
	if err := pool.QueryRow(ctx, `INSERT INTO invoice_counters (year, last_value) VALUES ($1, 1)
	    ON CONFLICT (year) DO UPDATE SET last_value = invoice_counters.last_value + 1
	    RETURNING last_value`, 2001).Scan(&n); err != nil {
		t.Fatalf("counter UPSERT exercise: %v", err)
	}
	if n != 42 {
		t.Fatalf("counter UPSERT for pre-seeded year 2001 (last_value=41) = %d, want 42", n)
	}
}

// TestCreateInvoiceRollsBackOnLineFailure pins CreateInvoice's atomicity
// guarantee (Task 3 review follow-up): a UNIQUE(invoice_id, position)
// violation on the second line must roll back the whole transaction,
// including the already-inserted invoice header row itself. The
// invoice_counters gap this leaves behind is fine — numbering allows gaps.
func TestCreateInvoiceRollsBackOnLineFailure(t *testing.T) {
	s, pool, ctx := newBillingTestStore(t)
	tenantID := createBillingTestTenant(t, s, pool, ctx)
	planID := fetchAnyPlanID(t, s, ctx)

	var before int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM invoices WHERE tenant_id = $1`, tenantID).Scan(&before); err != nil {
		t.Fatalf("count invoices (before): %v", err)
	}

	inv := newTestInvoice(tenantID)
	lines := newTestInvoiceLines(planID)
	// Force a UNIQUE(invoice_id, position) violation: duplicate the first line's position.
	lines[1].Position = lines[0].Position

	if err := s.CreateInvoice(ctx, inv, lines); err == nil {
		t.Fatal("CreateInvoice with duplicate line position succeeded, want a UNIQUE-constraint error")
	}

	var after int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM invoices WHERE tenant_id = $1`, tenantID).Scan(&after); err != nil {
		t.Fatalf("count invoices (after): %v", err)
	}
	if after != before {
		t.Fatalf("invoice count for tenant changed after failed CreateInvoice: before=%d after=%d, want no committed row", before, after)
	}
}

// TestCreateInvoiceForcesIssuedStatus pins that CreateInvoice always inserts
// a new invoice with status "issued", regardless of whatever Status the
// caller pre-set on the *models.Invoice passed in. The only supported paths
// to "paid"/"cancelled" are ApplyInvoicePayment/CancelInvoice; a caller must
// never be able to bypass those by pre-setting Status before creation.
func TestCreateInvoiceForcesIssuedStatus(t *testing.T) {
	s, pool, ctx := newBillingTestStore(t)
	tenantID := createBillingTestTenant(t, s, pool, ctx)
	planID := fetchAnyPlanID(t, s, ctx)

	inv := newTestInvoice(tenantID)
	inv.Status = "paid" // attempt to bypass ApplyInvoicePayment
	if err := s.CreateInvoice(ctx, inv, newTestInvoiceLines(planID)); err != nil {
		t.Fatalf("CreateInvoice: %v", err)
	}
	if inv.Status != "issued" {
		t.Fatalf("Invoice.Status (returned) = %q, want forced %q", inv.Status, "issued")
	}

	var dbStatus string
	if err := pool.QueryRow(ctx, `SELECT status FROM invoices WHERE id = $1`, inv.ID).Scan(&dbStatus); err != nil {
		t.Fatalf("query invoice status: %v", err)
	}
	if dbStatus != "issued" {
		t.Fatalf("invoices.status in DB = %q, want forced %q despite caller pre-setting %q", dbStatus, "issued", "paid")
	}
}

func TestGetInvoiceByIDLoadsLinesInOrder(t *testing.T) {
	s, pool, ctx := newBillingTestStore(t)
	tenantID := createBillingTestTenant(t, s, pool, ctx)
	planID := fetchAnyPlanID(t, s, ctx)

	inv := newTestInvoice(tenantID)
	lines := newTestInvoiceLines(planID)
	if err := s.CreateInvoice(ctx, inv, lines); err != nil {
		t.Fatalf("CreateInvoice: %v", err)
	}

	got, err := s.GetInvoiceByID(ctx, inv.ID)
	if err != nil {
		t.Fatalf("GetInvoiceByID: %v", err)
	}
	if got == nil {
		t.Fatal("GetInvoiceByID returned nil for existing invoice")
	}
	if len(got.Lines) != 3 {
		t.Fatalf("len(Lines) = %d, want 3", len(got.Lines))
	}
	for i, line := range got.Lines {
		if line.Position != i+1 {
			t.Fatalf("Lines[%d].Position = %d, want %d", i, line.Position, i+1)
		}
	}
	if got.Lines[0].Kind != "plan" || got.Lines[0].VATRate == nil || *got.Lines[0].VATRate != 20.0 {
		t.Fatalf("Lines[0] = %+v, want kind=plan VATRate=20", got.Lines[0])
	}
	if got.Lines[0].PlanID == nil || *got.Lines[0].PlanID != planID {
		t.Fatalf("Lines[0].PlanID = %v, want %v", got.Lines[0].PlanID, planID)
	}
	if got.Lines[1].Kind != "service" {
		t.Fatalf("Lines[1].Kind = %q, want service", got.Lines[1].Kind)
	}
	if got.Lines[1].VATRate != nil {
		t.Fatalf("Lines[1].VATRate = %v, want nil", got.Lines[1].VATRate)
	}
	if got.Lines[2].Kind != "addon" || got.Lines[2].LimitKey == nil || *got.Lines[2].LimitKey != "attendees_per_event" {
		t.Fatalf("Lines[2] = %+v, want kind=addon LimitKey=attendees_per_event", got.Lines[2])
	}
	if got.Lines[2].LimitDelta == nil || *got.Lines[2].LimitDelta != 50 {
		t.Fatalf("Lines[2].LimitDelta = %v, want 50", got.Lines[2].LimitDelta)
	}

	missing, err := s.GetInvoiceByID(ctx, uuid.New())
	if err != nil {
		t.Fatalf("GetInvoiceByID (missing): %v", err)
	}
	if missing != nil {
		t.Fatalf("GetInvoiceByID (missing) = %+v, want nil", missing)
	}
}

func TestListInvoicesFilters(t *testing.T) {
	s, pool, ctx := newBillingTestStore(t)
	tenantA := createBillingTestTenant(t, s, pool, ctx)
	tenantB := createBillingTestTenant(t, s, pool, ctx)
	planID := fetchAnyPlanID(t, s, ctx)

	invA1 := newTestInvoice(tenantA)
	if err := s.CreateInvoice(ctx, invA1, newTestInvoiceLines(planID)); err != nil {
		t.Fatalf("CreateInvoice A1: %v", err)
	}
	time.Sleep(10 * time.Millisecond)
	invA2 := newTestInvoice(tenantA)
	if err := s.CreateInvoice(ctx, invA2, newTestInvoiceLines(planID)); err != nil {
		t.Fatalf("CreateInvoice A2: %v", err)
	}
	time.Sleep(10 * time.Millisecond)
	invB1 := newTestInvoice(tenantB)
	if err := s.CreateInvoice(ctx, invB1, newTestInvoiceLines(planID)); err != nil {
		t.Fatalf("CreateInvoice B1: %v", err)
	}

	// CreateInvoice always issues; mark invA2 paid directly to test the status filter.
	if _, err := pool.Exec(ctx, `UPDATE invoices SET status = 'paid', paid_at = NOW() WHERE id = $1`, invA2.ID); err != nil {
		t.Fatalf("mark invA2 paid: %v", err)
	}

	byTenant, err := s.ListInvoices(ctx, InvoiceFilter{TenantID: &tenantA})
	if err != nil {
		t.Fatalf("ListInvoices (tenant filter): %v", err)
	}
	if len(byTenant) != 2 {
		t.Fatalf("ListInvoices(tenant A) len = %d, want 2", len(byTenant))
	}
	if byTenant[0].ID != invA2.ID || byTenant[1].ID != invA1.ID {
		t.Fatalf("ListInvoices(tenant A) not newest-first: got [%s, %s], want [%s, %s]",
			byTenant[0].ID, byTenant[1].ID, invA2.ID, invA1.ID)
	}
	for _, inv := range byTenant {
		if inv.TenantName == "" {
			t.Fatalf("ListInvoices TenantName not set for invoice %s", inv.ID)
		}
		if len(inv.Lines) != 0 {
			t.Fatalf("ListInvoices should not load Lines, got %d for invoice %s", len(inv.Lines), inv.ID)
		}
	}

	paid, err := s.ListInvoices(ctx, InvoiceFilter{Status: "paid"})
	if err != nil {
		t.Fatalf("ListInvoices (status filter): %v", err)
	}
	foundPaid := false
	for _, inv := range paid {
		if inv.ID == invA2.ID {
			foundPaid = true
		}
		if inv.Status != "paid" {
			t.Fatalf("ListInvoices(status=paid) returned non-paid invoice %s (status=%s)", inv.ID, inv.Status)
		}
	}
	if !foundPaid {
		t.Fatal("ListInvoices(status=paid) did not include invA2")
	}

	all, err := s.ListInvoices(ctx, InvoiceFilter{})
	if err != nil {
		t.Fatalf("ListInvoices (no filter): %v", err)
	}
	gotAll := map[uuid.UUID]bool{}
	for _, inv := range all {
		gotAll[inv.ID] = true
	}
	for _, want := range []uuid.UUID{invA1.ID, invA2.ID, invB1.ID} {
		if !gotAll[want] {
			t.Fatalf("ListInvoices (no filter) missing invoice %s", want)
		}
	}
}

// --- Mark-paid application semantics (Task 4 of the billing-invoices plan) ---
//
// ApplyInvoicePayment/CancelInvoice/GetActiveLimitBoosts and the boost term
// resolveTenantLimit now adds are exercised against a real Postgres DB: the
// SELECT ... FOR UPDATE locking, the subscriptions UPSERT-on-first-plan-line
// semantics, and the limit_boosts CHECK constraints cannot be proven by
// pgxmock.

// fetchPlanIDBySlug returns a seeded subscription_plans.id by slug (e.g.
// "free", "pro") — invoice_lines.plan_id and subscriptions.plan_id are both
// FK-constrained to subscription_plans, so tests must reuse real seeded rows.
func fetchPlanIDBySlug(t *testing.T, pool *pgxpool.Pool, ctx context.Context, slug string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT id FROM subscription_plans WHERE slug = $1`, slug).Scan(&id); err != nil {
		t.Fatalf("fetch plan by slug %q: %v", slug, err)
	}
	return id
}

// newServiceLine/newPlanLine/newAddonLine build fresh *models.InvoiceLine
// values (never share a pointer across two CreateInvoice calls: CreateInvoice
// mutates line.ID/InvoiceID on its argument).
func newServiceLine(position int) *models.InvoiceLine {
	return &models.InvoiceLine{
		Position: position,
		Kind:     "service",
		Name:     "Service line",
		Price:    200,
		Quantity: 1,
		Amount:   200,
	}
}

func newPlanLine(position int, planID uuid.UUID, period, activation string, quantity int) *models.InvoiceLine {
	p, a := period, activation
	return &models.InvoiceLine{
		Position:   position,
		Kind:       "plan",
		Name:       "Plan line",
		Price:      1000,
		PlanID:     &planID,
		Period:     &p,
		Activation: &a,
		Quantity:   quantity,
		Amount:     float64(quantity) * 1000,
	}
}

func newAddonLine(position int, limitKey string, limitDelta, quantity int, validity string, validityDays *int) *models.InvoiceLine {
	lk, v := limitKey, validity
	ld := limitDelta
	return &models.InvoiceLine{
		Position:     position,
		Kind:         "addon",
		Name:         "Addon line",
		Price:        300,
		LimitKey:     &lk,
		LimitDelta:   &ld,
		Validity:     &v,
		ValidityDays: validityDays,
		Quantity:     quantity,
		Amount:       300,
	}
}

func TestApplyInvoicePaymentOnPaymentUpgrade(t *testing.T) {
	s, pool, ctx := newBillingTestStore(t)
	tenantID := createBillingTestTenant(t, s, pool, ctx)
	freePlanID := fetchPlanIDBySlug(t, pool, ctx, "free")
	proPlanID := fetchPlanIDBySlug(t, pool, ctx, "pro")

	now := time.Now().UTC()
	if err := s.UpsertSubscription(ctx, &models.Subscription{
		TenantID:  tenantID,
		PlanID:    &freePlanID,
		Status:    "active",
		StartDate: now,
	}); err != nil {
		t.Fatalf("UpsertSubscription: %v", err)
	}

	inv := newTestInvoice(tenantID)
	line := newPlanLine(1, proPlanID, "month", "on_payment", 1)
	if err := s.CreateInvoice(ctx, inv, []*models.InvoiceLine{line}); err != nil {
		t.Fatalf("CreateInvoice: %v", err)
	}

	paid, effects, err := s.ApplyInvoicePayment(ctx, inv.ID, now)
	if err != nil {
		t.Fatalf("ApplyInvoicePayment: %v", err)
	}
	if paid.Status != "paid" {
		t.Fatalf("Status = %q, want paid", paid.Status)
	}
	if paid.PaidAt == nil {
		t.Fatal("PaidAt not set")
	}
	if len(effects) != 1 || effects[0].Kind != "plan" {
		t.Fatalf("effects = %+v, want 1 plan effect", effects)
	}

	sub, err := s.GetSubscriptionByTenantID(ctx, tenantID)
	if err != nil {
		t.Fatalf("GetSubscriptionByTenantID: %v", err)
	}
	if sub.PlanID == nil || *sub.PlanID != proPlanID {
		t.Fatalf("PlanID = %v, want %v", sub.PlanID, proPlanID)
	}
	if sub.Status != "active" {
		t.Fatalf("Status = %q, want active", sub.Status)
	}
	if sub.EndDate == nil {
		t.Fatal("EndDate not set")
	}
	wantEnd := now.AddDate(0, 1, 0)
	if diff := sub.EndDate.Sub(wantEnd); diff < -time.Minute || diff > time.Minute {
		t.Fatalf("EndDate = %v, want ~%v", sub.EndDate, wantEnd)
	}
}

func TestApplyInvoicePaymentAfterCurrentChains(t *testing.T) {
	s, pool, ctx := newBillingTestStore(t)
	tenantID := createBillingTestTenant(t, s, pool, ctx)
	planID := fetchPlanIDBySlug(t, pool, ctx, "pro")

	now := time.Now().UTC()
	currentEnd := now.Add(10 * 24 * time.Hour)
	if err := s.UpsertSubscription(ctx, &models.Subscription{
		TenantID:  tenantID,
		PlanID:    &planID,
		Status:    "active",
		StartDate: now.Add(-30 * 24 * time.Hour),
		EndDate:   &currentEnd,
	}); err != nil {
		t.Fatalf("UpsertSubscription: %v", err)
	}

	inv := newTestInvoice(tenantID)
	line := newPlanLine(1, planID, "month", "after_current", 2)
	if err := s.CreateInvoice(ctx, inv, []*models.InvoiceLine{line}); err != nil {
		t.Fatalf("CreateInvoice: %v", err)
	}

	if _, _, err := s.ApplyInvoicePayment(ctx, inv.ID, now); err != nil {
		t.Fatalf("ApplyInvoicePayment: %v", err)
	}

	sub, err := s.GetSubscriptionByTenantID(ctx, tenantID)
	if err != nil {
		t.Fatalf("GetSubscriptionByTenantID: %v", err)
	}
	if sub.EndDate == nil {
		t.Fatal("EndDate not set")
	}
	wantEnd := currentEnd.AddDate(0, 2, 0)
	if diff := sub.EndDate.Sub(wantEnd); diff < -time.Minute || diff > time.Minute {
		t.Fatalf("EndDate = %v, want ~%v (chained onto current end_date)", sub.EndDate, wantEnd)
	}

	// Second sub-case: subscription already expired -> base=now, status revived to active.
	tenantID2 := createBillingTestTenant(t, s, pool, ctx)
	pastEnd := now.Add(-5 * 24 * time.Hour)
	if err := s.UpsertSubscription(ctx, &models.Subscription{
		TenantID:  tenantID2,
		PlanID:    &planID,
		Status:    "expired",
		StartDate: now.Add(-60 * 24 * time.Hour),
		EndDate:   &pastEnd,
	}); err != nil {
		t.Fatalf("UpsertSubscription (expired): %v", err)
	}

	inv2 := newTestInvoice(tenantID2)
	line2 := newPlanLine(1, planID, "month", "after_current", 1)
	if err := s.CreateInvoice(ctx, inv2, []*models.InvoiceLine{line2}); err != nil {
		t.Fatalf("CreateInvoice (expired case): %v", err)
	}
	if _, _, err := s.ApplyInvoicePayment(ctx, inv2.ID, now); err != nil {
		t.Fatalf("ApplyInvoicePayment (expired case): %v", err)
	}

	sub2, err := s.GetSubscriptionByTenantID(ctx, tenantID2)
	if err != nil {
		t.Fatalf("GetSubscriptionByTenantID (expired case): %v", err)
	}
	if sub2.Status != "active" {
		t.Fatalf("Status = %q, want active (revived)", sub2.Status)
	}
	if sub2.EndDate == nil {
		t.Fatal("EndDate not set (expired case)")
	}
	wantEnd2 := now.AddDate(0, 1, 0)
	if diff := sub2.EndDate.Sub(wantEnd2); diff < -time.Minute || diff > time.Minute {
		t.Fatalf("EndDate = %v, want ~%v (base=now, expired case)", sub2.EndDate, wantEnd2)
	}
}

func TestApplyInvoicePaymentAddonAndManual(t *testing.T) {
	s, pool, ctx := newBillingTestStore(t)
	tenantID := createBillingTestTenant(t, s, pool, ctx)
	planID := fetchPlanIDBySlug(t, pool, ctx, "pro")

	now := time.Now().UTC()
	if err := s.UpsertSubscription(ctx, &models.Subscription{
		TenantID:  tenantID,
		PlanID:    &planID,
		Status:    "active",
		StartDate: now,
	}); err != nil {
		t.Fatalf("UpsertSubscription: %v", err)
	}

	validityDays := 30
	addon := newAddonLine(1, "attendees_per_event", 500, 2, "fixed_days", &validityDays)
	manualPlan := newPlanLine(2, planID, "month", "manual", 1)
	service := newServiceLine(3)

	inv := newTestInvoice(tenantID)
	if err := s.CreateInvoice(ctx, inv, []*models.InvoiceLine{addon, manualPlan, service}); err != nil {
		t.Fatalf("CreateInvoice: %v", err)
	}

	subBefore, err := s.GetSubscriptionByTenantID(ctx, tenantID)
	if err != nil {
		t.Fatalf("GetSubscriptionByTenantID (before): %v", err)
	}

	_, effects, err := s.ApplyInvoicePayment(ctx, inv.ID, now)
	if err != nil {
		t.Fatalf("ApplyInvoicePayment: %v", err)
	}
	if len(effects) != 3 {
		t.Fatalf("len(effects) = %d, want 3", len(effects))
	}
	// Application order is KIND order (plan, then addon, then service), not
	// invoice-position order — even though addon was listed first (position
	// 1) and the manual plan second (position 2).
	if effects[0].Kind != "plan" || effects[1].Kind != "addon" || effects[2].Kind != "service" {
		t.Fatalf("effect kinds = [%s, %s, %s], want [plan, addon, service] (kind order, not position order)",
			effects[0].Kind, effects[1].Kind, effects[2].Kind)
	}

	boosts, err := s.GetActiveLimitBoosts(ctx, tenantID)
	if err != nil {
		t.Fatalf("GetActiveLimitBoosts: %v", err)
	}
	if len(boosts) != 1 {
		t.Fatalf("len(boosts) = %d, want 1", len(boosts))
	}
	if boosts[0].Delta != 1000 {
		t.Fatalf("Delta = %d, want 1000 (500 x quantity 2)", boosts[0].Delta)
	}
	wantValidUntil := now.Add(30 * 24 * time.Hour)
	if diff := boosts[0].ValidUntil.Sub(wantValidUntil); diff < -time.Minute || diff > time.Minute {
		t.Fatalf("ValidUntil = %v, want ~%v", boosts[0].ValidUntil, wantValidUntil)
	}

	// The manual plan line and the service line must not touch the subscription.
	subAfter, err := s.GetSubscriptionByTenantID(ctx, tenantID)
	if err != nil {
		t.Fatalf("GetSubscriptionByTenantID (after): %v", err)
	}
	if subAfter.Status != subBefore.Status {
		t.Fatalf("subscription Status changed by manual/service lines: before=%q after=%q", subBefore.Status, subAfter.Status)
	}
	if (subAfter.EndDate == nil) != (subBefore.EndDate == nil) {
		t.Fatalf("subscription EndDate presence changed by manual/service lines: before=%v after=%v", subBefore.EndDate, subAfter.EndDate)
	}
}

func TestApplyInvoicePaymentAddonUntilPeriodEndRequiresEndDate(t *testing.T) {
	s, pool, ctx := newBillingTestStore(t)
	tenantID := createBillingTestTenant(t, s, pool, ctx)
	planID := fetchPlanIDBySlug(t, pool, ctx, "pro")

	now := time.Now().UTC()
	if err := s.UpsertSubscription(ctx, &models.Subscription{
		TenantID:  tenantID,
		PlanID:    &planID,
		Status:    "active",
		StartDate: now,
		// EndDate deliberately left nil.
	}); err != nil {
		t.Fatalf("UpsertSubscription: %v", err)
	}

	addon := newAddonLine(1, "users", 5, 1, "until_period_end", nil)
	inv := newTestInvoice(tenantID)
	if err := s.CreateInvoice(ctx, inv, []*models.InvoiceLine{addon}); err != nil {
		t.Fatalf("CreateInvoice: %v", err)
	}

	_, _, err := s.ApplyInvoicePayment(ctx, inv.ID, now)
	if !errors.Is(err, ErrBoostNeedsEndDate) {
		t.Fatalf("ApplyInvoicePayment error = %v, want ErrBoostNeedsEndDate", err)
	}

	got, err := s.GetInvoiceByID(ctx, inv.ID)
	if err != nil {
		t.Fatalf("GetInvoiceByID: %v", err)
	}
	if got.Status != "issued" {
		t.Fatalf("Status = %q, want issued (whole tx rolled back)", got.Status)
	}

	boosts, err := s.GetActiveLimitBoosts(ctx, tenantID)
	if err != nil {
		t.Fatalf("GetActiveLimitBoosts: %v", err)
	}
	if len(boosts) != 0 {
		t.Fatalf("len(boosts) = %d, want 0 (rolled back)", len(boosts))
	}
}

// TestApplyInvoicePaymentAddonUntilPeriodEndRejectsPastEndDate pins the
// expire→pay walk (live-reproduced money-path bug, invoice СЧ-2026-0156): a
// subscription whose end_date has already lapsed must not let an
// until_period_end addon silently insert an already-expired boost. Without
// the past-date guard, ErrBoostNeedsEndDate previously fired only for a nil
// end_date — a ticker-expired subscription (end_date set but in the past)
// slipped through, taking the tenant's money for a boost that
// resolveTenantLimit/GetActiveLimitBoosts would never see.
func TestApplyInvoicePaymentAddonUntilPeriodEndRejectsPastEndDate(t *testing.T) {
	s, pool, ctx := newBillingTestStore(t)
	tenantID := createBillingTestTenant(t, s, pool, ctx)
	planID := fetchPlanIDBySlug(t, pool, ctx, "pro")

	now := time.Now().UTC()
	pastEnd := now.Add(-3 * 24 * time.Hour)
	if err := s.UpsertSubscription(ctx, &models.Subscription{
		TenantID:  tenantID,
		PlanID:    &planID,
		Status:    "expired",
		StartDate: now.Add(-60 * 24 * time.Hour),
		EndDate:   &pastEnd,
	}); err != nil {
		t.Fatalf("UpsertSubscription: %v", err)
	}

	addon := newAddonLine(1, "users", 5, 1, "until_period_end", nil)
	inv := newTestInvoice(tenantID)
	if err := s.CreateInvoice(ctx, inv, []*models.InvoiceLine{addon}); err != nil {
		t.Fatalf("CreateInvoice: %v", err)
	}

	_, _, err := s.ApplyInvoicePayment(ctx, inv.ID, now)
	if !errors.Is(err, ErrBoostNeedsEndDate) {
		t.Fatalf("ApplyInvoicePayment error = %v, want ErrBoostNeedsEndDate (past end_date must be rejected)", err)
	}

	got, err := s.GetInvoiceByID(ctx, inv.ID)
	if err != nil {
		t.Fatalf("GetInvoiceByID: %v", err)
	}
	if got.Status != "issued" {
		t.Fatalf("Status = %q, want issued (whole tx rolled back)", got.Status)
	}

	boosts, err := s.GetActiveLimitBoosts(ctx, tenantID)
	if err != nil {
		t.Fatalf("GetActiveLimitBoosts: %v", err)
	}
	if len(boosts) != 0 {
		t.Fatalf("len(boosts) = %d, want 0 (rolled back, no money-taken-nothing-delivered boost)", len(boosts))
	}
}

// TestApplyInvoicePaymentPlanBeforeAddonSameInvoice pins the ordering fix
// (live-reproduced, invoice СЧ-2026-0156): «тариф + надбавка until_period_end»
// on one invoice must succeed regardless of which line was listed first.
// Here the addon is at position 1 (before the plan at position 2) — under
// the old raw-position application order this 409ed (ErrBoostNeedsEndDate)
// because the addon ran before the plan line had set any end_date at all.
func TestApplyInvoicePaymentPlanBeforeAddonSameInvoice(t *testing.T) {
	s, pool, ctx := newBillingTestStore(t)
	tenantID := createBillingTestTenant(t, s, pool, ctx)
	planID := fetchPlanIDBySlug(t, pool, ctx, "pro")

	now := time.Now().UTC()
	// No pre-existing subscription: the plan line (on_payment) must create
	// one and set its end_date before the addon line (position 1, listed
	// first) reads it.
	addon := newAddonLine(1, "users", 5, 1, "until_period_end", nil)
	plan := newPlanLine(2, planID, "month", "on_payment", 1)
	inv := newTestInvoice(tenantID)
	if err := s.CreateInvoice(ctx, inv, []*models.InvoiceLine{addon, plan}); err != nil {
		t.Fatalf("CreateInvoice: %v", err)
	}

	paid, effects, err := s.ApplyInvoicePayment(ctx, inv.ID, now)
	if err != nil {
		t.Fatalf("ApplyInvoicePayment: %v (want success — plan line must apply before addon regardless of invoice position)", err)
	}
	if paid.Status != "paid" {
		t.Fatalf("Status = %q, want paid", paid.Status)
	}
	if len(effects) != 2 || effects[0].Kind != "plan" || effects[1].Kind != "addon" {
		t.Fatalf("effects = %+v, want [plan, addon] (kind order)", effects)
	}

	sub, err := s.GetSubscriptionByTenantID(ctx, tenantID)
	if err != nil {
		t.Fatalf("GetSubscriptionByTenantID: %v", err)
	}
	if sub.Status != "active" {
		t.Fatalf("subscription Status = %q, want active", sub.Status)
	}
	if sub.EndDate == nil {
		t.Fatal("subscription EndDate not set")
	}

	boosts, err := s.GetActiveLimitBoosts(ctx, tenantID)
	if err != nil {
		t.Fatalf("GetActiveLimitBoosts: %v", err)
	}
	if len(boosts) != 1 {
		t.Fatalf("len(boosts) = %d, want 1", len(boosts))
	}
	if diff := boosts[0].ValidUntil.Sub(*sub.EndDate); diff < -time.Second || diff > time.Second {
		t.Fatalf("boost ValidUntil = %v, want == subscription EndDate %v (the NEW end_date set by the plan line)",
			boosts[0].ValidUntil, sub.EndDate)
	}
}

func TestApplyInvoicePaymentGuardsStatus(t *testing.T) {
	s, pool, ctx := newBillingTestStore(t)
	tenantID := createBillingTestTenant(t, s, pool, ctx)
	now := time.Now().UTC()

	inv := newTestInvoice(tenantID)
	if err := s.CreateInvoice(ctx, inv, []*models.InvoiceLine{newServiceLine(1)}); err != nil {
		t.Fatalf("CreateInvoice: %v", err)
	}

	if _, _, err := s.ApplyInvoicePayment(ctx, inv.ID, now); err != nil {
		t.Fatalf("ApplyInvoicePayment (1st): %v", err)
	}
	if _, _, err := s.ApplyInvoicePayment(ctx, inv.ID, now); !errors.Is(err, ErrInvoiceNotIssued) {
		t.Fatalf("ApplyInvoicePayment (2nd) error = %v, want ErrInvoiceNotIssued", err)
	}
	if err := s.CancelInvoice(ctx, inv.ID); !errors.Is(err, ErrInvoiceNotIssued) {
		t.Fatalf("CancelInvoice (after paid) error = %v, want ErrInvoiceNotIssued", err)
	}

	inv2 := newTestInvoice(tenantID)
	if err := s.CreateInvoice(ctx, inv2, []*models.InvoiceLine{newServiceLine(1)}); err != nil {
		t.Fatalf("CreateInvoice (2): %v", err)
	}
	if err := s.CancelInvoice(ctx, inv2.ID); err != nil {
		t.Fatalf("CancelInvoice: %v", err)
	}
	got, err := s.GetInvoiceByID(ctx, inv2.ID)
	if err != nil {
		t.Fatalf("GetInvoiceByID: %v", err)
	}
	if got.Status != "cancelled" {
		t.Fatalf("Status = %q, want cancelled", got.Status)
	}
	if got.CancelledAt == nil {
		t.Fatal("CancelledAt not set")
	}
}

func TestResolveTenantLimitAddsActiveBoosts(t *testing.T) {
	s, pool, ctx := newBillingTestStore(t)
	tenantID := createBillingTestTenant(t, s, pool, ctx)
	planID := fetchPlanIDBySlug(t, pool, ctx, "free")
	now := time.Now().UTC()

	if err := s.UpsertSubscription(ctx, &models.Subscription{
		TenantID:     tenantID,
		PlanID:       &planID,
		Status:       "active",
		StartDate:    now,
		CustomLimits: map[string]interface{}{"users": float64(3)},
	}); err != nil {
		t.Fatalf("UpsertSubscription: %v", err)
	}

	if _, err := pool.Exec(ctx,
		`INSERT INTO limit_boosts (tenant_id, limit_key, delta, valid_until) VALUES ($1, 'users', 2, $2)`,
		tenantID, now.Add(time.Hour)); err != nil {
		t.Fatalf("insert active boost: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO limit_boosts (tenant_id, limit_key, delta, valid_until) VALUES ($1, 'users', 100, $2)`,
		tenantID, now.Add(-time.Hour)); err != nil {
		t.Fatalf("insert expired boost: %v", err)
	}

	_, _, max, err := s.CheckTenantLimit(ctx, tenantID, "users")
	if err != nil {
		t.Fatalf("CheckTenantLimit: %v", err)
	}
	if max != 5 {
		t.Fatalf("max = %d, want 5 (custom limit 3 + active boost 2, expired boost excluded)", max)
	}

	// custom_limits = -1 (unlimited) must ignore boosts entirely.
	tenantID2 := createBillingTestTenant(t, s, pool, ctx)
	if err := s.UpsertSubscription(ctx, &models.Subscription{
		TenantID:     tenantID2,
		PlanID:       &planID,
		Status:       "active",
		StartDate:    now,
		CustomLimits: map[string]interface{}{"users": float64(-1)},
	}); err != nil {
		t.Fatalf("UpsertSubscription (unlimited): %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO limit_boosts (tenant_id, limit_key, delta, valid_until) VALUES ($1, 'users', 10, $2)`,
		tenantID2, now.Add(time.Hour)); err != nil {
		t.Fatalf("insert boost (unlimited tenant): %v", err)
	}

	_, _, max2, err := s.CheckTenantLimit(ctx, tenantID2, "users")
	if err != nil {
		t.Fatalf("CheckTenantLimit (unlimited): %v", err)
	}
	if max2 != -1 {
		t.Fatalf("max2 = %d, want -1 (unlimited ignores boosts)", max2)
	}
}

// TestExpireOverdueSubscriptions exercises the store method behind the
// subscription lifecycle ticker (billing.StartLifecycle / Task 5 of the
// billing-invoices plan) against a real Postgres database.
//
// The shared dev DB this test runs against may already contain OTHER
// overdue subscriptions left over from earlier test runs, so this test
// deliberately does NOT assert the method's global return count equals
// exactly the number of fixtures it creates here — only that it's at least
// that many, and that ITS OWN three fixture tenants land in the right
// states.
func TestExpireOverdueSubscriptions(t *testing.T) {
	s, pool, ctx := newBillingTestStore(t)
	planID := fetchAnyPlanID(t, s, ctx)
	now := time.Now()

	tenantTrialOverdue := createBillingTestTenant(t, s, pool, ctx)
	tenantActiveOverdue := createBillingTestTenant(t, s, pool, ctx)
	tenantActiveCurrent := createBillingTestTenant(t, s, pool, ctx)

	yesterday := now.Add(-24 * time.Hour)
	tomorrow := now.Add(24 * time.Hour)

	if err := s.UpsertSubscription(ctx, &models.Subscription{
		TenantID:     tenantTrialOverdue,
		PlanID:       &planID,
		Status:       "trial",
		StartDate:    now.Add(-7 * 24 * time.Hour),
		TrialEndDate: &yesterday,
	}); err != nil {
		t.Fatalf("UpsertSubscription (trial overdue): %v", err)
	}
	if err := s.UpsertSubscription(ctx, &models.Subscription{
		TenantID:  tenantActiveOverdue,
		PlanID:    &planID,
		Status:    "active",
		StartDate: now.Add(-30 * 24 * time.Hour),
		EndDate:   &yesterday,
	}); err != nil {
		t.Fatalf("UpsertSubscription (active overdue): %v", err)
	}
	if err := s.UpsertSubscription(ctx, &models.Subscription{
		TenantID:  tenantActiveCurrent,
		PlanID:    &planID,
		Status:    "active",
		StartDate: now.Add(-30 * 24 * time.Hour),
		EndDate:   &tomorrow,
	}); err != nil {
		t.Fatalf("UpsertSubscription (active current): %v", err)
	}

	assertSubscriptionStatus := func(t *testing.T, tenantID uuid.UUID, want string) {
		t.Helper()
		var got string
		if err := pool.QueryRow(ctx, `SELECT status FROM subscriptions WHERE tenant_id = $1`, tenantID).Scan(&got); err != nil {
			t.Fatalf("query subscription status for %s: %v", tenantID, err)
		}
		if got != want {
			t.Errorf("subscription status for tenant %s = %q, want %q", tenantID, got, want)
		}
	}

	countAuditRows := func(t *testing.T, tenantID uuid.UUID) (n int, adminIDIsNull bool) {
		t.Helper()
		rows, err := pool.Query(ctx,
			`SELECT admin_user_id IS NULL FROM admin_audit_log
			  WHERE action = 'subscription_expired' AND target_type = 'tenant' AND target_id = $1`,
			tenantID)
		if err != nil {
			t.Fatalf("query admin_audit_log for %s: %v", tenantID, err)
		}
		defer rows.Close()
		adminIDIsNull = true
		for rows.Next() {
			var isNull bool
			if err := rows.Scan(&isNull); err != nil {
				t.Fatalf("scan admin_audit_log row: %v", err)
			}
			n++
			adminIDIsNull = adminIDIsNull && isNull
		}
		if err := rows.Err(); err != nil {
			t.Fatalf("iterate admin_audit_log rows: %v", err)
		}
		return n, adminIDIsNull
	}

	// First pass: expires the two overdue fixtures, leaves the current one
	// alone. Other leftover overdue subscriptions in the shared dev DB may
	// also be expired in the same pass, so only assert a lower bound.
	n, err := s.ExpireOverdueSubscriptions(ctx)
	if err != nil {
		t.Fatalf("ExpireOverdueSubscriptions: %v", err)
	}
	if n < 2 {
		t.Fatalf("ExpireOverdueSubscriptions returned %d, want >= 2 (this test's own two overdue fixtures)", n)
	}

	assertSubscriptionStatus(t, tenantTrialOverdue, "expired")
	assertSubscriptionStatus(t, tenantActiveOverdue, "expired")
	assertSubscriptionStatus(t, tenantActiveCurrent, "active")

	trialAuditCount, trialAuditNullActor := countAuditRows(t, tenantTrialOverdue)
	if trialAuditCount != 1 {
		t.Fatalf("admin_audit_log rows for trial-overdue tenant = %d, want 1", trialAuditCount)
	}
	if !trialAuditNullActor {
		t.Errorf("admin_audit_log row for trial-overdue tenant has non-NULL admin_user_id, want NULL")
	}

	activeAuditCount, activeAuditNullActor := countAuditRows(t, tenantActiveOverdue)
	if activeAuditCount != 1 {
		t.Fatalf("admin_audit_log rows for active-overdue tenant = %d, want 1", activeAuditCount)
	}
	if !activeAuditNullActor {
		t.Errorf("admin_audit_log row for active-overdue tenant has non-NULL admin_user_id, want NULL")
	}

	currentAuditCount, _ := countAuditRows(t, tenantActiveCurrent)
	if currentAuditCount != 0 {
		t.Fatalf("admin_audit_log rows for untouched tenant = %d, want 0", currentAuditCount)
	}

	// Second pass: idempotent. This test's own tenants must not change
	// again or gain additional audit rows (the global return count can
	// still be nonzero because of unrelated leftover overdue rows in the
	// shared dev DB, so it isn't asserted here).
	if _, err := s.ExpireOverdueSubscriptions(ctx); err != nil {
		t.Fatalf("ExpireOverdueSubscriptions (second pass): %v", err)
	}

	assertSubscriptionStatus(t, tenantTrialOverdue, "expired")
	assertSubscriptionStatus(t, tenantActiveOverdue, "expired")
	assertSubscriptionStatus(t, tenantActiveCurrent, "active")

	trialAuditCount2, _ := countAuditRows(t, tenantTrialOverdue)
	if trialAuditCount2 != 1 {
		t.Fatalf("admin_audit_log rows for trial-overdue tenant after second pass = %d, want 1 (idempotent, no new row)", trialAuditCount2)
	}
	activeAuditCount2, _ := countAuditRows(t, tenantActiveOverdue)
	if activeAuditCount2 != 1 {
		t.Fatalf("admin_audit_log rows for active-overdue tenant after second pass = %d, want 1 (idempotent, no new row)", activeAuditCount2)
	}
}
