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

func (s *PGStore) GetEventByID(ctx context.Context, id uuid.UUID) (*models.Event, error) {
	var e models.Event
	var customFieldsJSON []byte
	query := `SELECT id, tenant_id, name, start_date, end_date, location, field_schema, custom_fields, created_at, updated_at 
			  FROM events WHERE id = $1 AND deleted_at IS NULL`
	err := s.db.QueryRow(ctx, query, id).Scan(
		&e.ID, &e.TenantID, &e.Name, &e.StartDate, &e.EndDate, &e.Location, &e.FieldSchema, &customFieldsJSON, &e.CreatedAt, &e.UpdatedAt,
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
		argCount++
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
		return nil, err
	}
	if len(customFieldsJSON) > 0 && string(customFieldsJSON) != "null" {
		if err := json.Unmarshal(customFieldsJSON, &a.CustomFields); err != nil {
			return nil, err
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
		return nil, err
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
	return attendees, rows.Err()
}

// CountAttendeesByEventID counts non-deleted attendees for an event.
func (s *PGStore) CountAttendeesByEventID(ctx context.Context, eventID uuid.UUID) (int, error) {
	var n int
	// Keep the WHERE clause in lockstep with GetAttendeesByEventID.
	err := s.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM attendees WHERE event_id = $1 AND deleted_at IS NULL`, eventID).Scan(&n)
	return n, err
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
		return nil, 0, err
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

	pageArgs := append(append([]interface{}{}, args...), f.PerPage, (f.Page-1)*f.PerPage)

	rows, err := s.db.Query(ctx, query, pageArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	attendees := []*models.Attendee{}
	for rows.Next() {
		a, err := scanAttendeeRow(rows)
		if err != nil {
			return nil, 0, err
		}
		attendees = append(attendees, a)
	}
	return attendees, total, rows.Err()
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
			  first_name = $1, last_name = $2, email = $3, company = $4, position = $5,
			  checkin_status = $6, checked_in_at = $7, checked_in_by = $8, checked_in_device_number = $9, checked_in_point_name = $10, printed_count = $11, blocked = $12,
			  block_reason = $13, custom_fields = $14, deleted_at = $15, updated_at = NOW()
			  WHERE id = $16`
	_, err = s.db.Exec(ctx, query,
		attendee.FirstName, attendee.LastName, attendee.Email, attendee.Company, attendee.Position,
		attendee.CheckinStatus, attendee.CheckedInAt, attendee.CheckedInBy, attendee.CheckedInDeviceNumber, attendee.CheckedInPointName, attendee.PrintedCount, attendee.Blocked,
		attendee.BlockReason, customFieldsJSON, attendee.DeletedAt, attendee.ID,
	)
	return err
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
