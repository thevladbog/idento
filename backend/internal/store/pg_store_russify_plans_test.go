package store

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// TestRussifyPlanSeedsMigrationGuardsOperatorEdits pins migration 000028:
// every UPDATE must be keyed by slug AND guarded by the old English/old
// price default, so plans an operator already customized through the
// console's plan editor are never clobbered. Name/description and price
// updates are independent statements (a price-only edit still gets the
// rename, and vice versa).
func TestRussifyPlanSeedsMigrationGuardsOperatorEdits(t *testing.T) {
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller could not locate migration test")
	}
	migrationsDir := filepath.Join(filepath.Dir(currentFile), "..", "..", "migrations")
	upBytes, err := os.ReadFile(filepath.Join(migrationsDir, "000028_russify_plan_seeds.up.sql"))
	if err != nil {
		t.Fatalf("read up migration: %v", err)
	}
	downBytes, err := os.ReadFile(filepath.Join(migrationsDir, "000028_russify_plan_seeds.down.sql"))
	if err != nil {
		t.Fatalf("read down migration: %v", err)
	}
	up := strings.Join(strings.Fields(strings.ToLower(string(upBytes))), " ")
	down := strings.Join(strings.Fields(strings.ToLower(string(downBytes))), " ")

	for _, fragment := range []string{
		// renames, keyed by slug + old default name
		"set name = 'бесплатный' where slug = 'free' and name = 'free'",
		"set name = 'стартовый' where slug = 'starter' and name = 'starter'",
		"set name = 'профессиональный' where slug = 'pro' and name = 'professional'",
		"set name = 'корпоративный' where slug = 'enterprise' and name = 'enterprise'",
		"set name = 'безлимитный' where slug = 'unlimited' and name = 'unlimited'",
		// prices, keyed by slug + BOTH old default prices
		"set price_monthly = 2990, price_yearly = 29900 where slug = 'starter' and price_monthly = 29 and price_yearly = 290",
		"set price_monthly = 9990, price_yearly = 99900 where slug = 'pro' and price_monthly = 99 and price_yearly = 990",
	} {
		if !strings.Contains(up, fragment) {
			t.Errorf("up migration missing guarded update %q", fragment)
		}
	}
	if strings.Contains(up, "where slug = 'free';") || strings.Contains(up, "where slug = 'starter';") {
		t.Error("up migration contains an unguarded slug-only update")
	}

	for _, fragment := range []string{
		"set name = 'free' where slug = 'free' and name = 'бесплатный'",
		"set price_monthly = 29, price_yearly = 290 where slug = 'starter' and price_monthly = 2990 and price_yearly = 29900",
	} {
		if !strings.Contains(down, fragment) {
			t.Errorf("down migration missing guarded restore %q", fragment)
		}
	}
}
