package store

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	pgxmock "github.com/pashagolub/pgxmock/v4"
)

const listExpiredSQL = `SELECT id, name, archived_at FROM tenants\s+WHERE status = 'archived' AND archived_at < NOW\(\) - make_interval\(days => \$1\)`

const purgeDeleteSQL = `DELETE FROM tenants\s+WHERE id = \$1 AND status = 'archived' AND archived_at < NOW\(\) - make_interval\(days => \$2\)`

func expectPurgeTx(mock pgxmock.PgxPoolIface, id uuid.UUID) {
	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE users SET tenant_id = NULL`).
		WithArgs(id).
		WillReturnResult(pgxmock.NewResult("UPDATE", 0))
	mock.ExpectExec(purgeDeleteSQL).
		WithArgs(id, 90).
		WillReturnResult(pgxmock.NewResult("DELETE", 1))
	mock.ExpectExec(`INSERT INTO admin_audit_log \(admin_user_id, action, target_type, target_id, changes\)`).
		WithArgs(id, pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))
	mock.ExpectCommit()
}

// retentionDays <= 0 means "disabled" — the method must not touch the
// database at all (a zero interval would otherwise match every archived
// tenant). No expectations are set, so any query would fail the test.
func TestPurgeExpiredTenantsNoopWhenRetentionDisabled(t *testing.T) {
	for _, days := range []int{0, -1} {
		mock, err := pgxmock.NewPool()
		if err != nil {
			t.Fatalf("pgxmock.NewPool: %v", err)
		}
		s := &PGStore{db: mock}
		purged, err := s.PurgeExpiredTenants(context.Background(), days)
		if err != nil || purged != nil {
			t.Errorf("PurgeExpiredTenants(%d) = %v, %v; want nil, nil", days, purged, err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unmet expectations: %v", err)
		}
		mock.Close()
	}
}

func TestPurgeExpiredTenantsPurgesEachInOneTx(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	idA, idB := uuid.New(), uuid.New()
	archived := time.Now().Add(-100 * 24 * time.Hour)
	mock.ExpectQuery(listExpiredSQL).
		WithArgs(90).
		WillReturnRows(pgxmock.NewRows([]string{"id", "name", "archived_at"}).
			AddRow(idA, "Org A", archived).
			AddRow(idB, "Org B", archived))
	expectPurgeTx(mock, idA)
	expectPurgeTx(mock, idB)

	s := &PGStore{db: mock}
	purged, err := s.PurgeExpiredTenants(context.Background(), 90)
	if err != nil {
		t.Fatalf("PurgeExpiredTenants: %v", err)
	}
	if len(purged) != 2 || purged[0].Name != "Org A" || purged[1].ID != idB {
		t.Errorf("purged = %+v; want Org A and Org B", purged)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestPurgeExpiredTenantsSkipsFailedTenantAndContinues(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	idA, idB := uuid.New(), uuid.New()
	archived := time.Now().Add(-100 * 24 * time.Hour)
	mock.ExpectQuery(listExpiredSQL).
		WithArgs(90).
		WillReturnRows(pgxmock.NewRows([]string{"id", "name", "archived_at"}).
			AddRow(idA, "Org A", archived).
			AddRow(idB, "Org B", archived))

	// Tenant A: delete fails mid-transaction → rollback, move on.
	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE users SET tenant_id = NULL`).
		WithArgs(idA).
		WillReturnResult(pgxmock.NewResult("UPDATE", 0))
	mock.ExpectExec(purgeDeleteSQL).
		WithArgs(idA, 90).
		WillReturnError(errors.New("fk violation"))
	mock.ExpectRollback()
	// Tenant B still purges.
	expectPurgeTx(mock, idB)

	s := &PGStore{db: mock}
	purged, err := s.PurgeExpiredTenants(context.Background(), 90)
	if err == nil {
		t.Fatal("want combined error for tenant A, got nil")
	}
	if len(purged) != 1 || purged[0].ID != idB {
		t.Errorf("purged = %+v; want only Org B", purged)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestPurgeExpiredTenantsSkipsReactivatedTenant covers the guarded DELETE:
// a candidate that was reactivated (or already purged by another replica)
// between the candidate SELECT and this transaction no longer matches the
// DELETE's WHERE clause. The purge must roll back silently — no audit
// entry, no commit, not counted as purged, and no error surfaced.
func TestPurgeExpiredTenantsSkipsReactivatedTenant(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	id := uuid.New()
	archived := time.Now().Add(-100 * 24 * time.Hour)
	mock.ExpectQuery(listExpiredSQL).
		WithArgs(90).
		WillReturnRows(pgxmock.NewRows([]string{"id", "name", "archived_at"}).
			AddRow(id, "Org A", archived))

	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE users SET tenant_id = NULL`).
		WithArgs(id).
		WillReturnResult(pgxmock.NewResult("UPDATE", 0))
	mock.ExpectExec(purgeDeleteSQL).
		WithArgs(id, 90).
		WillReturnResult(pgxmock.NewResult("DELETE", 0))
	mock.ExpectRollback()

	s := &PGStore{db: mock}
	purged, err := s.PurgeExpiredTenants(context.Background(), 90)
	if err != nil {
		t.Fatalf("PurgeExpiredTenants: want nil error, got %v", err)
	}
	if len(purged) != 0 {
		t.Errorf("purged = %+v; want empty", purged)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}
