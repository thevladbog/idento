package store

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	pgxmock "github.com/pashagolub/pgxmock/v4"
)

const (
	getUserByQRCredentialSQL  = `SELECT u\.id, u\.tenant_id, u\.email, u\.password_hash, u\.role, u\.is_super_admin,\s+c\.created_at, c\.tenant_id, c\.role, u\.created_at, u\.updated_at\s+FROM user_qr_credentials c\s+INNER JOIN users u ON u\.id = c\.user_id\s+WHERE c\.token = \$1`
	upsertUserQRCredentialSQL = `INSERT INTO user_qr_credentials \(user_id, tenant_id, role, token, created_at\)\s+VALUES \(\$1, \$2, \$3, \$4, \$5\)\s+ON CONFLICT \(user_id\) DO UPDATE\s+SET tenant_id = EXCLUDED\.tenant_id,\s+role = EXCLUDED\.role,\s+token = EXCLUDED\.token,\s+created_at = EXCLUDED\.created_at`
)

func TestUpdateUserQRTokenUpsertsCompleteScopedCredential(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	userID := uuid.New()
	tenantID := uuid.New()
	createdAt := time.Now()
	mock.ExpectExec(upsertUserQRCredentialSQL).
		WithArgs(userID, tenantID, "staff", pgxmock.AnyArg(), createdAt).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))

	s := &PGStore{db: mock}
	if err := s.UpdateUserQRToken(context.Background(), userID, tenantID, "staff", "opaque-test-value", createdAt); err != nil {
		t.Fatalf("UpdateUserQRToken: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestGetUserByQRTokenReadsOnlyScopedCredentialTable(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	userID := uuid.New()
	homeTenantID := uuid.New()
	activeTenantID := uuid.New()
	activeRole := "staff"
	issuedAt := time.Now()
	createdAt := issuedAt.Add(-time.Hour)
	updatedAt := issuedAt.Add(-time.Minute)
	mock.ExpectQuery(getUserByQRCredentialSQL).
		WithArgs(pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "email", "password_hash", "role", "is_super_admin",
			"credential_created_at", "credential_tenant_id", "credential_role", "created_at", "updated_at",
		}).AddRow(
			userID, homeTenantID, "staff@org.test", "hash", "admin", false,
			&issuedAt, &activeTenantID, &activeRole, createdAt, updatedAt,
		))

	s := &PGStore{db: mock}
	user, err := s.GetUserByQRToken(context.Background(), "opaque-test-value")
	if err != nil {
		t.Fatalf("GetUserByQRToken: %v", err)
	}
	if user == nil {
		t.Fatal("GetUserByQRToken returned nil user")
	}
	if user.QRToken != nil {
		t.Fatal("GetUserByQRToken retained raw credential material on the user model")
	}
	if !user.HasQRToken {
		t.Fatal("GetUserByQRToken did not mark scoped credential metadata present")
	}
	if user.QRTokenTenantID == nil || *user.QRTokenTenantID != activeTenantID || user.QRTokenRole == nil || *user.QRTokenRole != "staff" {
		t.Fatal("GetUserByQRToken did not scan the persisted tenant/role scope")
	}
	if user.QRTokenCreatedAt == nil || !user.QRTokenCreatedAt.Equal(issuedAt) {
		t.Fatal("GetUserByQRToken did not scan the scoped credential creation time")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestGetUserByQRTokenReturnsNilForUnknownCredential(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()
	mock.ExpectQuery(getUserByQRCredentialSQL).
		WithArgs(pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "email", "password_hash", "role", "is_super_admin",
			"credential_created_at", "credential_tenant_id", "credential_role", "created_at", "updated_at",
		}))

	s := &PGStore{db: mock}
	user, err := s.GetUserByQRToken(context.Background(), "opaque-test-value")
	if err != nil {
		t.Fatalf("GetUserByQRToken: %v", err)
	}
	if user != nil {
		t.Fatal("GetUserByQRToken returned a user for an unknown credential")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestGetUserByQRTokenPropagatesQueryError(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()
	wantErr := errors.New("query unavailable")
	mock.ExpectQuery(getUserByQRCredentialSQL).
		WithArgs(pgxmock.AnyArg()).
		WillReturnError(wantErr)

	s := &PGStore{db: mock}
	user, err := s.GetUserByQRToken(context.Background(), "opaque-test-value")
	if !errors.Is(err, wantErr) {
		t.Fatalf("GetUserByQRToken error = %v, want query error", err)
	}
	if user != nil {
		t.Fatal("GetUserByQRToken returned a user with a query error")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestGetUsersByTenantIDDerivesScopedCredentialMetadataWithoutRawToken(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()
	tenantID := uuid.New()
	userID := uuid.New()
	issuedAt := time.Now()
	createdAt := issuedAt.Add(-time.Hour)
	updatedAt := issuedAt.Add(-time.Minute)
	mock.ExpectQuery(`SELECT u\.id, u\.tenant_id, u\.email, u\.role, u\.is_super_admin,\s+\(q\.user_id IS NOT NULL\), q\.created_at, u\.created_at, u\.updated_at\s+FROM users u\s+LEFT JOIN user_qr_credentials q ON q\.user_id = u\.id AND q\.tenant_id = \$1\s+WHERE u\.tenant_id = \$1 ORDER BY u\.created_at DESC`).
		WithArgs(tenantID).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "email", "role", "is_super_admin", "has_qr_token", "qr_token_created_at", "created_at", "updated_at",
		}).AddRow(userID, tenantID, "staff@org.test", "staff", false, true, &issuedAt, createdAt, updatedAt))

	s := &PGStore{db: mock}
	users, err := s.GetUsersByTenantID(context.Background(), tenantID)
	if err != nil {
		t.Fatalf("GetUsersByTenantID: %v", err)
	}
	if len(users) != 1 || !users[0].HasQRToken || users[0].QRTokenCreatedAt == nil || !users[0].QRTokenCreatedAt.Equal(issuedAt) {
		t.Fatal("GetUsersByTenantID did not preserve scoped QR credential metadata")
	}
	if users[0].QRToken != nil {
		t.Fatal("GetUsersByTenantID selected raw credential material")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestGetEventStaffDerivesEventScopedCredentialMetadataWithoutChangingRoleSemantics(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()
	eventID := uuid.New()
	homeTenantID := uuid.New()
	userID := uuid.New()
	issuedAt := time.Now()
	createdAt := issuedAt.Add(-time.Hour)
	updatedAt := issuedAt.Add(-time.Minute)
	mock.ExpectQuery(`SELECT u\.id, u\.tenant_id, u\.email, u\.role, u\.is_super_admin,\s+\(q\.user_id IS NOT NULL\), q\.created_at, u\.created_at, u\.updated_at\s+FROM users u\s+INNER JOIN event_staff es ON u\.id = es\.user_id\s+INNER JOIN events e ON e\.id = es\.event_id\s+LEFT JOIN user_qr_credentials q ON q\.user_id = u\.id AND q\.tenant_id = e\.tenant_id\s+WHERE es\.event_id = \$1\s+ORDER BY es\.assigned_at DESC`).
		WithArgs(eventID).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "email", "role", "is_super_admin", "has_qr_token", "qr_token_created_at", "created_at", "updated_at",
		}).AddRow(userID, homeTenantID, "staff@org.test", "admin", false, true, &issuedAt, createdAt, updatedAt))

	s := &PGStore{db: mock}
	users, err := s.GetEventStaff(context.Background(), eventID)
	if err != nil {
		t.Fatalf("GetEventStaff: %v", err)
	}
	if len(users) != 1 || !users[0].HasQRToken || users[0].QRTokenCreatedAt == nil || !users[0].QRTokenCreatedAt.Equal(issuedAt) {
		t.Fatal("GetEventStaff did not preserve event-scoped QR credential metadata")
	}
	if users[0].TenantID != homeTenantID || users[0].Role != "admin" {
		t.Fatal("Task 16 unexpectedly changed GetEventStaff tenant/role semantics")
	}
	if users[0].QRToken != nil {
		t.Fatal("GetEventStaff selected raw credential material")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestScopeUserQRTokensMigrationIsRollbackSafeAndDisablesLegacyStorage(t *testing.T) {
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller could not locate migration test")
	}
	migrationsDir := filepath.Join(filepath.Dir(currentFile), "..", "..", "migrations")
	upBytes, err := os.ReadFile(filepath.Join(migrationsDir, "000026_scope_user_qr_tokens.up.sql"))
	if err != nil {
		t.Fatalf("read up migration: %v", err)
	}
	downBytes, err := os.ReadFile(filepath.Join(migrationsDir, "000026_scope_user_qr_tokens.down.sql"))
	if err != nil {
		t.Fatalf("read down migration: %v", err)
	}
	up := strings.Join(strings.Fields(strings.ToLower(string(upBytes))), " ")
	down := strings.Join(strings.Fields(strings.ToLower(string(downBytes))), " ")

	for _, fragment := range []string{
		"create table user_qr_credentials",
		"user_id uuid primary key references users(id) on delete cascade",
		"tenant_id uuid not null references tenants(id) on delete cascade",
		"token varchar(255) not null unique",
		"role varchar(50) not null check (role in ('admin', 'manager', 'staff'))",
		"created_at timestamp with time zone not null",
		"update users set qr_token = null, qr_token_created_at = null",
		"check (qr_token is null and qr_token_created_at is null)",
	} {
		if !strings.Contains(up, fragment) {
			t.Errorf("up migration missing required invariant %q", fragment)
		}
	}
	if strings.Contains(up, "add column qr_token_tenant_id") || strings.Contains(up, "add column qr_token_role") {
		t.Error("up migration still stores scope in legacy-readable users rows")
	}

	clearAt := strings.Index(down, "update users set qr_token = null, qr_token_created_at = null")
	dropTableAt := strings.Index(down, "drop table if exists user_qr_credentials")
	dropConstraintAt := strings.Index(down, "drop constraint if exists users_legacy_qr_disabled")
	if clearAt < 0 || dropTableAt < 0 || dropConstraintAt < 0 {
		t.Error("down migration is missing a rollback-safety operation")
	} else if clearAt >= dropTableAt || dropTableAt >= dropConstraintAt {
		t.Error("down migration must clear legacy columns before dropping scoped storage and the legacy-write constraint")
	}
}
