package store

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// TestFixCheckedInByFKMigrationReplacesTheNoOpConstraint pins migration
// 000027, which closes the PR #58-era backlog item: 000001 created
// attendees.checked_in_by with a plain FK, so 000005's
// `ADD COLUMN IF NOT EXISTS ... ON DELETE SET NULL` silently no-oped and
// the intended ON DELETE SET NULL never applied. The fix must drop the old
// constraint before re-adding it, carry the SET NULL action, and follow the
// 000026 precedent of NOT VALID + explicit VALIDATE so the existing-row
// scan never runs under the ALTER TABLE lock.
func TestFixCheckedInByFKMigrationReplacesTheNoOpConstraint(t *testing.T) {
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller could not locate migration test")
	}
	migrationsDir := filepath.Join(filepath.Dir(currentFile), "..", "..", "migrations")
	upBytes, err := os.ReadFile(filepath.Join(migrationsDir, "000027_fix_attendees_checked_in_by_fk.up.sql"))
	if err != nil {
		t.Fatalf("read up migration: %v", err)
	}
	downBytes, err := os.ReadFile(filepath.Join(migrationsDir, "000027_fix_attendees_checked_in_by_fk.down.sql"))
	if err != nil {
		t.Fatalf("read down migration: %v", err)
	}
	up := strings.Join(strings.Fields(strings.ToLower(string(upBytes))), " ")
	down := strings.Join(strings.Fields(strings.ToLower(string(downBytes))), " ")

	dropAt := strings.Index(up, "alter table attendees drop constraint if exists attendees_checked_in_by_fkey")
	addAt := strings.Index(up, "add constraint attendees_checked_in_by_fkey foreign key (checked_in_by) references users(id) on delete set null not valid")
	validateAt := strings.Index(up, "alter table attendees validate constraint attendees_checked_in_by_fkey")
	if dropAt < 0 || addAt < 0 || validateAt < 0 {
		t.Fatalf("up migration is missing a required operation (drop=%d add=%d validate=%d)", dropAt, addAt, validateAt)
	}
	if dropAt >= addAt || addAt >= validateAt {
		t.Error("up migration must drop the stale constraint, re-add it NOT VALID, then validate it -- in that order")
	}

	if !strings.Contains(down, "drop constraint if exists attendees_checked_in_by_fkey") {
		t.Error("down migration must drop the SET NULL constraint")
	}
	if !strings.Contains(down, "foreign key (checked_in_by) references users(id) not valid") {
		t.Error("down migration must restore the plain no-action FK 000001 actually created")
	}
	if strings.Contains(down, "on delete set null") {
		t.Error("down migration must not keep the SET NULL action")
	}
}
