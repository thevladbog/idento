package store

import (
	"context"
	"os"
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
