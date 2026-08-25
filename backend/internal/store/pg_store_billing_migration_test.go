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
