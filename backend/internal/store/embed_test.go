package store

import (
	"testing"

	"idento/backend/migrations"
)

func TestEmbeddedMigrationsPresent(t *testing.T) {
	entries, err := migrations.Files.ReadDir(".")
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	found := map[string]bool{}
	for _, e := range entries {
		found[e.Name()] = true
	}
	for _, want := range []string{"000001_init_schema.up.sql", "000009_super_admin_billing.up.sql", "000011_api_keys_bcrypt.up.sql"} {
		if !found[want] {
			t.Errorf("embedded FS missing %s (got %d entries)", want, len(entries))
		}
	}
	if found["seed.sql"] {
		t.Error("seed.sql must NOT be embedded (glob is *.up.sql)")
	}
}
