package store

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// TestBillingMigrationShape pins migration 000029: kind-consistency CHECKs,
// status enum, per-year counter, snapshot columns, and full down-migration.
func TestBillingMigrationShape(t *testing.T) {
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller could not locate migration test")
	}
	dir := filepath.Join(filepath.Dir(currentFile), "..", "..", "migrations")
	upBytes, err := os.ReadFile(filepath.Join(dir, "000029_billing_invoices.up.sql"))
	if err != nil {
		t.Fatalf("read up migration: %v", err)
	}
	downBytes, err := os.ReadFile(filepath.Join(dir, "000029_billing_invoices.down.sql"))
	if err != nil {
		t.Fatalf("read down migration: %v", err)
	}
	up := strings.Join(strings.Fields(strings.ToLower(string(upBytes))), " ")
	down := strings.ToLower(string(downBytes))

	for _, fragment := range []string{
		"create table if not exists tenant_billing_profiles",
		"create table if not exists billing_catalog_items",
		"create table if not exists invoice_counters",
		"create table if not exists invoices",
		"create table if not exists invoice_lines",
		"create table if not exists limit_boosts",
		"kind in ('plan','service','addon')",
		"status in ('issued','paid','cancelled')",
		"period in ('month','year')",
		"default_activation in ('on_payment','after_current','manual')",
		"limit_key in ('attendees_per_event','events_per_month','users')",
		"validity in ('until_period_end','fixed_days')",
		"constraint billing_catalog_kind_plan check",
		"constraint billing_catalog_kind_addon check",
		"constraint billing_catalog_kind_service check",
		"number text not null unique",
		"quantity int not null check (quantity >= 1)",
		"valid_until timestamptz not null",
	} {
		if !strings.Contains(up, fragment) {
			t.Errorf("up migration missing %q", fragment)
		}
	}
	for _, table := range []string{
		"limit_boosts", "invoice_lines", "invoices", "invoice_counters",
		"billing_catalog_items", "tenant_billing_profiles",
	} {
		if !strings.Contains(down, "drop table if exists "+table) {
			t.Errorf("down migration missing drop of %s", table)
		}
	}
}

// TestInvoicesRestrictTenantDeleteMigrationShape pins migration 000030:
// invoices.tenant_id switches from ON DELETE CASCADE (000029) to ON DELETE
// RESTRICT so a tenant with invoices can never be hard-deleted and silently
// take its financial records with it; the down migration restores CASCADE.
func TestInvoicesRestrictTenantDeleteMigrationShape(t *testing.T) {
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller could not locate migration test")
	}
	dir := filepath.Join(filepath.Dir(currentFile), "..", "..", "migrations")
	upBytes, err := os.ReadFile(filepath.Join(dir, "000030_invoices_restrict_tenant_delete.up.sql"))
	if err != nil {
		t.Fatalf("read up migration: %v", err)
	}
	downBytes, err := os.ReadFile(filepath.Join(dir, "000030_invoices_restrict_tenant_delete.down.sql"))
	if err != nil {
		t.Fatalf("read down migration: %v", err)
	}
	up := strings.Join(strings.Fields(strings.ToLower(string(upBytes))), " ")
	down := strings.Join(strings.Fields(strings.ToLower(string(downBytes))), " ")

	if !strings.Contains(up, "drop constraint invoices_tenant_id_fkey") {
		t.Error("up migration missing drop of invoices_tenant_id_fkey")
	}
	if !strings.Contains(up, "foreign key (tenant_id) references tenants(id) on delete restrict") {
		t.Error("up migration missing RESTRICT re-add of invoices_tenant_id_fkey")
	}
	if !strings.Contains(down, "drop constraint invoices_tenant_id_fkey") {
		t.Error("down migration missing drop of invoices_tenant_id_fkey")
	}
	if !strings.Contains(down, "foreign key (tenant_id) references tenants(id) on delete cascade") {
		t.Error("down migration missing CASCADE restore of invoices_tenant_id_fkey")
	}
}

// TestSubscriptionsLifecycleIndexMigrationShape pins migration 000031: two
// partial indexes backing the hourly ExpireOverdueSubscriptions ticker query
// (WHERE (status='trial' AND trial_end_date < NOW()) OR (status='active' AND
// end_date < NOW())), each scoped to the status branch it serves, plus a
// full down-migration dropping both.
func TestSubscriptionsLifecycleIndexMigrationShape(t *testing.T) {
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller could not locate migration test")
	}
	dir := filepath.Join(filepath.Dir(currentFile), "..", "..", "migrations")
	upBytes, err := os.ReadFile(filepath.Join(dir, "000031_subscriptions_lifecycle_index.up.sql"))
	if err != nil {
		t.Fatalf("read up migration: %v", err)
	}
	downBytes, err := os.ReadFile(filepath.Join(dir, "000031_subscriptions_lifecycle_index.down.sql"))
	if err != nil {
		t.Fatalf("read down migration: %v", err)
	}
	up := strings.Join(strings.Fields(strings.ToLower(string(upBytes))), " ")
	down := strings.Join(strings.Fields(strings.ToLower(string(downBytes))), " ")

	for _, fragment := range []string{
		"create index if not exists idx_subscriptions_trial_expiry on subscriptions (trial_end_date) where status = 'trial'",
		"create index if not exists idx_subscriptions_active_expiry on subscriptions (end_date) where status = 'active'",
	} {
		if !strings.Contains(up, fragment) {
			t.Errorf("up migration missing %q", fragment)
		}
	}
	for _, index := range []string{"idx_subscriptions_trial_expiry", "idx_subscriptions_active_expiry"} {
		if !strings.Contains(down, "drop index if exists "+index) {
			t.Errorf("down migration missing drop of %s", index)
		}
	}
}
