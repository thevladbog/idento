package store

import (
	"sort"
	"testing"

	"idento/backend/migrations"
)

// Regression test for a real incident: 000014_audit_indexes.up.sql and
// 000014_mobile_stations.up.sql both shipped with version prefix "000014".
// RunMigrations recorded "000014" after the first one ran and then silently
// skipped the second forever, so the mobile-stations schema (stations,
// station_provisioning_tokens, checkin_overrides, batch_checkin_log,
// zone_scan_log, zone_access_rules.time_from/time_to) never got created on a
// fresh database. duplicateMigrationVersion() lets RunMigrations catch this
// before applying anything, rather than degrade into a silent no-op.
func TestDuplicateMigrationVersion(t *testing.T) {
	tests := []struct {
		name        string
		filenames   []string
		wantOK      bool
		wantFirst   string
		wantSecond  string
		wantVersion string
	}{
		{
			name:      "no collision",
			filenames: []string{"000001_init_schema.up.sql", "000002_add_user_permissions.up.sql"},
			wantOK:    false,
		},
		{
			name:        "collision between two different migrations sharing a version",
			filenames:   []string{"000014_audit_indexes.up.sql", "000014_mobile_stations.up.sql"},
			wantOK:      true,
			wantFirst:   "000014_audit_indexes.up.sql",
			wantSecond:  "000014_mobile_stations.up.sql",
			wantVersion: "000014",
		},
		{
			name:      "empty input",
			filenames: nil,
			wantOK:    false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			first, second, version, ok := duplicateMigrationVersion(tt.filenames)
			if ok != tt.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tt.wantOK)
			}
			if !ok {
				return
			}
			if first != tt.wantFirst || second != tt.wantSecond || version != tt.wantVersion {
				t.Errorf("got (%q, %q, %q), want (%q, %q, %q)",
					first, second, version, tt.wantFirst, tt.wantSecond, tt.wantVersion)
			}
		})
	}
}

// The currently embedded migration set must never regress into a version
// collision (this is what RunMigrations checks against a real database).
func TestEmbeddedMigrationsHaveNoVersionCollision(t *testing.T) {
	entries, err := migrations.Files.ReadDir(".")
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	var filenames []string
	for _, e := range entries {
		filenames = append(filenames, e.Name())
	}
	sort.Strings(filenames)

	if first, second, version, ok := duplicateMigrationVersion(filenames); ok {
		t.Fatalf("embedded migrations have a version collision: %q and %q both resolve to %q", first, second, version)
	}
}
