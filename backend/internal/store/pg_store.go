package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"idento/backend/internal/models"
	"idento/backend/migrations"
	"io/fs"
	"log"
	"math"
	"net/netip"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

// dbConn is the subset of *pgxpool.Pool the store uses, narrowed to an
// interface so tests can substitute an in-memory mock (pgxmock).
type dbConn interface {
	Begin(ctx context.Context) (pgx.Tx, error)
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Close()
}

type PGStore struct {
	db dbConn
}

func NewPGStore(dbURL string) (*PGStore, error) {
	pool, err := pgxpool.New(context.Background(), dbURL)
	if err != nil {
		return nil, err
	}

	if err := pool.Ping(context.Background()); err != nil {
		return nil, err
	}

	return &PGStore{db: pool}, nil
}

func (s *PGStore) Close() {
	s.db.Close()
}

func (s *PGStore) RunMigrations() error {
	log.Printf("Running migrations...")
	// Create schema_migrations table if not exists
	_, err := s.db.Exec(context.Background(), `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version VARCHAR(255) PRIMARY KEY,
			applied_at TIMESTAMP DEFAULT NOW()
		)
	`)
	if err != nil {
		return fmt.Errorf("failed to create schema_migrations table: %w", err)
	}

	// Read migration files from the embedded FS (binary is self-contained).
	entries, err := fs.ReadDir(migrations.Files, ".")
	if err != nil {
		return fmt.Errorf("failed to read embedded migrations: %w", err)
	}

	var migrationFiles []string
	for _, entry := range entries {
		migrationFiles = append(migrationFiles, entry.Name())
	}
	sort.Strings(migrationFiles)

	// schema_migrations is keyed on the numeric version prefix alone, so two
	// files sharing a prefix would make the second one silently no-op (it
	// looks "already applied"). Fail fast instead of skipping it forever.
	if a, b, version, ok := duplicateMigrationVersion(migrationFiles); ok {
		return fmt.Errorf("migration version collision: %q and %q both resolve to version %q", a, b, version)
	}

	appliedCount := 0
	for _, filename := range migrationFiles {
		// Extract version from filename (e.g., "000001_init_schema.up.sql" -> "000001")
		version := strings.Split(filename, "_")[0]

		// Check if already applied — skip if yes
		var exists bool
		err := s.db.QueryRow(context.Background(),
			`SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)`, version).Scan(&exists)
		if err != nil {
			return fmt.Errorf("failed to check migration status: %w", err)
		}

		if exists {
			log.Printf("Migration %s: already applied, skipping", filename)
			continue
		}

		// Read and execute migration
		content, err := migrations.Files.ReadFile(filename)
		if err != nil {
			return fmt.Errorf("failed to read migration %s: %w", filename, err)
		}

		log.Printf("Applying migration %s...", filename)
		_, err = s.db.Exec(context.Background(), string(content))
		if err != nil {
			return fmt.Errorf("failed to execute migration %s: %w", filename, err)
		}

		_, err = s.db.Exec(context.Background(),
			`INSERT INTO schema_migrations (version) VALUES ($1)`, version)
		if err != nil {
			return fmt.Errorf("failed to record migration %s: %w", version, err)
		}

		appliedCount++
		log.Printf("Migration %s: applied", filename)
	}

	if appliedCount == 0 {
		log.Printf("Migrations: no new migrations to apply")
	} else {
		log.Printf("Migrations: applied %d migration(s)", appliedCount)
	}
	return nil
}

// duplicateMigrationVersion reports the first pair of sorted migration
// filenames whose version prefix (the text before the first "_") collides,
// e.g. "000014_a.up.sql" and "000014_b.up.sql" both resolving to "000014".
func duplicateMigrationVersion(sortedFilenames []string) (first, second, version string, ok bool) {
	var prevVersion, prevFilename string
	for _, filename := range sortedFilenames {
		v := strings.Split(filename, "_")[0]
		if v == prevVersion {
			return prevFilename, filename, v, true
		}
		prevVersion, prevFilename = v, filename
	}
	return "", "", "", false
}

// Implement Store interface methods

func (s *PGStore) CreateTenant(ctx context.Context, tenant *models.Tenant) error {
	query := `INSERT INTO tenants (name) VALUES ($1) RETURNING id, created_at, updated_at`
	return s.db.QueryRow(ctx, query, tenant.Name).Scan(&tenant.ID, &tenant.CreatedAt, &tenant.UpdatedAt)
}

func (s *PGStore) CreateTenantWithDefaultSubscription(ctx context.Context, tenant *models.Tenant) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() {
		if err := tx.Rollback(ctx); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
			log.Printf("rollback tenant provisioning: %v", err)
		}
	}()

	if err := tx.QueryRow(ctx,
		`INSERT INTO tenants (name) VALUES ($1) RETURNING id, created_at, updated_at`,
		tenant.Name).Scan(&tenant.ID, &tenant.CreatedAt, &tenant.UpdatedAt); err != nil {
		return err
	}

	var planID uuid.UUID
	if err := tx.QueryRow(ctx,
		`SELECT id FROM subscription_plans WHERE is_default AND is_active ORDER BY sort_order LIMIT 1`).Scan(&planID); err != nil {
		if err == pgx.ErrNoRows {
			return fmt.Errorf("no default subscription plan configured: %w", err)
		}
		return fmt.Errorf("lookup default subscription plan: %w", err)
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO subscriptions (tenant_id, plan_id, status, start_date) VALUES ($1, $2, 'active', NOW())`,
		tenant.ID, planID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// ErrInvalidCredentials is returned when registration hits an existing email
// and the supplied password does not match that account's password hash.
var ErrInvalidCredentials = errors.New("invalid credentials for existing user")

// ProvisionTenantWithAdmin registers a tenant, its default-plan subscription,
// the admin user (created, or reused by email after verifying the supplied
// password against the stored hash — attaching a new org to an account
// requires proving you own it), and the user_tenants membership row in a
// single transaction, so a mid-way failure (or a killed process) leaves no
// orphan tenant/user/subscription rows.
func (s *PGStore) ProvisionTenantWithAdmin(ctx context.Context, tenantName, email, password string) (*models.Tenant, *models.User, error) {
	// Hash before opening the transaction (bcrypt is slow; don't hold a tx).
	// Hashing unconditionally also keeps register timing flat whether or not
	// the email already exists.
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, nil, fmt.Errorf("hash password: %w", err)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, nil, err
	}
	defer func() {
		if err := tx.Rollback(ctx); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
			log.Printf("rollback tenant registration: %v", err)
		}
	}()

	tenant := &models.Tenant{Name: tenantName}
	if err := tx.QueryRow(ctx,
		`INSERT INTO tenants (name) VALUES ($1) RETURNING id, created_at, updated_at`,
		tenant.Name).Scan(&tenant.ID, &tenant.CreatedAt, &tenant.UpdatedAt); err != nil {
		return nil, nil, err
	}

	var planID uuid.UUID
	if err := tx.QueryRow(ctx,
		`SELECT id FROM subscription_plans WHERE is_default AND is_active ORDER BY sort_order LIMIT 1`).Scan(&planID); err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil, fmt.Errorf("no default subscription plan configured: %w", err)
		}
		return nil, nil, fmt.Errorf("lookup default subscription plan: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO subscriptions (tenant_id, plan_id, status, start_date) VALUES ($1, $2, 'active', NOW())`,
		tenant.ID, planID); err != nil {
		return nil, nil, err
	}

	user := &models.User{Email: email}
	var storedHash string
	err = tx.QueryRow(ctx,
		`SELECT id, tenant_id, role, is_super_admin, password_hash, created_at, updated_at FROM users WHERE email = $1`, email).
		Scan(&user.ID, &user.TenantID, &user.Role, &user.IsSuperAdmin, &storedHash, &user.CreatedAt, &user.UpdatedAt)
	switch {
	case err == pgx.ErrNoRows:
		user.TenantID = tenant.ID
		user.Role = "admin"
		user.PasswordHash = string(passwordHash)
		if err := tx.QueryRow(ctx,
			`INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, $3, 'admin') RETURNING id, created_at, updated_at`,
			user.TenantID, user.Email, user.PasswordHash).Scan(&user.ID, &user.CreatedAt, &user.UpdatedAt); err != nil {
			return nil, nil, err
		}
	case err != nil:
		return nil, nil, err
	default:
		// Existing account: the caller must prove ownership before this
		// registration mints a token for it (SEC: without this, knowing an
		// email was enough to obtain that user's JWT).
		if bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(password)) != nil {
			return nil, nil, ErrInvalidCredentials
		}
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO user_tenants (user_id, tenant_id, role, joined_at) VALUES ($1, $2, 'admin', NOW())
		 ON CONFLICT (user_id, tenant_id) DO NOTHING`,
		user.ID, tenant.ID); err != nil {
		return nil, nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, nil, err
	}
	return tenant, user, nil
}

func (s *PGStore) GetTenantByID(ctx context.Context, id uuid.UUID) (*models.Tenant, error) {
	var t models.Tenant
	var settingsJSON []byte
	query := `SELECT id, name, status, archived_at, settings, logo_url, website, contact_email, created_at, updated_at FROM tenants WHERE id = $1`
	err := s.db.QueryRow(ctx, query, id).Scan(&t.ID, &t.Name, &t.Status, &t.ArchivedAt, &settingsJSON, &t.LogoURL, &t.Website, &t.ContactEmail, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		return nil, err
	}
	if len(settingsJSON) > 0 && string(settingsJSON) != "null" {
		if err := json.Unmarshal(settingsJSON, &t.Settings); err != nil {
			return nil, err
		}
	}
	return &t, nil
}

func (s *PGStore) UpdateTenant(ctx context.Context, tenant *models.Tenant) error {
	var settingsJSON []byte
	var err error
	if tenant.Settings != nil {
		settingsJSON, err = json.Marshal(tenant.Settings)
		if err != nil {
			return err
		}
	}

	query := `UPDATE tenants 
			  SET name = $1, settings = $2, logo_url = $3, website = $4, contact_email = $5, updated_at = NOW()
			  WHERE id = $6`
	_, err = s.db.Exec(ctx, query,
		tenant.Name, settingsJSON, tenant.LogoURL, tenant.Website, tenant.ContactEmail, tenant.ID,
	)
	return err
}

// GetTenantStatus returns the lifecycle status, or "" if the tenant does not exist.
func (s *PGStore) GetTenantStatus(ctx context.Context, id uuid.UUID) (string, error) {
	var status string
	err := s.db.QueryRow(ctx, `SELECT status FROM tenants WHERE id = $1`, id).Scan(&status)
	if err == pgx.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return status, nil
}

// UpdateTenantStatus sets the lifecycle status; transition rules live in the handler.
func (s *PGStore) UpdateTenantStatus(ctx context.Context, id uuid.UUID, status string) error {
	tag, err := s.db.Exec(ctx, `UPDATE tenants
		SET status = $2,
		    archived_at = CASE WHEN $2 = 'archived' THEN NOW() ELSE NULL END,
		    updated_at = NOW()
		WHERE id = $1`, id, status)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("tenant %s not found", id)
	}
	return nil
}

func (s *PGStore) CreateUser(ctx context.Context, user *models.User) error {
	query := `INSERT INTO users (tenant_id, email, password_hash, role) 
			  VALUES ($1, $2, $3, $4) 
			  RETURNING id, created_at, updated_at`
	return s.db.QueryRow(ctx, query,
		user.TenantID, user.Email, user.PasswordHash, user.Role,
	).Scan(&user.ID, &user.CreatedAt, &user.UpdatedAt)
}

func (s *PGStore) GetUserByEmail(ctx context.Context, email string) (*models.User, error) {
	var u models.User
	query := `SELECT id, tenant_id, email, password_hash, role, is_super_admin, qr_token, qr_token_created_at, created_at, updated_at 
			  FROM users WHERE email = $1`
	err := s.db.QueryRow(ctx, query, email).Scan(
		&u.ID, &u.TenantID, &u.Email, &u.PasswordHash, &u.Role, &u.IsSuperAdmin, &u.QRToken, &u.QRTokenCreatedAt, &u.CreatedAt, &u.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &u, nil
}

// HasAnyUsers reports whether the users table has any row at all, across
// every tenant — used to detect a genuinely fresh on-prem install.
func (s *PGStore) HasAnyUsers(ctx context.Context) (bool, error) {
	var exists bool
	err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users)`).Scan(&exists)
	return exists, err
}

func (s *PGStore) GetUserByID(ctx context.Context, id uuid.UUID) (*models.User, error) {
	var u models.User
	query := `SELECT id, tenant_id, email, password_hash, role, is_super_admin, qr_token, qr_token_created_at, created_at, updated_at 
			  FROM users WHERE id = $1`
	err := s.db.QueryRow(ctx, query, id).Scan(
		&u.ID, &u.TenantID, &u.Email, &u.PasswordHash, &u.Role, &u.IsSuperAdmin, &u.QRToken, &u.QRTokenCreatedAt, &u.CreatedAt, &u.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (s *PGStore) GetUsersByTenantID(ctx context.Context, tenantID uuid.UUID) ([]*models.User, error) {
	query := `SELECT id, tenant_id, email, role, is_super_admin, qr_token, qr_token_created_at, created_at, updated_at 
			  FROM users WHERE tenant_id = $1 ORDER BY created_at DESC`
	rows, err := s.db.Query(ctx, query, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	users := []*models.User{}
	for rows.Next() {
		var u models.User
		if err := rows.Scan(&u.ID, &u.TenantID, &u.Email, &u.Role, &u.IsSuperAdmin, &u.QRToken, &u.QRTokenCreatedAt, &u.CreatedAt, &u.UpdatedAt); err != nil {
			return nil, err
		}
		users = append(users, &u)
	}
	return users, nil
}

func (s *PGStore) GetUserByQRToken(ctx context.Context, token string) (*models.User, error) {
	var u models.User
	query := `SELECT id, tenant_id, email, password_hash, role, is_super_admin, qr_token, qr_token_created_at, created_at, updated_at 
			  FROM users WHERE qr_token = $1`
	err := s.db.QueryRow(ctx, query, token).Scan(
		&u.ID, &u.TenantID, &u.Email, &u.PasswordHash, &u.Role, &u.IsSuperAdmin, &u.QRToken, &u.QRTokenCreatedAt, &u.CreatedAt, &u.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (s *PGStore) UpdateUserQRToken(ctx context.Context, userID uuid.UUID, token string, createdAt time.Time) error {
	query := `UPDATE users SET qr_token = $1, qr_token_created_at = $2, updated_at = NOW() WHERE id = $3`
	_, err := s.db.Exec(ctx, query, token, createdAt, userID)
	return err
}

func (s *PGStore) AssignStaffToEvent(ctx context.Context, assignment *models.EventStaff) error {
	query := `INSERT INTO event_staff (id, event_id, user_id, assigned_at, assigned_by) 
			  VALUES ($1, $2, $3, $4, $5)
			  ON CONFLICT (event_id, user_id) DO NOTHING`
	_, err := s.db.Exec(ctx, query, assignment.ID, assignment.EventID, assignment.UserID, assignment.AssignedAt, assignment.AssignedBy)
	return err
}

func (s *PGStore) GetEventStaff(ctx context.Context, eventID uuid.UUID) ([]*models.User, error) {
	query := `SELECT u.id, u.tenant_id, u.email, u.role, u.is_super_admin, u.qr_token, u.qr_token_created_at, u.created_at, u.updated_at
			  FROM users u
			  INNER JOIN event_staff es ON u.id = es.user_id
			  WHERE es.event_id = $1
			  ORDER BY es.assigned_at DESC`
	rows, err := s.db.Query(ctx, query, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	users := []*models.User{}
	for rows.Next() {
		var u models.User
		if err := rows.Scan(&u.ID, &u.TenantID, &u.Email, &u.Role, &u.IsSuperAdmin, &u.QRToken, &u.QRTokenCreatedAt, &u.CreatedAt, &u.UpdatedAt); err != nil {
			return nil, err
		}
		users = append(users, &u)
	}
	return users, nil
}

func (s *PGStore) RemoveStaffFromEvent(ctx context.Context, eventID, userID uuid.UUID) error {
	query := `DELETE FROM event_staff WHERE event_id = $1 AND user_id = $2`
	_, err := s.db.Exec(ctx, query, eventID, userID)
	return err
}

func (s *PGStore) GetUserEvents(ctx context.Context, userID uuid.UUID) ([]*models.Event, error) {
	query := `SELECT e.id, e.tenant_id, e.name, e.start_date, e.end_date, e.location, e.created_at, e.updated_at
			  FROM events e
			  INNER JOIN event_staff es ON e.id = es.event_id
			  WHERE es.user_id = $1 AND e.deleted_at IS NULL
			  ORDER BY e.start_date DESC`
	rows, err := s.db.Query(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []*models.Event
	for rows.Next() {
		var e models.Event
		if err := rows.Scan(&e.ID, &e.TenantID, &e.Name, &e.StartDate, &e.EndDate, &e.Location, &e.CreatedAt, &e.UpdatedAt); err != nil {
			return nil, err
		}
		events = append(events, &e)
	}
	return events, nil
}

func (s *PGStore) CreateEvent(ctx context.Context, event *models.Event) error {
	var customFieldsJSON []byte
	var err error
	if event.CustomFields != nil {
		customFieldsJSON, err = json.Marshal(event.CustomFields)
		if err != nil {
			return err
		}
	}

	query := `INSERT INTO events (tenant_id, name, start_date, end_date, location, field_schema, custom_fields) 
			  VALUES ($1, $2, $3, $4, $5, $6, $7) 
			  RETURNING id, created_at, updated_at`
	return s.db.QueryRow(ctx, query,
		event.TenantID, event.Name, event.StartDate, event.EndDate, event.Location, event.FieldSchema, customFieldsJSON,
	).Scan(&event.ID, &event.CreatedAt, &event.UpdatedAt)
}

func (s *PGStore) UpdateEvent(ctx context.Context, event *models.Event) error {
	var customFieldsJSON []byte
	var err error
	if event.CustomFields != nil {
		customFieldsJSON, err = json.Marshal(event.CustomFields)
		if err != nil {
			return err
		}
	}

	query := `UPDATE events 
			  SET name = $1, start_date = $2, end_date = $3, location = $4, field_schema = $5, custom_fields = $6, updated_at = NOW()
			  WHERE id = $7 AND deleted_at IS NULL`
	_, err = s.db.Exec(ctx, query,
		event.Name, event.StartDate, event.EndDate, event.Location, event.FieldSchema, customFieldsJSON, event.ID,
	)
	return err
}

func (s *PGStore) GetEventsByTenantID(ctx context.Context, tenantID uuid.UUID) ([]*models.Event, error) {
	query := `SELECT id, tenant_id, name, start_date, end_date, location, field_schema, custom_fields, created_at, updated_at 
			  FROM events WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`
	rows, err := s.db.Query(ctx, query, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := []*models.Event{}
	for rows.Next() {
		var e models.Event
		var customFieldsJSON []byte
		if err := rows.Scan(&e.ID, &e.TenantID, &e.Name, &e.StartDate, &e.EndDate, &e.Location, &e.FieldSchema, &customFieldsJSON, &e.CreatedAt, &e.UpdatedAt); err != nil {
			return nil, err
		}
		if len(customFieldsJSON) > 0 && string(customFieldsJSON) != "null" {
			if err := json.Unmarshal(customFieldsJSON, &e.CustomFields); err != nil {
				return nil, err
			}
		}
		events = append(events, &e)
	}
	return events, nil
}

// GetEventByID also scans the P3.1 badge_template/badge_template_version
// columns (unlike GetEventsByTenantID's list query, which doesn't need them):
// requireEventOwnership and every other event-fetch path that feeds
// handler/badge_zpl.go and handler/readiness.go route through this method, so
// they need the column value available on the Event without a second store
// round-trip.
func (s *PGStore) GetEventByID(ctx context.Context, id uuid.UUID) (*models.Event, error) {
	var e models.Event
	var customFieldsJSON []byte
	var badgeTemplateJSON []byte
	query := `SELECT id, tenant_id, name, start_date, end_date, location, field_schema, custom_fields, badge_template, badge_template_version, created_at, updated_at
			  FROM events WHERE id = $1 AND deleted_at IS NULL`
	err := s.db.QueryRow(ctx, query, id).Scan(
		&e.ID, &e.TenantID, &e.Name, &e.StartDate, &e.EndDate, &e.Location, &e.FieldSchema, &customFieldsJSON, &badgeTemplateJSON, &e.BadgeTemplateVersion, &e.CreatedAt, &e.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	if len(customFieldsJSON) > 0 && string(customFieldsJSON) != "null" {
		if err := json.Unmarshal(customFieldsJSON, &e.CustomFields); err != nil {
			return nil, err
		}
	}
	if len(badgeTemplateJSON) > 0 && string(badgeTemplateJSON) != "null" {
		e.BadgeTemplate = json.RawMessage(badgeTemplateJSON)
	}
	return &e, nil
}

func (s *PGStore) GetEventByIDForTenant(ctx context.Context, id, tenantID uuid.UUID) (*models.Event, error) {
	event, err := s.GetEventByID(ctx, id)
	if err != nil || event == nil {
		return event, err
	}
	if event.TenantID != tenantID {
		return nil, nil
	}
	return event, nil
}

func (s *PGStore) SoftDeleteEvent(ctx context.Context, id uuid.UUID) error {
	_, err := s.db.Exec(ctx,
		`UPDATE events SET deleted_at = now(), updated_at = now() WHERE id = $1 AND deleted_at IS NULL`, id)
	return err
}

// ErrVersionConflict is returned by UpdateEventBadgeTemplate when the
// guarded UPDATE affects 0 rows because expectedVersion no longer matches
// the row's current badge_template_version. By contract the caller has
// already confirmed the event exists (e.g. via requireEventOwnership)
// before calling, so this method treats every 0-row result as a version
// conflict rather than trying to disambiguate "stale version" from
// "no such event".
var ErrVersionConflict = errors.New("badge template version conflict")

// GetEventBadgeTemplate reads the dedicated badge_template/
// badge_template_version columns (P3.1) directly — it never looks at the
// legacy custom_fields["badgeTemplate"] key. Both "column is NULL" (no
// template saved yet) and "no matching, non-deleted event" collapse to the
// same (nil, 0, nil) zero value: this method never fabricates a template,
// and never reports pgx.ErrNoRows to the caller (mirrors GetEventByID's
// not-found idiom). Callers that need to distinguish a missing event from a
// missing template must check existence themselves.
func (s *PGStore) GetEventBadgeTemplate(ctx context.Context, eventID uuid.UUID) (json.RawMessage, int, error) {
	var templateJSON []byte
	var version int
	query := `SELECT badge_template, badge_template_version FROM events WHERE id = $1 AND deleted_at IS NULL`
	err := s.db.QueryRow(ctx, query, eventID).Scan(&templateJSON, &version)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, 0, nil
		}
		return nil, 0, err
	}
	if len(templateJSON) == 0 || string(templateJSON) == "null" {
		return nil, 0, nil
	}
	return json.RawMessage(templateJSON), version, nil
}

// UpdateEventBadgeTemplate persists template verbatim (raw bytes, no
// re-encoding) under an optimistic-concurrency guard: the UPDATE only
// matches the row whose current badge_template_version equals
// expectedVersion (AND which is not soft-deleted — final-review Minor 6:
// every other events UPDATE in this file already excludes deleted_at IS NOT
// NULL rows, and this guarded write was the one missing it, which would
// otherwise let a stale-but-matching version silently "resurrect" a
// soft-deleted event's badge template), and bumps the version by one in the
// same statement. On success it returns the new (bumped) version via
// RETURNING. When the guard misses — expectedVersion is stale, or the event
// is soft-deleted — the UPDATE affects 0 rows, which QueryRow surfaces as
// pgx.ErrNoRows; this method maps that to ErrVersionConflict. Contract: the
// caller must already have confirmed the event exists and is not
// soft-deleted (e.g. via requireEventOwnership) before calling — this
// method does not re-check event existence, so a 0-row result is always
// reported as a version conflict, never as "not found".
//
// P5.2 removed the transitional custom_fields["badgeTemplate"] mirror this
// statement used to also write (via jsonb_set) — the legacy web editor is
// gone, so badge_template/badge_template_version is the sole source of
// truth and custom_fields no longer needs to be kept coherent with it.
func (s *PGStore) UpdateEventBadgeTemplate(ctx context.Context, eventID uuid.UUID, template json.RawMessage, expectedVersion int) (int, error) {
	var newVersion int
	query := `UPDATE events
			  SET badge_template = $1, badge_template_version = badge_template_version + 1, updated_at = NOW()
			  WHERE id = $2 AND badge_template_version = $3 AND deleted_at IS NULL
			  RETURNING badge_template_version`
	err := s.db.QueryRow(ctx, query, []byte(template), eventID, expectedVersion).Scan(&newVersion)
	if err != nil {
		if err == pgx.ErrNoRows {
			return 0, ErrVersionConflict
		}
		return 0, err
	}
	return newVersion, nil
}

// GetCheckinSettings reads the dedicated events.checkin_settings JSONB
// column (P4.1) directly. Both "column is NULL" (no settings saved yet)
// and "no matching, non-deleted event" collapse to the same (nil, nil)
// zero value — mirrors GetEventBadgeTemplate's not-found idiom: this
// method never fabricates a settings object, and never reports
// pgx.ErrNoRows to the caller. Callers that need to distinguish a missing
// event from missing settings must check existence themselves (e.g.
// requireEventOwnership).
func (s *PGStore) GetCheckinSettings(ctx context.Context, eventID uuid.UUID) (json.RawMessage, error) {
	var settingsJSON []byte
	query := `SELECT checkin_settings FROM events WHERE id = $1 AND deleted_at IS NULL`
	err := s.db.QueryRow(ctx, query, eventID).Scan(&settingsJSON)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	if len(settingsJSON) == 0 || string(settingsJSON) == "null" {
		return nil, nil
	}
	return json.RawMessage(settingsJSON), nil
}

// ErrEventNotFound is returned by UpdateCheckinSettings when its guarded
// UPDATE affects 0 rows — PR #77 bot-review round, Finding C. By contract
// the caller has already confirmed the event exists (via
// requireEventOwnership) before calling, so this sentinel is reachable
// ONLY via the soft-delete race: the pre-check passes, a concurrent
// SoftDeleteEvent lands, and the `deleted_at IS NULL` guard then matches
// nothing. Mirrors ErrAttendeeNotFound/ErrVersionConflict's 0-row sentinel
// pattern (UpdateEventBadgeTemplate/IncrementAttendeePrintedCount) — before
// this, UpdateCheckinSettings silently swallowed the 0-row case (the same
// idiom as SoftDeleteEvent's genuinely-idempotent delete), which meant the
// handler responded 200 with settings that were never actually persisted.
// Handlers map it to the house 404 masking ("Event not found"), identical
// to requireEventOwnership's own wording.
var ErrEventNotFound = errors.New("event not found")

// UpdateCheckinSettings persists settings verbatim (raw bytes, no
// re-encoding) — no optimistic-concurrency version, unlike
// UpdateEventBadgeTemplate: check-in settings are operator-only config
// with no concurrent-editor conflict class to guard against. The UPDATE
// nevertheless carries a `deleted_at IS NULL` guard (same race class as
// UpdateEventBadgeTemplate/IncrementAttendeePrintedCount): the caller's
// requireEventOwnership pre-check can pass and a concurrent soft-delete
// land before this UPDATE executes. Contract: the caller must already
// have confirmed the event exists before calling — a 0-row result (the
// soft-delete race) returns the exported ErrEventNotFound sentinel, never
// a fabricated success (PR #77 bot-review round, Finding C).
func (s *PGStore) UpdateCheckinSettings(ctx context.Context, eventID uuid.UUID, settings json.RawMessage) error {
	tag, err := s.db.Exec(ctx,
		`UPDATE events SET checkin_settings = $1, updated_at = now() WHERE id = $2 AND deleted_at IS NULL`,
		[]byte(settings), eventID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrEventNotFound
	}
	return nil
}

// ErrCheckinStationNotFound is returned by HeartbeatCheckinStation when its
// guarded UPDATE matches 0 rows — either the station id doesn't exist at
// all, or it belongs to a different event than the caller's eventID (the
// `AND event_id = $2` guard is what makes a foreign station id 404 rather
// than silently heartbeating someone else's station). Handlers map it to
// the house 404, never a fabricated success.
var ErrCheckinStationNotFound = errors.New("check-in station not found")

// UpsertCheckinStation registers a check-in station scoped to eventID
// (P4.1 Task 2). A fresh name inserts a new row (last_seen_at defaults to
// now() from the column default); re-registering the SAME name is
// idempotent via ON CONFLICT (event_id, name) DO UPDATE — the SAME row/id
// is returned, with zone_id replaced by the newly-submitted value (even
// back to NULL) and last_seen_at refreshed, rather than erroring or
// creating a duplicate row. Contract: the caller must already have
// confirmed the event exists and, when zoneID is non-nil, that it belongs
// to the SAME event (e.g. via requireEventOwnership + GetEventZoneByID) —
// this method does not re-validate either.
func (s *PGStore) UpsertCheckinStation(ctx context.Context, eventID uuid.UUID, name string, zoneID *uuid.UUID) (*models.CheckinStation, error) {
	var st models.CheckinStation
	query := `INSERT INTO checkin_stations (event_id, name, zone_id)
		VALUES ($1, $2, $3)
		ON CONFLICT (event_id, name) DO UPDATE SET zone_id = EXCLUDED.zone_id, last_seen_at = now()
		RETURNING id, event_id, name, zone_id, last_seen_at, created_at`
	err := s.db.QueryRow(ctx, query, eventID, name, zoneID).
		Scan(&st.ID, &st.EventID, &st.Name, &st.ZoneID, &st.LastSeenAt, &st.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &st, nil
}

// HeartbeatCheckinStation refreshes a station's last_seen_at, scoped to
// eventID so a station id belonging to a different event can never be
// touched (the same tenant-isolation shape as
// UpdateCheckinSettings/IncrementAttendeePrintedCount's guards, just on a
// foreign-event axis instead of soft-delete). On 0 rows (unknown id, or an
// id that belongs to a different event) this returns
// ErrCheckinStationNotFound.
func (s *PGStore) HeartbeatCheckinStation(ctx context.Context, eventID, stationID uuid.UUID) error {
	tag, err := s.db.Exec(ctx,
		`UPDATE checkin_stations SET last_seen_at = now() WHERE id = $1 AND event_id = $2`,
		stationID, eventID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrCheckinStationNotFound
	}
	return nil
}

// ListCheckinStations returns every station registered for eventID,
// ordered by name for a deterministic listing (stations have no natural
// display order otherwise).
func (s *PGStore) ListCheckinStations(ctx context.Context, eventID uuid.UUID) ([]*models.CheckinStation, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, event_id, name, zone_id, last_seen_at, created_at FROM checkin_stations WHERE event_id = $1 ORDER BY name`,
		eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var stations []*models.CheckinStation
	for rows.Next() {
		var st models.CheckinStation
		if err := rows.Scan(&st.ID, &st.EventID, &st.Name, &st.ZoneID, &st.LastSeenAt, &st.CreatedAt); err != nil {
			return nil, err
		}
		stations = append(stations, &st)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return stations, nil
}

// GetCheckinStationByID looks up a single check-in station by id (P4.1
// Task 3). Mirrors GetEventZoneByID: a no-match surfaces the raw
// pgx.ErrNoRows rather than a normalized (nil, nil) — callers distinguish
// "unknown id" from "found" via errors.Is(err, pgx.ErrNoRows).
func (s *PGStore) GetCheckinStationByID(ctx context.Context, id uuid.UUID) (*models.CheckinStation, error) {
	var st models.CheckinStation
	query := `SELECT id, event_id, name, zone_id, last_seen_at, created_at FROM checkin_stations WHERE id = $1`
	err := s.db.QueryRow(ctx, query, id).Scan(&st.ID, &st.EventID, &st.Name, &st.ZoneID, &st.LastSeenAt, &st.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &st, nil
}

// checkinAttendeeColumnsSQL is the plain (non-joined) attendee column list
// (in scan order) shared by CheckInAttendee's and UndoCheckin's guarded
// UPDATE ... RETURNING clauses — the same 19 columns as
// GetAttendeeByID/GetAttendeeByCode. It deliberately excludes
// checked_in_by_email: attendees has no such COLUMN — that field is always
// derived from users.email via checked_in_by (see attendeeListColumnsSQL),
// never persisted, so a RETURNING clause can't produce it.
const checkinAttendeeColumnsSQL = `id, event_id, first_name, last_name, email, company, position, code, checkin_status, checked_in_at, checked_in_by, checked_in_device_number, checked_in_point_name, printed_count, custom_fields, blocked, block_reason, created_at, updated_at`

// scanCheckinAttendeeRow scans one row shaped by checkinAttendeeColumnsSQL
// into a fresh *models.Attendee, unmarshaling custom_fields.
func scanCheckinAttendeeRow(row pgx.Row) (*models.Attendee, error) {
	var a models.Attendee
	var customFieldsJSON []byte
	if err := row.Scan(&a.ID, &a.EventID, &a.FirstName, &a.LastName, &a.Email, &a.Company, &a.Position, &a.Code,
		&a.CheckinStatus, &a.CheckedInAt, &a.CheckedInBy, &a.CheckedInDeviceNumber, &a.CheckedInPointName,
		&a.PrintedCount, &customFieldsJSON, &a.Blocked, &a.BlockReason, &a.CreatedAt, &a.UpdatedAt); err != nil {
		return nil, err
	}
	if len(customFieldsJSON) > 0 && string(customFieldsJSON) != "null" {
		if err := json.Unmarshal(customFieldsJSON, &a.CustomFields); err != nil {
			return nil, err
		}
	}
	return &a, nil
}

// scanAttendeeByEmailJoinRow scans one row shaped by attendeeListColumnsSQL
// (the LEFT JOIN ... users u ON a.checked_in_by = u.id shape, including the
// joined checked_in_by_email) from a pgx.Row — unlike scanAttendeeRow, which
// takes pgx.Rows (the pgx.Rows.Scan and pgx.Row.Scan signatures match, but
// QueryRow's pgx.Row does not satisfy the pgx.Rows interface, so it can't be
// passed to scanAttendeeRow directly).
func scanAttendeeByEmailJoinRow(row pgx.Row) (*models.Attendee, error) {
	var a models.Attendee
	var customFieldsJSON []byte
	if err := row.Scan(&a.ID, &a.EventID, &a.FirstName, &a.LastName, &a.Email, &a.Company, &a.Position, &a.Code,
		&a.CheckinStatus, &a.CheckedInAt, &a.CheckedInBy, &a.CheckedInDeviceNumber, &a.CheckedInPointName,
		&a.PrintedCount, &customFieldsJSON, &a.Blocked, &a.BlockReason, &a.CreatedAt, &a.UpdatedAt, &a.CheckedInByEmail); err != nil {
		return nil, err
	}
	if len(customFieldsJSON) > 0 && string(customFieldsJSON) != "null" {
		if err := json.Unmarshal(customFieldsJSON, &a.CustomFields); err != nil {
			return nil, err
		}
	}
	return &a, nil
}

// checkinActionInsertSQL is the single INSERT shared by CheckInAttendee's
// 'checkin' row, UndoCheckin's 'undo' row, and the standalone
// InsertCheckinAction Store method's 'reprint' row (P4.1 Task 4
// extraction) — action is a bind parameter so all three call sites run
// byte-for-byte the same statement.
const checkinActionInsertSQL = `INSERT INTO checkin_actions (event_id, attendee_id, station_id, action, staff_user_id) VALUES ($1, $2, $3, $4, $5)`

// checkinActionExecutor is the minimal subset of dbConn/pgx.Tx needed to run
// checkinActionInsertSQL — satisfied by both *pgxpool.Pool (via PGStore.db,
// InsertCheckinAction's standalone path used by the /printed reprint
// endpoint, which is NOT inside any existing transaction) and pgx.Tx (the
// open transaction CheckInAttendee/UndoCheckin already hold), so the exact
// same insert runs either standalone or nested inside an existing
// transaction. pgx.Tx does not implement dbConn itself (it has no Close
// method), which is why this is its own narrower interface rather than
// reusing dbConn.
type checkinActionExecutor interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}

// insertCheckinAction is the shared implementation behind
// PGStore.InsertCheckinAction, CheckInAttendee's 'checkin' row, and
// UndoCheckin's 'undo' row (P4.1 Tasks 3-4) — one INSERT statement, one
// place it's issued from. CheckInAttendee/UndoCheckin call this directly
// with their own open tx (never through the InsertCheckinAction Store
// method, which always runs against the pool) so the feed row commits
// atomically with the state-changing UPDATE in the SAME transaction.
func insertCheckinAction(ctx context.Context, exec checkinActionExecutor, eventID, attendeeID uuid.UUID, action string, stationID *uuid.UUID, staffUserID uuid.UUID) error {
	_, err := exec.Exec(ctx, checkinActionInsertSQL, eventID, attendeeID, stationID, action, staffUserID)
	return err
}

// InsertCheckinAction records one checkin_actions feed row standalone,
// against the pool (P4.1 Task 4) — used by the /printed endpoint's reprint
// logging, which happens as its own store call AFTER
// IncrementAttendeePrintedCount's guarded UPDATE has already committed, not
// nested inside it (there is no shared transaction to join). Contract: the
// caller has already resolved staffUserID (e.g. from JWT claims) and
// validated stationID, when non-nil, belongs to the same event — this
// method does not re-validate either.
func (s *PGStore) InsertCheckinAction(ctx context.Context, eventID, attendeeID uuid.UUID, action string, stationID *uuid.UUID, staffUserID uuid.UUID) error {
	return insertCheckinAction(ctx, s.db, eventID, attendeeID, action, stationID, staffUserID)
}

// checkinActionInsertAtSQL is InsertCheckinActionAt's statement (2026-07-19
// event-wide actions-feed design): identical to checkinActionInsertSQL
// except created_at is an explicit bind with a COALESCE($6, now())
// fallback and staff_user_id is nullable. It is a SEPARATE statement, not
// an extension of checkinActionInsertSQL — that statement's byte-for-byte
// text is a P4.1 pgxmock contract, and its created_at DEFAULT now() is
// load-bearing for the station path (transaction-stable equality with
// checked_in_at = now() inside CheckInAttendee's tx).
const checkinActionInsertAtSQL = `INSERT INTO checkin_actions (event_id, attendee_id, station_id, action, staff_user_id, created_at) VALUES ($1, $2, $3, $4, $5, COALESCE($6, now()))`

// insertCheckinActionAt is the shared implementation behind
// PGStore.InsertCheckinActionAt and ApplyBatchCheckin's in-transaction
// 'checkin' row — mirroring how insertCheckinAction serves both the pool
// and open-tx callers via checkinActionExecutor.
func insertCheckinActionAt(ctx context.Context, exec checkinActionExecutor, eventID, attendeeID uuid.UUID, action string, stationID *uuid.UUID, staffUserID *uuid.UUID, at *time.Time) error {
	_, err := exec.Exec(ctx, checkinActionInsertAtSQL, eventID, attendeeID, stationID, action, staffUserID, at)
	return err
}

// InsertCheckinActionAt records one checkin_actions feed row standalone,
// against the pool, with an EXPLICIT created_at (nil → now()) — the
// non-station write paths' variant of InsertCheckinAction (2026-07-19
// event-wide actions-feed design). Callers pass `at` equal to the exact
// value they persisted into attendees.checked_in_at so the monitor's
// current-period predicate (ca.created_at >= a.checked_in_at) holds by
// equality regardless of app/db clock skew. Contract: like
// InsertCheckinAction, this never re-validates ids and callers treat a
// failure as best-effort/non-fatal (log-don't-fail) — the state-changing
// write it annotates has already committed.
func (s *PGStore) InsertCheckinActionAt(ctx context.Context, eventID, attendeeID uuid.UUID, action string, stationID *uuid.UUID, staffUserID *uuid.UUID, at *time.Time) error {
	return insertCheckinActionAt(ctx, s.db, eventID, attendeeID, action, stationID, staffUserID, at)
}

// TransitionAttendeeCheckinStatus atomically claims a check-in status
// transition for the LEGACY write paths (attendee PUT, sync push) — PR #82
// bot round: gating their feed-row inserts on a Go-level before/after
// compare was a read-compare-write race (two concurrent requests could
// both observe the old status, both blind-write via UpdateAttendee, and
// both insert a duplicate checkin_actions feed row, overcounting the
// monitor's rate/peak/recent). The guarded UPDATE's WHERE clause on the
// CURRENT status makes Postgres the sole arbiter of which request
// actually performed the flip — the same pattern as ApplyBatchCheckin's
// and CheckInAttendee's guarded UPDATEs. It writes only the check-in
// columns (status, checked_in_at, checked_in_by; cleared on un-check);
// callers still run their legacy UpdateAttendee afterwards for the
// remaining columns and its established overwrite semantics.
func (s *PGStore) TransitionAttendeeCheckinStatus(ctx context.Context, attendeeID uuid.UUID, target bool, checkedInAt *time.Time, checkedInBy *uuid.UUID) (bool, error) {
	var tag pgconn.CommandTag
	var err error
	if target {
		tag, err = s.db.Exec(ctx,
			`UPDATE attendees
			 SET checkin_status = true, checked_in_at = $2, checked_in_by = $3, updated_at = now()
			 WHERE id = $1 AND checkin_status = false AND deleted_at IS NULL`,
			attendeeID, checkedInAt, checkedInBy)
	} else {
		tag, err = s.db.Exec(ctx,
			`UPDATE attendees
			 SET checkin_status = false, checked_in_at = NULL, checked_in_by = NULL, updated_at = now()
			 WHERE id = $1 AND checkin_status = true AND deleted_at IS NULL`,
			attendeeID)
	}
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// ErrCheckinConflict is returned by CheckInAttendee when a bounded retry
// (see checkInAttendeeMaxAttempts) still can't resolve the guarded UPDATE
// to a definitive outcome — PR #77 bot-review round 2, Finding 1. It marks
// an extremely narrow, transient race (not "already checked in", not
// "blocked", not "missing"); callers should treat it as retryable rather
// than as any of those three normal outcomes.
var ErrCheckinConflict = errors.New("check-in conflict, please retry")

// checkInAttendeeMaxAttempts bounds CheckInAttendee's retry of its own
// guarded-UPDATE-then-fallback sequence to a single extra attempt (2 total)
// when the fallback SELECT lands on the "neither checked in nor blocked"
// race window (PR #77 bot-review round 2, Finding 1) — an unbounded/
// infinite retry loop would be wrong, but the race window this closes is
// narrow enough that a single retry against the now-current state resolves
// the vast majority of real occurrences.
const checkInAttendeeMaxAttempts = 2

// checkInAttendeeGuardedUpdateSQL is CheckInAttendee's exact guarded UPDATE
// — see the Store interface doc for the full guard/outcome contract.
// blocked = false closes a TOCTOU race (PR #77 bot-review round 1, Finding
// A): StationCheckin's handler reads the attendee and returns the "blocked"
// outcome BEFORE calling here — but another operator's blocked/unblocked
// toggle can land in the window between that pre-read and this UPDATE
// actually running. Without this guard, the predicate would still match a
// NOW-blocked attendee (it only checked checkin_status/deleted_at) and
// check them in anyway, violating the endpoint's "blocked attendees are
// never checked in" contract. checked_in_device_number = NULL (PR #77
// bot-review round 2, Finding 2) mirrors UndoCheckin's clear, so a fresh
// panel check-in never inherits a stale device number left over from an
// earlier mobile check-in.
const checkInAttendeeGuardedUpdateSQL = `UPDATE attendees
	SET checkin_status = true, checked_in_at = now(), checked_in_by = $1, checked_in_device_number = NULL, checked_in_point_name = $2, updated_at = now()
	WHERE id = $3 AND event_id = $4 AND checkin_status = false AND blocked = false AND deleted_at IS NULL
	RETURNING ` + checkinAttendeeColumnsSQL

// checkInAttendeeAttempt runs ONE guarded-UPDATE-then-fallback sequence
// inside tx and classifies the result into one of FOUR outcomes: "checked_in"
// (this attempt's own guarded UPDATE won), "blocked" (fallback SELECT found
// checkin_status = false, blocked = true — the TOCTOU race path), "conflict"
// (fallback SELECT found checkin_status = false, blocked = false — neither
// checked in nor blocked; PR #77 bot-review round 2, Finding 1, retried by
// the caller), or "already_checked_in" (fallback SELECT found checkin_status
// = true). A missing attendee returns ErrAttendeeNotFound directly (never
// retried — see CheckInAttendee below). Does not touch checked_in_by_email
// or insert any checkin_actions row; the caller (CheckInAttendee) owns both,
// since they only apply once, after a final "checked_in" outcome.
func checkInAttendeeAttempt(ctx context.Context, tx pgx.Tx, eventID, attendeeID uuid.UUID, pointName *string, staffUserID uuid.UUID) (string, *models.Attendee, error) {
	a, err := scanCheckinAttendeeRow(tx.QueryRow(ctx, checkInAttendeeGuardedUpdateSQL, staffUserID, pointName, attendeeID, eventID))
	if err == nil {
		return "checked_in", a, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", nil, err
	}

	// 0 rows: the guarded UPDATE's predicate missed for one of FOUR
	// reasons — already checked in (by this or another staff
	// member/station), newly blocked (the TOCTOU race the blocked = false
	// guard above closes), neither checked in nor blocked (a narrower,
	// retryable race — Finding 1), or genuinely missing (soft-deleted, or
	// doesn't belong to eventID). The fallback SELECT below (joined to
	// users, same shape as attendeeListColumnsSQL/scanAttendeeRow)
	// distinguishes all four: missing rows ErrAttendeeNotFound; a row with
	// checkin_status = false AND blocked = true is the newly-blocked case
	// (outcome "blocked" — this call never actually checked them in, so
	// their pre-existing first-scan metadata, if any, is untouched); a row
	// with checkin_status = false AND blocked = false is the conflict case
	// (outcome "conflict" — genuinely not checked in, so reporting
	// already_checked_in would be both factually wrong and would skip the
	// only outcome that triggers printing); anything else (checkin_status =
	// true) is already_checked_in, returning the ORIGINAL first-scan
	// metadata untouched.
	selectQuery := `SELECT` + attendeeListColumnsSQL + `
		FROM attendees a
		LEFT JOIN users u ON a.checked_in_by = u.id
		WHERE a.id = $1 AND a.event_id = $2 AND a.deleted_at IS NULL`
	existing, err := scanAttendeeByEmailJoinRow(tx.QueryRow(ctx, selectQuery, attendeeID, eventID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil, ErrAttendeeNotFound
		}
		return "", nil, err
	}
	if !existing.CheckinStatus && existing.Blocked {
		return "blocked", existing, nil
	}
	if !existing.CheckinStatus && !existing.Blocked {
		return "conflict", existing, nil
	}
	return "already_checked_in", existing, nil
}

// CheckInAttendee performs one station's single-scan check-in idempotently
// (P4.1 Task 3) — see the Store interface doc for the full outcome
// contract. This is the zero-double-checkin guarantee at the source,
// mirroring ApplyBatchCheckin's guarded-UPDATE pattern (pg_store_batch.go)
// but with a RETURNING clause so the full row comes back in the same round
// trip as the write.
func (s *PGStore) CheckInAttendee(ctx context.Context, eventID, attendeeID uuid.UUID, stationID *uuid.UUID, staffUserID uuid.UUID, staffEmail, stationName string) (string, *models.Attendee, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return "", nil, err
	}
	defer func() {
		if rbErr := tx.Rollback(ctx); rbErr != nil && !errors.Is(rbErr, pgx.ErrTxClosed) {
			log.Printf("rollback check-in: %v", rbErr)
		}
	}()

	var pointName *string
	if stationName != "" {
		pointName = &stationName
	}

	// Bounded retry (PR #77 bot-review round 2, Finding 1): the vast
	// majority of calls resolve on the first attempt; only the "conflict"
	// outcome (neither checked in nor blocked) loops back for one more
	// attempt against the now-current state, all inside the SAME
	// transaction.
	var outcome string
	var a *models.Attendee
	for attempt := 0; attempt < checkInAttendeeMaxAttempts; attempt++ {
		outcome, a, err = checkInAttendeeAttempt(ctx, tx, eventID, attendeeID, pointName, staffUserID)
		if err != nil {
			return "", nil, err
		}
		if outcome != "conflict" {
			break
		}
	}
	if outcome == "conflict" {
		// The retry landed on the same unresolved state again — vanishingly
		// unlikely, but must not recurse/loop forever. Roll back (via the
		// deferred Rollback above) and surface a retryable sentinel rather
		// than misreporting "already_checked_in".
		return "", nil, ErrCheckinConflict
	}

	if outcome == "checked_in" {
		// This call's own guarded UPDATE won the race — it just wrote
		// checked_in_by = staffUserID, so its email IS staffEmail (the
		// caller resolved it, e.g. via GetUserByID, before calling here).
		// There is no checked_in_by_email COLUMN to read it back from.
		if staffEmail != "" {
			a.CheckedInByEmail = &staffEmail
		}
		if err := insertCheckinAction(ctx, tx, eventID, attendeeID, "checkin", stationID, staffUserID); err != nil {
			return "", nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return "", nil, err
	}
	return outcome, a, nil
}

// UndoCheckin clears a check-in idempotently (P4.1 Task 3) — see the Store
// interface doc for the full outcome contract. Fixes the legacy
// UpdateAttendeeHandler path's incomplete clear, which never touched
// checked_in_point_name.
func (s *PGStore) UndoCheckin(ctx context.Context, eventID, attendeeID uuid.UUID, stationID *uuid.UUID, staffUserID uuid.UUID) (*models.Attendee, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() {
		if rbErr := tx.Rollback(ctx); rbErr != nil && !errors.Is(rbErr, pgx.ErrTxClosed) {
			log.Printf("rollback undo check-in: %v", rbErr)
		}
	}()

	// checked_in_device_number is cleared alongside the rest (PR #77
	// bot-review round, Finding B): an attendee checked in via the mobile
	// batch path (ApplyBatchCheckin, pg_store_batch.go) carries a device
	// number in this column — leaving it untouched here meant a panel undo
	// of a mobile check-in left stale device metadata on an otherwise
	// not-checked-in row.
	updateQuery := `UPDATE attendees
		SET checkin_status = false, checked_in_at = NULL, checked_in_by = NULL, checked_in_device_number = NULL, checked_in_point_name = NULL, updated_at = now()
		WHERE id = $1 AND event_id = $2 AND checkin_status = true AND deleted_at IS NULL
		RETURNING ` + checkinAttendeeColumnsSQL
	a, err := scanCheckinAttendeeRow(tx.QueryRow(ctx, updateQuery, attendeeID, eventID))
	if err == nil {
		if err := insertCheckinAction(ctx, tx, eventID, attendeeID, "undo", stationID, staffUserID); err != nil {
			return nil, err
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
		return a, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	// 0 rows: either already not checked in (idempotent no-op — no feed
	// row), or genuinely missing.
	selectQuery := `SELECT ` + checkinAttendeeColumnsSQL + ` FROM attendees WHERE id = $1 AND event_id = $2 AND deleted_at IS NULL`
	existing, err := scanCheckinAttendeeRow(tx.QueryRow(ctx, selectQuery, attendeeID, eventID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrAttendeeNotFound
		}
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return existing, nil
}

// GetCheckinActions returns the newest `limit` rows of an event's
// check-in/undo/reprint feed (P4.1 Task 3), joined to a slim attendee
// projection — backs the station's recent-scans rail.
func (s *PGStore) GetCheckinActions(ctx context.Context, eventID uuid.UUID, limit int) ([]CheckinActionRow, error) {
	// ca.id DESC is a deterministic tie-breaker (PR #77 bot-review round,
	// Finding E): ORDER BY created_at DESC alone can arbitrarily reorder or
	// omit rows across repeated calls with the same LIMIT whenever two
	// concurrent actions share the same timestamp (down to whatever
	// precision created_at stores) — id is a UUID with no inherent
	// ordering relationship to created_at, but it only needs to be SOME
	// deterministic total order, not a meaningful one, to make the "last
	// 50" feed stable. idx_checkin_actions_event_created (migration
	// 000019) is defined on (event_id, created_at DESC, id DESC) to match.
	rows, err := s.db.Query(ctx, `
		SELECT ca.id, ca.action, ca.station_id, ca.created_at, a.id, a.first_name, a.last_name, a.code
		FROM checkin_actions ca
		JOIN attendees a ON ca.attendee_id = a.id
		WHERE ca.event_id = $1
		ORDER BY ca.created_at DESC, ca.id DESC
		LIMIT $2`, eventID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var actions []CheckinActionRow
	for rows.Next() {
		var row CheckinActionRow
		if err := rows.Scan(&row.ID, &row.Action, &row.StationID, &row.CreatedAt,
			&row.Attendee.ID, &row.Attendee.FirstName, &row.Attendee.LastName, &row.Attendee.Code); err != nil {
			return nil, err
		}
		actions = append(actions, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return actions, nil
}

func (s *PGStore) CreateAttendee(ctx context.Context, attendee *models.Attendee) error {
	var customFieldsJSON []byte
	var err error
	if attendee.CustomFields != nil {
		customFieldsJSON, err = json.Marshal(attendee.CustomFields)
		if err != nil {
			return err
		}
	}
	query := `INSERT INTO attendees (event_id, first_name, last_name, email, company, position, code, blocked, block_reason, custom_fields) 
			  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
			  RETURNING id, created_at, updated_at`
	return s.db.QueryRow(ctx, query,
		attendee.EventID, attendee.FirstName, attendee.LastName, attendee.Email, attendee.Company, attendee.Position, attendee.Code, attendee.Blocked, attendee.BlockReason, customFieldsJSON,
	).Scan(&attendee.ID, &attendee.CreatedAt, &attendee.UpdatedAt)
}

// escapeILikeSearch escapes ILIKE's own wildcard characters (% and _) and the
// escape character itself (\) in user-supplied search text before it is
// wrapped in % for substring matching -- otherwise "jane_doe" would also
// match "janeXdoe" since _ means "any one character" to ILIKE (email
// addresses commonly contain literal underscores). Shared by every store
// method that builds an ILIKE ... ESCAPE '\' search clause over attendees.
func escapeILikeSearch(search string) string {
	escaped := strings.ReplaceAll(search, `\`, `\\`)
	escaped = strings.ReplaceAll(escaped, "%", `\%`)
	escaped = strings.ReplaceAll(escaped, "_", `\_`)
	return escaped
}

// attendeeFilterClause builds the JOIN/WHERE fragment (and matching bind
// args) shared by GetAttendeesByEventID and GetAttendeesPage, so the two
// queries' row-selection semantics can never drift apart. join is "" unless
// zoneID is set, in which case it inner-joins attendee_zone_access to narrow
// to attendees with an explicit allowed=true override for that zone. where
// always starts with "WHERE a.event_id = $1 AND a.deleted_at IS NULL" ($1 is
// always eventID, the first element of the returned args).
func attendeeFilterClause(eventID uuid.UUID, code, search string, zoneID *uuid.UUID, status *bool) (join string, where string, args []interface{}) {
	args = []interface{}{eventID}
	argCount := 2

	if zoneID != nil {
		join = fmt.Sprintf(" JOIN attendee_zone_access aza ON aza.attendee_id = a.id AND aza.zone_id = $%d AND aza.allowed = true", argCount)
		args = append(args, *zoneID)
		argCount++
	}

	where = "WHERE a.event_id = $1 AND a.deleted_at IS NULL"

	if code != "" {
		where += fmt.Sprintf(" AND a.code = $%d", argCount)
		args = append(args, code)
		argCount++
	}

	if search != "" {
		escapedSearch := escapeILikeSearch(search)
		where += fmt.Sprintf(
			" AND (a.first_name ILIKE $%d ESCAPE '\\' OR a.last_name ILIKE $%d ESCAPE '\\' OR a.email ILIKE $%d ESCAPE '\\' OR a.code ILIKE $%d ESCAPE '\\')",
			argCount, argCount, argCount, argCount,
		)
		args = append(args, "%"+escapedSearch+"%")
		argCount++
	}

	if status != nil {
		where += fmt.Sprintf(" AND a.checkin_status = $%d", argCount)
		args = append(args, *status)
		argCount++ //nolint:ineffassign // kept for consistency — a future clause added after this one needs the incremented value
	}

	return join, where, args
}

// attendeeListColumnsSQL is the column list (in scan order) shared by
// GetAttendeesByEventID and GetAttendeesPage, including the LEFT JOINed
// checked_in_by_email.
const attendeeListColumnsSQL = `
	a.id, a.event_id, a.first_name, a.last_name, a.email, a.company, a.position, a.code,
	a.checkin_status, a.checked_in_at, a.checked_in_by, a.checked_in_device_number, a.checked_in_point_name, a.printed_count, a.custom_fields,
	a.blocked, a.block_reason, a.created_at, a.updated_at,
	u.email as checked_in_by_email
`

// scanAttendeeRow scans one row shaped by attendeeListColumnsSQL, shared by
// GetAttendeesByEventID and GetAttendeesPage.
func scanAttendeeRow(rows pgx.Rows) (*models.Attendee, error) {
	var a models.Attendee
	var customFieldsJSON []byte
	if err := rows.Scan(&a.ID, &a.EventID, &a.FirstName, &a.LastName, &a.Email, &a.Company, &a.Position, &a.Code, &a.CheckinStatus, &a.CheckedInAt, &a.CheckedInBy, &a.CheckedInDeviceNumber, &a.CheckedInPointName, &a.PrintedCount, &customFieldsJSON, &a.Blocked, &a.BlockReason, &a.CreatedAt, &a.UpdatedAt, &a.CheckedInByEmail); err != nil {
		return nil, fmt.Errorf("scan attendee row: %w", err)
	}
	if len(customFieldsJSON) > 0 && string(customFieldsJSON) != "null" {
		if err := json.Unmarshal(customFieldsJSON, &a.CustomFields); err != nil {
			return nil, fmt.Errorf("unmarshal custom_fields: %w", err)
		}
	}
	return &a, nil
}

// GetAttendeesByEventID returns attendees for an event, optionally narrowed by
// an exact `code` match and/or a case-insensitive `search` substring match
// across first name/last name/email/code. Pass "" for either to skip that
// filter — matches the empty-string-means-unset convention used by
// GetAllUsers' search/tenantIDFilter params (pg_store_super_admin.go).
func (s *PGStore) GetAttendeesByEventID(ctx context.Context, eventID uuid.UUID, code string, search string) ([]*models.Attendee, error) {
	_, where, args := attendeeFilterClause(eventID, code, search, nil, nil)
	query := "SELECT" + attendeeListColumnsSQL + `
		FROM attendees a
		LEFT JOIN users u ON a.checked_in_by = u.id
		` + where + `
		ORDER BY a.last_name, a.first_name
	`

	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query attendees by event id: %w", err)
	}
	defer rows.Close()

	attendees := []*models.Attendee{}
	for rows.Next() {
		a, err := scanAttendeeRow(rows)
		if err != nil {
			return nil, err
		}
		attendees = append(attendees, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("attendees by event id rows: %w", err)
	}
	return attendees, nil
}

// CountAttendeesByEventID counts non-deleted attendees for an event.
func (s *PGStore) CountAttendeesByEventID(ctx context.Context, eventID uuid.UUID) (int, error) {
	var n int
	// Keep the WHERE clause in lockstep with GetAttendeesByEventID.
	err := s.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM attendees WHERE event_id = $1 AND deleted_at IS NULL`, eventID).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("count attendees by event id: %w", err)
	}
	return n, nil
}

// GetAttendeesPage returns one page of attendees for an event matching f,
// plus the total count matching f (before paging) via a COUNT(*) query that
// shares the exact same JOIN/WHERE fragment (attendeeFilterClause) as the
// page query, so the two can never disagree. Ordering is
// last_name/first_name/id — the trailing id keeps ties (identical
// last/first name) stably ordered across pages, which a two-column sort
// alone cannot guarantee.
func (s *PGStore) GetAttendeesPage(ctx context.Context, eventID uuid.UUID, f AttendeeFilter) ([]*models.Attendee, int, error) {
	join, where, args := attendeeFilterClause(eventID, f.Code, f.Search, f.ZoneID, f.Status)

	var total int
	countQuery := "SELECT COUNT(*) FROM attendees a" + join + " " + where
	if err := s.db.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count attendees page: %w", err)
	}

	limitIdx := len(args) + 1
	offsetIdx := len(args) + 2
	query := "SELECT" + attendeeListColumnsSQL + `
		FROM attendees a
		LEFT JOIN users u ON a.checked_in_by = u.id
		` + join + `
		` + where + fmt.Sprintf(`
		ORDER BY a.last_name, a.first_name, a.id
		LIMIT $%d OFFSET $%d
	`, limitIdx, offsetIdx)

	// Defense-in-depth: the handler layer is expected to reject a page value
	// large enough to overflow this multiplication before calling here, but
	// don't trust that blindly — guard it again at the store boundary.
	if f.PerPage > 0 && f.Page-1 > math.MaxInt/f.PerPage {
		return nil, 0, fmt.Errorf("page/per_page would overflow offset calculation")
	}

	pageArgs := append(append([]interface{}{}, args...), f.PerPage, (f.Page-1)*f.PerPage)

	rows, err := s.db.Query(ctx, query, pageArgs...)
	if err != nil {
		return nil, 0, fmt.Errorf("query attendees page: %w", err)
	}
	defer rows.Close()

	attendees := []*models.Attendee{}
	for rows.Next() {
		a, err := scanAttendeeRow(rows)
		if err != nil {
			return nil, 0, fmt.Errorf("scan attendees page row: %w", err)
		}
		attendees = append(attendees, a)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("attendees page rows: %w", err)
	}
	return attendees, total, nil
}

func (s *PGStore) GetAttendeeByCode(ctx context.Context, eventID uuid.UUID, code string) (*models.Attendee, error) {
	var a models.Attendee
	var customFieldsJSON []byte
	query := `SELECT id, event_id, first_name, last_name, email, company, position, code, checkin_status, checked_in_at, checked_in_by, checked_in_device_number, checked_in_point_name, printed_count, custom_fields, blocked, block_reason, created_at, updated_at
			  FROM attendees WHERE event_id = $1 AND code = $2 AND deleted_at IS NULL`
	err := s.db.QueryRow(ctx, query, eventID, code).Scan(
		&a.ID, &a.EventID, &a.FirstName, &a.LastName, &a.Email, &a.Company, &a.Position, &a.Code, &a.CheckinStatus, &a.CheckedInAt, &a.CheckedInBy, &a.CheckedInDeviceNumber, &a.CheckedInPointName, &a.PrintedCount, &customFieldsJSON, &a.Blocked, &a.BlockReason, &a.CreatedAt, &a.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	if len(customFieldsJSON) > 0 && string(customFieldsJSON) != "null" {
		if err := json.Unmarshal(customFieldsJSON, &a.CustomFields); err != nil {
			return nil, err
		}
	}
	return &a, nil
}

func (s *PGStore) GetAttendeeByID(ctx context.Context, id uuid.UUID) (*models.Attendee, error) {
	var a models.Attendee
	var customFieldsJSON []byte
	query := `SELECT id, event_id, first_name, last_name, email, company, position, code, checkin_status, checked_in_at, checked_in_by, checked_in_device_number, checked_in_point_name, printed_count, custom_fields, blocked, block_reason, created_at, updated_at
			  FROM attendees WHERE id = $1 AND deleted_at IS NULL`
	err := s.db.QueryRow(ctx, query, id).Scan(
		&a.ID, &a.EventID, &a.FirstName, &a.LastName, &a.Email, &a.Company, &a.Position, &a.Code, &a.CheckinStatus, &a.CheckedInAt, &a.CheckedInBy, &a.CheckedInDeviceNumber, &a.CheckedInPointName, &a.PrintedCount, &customFieldsJSON, &a.Blocked, &a.BlockReason, &a.CreatedAt, &a.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	if len(customFieldsJSON) > 0 && string(customFieldsJSON) != "null" {
		if err := json.Unmarshal(customFieldsJSON, &a.CustomFields); err != nil {
			return nil, err
		}
	}
	return &a, nil
}

func (s *PGStore) GetAttendeeByIDForTenant(ctx context.Context, id, tenantID uuid.UUID) (*models.Attendee, error) {
	attendee, err := s.GetAttendeeByID(ctx, id)
	if err != nil || attendee == nil {
		return attendee, err
	}
	event, err := s.GetEventByIDForTenant(ctx, attendee.EventID, tenantID)
	if err != nil {
		return nil, err
	}
	if event == nil {
		return nil, nil
	}
	return attendee, nil
}

// UpdateAttendee persists every attendee field EXCEPT printed_count.
// printed_count is intentionally excluded from this UPDATE's column list:
// this method always writes back a full in-memory *models.Attendee that was
// loaded (often well) before the call, so its PrintedCount field can be
// stale by the time the write lands. A PATCH that loaded count=0, then lost
// a race with a concurrent print (which increments count to 1 via
// IncrementAttendeePrintedCount), would otherwise write the stale 0 back and
// silently erase the increment. IncrementAttendeePrintedCount's own guarded
// `UPDATE ... SET printed_count = printed_count + 1 ... RETURNING
// printed_count` is the sole writer of this column; every other codepath
// (handlers/attendees.go, handlers/sync.go, handlers/zones.go,
// handlers/attendee_codes.go) must go through it instead of round-tripping
// the value here.
func (s *PGStore) UpdateAttendee(ctx context.Context, attendee *models.Attendee) error {
	var customFieldsJSON []byte
	var err error
	if attendee.CustomFields != nil {
		customFieldsJSON, err = json.Marshal(attendee.CustomFields)
		if err != nil {
			return err
		}
	}
	query := `UPDATE attendees SET
			  first_name = $1, last_name = $2, email = $3, company = $4, position = $5, code = $6,
			  checkin_status = $7, checked_in_at = $8, checked_in_by = $9, checked_in_device_number = $10, checked_in_point_name = $11, blocked = $12,
			  block_reason = $13, custom_fields = $14, deleted_at = $15, updated_at = NOW()
			  WHERE id = $16`
	_, err = s.db.Exec(ctx, query,
		attendee.FirstName, attendee.LastName, attendee.Email, attendee.Company, attendee.Position, attendee.Code,
		attendee.CheckinStatus, attendee.CheckedInAt, attendee.CheckedInBy, attendee.CheckedInDeviceNumber, attendee.CheckedInPointName, attendee.Blocked,
		attendee.BlockReason, customFieldsJSON, attendee.DeletedAt, attendee.ID,
	)
	return err
}

// ErrAttendeeNotFound is returned by IncrementAttendeePrintedCount when its
// guarded UPDATE matches 0 rows. By contract the caller has already
// confirmed the attendee exists, belongs to the caller's tenant, and is not
// soft-deleted (via requireAttendeeOwnership) before calling — so this
// sentinel is reachable ONLY via the soft-delete race: the ownership
// pre-check passes, a concurrent DELETE /api/attendees/{id} sets deleted_at,
// and the UPDATE's `deleted_at IS NULL` guard then matches nothing. Handlers
// map it to the house 404 masking ("Attendee not found"), identical to
// requireAttendeeOwnership's own wording.
var ErrAttendeeNotFound = errors.New("attendee not found")

// IncrementAttendeePrintedCount bumps printed_count by one and returns the
// new value (backs the attendees table's Printed pill — reconciliation #6,
// docs/superpowers/plans/2026-07-16-panel-p3.2-print-truth.md; this is a
// counter, not a print journal). The UPDATE carries a `deleted_at IS NULL`
// guard (matching UpdateEventBadgeTemplate's guard above — same race
// class): the caller's requireAttendeeOwnership pre-check can pass and a
// concurrent soft-delete land before this UPDATE executes; without the
// guard, an id-only UPDATE would still increment and 200 for a gone
// attendee. When the guard misses (0 rows), QueryRow surfaces
// pgx.ErrNoRows, which this method maps to the exported ErrAttendeeNotFound
// sentinel — never a fabricated count.
func (s *PGStore) IncrementAttendeePrintedCount(ctx context.Context, attendeeID uuid.UUID) (int, error) {
	var newCount int
	query := `UPDATE attendees SET printed_count = printed_count + 1, updated_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING printed_count`
	err := s.db.QueryRow(ctx, query, attendeeID).Scan(&newCount)
	if err != nil {
		if err == pgx.ErrNoRows {
			return 0, ErrAttendeeNotFound
		}
		return 0, err
	}
	return newCount, nil
}

// API Keys methods
func (s *PGStore) CreateAPIKey(ctx context.Context, apiKey *models.APIKey) error {
	query := `INSERT INTO api_keys (id, event_id, name, key_hash, key_hash_bcrypt, key_preview, expires_at, created_at)
			  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`
	_, err := s.db.Exec(ctx, query,
		apiKey.ID, apiKey.EventID, apiKey.Name, apiKey.KeyHash, apiKey.KeyHashBcrypt, apiKey.KeyPreview, apiKey.ExpiresAt, apiKey.CreatedAt,
	)
	return err
}

func (s *PGStore) GetAPIKeysByEventID(ctx context.Context, eventID uuid.UUID) ([]*models.APIKey, error) {
	query := `SELECT id, event_id, name, key_hash, key_hash_bcrypt, key_preview, expires_at, last_used_at, revoked_at, created_at
			  FROM api_keys
			  WHERE event_id = $1
			  ORDER BY created_at DESC`

	rows, err := s.db.Query(ctx, query, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	keys := []*models.APIKey{}
	for rows.Next() {
		var key models.APIKey
		if err := rows.Scan(&key.ID, &key.EventID, &key.Name, &key.KeyHash, &key.KeyHashBcrypt, &key.KeyPreview,
			&key.ExpiresAt, &key.LastUsedAt, &key.RevokedAt, &key.CreatedAt); err != nil {
			return nil, err
		}
		keys = append(keys, &key)
	}
	return keys, nil
}

func (s *PGStore) GetAPIKeyByHash(ctx context.Context, keyHash string) (*models.APIKey, error) {
	query := `SELECT id, event_id, name, key_hash, key_hash_bcrypt, key_preview, expires_at, last_used_at, revoked_at, created_at
			  FROM api_keys
			  WHERE key_hash = $1`

	var key models.APIKey
	err := s.db.QueryRow(ctx, query, keyHash).Scan(
		&key.ID, &key.EventID, &key.Name, &key.KeyHash, &key.KeyHashBcrypt, &key.KeyPreview,
		&key.ExpiresAt, &key.LastUsedAt, &key.RevokedAt, &key.CreatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("API key not found")
	}
	if err != nil {
		return nil, err
	}
	return &key, nil
}

// GetActiveAPIKeys returns all non-revoked, non-expired API keys (with key_hash_bcrypt set) for verification.
func (s *PGStore) GetActiveAPIKeys(ctx context.Context) ([]*models.APIKey, error) {
	query := `SELECT id, event_id, name, key_hash, key_hash_bcrypt, key_preview, expires_at, last_used_at, revoked_at, created_at
			  FROM api_keys
			  WHERE revoked_at IS NULL
			    AND (expires_at IS NULL OR expires_at > NOW())
			    AND key_hash_bcrypt IS NOT NULL`

	rows, err := s.db.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var keys []*models.APIKey
	for rows.Next() {
		var key models.APIKey
		if err := rows.Scan(&key.ID, &key.EventID, &key.Name, &key.KeyHash, &key.KeyHashBcrypt, &key.KeyPreview,
			&key.ExpiresAt, &key.LastUsedAt, &key.RevokedAt, &key.CreatedAt); err != nil {
			return nil, err
		}
		keys = append(keys, &key)
	}
	return keys, nil
}

func (s *PGStore) RevokeAPIKey(ctx context.Context, id uuid.UUID) error {
	query := `UPDATE api_keys SET revoked_at = NOW() WHERE id = $1`
	_, err := s.db.Exec(ctx, query, id)
	return err
}

func (s *PGStore) UpdateAPIKeyLastUsed(ctx context.Context, id uuid.UUID) error {
	query := `UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`
	_, err := s.db.Exec(ctx, query, id)
	return err
}

// Font methods (per event)

func (s *PGStore) CreateFont(ctx context.Context, font *models.Font) error {
	query := `INSERT INTO fonts (id, event_id, name, family, weight, style, format, data, size, mime_type, uploaded_by, license_accepted_at, created_at)
			  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`
	_, err := s.db.Exec(ctx, query,
		font.ID, font.EventID, font.Name, font.Family, font.Weight, font.Style,
		font.Format, font.Data, font.Size, font.MimeType, font.UploadedBy, font.LicenseAcceptedAt, font.CreatedAt,
	)
	return err
}

func (s *PGStore) GetFontsByEventID(ctx context.Context, eventID uuid.UUID) ([]*models.FontListItem, error) {
	query := `SELECT id, name, family, weight, style, format, size, created_at
			  FROM fonts
			  WHERE event_id = $1
			  ORDER BY family, weight, style`

	rows, err := s.db.Query(ctx, query, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var fonts []*models.FontListItem
	for rows.Next() {
		var font models.FontListItem
		if err := rows.Scan(&font.ID, &font.Name, &font.Family, &font.Weight, &font.Style,
			&font.Format, &font.Size, &font.CreatedAt); err != nil {
			return nil, err
		}
		fonts = append(fonts, &font)
	}
	return fonts, nil
}

func (s *PGStore) GetFontByID(ctx context.Context, id uuid.UUID) (*models.Font, error) {
	query := `SELECT id, event_id, name, family, weight, style, format, data, size, mime_type, uploaded_by, license_accepted_at, created_at
			  FROM fonts
			  WHERE id = $1`

	var font models.Font
	err := s.db.QueryRow(ctx, query, id).Scan(
		&font.ID, &font.EventID, &font.Name, &font.Family, &font.Weight, &font.Style,
		&font.Format, &font.Data, &font.Size, &font.MimeType, &font.UploadedBy, &font.LicenseAcceptedAt, &font.CreatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, fmt.Errorf("font not found")
	}
	if err != nil {
		return nil, err
	}
	return &font, nil
}

func (s *PGStore) DeleteFont(ctx context.Context, id uuid.UUID) error {
	query := `DELETE FROM fonts WHERE id = $1`
	_, err := s.db.Exec(ctx, query, id)
	return err
}

// Multi-organization support methods

func (s *PGStore) AddUserToTenant(ctx context.Context, userTenant *models.UserTenant) error {
	userTenant.ID = uuid.New()
	query := `INSERT INTO user_tenants (id, user_id, tenant_id, role, joined_at)
			  VALUES ($1, $2, $3, $4, $5)
			  ON CONFLICT (user_id, tenant_id) DO NOTHING`
	_, err := s.db.Exec(ctx, query, userTenant.ID, userTenant.UserID, userTenant.TenantID, userTenant.Role, userTenant.JoinedAt)
	return err
}

func (s *PGStore) RemoveUserFromTenant(ctx context.Context, userID, tenantID uuid.UUID) error {
	query := `DELETE FROM user_tenants WHERE user_id = $1 AND tenant_id = $2`
	_, err := s.db.Exec(ctx, query, userID, tenantID)
	return err
}

func (s *PGStore) GetUserTenants(ctx context.Context, userID uuid.UUID) ([]*models.Tenant, error) {
	query := `SELECT t.id, t.name, t.status, t.settings, t.logo_url, t.website, t.contact_email, t.created_at, t.updated_at
			  FROM tenants t
			  INNER JOIN user_tenants ut ON t.id = ut.tenant_id
			  WHERE ut.user_id = $1
			  ORDER BY ut.joined_at DESC`
	rows, err := s.db.Query(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tenants := []*models.Tenant{}
	for rows.Next() {
		var t models.Tenant
		var settingsJSON []byte
		if err := rows.Scan(&t.ID, &t.Name, &t.Status, &settingsJSON, &t.LogoURL, &t.Website, &t.ContactEmail, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, err
		}
		if len(settingsJSON) > 0 && string(settingsJSON) != "null" {
			if err := json.Unmarshal(settingsJSON, &t.Settings); err != nil {
				return nil, err
			}
		}
		tenants = append(tenants, &t)
	}
	return tenants, nil
}

func (s *PGStore) GetUserTenantRole(ctx context.Context, userID, tenantID uuid.UUID) (string, error) {
	var role string
	query := `SELECT role FROM user_tenants WHERE user_id = $1 AND tenant_id = $2`
	err := s.db.QueryRow(ctx, query, userID, tenantID).Scan(&role)
	if err != nil {
		return "", err
	}
	return role, nil
}

func (s *PGStore) UpdateUserTenantRole(ctx context.Context, userID, tenantID uuid.UUID, role string) error {
	query := `UPDATE user_tenants SET role = $1 WHERE user_id = $2 AND tenant_id = $3`
	_, err := s.db.Exec(ctx, query, role, userID, tenantID)
	return err
}

// Super Admin - Organizations Management

func (s *PGStore) GetAllTenants(ctx context.Context, filters map[string]interface{}) ([]*models.TenantWithStats, error) {
	query := `
		SELECT
			t.id, t.name, t.status AS tenant_status, t.archived_at, t.settings, t.logo_url, t.website, t.contact_email, t.created_at, t.updated_at,
			s.id as sub_id, s.plan_id as sub_plan_id, s.status AS subscription_status, s.start_date, s.end_date,
			sp.id as sp_id, sp.name as plan_name, sp.slug, sp.tier,
			COUNT(DISTINCT u.id) as users_count,
			COUNT(DISTINCT e.id) as events_count,
			COUNT(DISTINCT a.id) as attendees_count
		FROM tenants t
		LEFT JOIN subscriptions s ON t.id = s.tenant_id
		LEFT JOIN subscription_plans sp ON s.plan_id = sp.id
		LEFT JOIN user_tenants ut ON t.id = ut.tenant_id
		LEFT JOIN users u ON ut.user_id = u.id
		LEFT JOIN events e ON t.id = e.tenant_id
		LEFT JOIN attendees a ON e.id = a.event_id
		GROUP BY t.id, s.id, sp.id, sp.name, sp.slug, sp.tier
		ORDER BY t.created_at DESC
	`

	rows, err := s.db.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tenants := make([]*models.TenantWithStats, 0)
	for rows.Next() {
		var tws models.TenantWithStats
		var t models.Tenant
		var s models.Subscription
		var sp models.SubscriptionPlan
		var settingsJSON []byte
		var subID, subPlanID, spID, spName, spSlug, spTier, sStatus *string
		var sStartDate *time.Time
		var sEndDate *time.Time

		err := rows.Scan(
			&t.ID, &t.Name, &t.Status, &t.ArchivedAt, &settingsJSON, &t.LogoURL, &t.Website, &t.ContactEmail, &t.CreatedAt, &t.UpdatedAt,
			&subID, &subPlanID, &sStatus, &sStartDate, &sEndDate,
			&spID, &spName, &spSlug, &spTier,
			&tws.UsersCount, &tws.EventsCount, &tws.AttendeesCount,
		)
		if err != nil {
			return nil, err
		}

		if len(settingsJSON) > 0 && string(settingsJSON) != "null" {
			if err := json.Unmarshal(settingsJSON, &t.Settings); err != nil {
				log.Printf("Failed to unmarshal tenant settings: %v", err)
			}
		}

		tws.Tenant = &t

		// Build subscription if exists
		if subID != nil && *subID != "" {
			s.ID = uuid.MustParse(*subID)
			if sStatus != nil {
				s.Status = *sStatus
			}
			if sStartDate != nil {
				s.StartDate = *sStartDate
			}
			s.EndDate = sEndDate

			// Build plan if exists
			if spID != nil && *spID != "" {
				sp.ID = uuid.MustParse(*spID)
				if spName != nil {
					sp.Name = *spName
				}
				if spSlug != nil {
					sp.Slug = *spSlug
				}
				if spTier != nil {
					sp.Tier = *spTier
				}
				s.Plan = &sp
			}
			if subPlanID != nil && *subPlanID != "" {
				planUUID := uuid.MustParse(*subPlanID)
				s.PlanID = &planUUID
			}
			tws.Subscription = &s
		}

		tenants = append(tenants, &tws)
	}

	return tenants, nil
}

func (s *PGStore) GetTenantStats(ctx context.Context, tenantID uuid.UUID) (*models.TenantWithStats, error) {
	var tws models.TenantWithStats
	var t models.Tenant
	var settingsJSON []byte

	query := `SELECT id, name, status, archived_at, settings, logo_url, website, contact_email, created_at, updated_at
	          FROM tenants WHERE id = $1`
	err := s.db.QueryRow(ctx, query, tenantID).Scan(
		&t.ID, &t.Name, &t.Status, &t.ArchivedAt, &settingsJSON, &t.LogoURL, &t.Website, &t.ContactEmail, &t.CreatedAt, &t.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	if len(settingsJSON) > 0 && string(settingsJSON) != "null" {
		if err := json.Unmarshal(settingsJSON, &t.Settings); err != nil {
			return nil, fmt.Errorf("failed to unmarshal tenant settings: %w", err)
		}
	}

	tws.Tenant = &t

	// Get subscription
	sub, err := s.GetSubscriptionByTenantID(ctx, tenantID)
	if err != nil {
		return nil, fmt.Errorf("failed to get subscription: %w", err)
	}
	tws.Subscription = sub

	// Count users
	if err := s.db.QueryRow(ctx, `SELECT COUNT(*) FROM user_tenants WHERE tenant_id = $1`, tenantID).Scan(&tws.UsersCount); err != nil {
		return nil, fmt.Errorf("failed to count users: %w", err)
	}

	// Count events
	if err := s.db.QueryRow(ctx, `SELECT COUNT(*) FROM events WHERE tenant_id = $1 AND deleted_at IS NULL`, tenantID).Scan(&tws.EventsCount); err != nil {
		return nil, fmt.Errorf("failed to count events: %w", err)
	}

	// Count attendees
	if err := s.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM attendees a
		INNER JOIN events e ON a.event_id = e.id
		WHERE e.tenant_id = $1 AND a.deleted_at IS NULL AND e.deleted_at IS NULL
	`, tenantID).Scan(&tws.AttendeesCount); err != nil {
		return nil, fmt.Errorf("failed to count attendees: %w", err)
	}

	return &tws, nil
}

// GetPlatformAnalytics aggregates operator-facing platform metrics. All
// queries are cheap index scans/aggregates over small operator tables;
// callers are super-admin only.
func (s *PGStore) GetPlatformAnalytics(ctx context.Context) (*models.PlatformAnalytics, error) {
	a := &models.PlatformAnalytics{TenantsByStatus: map[string]int{}}

	rows, err := s.db.Query(ctx, `SELECT status, COUNT(*) FROM tenants GROUP BY status`)
	if err != nil {
		return nil, fmt.Errorf("tenants by status: %w", err)
	}
	for rows.Next() {
		var status string
		var count int
		if err := rows.Scan(&status, &count); err != nil {
			rows.Close()
			return nil, err
		}
		a.TenantsByStatus[status] = count
		a.TotalTenants += count
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("tenants by status: %w", err)
	}

	rows, err = s.db.Query(ctx, `
		SELECT COALESCE(p.slug, 'none'), COUNT(*)
		FROM tenants t
		LEFT JOIN subscriptions s ON s.tenant_id = t.id
		LEFT JOIN subscription_plans p ON p.id = s.plan_id
		GROUP BY 1 ORDER BY 2 DESC`)
	if err != nil {
		return nil, fmt.Errorf("tenants by plan: %w", err)
	}
	for rows.Next() {
		var pc models.PlanCount
		if err := rows.Scan(&pc.Plan, &pc.Count); err != nil {
			rows.Close()
			return nil, err
		}
		a.TenantsByPlan = append(a.TenantsByPlan, pc)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("tenants by plan: %w", err)
	}

	rows, err = s.db.Query(ctx, `
		SELECT to_char(date_trunc('week', created_at), 'YYYY-MM-DD'), COUNT(*)
		FROM tenants
		WHERE created_at >= date_trunc('week', NOW()) - INTERVAL '7 weeks'
		GROUP BY 1 ORDER BY 1`)
	if err != nil {
		return nil, fmt.Errorf("signups by week: %w", err)
	}
	for rows.Next() {
		var tc models.TimeCount
		if err := rows.Scan(&tc.Period, &tc.Count); err != nil {
			rows.Close()
			return nil, err
		}
		a.SignupsByWeek = append(a.SignupsByWeek, tc)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("signups by week: %w", err)
	}

	if err := s.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM events
		WHERE deleted_at IS NULL
		  AND (start_date IS NULL OR start_date <= NOW())
		  AND (end_date IS NULL OR end_date >= NOW())`).Scan(&a.ActiveEvents); err != nil {
		return nil, fmt.Errorf("active events: %w", err)
	}

	rows, err = s.db.Query(ctx, `
		SELECT to_char(date_trunc('day', checked_in_at), 'YYYY-MM-DD'), COUNT(*)
		FROM attendees
		WHERE checked_in_at >= NOW() - INTERVAL '14 days'
		GROUP BY 1 ORDER BY 1`)
	if err != nil {
		return nil, fmt.Errorf("checkins by day: %w", err)
	}
	for rows.Next() {
		var tc models.TimeCount
		if err := rows.Scan(&tc.Period, &tc.Count); err != nil {
			rows.Close()
			return nil, err
		}
		a.CheckinsByDay = append(a.CheckinsByDay, tc)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("checkins by day: %w", err)
	}

	if err := s.db.QueryRow(ctx, `
		SELECT COUNT(DISTINCT t.id)
		FROM tenants t
		JOIN subscriptions s ON s.tenant_id = t.id AND s.status = 'active'
		JOIN subscription_plans p ON p.id = s.plan_id AND p.price_monthly > 0`).Scan(&a.PaidTenants); err != nil {
		return nil, fmt.Errorf("paid tenants: %w", err)
	}
	if a.TotalTenants > 0 {
		a.PaidConversion = float64(a.PaidTenants) / float64(a.TotalTenants)
	}
	return a, nil
}

// Subscription Plans

func (s *PGStore) CreateSubscriptionPlan(ctx context.Context, plan *models.SubscriptionPlan) error {
	limitsJSON, err := json.Marshal(plan.Limits)
	if err != nil {
		return fmt.Errorf("failed to marshal limits: %w", err)
	}
	featuresJSON, err := json.Marshal(plan.Features)
	if err != nil {
		return fmt.Errorf("failed to marshal features: %w", err)
	}

	query := `INSERT INTO subscription_plans 
	          (name, slug, tier, description, price_monthly, price_yearly, limits, features, is_active, is_public, sort_order)
	          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	          RETURNING id, created_at, updated_at`

	return s.db.QueryRow(ctx, query,
		plan.Name, plan.Slug, plan.Tier, plan.Description, plan.PriceMonthly, plan.PriceYearly,
		limitsJSON, featuresJSON, plan.IsActive, plan.IsPublic, plan.SortOrder,
	).Scan(&plan.ID, &plan.CreatedAt, &plan.UpdatedAt)
}

func (s *PGStore) GetSubscriptionPlans(ctx context.Context, includeInactive bool) ([]*models.SubscriptionPlan, error) {
	query := `SELECT id, name, slug, tier, description, price_monthly, price_yearly, limits, features, 
	                 is_active, is_public, sort_order, created_at, updated_at
	          FROM subscription_plans`

	if !includeInactive {
		query += ` WHERE is_active = TRUE`
	}
	query += ` ORDER BY sort_order, created_at`

	rows, err := s.db.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var plans []*models.SubscriptionPlan
	for rows.Next() {
		var p models.SubscriptionPlan
		var limitsJSON, featuresJSON []byte

		if err := rows.Scan(
			&p.ID, &p.Name, &p.Slug, &p.Tier, &p.Description, &p.PriceMonthly, &p.PriceYearly,
			&limitsJSON, &featuresJSON, &p.IsActive, &p.IsPublic, &p.SortOrder, &p.CreatedAt, &p.UpdatedAt,
		); err != nil {
			return nil, err
		}

		if len(limitsJSON) > 0 {
			if err := json.Unmarshal(limitsJSON, &p.Limits); err != nil {
				log.Printf("Failed to unmarshal limits: %v", err)
			}
		}
		if len(featuresJSON) > 0 {
			if err := json.Unmarshal(featuresJSON, &p.Features); err != nil {
				log.Printf("Failed to unmarshal features: %v", err)
			}
		}

		plans = append(plans, &p)
	}

	return plans, nil
}

func (s *PGStore) GetSubscriptionPlanByID(ctx context.Context, id uuid.UUID) (*models.SubscriptionPlan, error) {
	var p models.SubscriptionPlan
	var limitsJSON, featuresJSON []byte

	query := `SELECT id, name, slug, tier, description, price_monthly, price_yearly, limits, features,
	                 is_active, is_public, sort_order, created_at, updated_at
	          FROM subscription_plans WHERE id = $1`

	err := s.db.QueryRow(ctx, query, id).Scan(
		&p.ID, &p.Name, &p.Slug, &p.Tier, &p.Description, &p.PriceMonthly, &p.PriceYearly,
		&limitsJSON, &featuresJSON, &p.IsActive, &p.IsPublic, &p.SortOrder, &p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	if len(limitsJSON) > 0 {
		if err := json.Unmarshal(limitsJSON, &p.Limits); err != nil {
			fmt.Printf("Failed to unmarshal limits: %v\n", err)
		}
	}
	if len(featuresJSON) > 0 {
		if err := json.Unmarshal(featuresJSON, &p.Features); err != nil {
			fmt.Printf("Failed to unmarshal features: %v\n", err)
		}
	}

	return &p, nil
}

func (s *PGStore) UpdateSubscriptionPlan(ctx context.Context, plan *models.SubscriptionPlan) error {
	limitsJSON, err := json.Marshal(plan.Limits)
	if err != nil {
		return fmt.Errorf("failed to marshal limits: %w", err)
	}
	featuresJSON, err := json.Marshal(plan.Features)
	if err != nil {
		return fmt.Errorf("failed to marshal features: %w", err)
	}

	query := `UPDATE subscription_plans 
	          SET name = $1, slug = $2, tier = $3, description = $4, price_monthly = $5, price_yearly = $6,
	              limits = $7, features = $8, is_active = $9, is_public = $10, sort_order = $11, updated_at = NOW()
	          WHERE id = $12`

	_, execErr := s.db.Exec(ctx, query,
		plan.Name, plan.Slug, plan.Tier, plan.Description, plan.PriceMonthly, plan.PriceYearly,
		limitsJSON, featuresJSON, plan.IsActive, plan.IsPublic, plan.SortOrder, plan.ID,
	)
	return execErr
}

// Subscriptions

// UpsertSubscription inserts or replaces the tenant's single subscription
// row atomically — concurrent create attempts cannot 500 on UNIQUE(tenant_id).
func (s *PGStore) UpsertSubscription(ctx context.Context, sub *models.Subscription) error {
	customLimitsJSON, err := json.Marshal(sub.CustomLimits)
	if err != nil {
		return fmt.Errorf("failed to marshal custom limits: %w", err)
	}
	customFeaturesJSON, err := json.Marshal(sub.CustomFeatures)
	if err != nil {
		return fmt.Errorf("failed to marshal custom features: %w", err)
	}
	query := `INSERT INTO subscriptions
	          (tenant_id, plan_id, status, start_date, end_date, trial_end_date,
	           custom_limits, custom_features, payment_method, admin_notes, created_by)
	          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	          ON CONFLICT (tenant_id) DO UPDATE SET
	            plan_id = EXCLUDED.plan_id, status = EXCLUDED.status,
	            start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date,
	            trial_end_date = EXCLUDED.trial_end_date,
	            custom_limits = EXCLUDED.custom_limits, custom_features = EXCLUDED.custom_features,
	            payment_method = EXCLUDED.payment_method, admin_notes = EXCLUDED.admin_notes,
	            updated_at = NOW()
	          RETURNING id, created_at, updated_at`
	return s.db.QueryRow(ctx, query,
		sub.TenantID, sub.PlanID, sub.Status, sub.StartDate, sub.EndDate, sub.TrialEndDate,
		customLimitsJSON, customFeaturesJSON, sub.PaymentMethod, sub.AdminNotes, sub.CreatedBy,
	).Scan(&sub.ID, &sub.CreatedAt, &sub.UpdatedAt)
}

func (s *PGStore) GetSubscriptionByTenantID(ctx context.Context, tenantID uuid.UUID) (*models.Subscription, error) {
	var sub models.Subscription
	var customLimitsJSON, customFeaturesJSON []byte
	var planID *string

	query := `SELECT s.id, s.tenant_id, s.plan_id, s.status, s.start_date, s.end_date, s.trial_end_date,
	                 s.custom_limits, s.custom_features, s.payment_method, s.last_payment_date,
	                 s.next_billing_date, s.admin_notes, s.created_at, s.updated_at, s.created_by,
	                 sp.id, sp.name, sp.slug, sp.tier, sp.limits, sp.features
	          FROM subscriptions s
	          LEFT JOIN subscription_plans sp ON s.plan_id = sp.id
	          WHERE s.tenant_id = $1`

	var spID, spName, spSlug, spTier *string
	var spLimits, spFeatures []byte

	err := s.db.QueryRow(ctx, query, tenantID).Scan(
		&sub.ID, &sub.TenantID, &planID, &sub.Status, &sub.StartDate, &sub.EndDate, &sub.TrialEndDate,
		&customLimitsJSON, &customFeaturesJSON, &sub.PaymentMethod, &sub.LastPaymentDate,
		&sub.NextBillingDate, &sub.AdminNotes, &sub.CreatedAt, &sub.UpdatedAt, &sub.CreatedBy,
		&spID, &spName, &spSlug, &spTier, &spLimits, &spFeatures,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}

	if len(customLimitsJSON) > 0 && string(customLimitsJSON) != "null" {
		if err := json.Unmarshal(customLimitsJSON, &sub.CustomLimits); err != nil {
			fmt.Printf("Failed to unmarshal custom limits: %v\n", err)
		}
	}
	if len(customFeaturesJSON) > 0 && string(customFeaturesJSON) != "null" {
		if err := json.Unmarshal(customFeaturesJSON, &sub.CustomFeatures); err != nil {
			fmt.Printf("Failed to unmarshal custom features: %v\n", err)
		}
	}

	if spID != nil {
		var plan models.SubscriptionPlan
		plan.ID = uuid.MustParse(*spID)
		plan.Name = *spName
		plan.Slug = *spSlug
		plan.Tier = *spTier

		if len(spLimits) > 0 {
			if err := json.Unmarshal(spLimits, &plan.Limits); err != nil {
				log.Printf("Failed to unmarshal plan limits: %v", err)
			}
		}
		if len(spFeatures) > 0 {
			if err := json.Unmarshal(spFeatures, &plan.Features); err != nil {
				log.Printf("Failed to unmarshal plan features: %v", err)
			}
		}

		sub.Plan = &plan
	}

	return &sub, nil
}

func (s *PGStore) UpdateSubscription(ctx context.Context, sub *models.Subscription) error {
	customLimitsJSON, err := json.Marshal(sub.CustomLimits)
	if err != nil {
		return fmt.Errorf("failed to marshal custom limits: %w", err)
	}
	customFeaturesJSON, err := json.Marshal(sub.CustomFeatures)
	if err != nil {
		return fmt.Errorf("failed to marshal custom features: %w", err)
	}

	query := `UPDATE subscriptions 
	          SET plan_id = $1, status = $2, end_date = $3, trial_end_date = $4,
	              custom_limits = $5, custom_features = $6, payment_method = $7,
	              last_payment_date = $8, next_billing_date = $9, admin_notes = $10, updated_at = NOW()
	          WHERE id = $11`

	_, execErr := s.db.Exec(ctx, query,
		sub.PlanID, sub.Status, sub.EndDate, sub.TrialEndDate,
		customLimitsJSON, customFeaturesJSON, sub.PaymentMethod,
		sub.LastPaymentDate, sub.NextBillingDate, sub.AdminNotes, sub.ID,
	)
	return execErr
}

func (s *PGStore) GetExpiringSubscriptions(ctx context.Context, days int) ([]*models.Subscription, error) {
	query := `SELECT id, tenant_id, plan_id, status, start_date, end_date, trial_end_date,
	                 custom_limits, custom_features, payment_method, last_payment_date,
	                 next_billing_date, admin_notes, created_at, updated_at
	          FROM subscriptions
	          WHERE status = 'active' AND end_date IS NOT NULL 
	            AND end_date BETWEEN NOW() AND NOW() + INTERVAL '1 day' * $1`

	rows, err := s.db.Query(ctx, query, days)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var subs []*models.Subscription
	for rows.Next() {
		var sub models.Subscription
		var customLimitsJSON, customFeaturesJSON []byte

		err := rows.Scan(
			&sub.ID, &sub.TenantID, &sub.PlanID, &sub.Status, &sub.StartDate, &sub.EndDate, &sub.TrialEndDate,
			&customLimitsJSON, &customFeaturesJSON, &sub.PaymentMethod, &sub.LastPaymentDate,
			&sub.NextBillingDate, &sub.AdminNotes, &sub.CreatedAt, &sub.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}

		if len(customLimitsJSON) > 0 {
			if err := json.Unmarshal(customLimitsJSON, &sub.CustomLimits); err != nil {
				log.Printf("Failed to unmarshal custom limits: %v", err)
			}
		}
		if len(customFeaturesJSON) > 0 {
			if err := json.Unmarshal(customFeaturesJSON, &sub.CustomFeatures); err != nil {
				log.Printf("Failed to unmarshal custom features: %v", err)
			}
		}

		subs = append(subs, &sub)
	}

	return subs, nil
}

// Usage Tracking

func (s *PGStore) LogUsage(ctx context.Context, log *models.UsageLog) error {
	metadataJSON, err := json.Marshal(log.Metadata)
	if err != nil {
		return fmt.Errorf("failed to marshal metadata: %w", err)
	}

	query := `INSERT INTO usage_logs (tenant_id, resource_type, resource_id, action, quantity, metadata)
	          VALUES ($1, $2, $3, $4, $5, $6)
	          RETURNING id, logged_at`

	return s.db.QueryRow(ctx, query,
		log.TenantID, log.ResourceType, log.ResourceID, log.Action, log.Quantity, metadataJSON,
	).Scan(&log.ID, &log.LoggedAt)
}

func (s *PGStore) GetUsageStats(ctx context.Context, tenantID uuid.UUID, startDate, endDate time.Time) (map[string]int, error) {
	query := `SELECT resource_type, SUM(quantity) as total
	          FROM usage_logs
	          WHERE tenant_id = $1 AND logged_at BETWEEN $2 AND $3
	          GROUP BY resource_type`

	rows, err := s.db.Query(ctx, query, tenantID, startDate, endDate)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	stats := make(map[string]int)
	for rows.Next() {
		var resourceType string
		var total int
		if err := rows.Scan(&resourceType, &total); err != nil {
			return nil, err
		}
		stats[resourceType] = total
	}

	return stats, nil
}

// resolveTenantLimit returns the effective value for limitType: custom
// subscription limits override plan limits; 0 means "not configured".
func (s *PGStore) resolveTenantLimit(ctx context.Context, tenantID uuid.UUID, limitType string) (float64, error) {
	sub, err := s.GetSubscriptionByTenantID(ctx, tenantID)
	if err != nil || sub == nil {
		return 0, fmt.Errorf("no active subscription")
	}
	var maxLimit float64
	if sub.CustomLimits != nil {
		if val, ok := sub.CustomLimits[limitType]; ok {
			floatVal, ok := val.(float64)
			if !ok {
				return 0, fmt.Errorf("invalid custom limit type for %s", limitType)
			}
			maxLimit = floatVal
		}
	}
	if maxLimit == 0 && sub.Plan != nil && sub.Plan.Limits != nil {
		if val, ok := sub.Plan.Limits[limitType]; ok {
			floatVal, ok := val.(float64)
			if !ok {
				return 0, fmt.Errorf("invalid plan limit type for %s", limitType)
			}
			maxLimit = floatVal
		}
	}
	return maxLimit, nil
}

func (s *PGStore) CheckTenantLimit(ctx context.Context, tenantID uuid.UUID, limitType string) (bool, int, int, error) {
	maxLimit, err := s.resolveTenantLimit(ctx, tenantID, limitType)
	if err != nil {
		return false, 0, 0, err
	}

	// -1 means unlimited
	if maxLimit == -1 {
		return true, 0, -1, nil
	}

	// Count current usage based on limit type
	var current int
	switch limitType {
	case "events_per_month":
		if err := s.db.QueryRow(ctx, `
			SELECT COUNT(*) FROM events
			WHERE tenant_id = $1 AND deleted_at IS NULL
			  AND created_at >= date_trunc('month', NOW())
		`, tenantID).Scan(&current); err != nil {
			return false, 0, 0, fmt.Errorf("failed to count events: %w", err)
		}
	case "users":
		if err := s.db.QueryRow(ctx, `
			SELECT COUNT(*) FROM user_tenants WHERE tenant_id = $1
		`, tenantID).Scan(&current); err != nil {
			return false, 0, 0, fmt.Errorf("failed to count users: %w", err)
		}
	}

	allowed := current < int(maxLimit)
	return allowed, current, int(maxLimit), nil
}

// CheckAttendeeLimit enforces attendees_per_event for one event, counting
// soft-deleted attendees out. adding is the number about to be created
// (1 for single create, len(batch) for bulk import).
func (s *PGStore) CheckAttendeeLimit(ctx context.Context, tenantID, eventID uuid.UUID, adding int) (bool, int, int, error) {
	maxLimit, err := s.resolveTenantLimit(ctx, tenantID, "attendees_per_event")
	if err != nil {
		return false, 0, 0, err
	}
	if maxLimit == -1 {
		return true, 0, -1, nil
	}
	var current int
	if err := s.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM attendees WHERE event_id = $1 AND deleted_at IS NULL`,
		eventID).Scan(&current); err != nil {
		return false, 0, 0, fmt.Errorf("failed to count attendees: %w", err)
	}
	return current+adding <= int(maxLimit), current, int(maxLimit), nil
}

// Audit

// auditIPValue normalizes a client-supplied IP for the INET audit column.
// c.RealIP() can carry spoofed/malformed forwarded values; an invalid string
// would fail the INSERT and silently drop the audit row (callers are
// best-effort), so invalid input degrades to NULL instead.
func auditIPValue(ip string) interface{} {
	if addr, err := netip.ParseAddr(ip); err == nil {
		return addr.String()
	}
	return nil
}

// LogAdminAction records a platform-operator action with request attribution.
func (s *PGStore) LogAdminAction(ctx context.Context, adminID uuid.UUID, action string, targetType string, targetID uuid.UUID, changes interface{}, ip, userAgent string) error {
	changesJSON, err := json.Marshal(changes)
	if err != nil {
		return fmt.Errorf("failed to marshal changes: %w", err)
	}

	query := `INSERT INTO admin_audit_log (admin_user_id, action, target_type, target_id, changes, ip_address, user_agent)
	          VALUES ($1, $2, $3, $4, $5, $6, $7)`

	_, execErr := s.db.Exec(ctx, query, adminID, action, targetType, targetID, changesJSON, auditIPValue(ip), userAgent)
	return execErr
}

func (s *PGStore) GetAuditLog(ctx context.Context, filters map[string]interface{}, limit int, offset int) ([]*models.AdminAuditLog, int, error) {
	var conditions []string
	var args []interface{}

	if action, ok := filters["action"].(string); ok && action != "" {
		args = append(args, action)
		conditions = append(conditions, fmt.Sprintf("action = $%d", len(args)))
	}
	if targetID, ok := filters["target_id"].(uuid.UUID); ok {
		args = append(args, targetID)
		conditions = append(conditions, fmt.Sprintf("target_id = $%d", len(args)))
	}
	if adminUserID, ok := filters["admin_user_id"].(uuid.UUID); ok {
		args = append(args, adminUserID)
		conditions = append(conditions, fmt.Sprintf("admin_user_id = $%d", len(args)))
	}
	if dateFrom, ok := filters["date_from"].(time.Time); ok {
		args = append(args, dateFrom)
		conditions = append(conditions, fmt.Sprintf("created_at >= $%d", len(args)))
	}
	if dateTo, ok := filters["date_to"].(time.Time); ok {
		args = append(args, dateTo.Add(24*time.Hour))
		conditions = append(conditions, fmt.Sprintf("created_at < $%d", len(args)))
	}

	where := ""
	if len(conditions) > 0 {
		where = "WHERE " + strings.Join(conditions, " AND ")
	}

	query := fmt.Sprintf(`SELECT id, admin_user_id, action, target_type, target_id, changes, ip_address::text, user_agent, created_at
	          FROM admin_audit_log %s
	          ORDER BY created_at DESC
	          LIMIT $%d OFFSET $%d`, where, len(args)+1, len(args)+2)
	rows, err := s.db.Query(ctx, query, append(args, limit, offset)...)
	if err != nil {
		return nil, 0, fmt.Errorf("query audit log: %w", err)
	}
	defer rows.Close()

	var logs []*models.AdminAuditLog
	for rows.Next() {
		var auditLog models.AdminAuditLog
		var changesJSON []byte

		err := rows.Scan(
			&auditLog.ID, &auditLog.AdminUserID, &auditLog.Action, &auditLog.TargetType, &auditLog.TargetID,
			&changesJSON, &auditLog.IPAddress, &auditLog.UserAgent, &auditLog.CreatedAt,
		)
		if err != nil {
			return nil, 0, fmt.Errorf("scan audit log: %w", err)
		}

		if len(changesJSON) > 0 {
			if err := json.Unmarshal(changesJSON, &auditLog.Changes); err != nil {
				log.Printf("Failed to unmarshal changes: %v", err)
			}
		}

		logs = append(logs, &auditLog)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate audit log: %w", err)
	}

	countQuery := "SELECT COUNT(*) FROM admin_audit_log " + where
	var total int
	if err := s.db.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("get audit log total count: %w", err)
	}

	return logs, total, nil
}
