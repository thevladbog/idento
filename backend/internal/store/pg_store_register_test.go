package store

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	pgxmock "github.com/pashagolub/pgxmock/v4"
	"golang.org/x/crypto/bcrypt"
)

// expectTenantProvision scripts the tenant + default-plan subscription inserts
// that open every ProvisionTenantWithAdmin transaction.
func expectTenantProvision(mock pgxmock.PgxPoolIface, tenantName string, tenantID, planID uuid.UUID, now time.Time) {
	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO tenants`).
		WithArgs(tenantName).
		WillReturnRows(pgxmock.NewRows([]string{"id", "created_at", "updated_at"}).AddRow(tenantID, now, now))
	mock.ExpectQuery(`SELECT id FROM subscription_plans`).
		WillReturnRows(pgxmock.NewRows([]string{"id"}).AddRow(planID))
	mock.ExpectExec(`INSERT INTO subscriptions`).
		WithArgs(tenantID, planID).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))
}

// Store half of the register account-takeover fix (PR #26 review — SEC), the
// handler half is pinned in handler/auth_register_test.go: an EXISTING email
// with the wrong password must fail with ErrInvalidCredentials, attach no
// membership and commit nothing.
func TestProvisionTenantExistingEmailWrongPasswordRollsBack(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	tenantID, planID, userID := uuid.New(), uuid.New(), uuid.New()
	now := time.Now()
	storedHash, err := bcrypt.GenerateFromPassword([]byte("correct-password"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("bcrypt: %v", err)
	}

	expectTenantProvision(mock, "Evil Org", tenantID, planID, now)
	mock.ExpectQuery(`SELECT id, tenant_id, role, is_super_admin, password_hash`).
		WithArgs("victim@acme.test").
		WillReturnRows(pgxmock.NewRows([]string{"id", "tenant_id", "role", "is_super_admin", "password_hash", "created_at", "updated_at"}).
			AddRow(userID, uuid.New(), "admin", false, string(storedHash), now, now))
	// Rollback comes straight after the user lookup: if the code regresses to
	// attaching the membership without verifying the password, the unexpected
	// user_tenants INSERT (or commit) breaks this script.
	mock.ExpectRollback()

	s := &PGStore{db: mock}
	_, _, err = s.ProvisionTenantWithAdmin(context.Background(), "Evil Org", "victim@acme.test", "wrong-password")
	if !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("err = %v, want ErrInvalidCredentials", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// The legitimate join-by-register flow: an existing email with the CORRECT
// password reuses the account and attaches an admin membership in the new
// tenant.
func TestProvisionTenantExistingEmailCorrectPasswordAttachesMembership(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	tenantID, planID, userID := uuid.New(), uuid.New(), uuid.New()
	now := time.Now()
	storedHash, err := bcrypt.GenerateFromPassword([]byte("correct-password"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("bcrypt: %v", err)
	}

	expectTenantProvision(mock, "Second Org", tenantID, planID, now)
	mock.ExpectQuery(`SELECT id, tenant_id, role, is_super_admin, password_hash`).
		WithArgs("owner@acme.test").
		WillReturnRows(pgxmock.NewRows([]string{"id", "tenant_id", "role", "is_super_admin", "password_hash", "created_at", "updated_at"}).
			AddRow(userID, uuid.New(), "admin", false, string(storedHash), now, now))
	mock.ExpectExec(`INSERT INTO user_tenants`).
		WithArgs(userID, tenantID).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))
	mock.ExpectCommit()
	mock.ExpectRollback().WillReturnError(pgx.ErrTxClosed) // deferred rollback after commit

	s := &PGStore{db: mock}
	tenant, user, err := s.ProvisionTenantWithAdmin(context.Background(), "Second Org", "owner@acme.test", "correct-password")
	if err != nil {
		t.Fatalf("ProvisionTenantWithAdmin: %v", err)
	}
	if user.ID != userID {
		t.Errorf("user.ID = %s, want reused %s", user.ID, userID)
	}
	if tenant.ID != tenantID {
		t.Errorf("tenant.ID = %s, want %s", tenant.ID, tenantID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}
