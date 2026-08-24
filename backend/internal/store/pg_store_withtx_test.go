package store

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	pgxmock "github.com/pashagolub/pgxmock/v4"
)

// TestWithTxSharesOneTransaction pins the WithTx contract: everything fn
// does on the store it receives runs between one BEGIN and one COMMIT --
// pgxmock enforces the ordering, so a statement escaping the transaction
// would fail the expectations.
func TestWithTxSharesOneTransaction(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	adminID := uuid.New()
	targetID := uuid.New()
	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO admin_audit_log`).
		WithArgs(adminID, "suspend_tenant", "tenant", targetID, pgxmock.AnyArg(), pgxmock.AnyArg(), "ua").
		WillReturnResult(pgxmock.NewResult("INSERT", 1))
	mock.ExpectCommit()

	s := &PGStore{db: mock}
	err = s.WithTx(context.Background(), func(tx Store) error {
		return tx.LogAdminAction(context.Background(), adminID, "suspend_tenant", "tenant", targetID,
			map[string]interface{}{"from": "active", "to": "suspended"}, "1.2.3.4", "ua")
	})
	if err != nil {
		t.Fatalf("WithTx: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestWithTxRollsBackAndReturnsFnError(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	mock.ExpectBegin()
	mock.ExpectRollback()

	s := &PGStore{db: mock}
	boom := errors.New("audit insert failed")
	err = s.WithTx(context.Background(), func(Store) error { return boom })
	if !errors.Is(err, boom) {
		t.Fatalf("WithTx error = %v, want the fn error", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}
