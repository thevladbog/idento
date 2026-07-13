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

func expectPurgeTx(mock pgxmock.PgxPoolIface, id uuid.UUID) {
	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE users SET tenant_id = NULL`).
		WithArgs(id).
		WillReturnResult(pgxmock.NewResult("UPDATE", 0))
	mock.ExpectExec(`DELETE FROM tenants WHERE id = \$1`).
		WithArgs(id).
		WillReturnResult(pgxmock.NewResult("DELETE", 1))
	mock.ExpectExec(`INSERT INTO admin_audit_log \(admin_user_id, action, target_type, target_id, changes\)`).
		WithArgs(id, pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))
	mock.ExpectCommit()
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
	mock.ExpectExec(`DELETE FROM tenants WHERE id = \$1`).
		WithArgs(idA).
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
