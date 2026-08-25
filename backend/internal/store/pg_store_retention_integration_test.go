package store

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestPurgeExpiredTenants_RealPostgres_CascadeDetachAndAudit closes the last
// PR #58 follow-up chip (real-DB integration test for the purge path): the
// pgxmock retention tests can only assert SQL text, not that the schema's
// actual FK graph lets the purge transaction complete — cascade deletion of
// all tenant data, survivor detachment, and the NULL-actor audit row are
// exactly the behaviors that live in Postgres, not in the Go code.
//
// It also pins the interaction with migration 000027: a check-in attributed
// to a purged user in a SURVIVING tenant must have its attendees.checked_in_by
// nulled by the (finally real) ON DELETE SET NULL — before 000027, that FK
// was a plain no-action constraint and this exact row would have aborted the
// whole purge transaction with a foreign-key violation.
//
// Gated behind TEST_DATABASE_URL and SKIPS when unset (the established
// integration-test idiom of this package). To run locally against the
// docker-compose db:
//
//	TEST_DATABASE_URL="postgres://idento:idento_password@localhost:5438/idento_db?sslmode=disable" \
//	  go test ./internal/store/ -run TestPurgeExpiredTenants_RealPostgres -v
func TestPurgeExpiredTenants_RealPostgres_CascadeDetachAndAudit(t *testing.T) {
	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping real-Postgres purge test (see doc comment for how to run it)")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

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

	now := time.Now()
	tenantPurge := uuid.New()    // archived 100 days ago -> purged at 90-day retention
	tenantKeep := uuid.New()     // active -> untouched
	tenantFresh := uuid.New()    // archived 10 days ago -> still within retention
	tenantInvoiced := uuid.New() // archived 100 days ago but HAS an invoice -> must be skipped, not purged

	mustExec := func(what, sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", what, err)
		}
	}

	mustExec("insert purge tenant",
		`INSERT INTO tenants (id, name, status, archived_at, created_at, updated_at) VALUES ($1, $2, 'archived', $3, $4, $4)`,
		tenantPurge, "Purge Target "+tenantPurge.String(), now.AddDate(0, 0, -100), now)
	mustExec("insert keep tenant",
		`INSERT INTO tenants (id, name, created_at, updated_at) VALUES ($1, $2, $3, $3)`,
		tenantKeep, "Purge Survivor "+tenantKeep.String(), now)
	mustExec("insert fresh-archived tenant",
		`INSERT INTO tenants (id, name, status, archived_at, created_at, updated_at) VALUES ($1, $2, 'archived', $3, $4, $4)`,
		tenantFresh, "Purge Too-Fresh "+tenantFresh.String(), now.AddDate(0, 0, -10), now)
	mustExec("insert invoiced archived tenant",
		`INSERT INTO tenants (id, name, status, archived_at, created_at, updated_at) VALUES ($1, $2, 'archived', $3, $4, $4)`,
		tenantInvoiced, "Purge Invoiced "+tenantInvoiced.String(), now.AddDate(0, 0, -100), now)

	// A retained financial document (migration 000030: invoices.tenant_id is
	// ON DELETE RESTRICT) that must block the hard-purge of tenantInvoiced
	// even though it's otherwise past retention.
	invoiceID := uuid.New()
	mustExec("insert invoice blocking purge",
		`INSERT INTO invoices (id, number, tenant_id, status, buyer_name, buyer_inn, buyer_address,
		    seller_name, seller_inn, seller_bank_name, seller_bank_account, seller_bank_bik, total, created_at, updated_at)
		 VALUES ($1, $2, $3, 'issued', 'Buyer LLC', '7700000000', 'Addr',
		    'Seller LLC', '7711111111', 'Bank', '40702810000000000001', '044525225', 1000, $4, $4)`,
		invoiceID, "СЧ-PURGE-ITEST-"+invoiceID.String()[:8], tenantInvoiced, now)

	// Four users homed in the doomed tenant, one per survival rule:
	//   solo  — no other memberships, not special -> cascades away entirely.
	//   super — is_super_admin                    -> detached, survives.
	//   multi — member of tenantKeep too          -> detached, survives.
	//   actor — has an admin_audit_log actor row  -> detached, survives.
	solo, super, multi, actor := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	insertUser := func(id uuid.UUID, tag string, isSuper bool) {
		t.Helper()
		mustExec("insert user "+tag,
			`INSERT INTO users (id, tenant_id, email, password_hash, role, is_super_admin, created_at, updated_at)
			 VALUES ($1, $2, $3, 'x', 'admin', $4, $5, $5)`,
			id, tenantPurge, tag+"-"+id.String()+"@purge.test", isSuper, now)
		mustExec("insert membership "+tag,
			`INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, 'admin')`,
			id, tenantPurge)
	}
	insertUser(solo, "solo", false)
	insertUser(super, "super", true)
	insertUser(multi, "multi", false)
	insertUser(actor, "actor", false)
	mustExec("insert multi's surviving membership",
		`INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, 'member')`,
		multi, tenantKeep)
	seedAuditID := uuid.New()
	mustExec("insert actor's pre-existing audit row",
		`INSERT INTO admin_audit_log (id, admin_user_id, action, target_type, target_id, changes)
		 VALUES ($1, $2, 'suspend_tenant', 'tenant', $3, '{}')`,
		seedAuditID, actor, tenantPurge)

	// Tenant data that must cascade away with the purge...
	eventPurge, zonePurge, attendeePurge := uuid.New(), uuid.New(), uuid.New()
	mustExec("insert purge event",
		`INSERT INTO events (id, tenant_id, name, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)`,
		eventPurge, tenantPurge, "Doomed Event", now)
	mustExec("insert purge zone",
		`INSERT INTO event_zones (id, event_id, name, created_at, updated_at) VALUES ($1, $2, 'Doomed Zone', $3, $3)`,
		zonePurge, eventPurge, now)
	mustExec("insert purge attendee",
		`INSERT INTO attendees (id, event_id, first_name, last_name, code, checked_in_by, created_at, updated_at)
		 VALUES ($1, $2, 'Ada', 'Doomed', $3, $4, $5, $5)`,
		attendeePurge, eventPurge, "P-"+attendeePurge.String()[:8], solo, now)
	mustExec("insert purge user's scoped QR credential",
		`INSERT INTO user_qr_credentials (user_id, tenant_id, token_digest, role, created_at)
		 VALUES ($1, $2, $3, 'staff', $4)`,
		solo, tenantPurge, qrTokenDigest("purge-itest-"+solo.String()), now)

	// ...and a SURVIVING tenant's attendee whose check-in was performed by
	// the doomed solo user (multi-org staff make this reachable in real
	// data). Pre-000027 this row's plain FK aborted the whole purge.
	eventKeep, attendeeKeep := uuid.New(), uuid.New()
	mustExec("insert keep event",
		`INSERT INTO events (id, tenant_id, name, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)`,
		eventKeep, tenantKeep, "Surviving Event", now)
	mustExec("insert keep attendee checked in by the doomed user",
		`INSERT INTO attendees (id, event_id, first_name, last_name, code, checked_in_by, checked_in_at, created_at, updated_at)
		 VALUES ($1, $2, 'Kay', 'Survives', $3, $4, $5, $5, $5)`,
		attendeeKeep, eventKeep, "K-"+attendeeKeep.String()[:8], solo, now)

	t.Cleanup(func() {
		cctx, ccancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer ccancel()
		// Invoice first: it's what keeps tenantInvoiced alive via RESTRICT, so
		// it must go before the tenant delete below.
		if _, err := pool.Exec(cctx, `DELETE FROM invoices WHERE id = $1`, invoiceID); err != nil {
			t.Logf("cleanup invoice: %v", err)
		}
		for _, sql := range []string{
			`DELETE FROM tenants WHERE id IN ($1, $2, $3, $4)`,
			`DELETE FROM admin_audit_log WHERE target_id IN ($1, $2, $3, $4)`,
		} {
			if _, err := pool.Exec(cctx, sql, tenantPurge, tenantKeep, tenantFresh, tenantInvoiced); err != nil {
				t.Logf("cleanup %q: %v", sql, err)
			}
		}
		// Detached survivors are no longer reachable via the tenant cascade.
		if _, err := pool.Exec(cctx, `DELETE FROM users WHERE id IN ($1, $2, $3, $4)`, solo, super, multi, actor); err != nil {
			t.Logf("cleanup users: %v", err)
		}
	})

	purged, err := s.PurgeExpiredTenants(ctx, 90)
	if err != nil {
		t.Fatalf("PurgeExpiredTenants: %v", err)
	}
	// The shared dev DB may contain other stale archived tenants; assert on
	// OUR fixtures, not on the global list length.
	foundPurge, foundFresh, foundInvoiced := false, false, false
	for _, p := range purged {
		if p.ID == tenantPurge {
			foundPurge = true
			if p.Name != "Purge Target "+tenantPurge.String() {
				t.Errorf("purged name = %q, want the seeded name", p.Name)
			}
		}
		if p.ID == tenantFresh {
			foundFresh = true
		}
		if p.ID == tenantInvoiced {
			foundInvoiced = true
		}
	}
	if !foundPurge {
		t.Fatal("the 100-day-archived tenant was not purged")
	}
	if foundFresh {
		t.Fatal("the 10-day-archived tenant was purged despite being within retention")
	}
	if foundInvoiced {
		t.Fatal("the invoiced archived tenant was purged despite having a retained invoice")
	}

	countRows := func(what, sql string, args ...any) int {
		t.Helper()
		var n int
		if err := pool.QueryRow(ctx, sql, args...).Scan(&n); err != nil {
			t.Fatalf("count %s: %v", what, err)
		}
		return n
	}

	t.Run("the tenant and all its data are gone; other tenants are intact", func(t *testing.T) {
		if n := countRows("purged tenant", `SELECT COUNT(*) FROM tenants WHERE id = $1`, tenantPurge); n != 0 {
			t.Errorf("tenants rows = %d, want 0", n)
		}
		if n := countRows("surviving tenants", `SELECT COUNT(*) FROM tenants WHERE id IN ($1, $2)`, tenantKeep, tenantFresh); n != 2 {
			t.Errorf("surviving tenant rows = %d, want 2", n)
		}
		if n := countRows("purged events", `SELECT COUNT(*) FROM events WHERE id = $1`, eventPurge); n != 0 {
			t.Errorf("event rows = %d, want 0", n)
		}
		if n := countRows("purged zones", `SELECT COUNT(*) FROM event_zones WHERE id = $1`, zonePurge); n != 0 {
			t.Errorf("zone rows = %d, want 0", n)
		}
		if n := countRows("purged attendees", `SELECT COUNT(*) FROM attendees WHERE id = $1`, attendeePurge); n != 0 {
			t.Errorf("attendee rows = %d, want 0", n)
		}
		if n := countRows("purged QR credentials", `SELECT COUNT(*) FROM user_qr_credentials WHERE user_id = $1`, solo); n != 0 {
			t.Errorf("qr credential rows = %d, want 0", n)
		}
	})

	t.Run("an archived tenant past retention with an invoice is skipped, invoice and tenant both survive", func(t *testing.T) {
		if n := countRows("invoiced tenant", `SELECT COUNT(*) FROM tenants WHERE id = $1`, tenantInvoiced); n != 1 {
			t.Errorf("invoiced tenant rows = %d, want 1 (must survive purge despite being past retention)", n)
		}
		if n := countRows("blocking invoice", `SELECT COUNT(*) FROM invoices WHERE id = $1`, invoiceID); n != 1 {
			t.Errorf("invoice rows = %d, want 1 (financial record must survive)", n)
		}
	})

	t.Run("solo user cascades away; the three protected users survive detached", func(t *testing.T) {
		if n := countRows("solo user", `SELECT COUNT(*) FROM users WHERE id = $1`, solo); n != 0 {
			t.Errorf("solo user rows = %d, want 0", n)
		}
		for _, u := range []struct {
			name string
			id   uuid.UUID
		}{{"super", super}, {"multi", multi}, {"actor", actor}} {
			var tenantID *uuid.UUID
			if err := pool.QueryRow(ctx, `SELECT tenant_id FROM users WHERE id = $1`, u.id).Scan(&tenantID); err != nil {
				t.Fatalf("%s user vanished: %v", u.name, err)
			}
			if tenantID != nil {
				t.Errorf("%s user tenant_id = %v, want NULL (detached)", u.name, tenantID)
			}
		}
		if n := countRows("multi's surviving membership",
			`SELECT COUNT(*) FROM user_tenants WHERE user_id = $1 AND tenant_id = $2`, multi, tenantKeep); n != 1 {
			t.Errorf("multi's tenantKeep membership rows = %d, want 1", n)
		}
		if n := countRows("purged memberships", `SELECT COUNT(*) FROM user_tenants WHERE tenant_id = $1`, tenantPurge); n != 0 {
			t.Errorf("doomed-tenant membership rows = %d, want 0", n)
		}
	})

	t.Run("migration 000027 for real: the surviving attendee's attribution is nulled, not FK-blocked", func(t *testing.T) {
		var checkedInBy *uuid.UUID
		var checkedInAt *time.Time
		if err := pool.QueryRow(ctx,
			`SELECT checked_in_by, checked_in_at FROM attendees WHERE id = $1`, attendeeKeep,
		).Scan(&checkedInBy, &checkedInAt); err != nil {
			t.Fatalf("surviving attendee vanished: %v", err)
		}
		if checkedInBy != nil {
			t.Errorf("checked_in_by = %v, want NULL after the attributed user was purged", checkedInBy)
		}
		if checkedInAt == nil {
			t.Error("checked_in_at was lost; only the attribution should be nulled")
		}
	})

	t.Run("a NULL-actor purge audit row is written; the actor's own history survives", func(t *testing.T) {
		var actorID *uuid.UUID
		var changesName string
		if err := pool.QueryRow(ctx,
			`SELECT admin_user_id, changes->>'name' FROM admin_audit_log WHERE action = 'purge_tenant' AND target_id = $1`,
			tenantPurge,
		).Scan(&actorID, &changesName); err != nil {
			t.Fatalf("purge audit row missing: %v", err)
		}
		if actorID != nil {
			t.Errorf("audit admin_user_id = %v, want NULL (system actor)", actorID)
		}
		if changesName != "Purge Target "+tenantPurge.String() {
			t.Errorf("audit changes name = %q, want the purged tenant's name", changesName)
		}
		if n := countRows("actor's seed audit row", `SELECT COUNT(*) FROM admin_audit_log WHERE id = $1`, seedAuditID); n != 1 {
			t.Errorf("actor's pre-existing audit rows = %d, want 1 (must survive the purge)", n)
		}
	})

	t.Run("a second run is a no-op: no re-purge, no duplicate audit row", func(t *testing.T) {
		again, err := s.PurgeExpiredTenants(ctx, 90)
		if err != nil {
			t.Fatalf("second PurgeExpiredTenants: %v", err)
		}
		for _, p := range again {
			if p.ID == tenantPurge {
				t.Fatal("second run reported the already-purged tenant again")
			}
		}
		if n := countRows("purge audit rows", `SELECT COUNT(*) FROM admin_audit_log WHERE action = 'purge_tenant' AND target_id = $1`, tenantPurge); n != 1 {
			t.Errorf("purge audit rows = %d, want exactly 1", n)
		}
	})
}
