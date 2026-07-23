package store

import (
	"context"
	"encoding/json"
	"errors"
	"log"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// UpsertEquipmentMachine registers/refreshes a machine row, then — only
// when seenDeviceIDs is non-empty — touches last_seen_at on every one of
// this tenant/machine's devices the agent's report still names as attached.
// The two statements are issued independently (no shared transaction):
// either can fail without affecting the other's already-committed effect,
// which is acceptable here since both are pure freshness signals, not
// state that must change atomically together.
func (s *PGStore) UpsertEquipmentMachine(ctx context.Context, m *models.EquipmentMachine, seenDeviceIDs []uuid.UUID) error {
	_, err := s.db.Exec(ctx,
		`INSERT INTO equipment_machines (tenant_id, machine_id, hostname, agent_version)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (tenant_id, machine_id) DO UPDATE SET hostname = EXCLUDED.hostname, agent_version = EXCLUDED.agent_version, last_seen_at = now()`,
		m.TenantID, m.MachineID, m.Hostname, m.AgentVersion)
	if err != nil {
		return err
	}

	if len(seenDeviceIDs) == 0 {
		return nil
	}

	_, err = s.db.Exec(ctx,
		`UPDATE equipment_devices SET last_seen_at = now() WHERE tenant_id = $1 AND machine_id = $2 AND id = ANY($3)`,
		m.TenantID, m.MachineID, seenDeviceIDs)
	return err
}

// GetEquipmentMachine returns the machine row plus every device registered
// under it, ordered by (class, created_at). Returns (nil, nil, nil) — never
// an error — when tenantID/machineID has never been registered.
func (s *PGStore) GetEquipmentMachine(ctx context.Context, tenantID, machineID uuid.UUID) (*models.EquipmentMachine, []models.EquipmentDevice, error) {
	m := &models.EquipmentMachine{TenantID: tenantID, MachineID: machineID}
	err := s.db.QueryRow(ctx,
		`SELECT hostname, agent_version, last_seen_at, created_at FROM equipment_machines WHERE tenant_id = $1 AND machine_id = $2`,
		tenantID, machineID,
	).Scan(&m.Hostname, &m.AgentVersion, &m.LastSeenAt, &m.CreatedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil, nil
		}
		return nil, nil, err
	}

	rows, err := s.db.Query(ctx,
		`SELECT id, class, kind, display_name, config, is_default, test_passed_at, last_seen_at, created_at, updated_at
		 FROM equipment_devices WHERE tenant_id = $1 AND machine_id = $2 ORDER BY class, created_at`,
		tenantID, machineID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	devices := make([]models.EquipmentDevice, 0)
	for rows.Next() {
		var d models.EquipmentDevice
		var configJSON []byte
		if err := rows.Scan(&d.ID, &d.Class, &d.Kind, &d.DisplayName, &configJSON, &d.IsDefault, &d.TestPassedAt, &d.LastSeenAt, &d.CreatedAt, &d.UpdatedAt); err != nil {
			return nil, nil, err
		}
		d.TenantID = tenantID
		d.MachineID = machineID
		d.Config = json.RawMessage(configJSON)
		devices = append(devices, d)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}

	return m, devices, nil
}

// GetEquipmentDeviceForTenant looks up a single device scoped by tenant_id
// alone. Returns (nil, nil) when the id doesn't exist or belongs to a
// different tenant — callers cannot distinguish "missing" from "foreign"
// from this method alone.
func (s *PGStore) GetEquipmentDeviceForTenant(ctx context.Context, tenantID, deviceID uuid.UUID) (*models.EquipmentDevice, error) {
	var d models.EquipmentDevice
	var configJSON []byte
	err := s.db.QueryRow(ctx,
		`SELECT id, machine_id, class, kind, display_name, config, is_default, test_passed_at, last_seen_at, created_at, updated_at
		 FROM equipment_devices WHERE tenant_id = $1 AND id = $2`,
		tenantID, deviceID,
	).Scan(&d.ID, &d.MachineID, &d.Class, &d.Kind, &d.DisplayName, &configJSON, &d.IsDefault, &d.TestPassedAt, &d.LastSeenAt, &d.CreatedAt, &d.UpdatedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	d.TenantID = tenantID
	d.Config = json.RawMessage(configJSON)
	return &d, nil
}

// equipmentDeviceInserter is the subset of dbConn/pgx.Tx that
// insertEquipmentDeviceRow needs — lets CreateEquipmentDevice share the
// same INSERT code across its transactional (makeDefault=true) and
// plain (makeDefault=false) paths.
type equipmentDeviceInserter interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// insertEquipmentDeviceRow's testPassed stamps test_passed_at = now() IN
// THE SAME INSERT when true (NULL otherwise) — Finding 2 (bot review PR
// #83 round 2): a create-then-separate-mark-test-passed two-write sequence
// left a window where the first write's success and the second's failure
// produced a half-created, already-visible device with no test stamp (and
// a retry would then 409/duplicate against it). Folding the stamp into the
// INSERT's own VALUES list makes "created" and "stamped" atomically the
// same write — there is no longer a second statement that can fail
// independently.
func insertEquipmentDeviceRow(ctx context.Context, q equipmentDeviceInserter, d *models.EquipmentDevice, testPassed bool) error {
	config := d.Config
	if len(config) == 0 {
		config = json.RawMessage(`{}`)
	}
	return q.QueryRow(ctx,
		`INSERT INTO equipment_devices (tenant_id, machine_id, class, kind, display_name, config, is_default, test_passed_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $8 THEN now() ELSE NULL END)
		 RETURNING id, created_at, updated_at, test_passed_at`,
		d.TenantID, d.MachineID, d.Class, d.Kind, d.DisplayName, []byte(config), d.IsDefault, testPassed,
	).Scan(&d.ID, &d.CreatedAt, &d.UpdatedAt, &d.TestPassedAt)
}

// clearDefaultEquipmentPrinter unsets whatever device currently holds
// is_default for (tenantID, machineID) — the shared first half of both
// CreateEquipmentDevice(makeDefault=true) and SetDefaultEquipmentPrinter's
// clear-then-set shape. 0 rows affected (no previous default) is never an
// error at this call site; callers decide what 0 rows means for them.
func clearDefaultEquipmentPrinter(ctx context.Context, ex interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}, tenantID, machineID uuid.UUID) error {
	_, err := ex.Exec(ctx,
		`UPDATE equipment_devices SET is_default = false, updated_at = now() WHERE tenant_id = $1 AND machine_id = $2 AND is_default`,
		tenantID, machineID)
	return err
}

// CreateEquipmentDevice inserts a new device, filling d.ID/d.CreatedAt/
// d.UpdatedAt/d.TestPassedAt from the RETURNING clause and stamping
// d.IsDefault = makeDefault. testPassed, when true, stamps
// test_passed_at = now() IN THE SAME INSERT (Finding 2, bot review PR #83
// round 2) — the caller must NOT separately call
// MarkEquipmentDeviceTestPassed after this returns; that would reintroduce
// the two-write window this atomicity fix closes (create succeeds, the
// separate stamp write fails, and a retry then 409s/duplicates against the
// already-created, wrongly-unstamped device). When makeDefault is true,
// the clear-existing-default and insert statements run inside one
// transaction so a crash between them can never leave two printers marked
// default.
func (s *PGStore) CreateEquipmentDevice(ctx context.Context, d *models.EquipmentDevice, makeDefault bool, testPassed bool) error {
	d.IsDefault = makeDefault

	if !makeDefault {
		return insertEquipmentDeviceRow(ctx, s.db, d, testPassed)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() {
		if rbErr := tx.Rollback(ctx); rbErr != nil && !errors.Is(rbErr, pgx.ErrTxClosed) {
			log.Printf("rollback create equipment device: %v", rbErr)
		}
	}()

	if err := clearDefaultEquipmentPrinter(ctx, tx, d.TenantID, d.MachineID); err != nil {
		return err
	}
	if err := insertEquipmentDeviceRow(ctx, tx, d, testPassed); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// UpdateEquipmentDevice renames a device and/or replaces its config.
// test_passed_at is cleared UNCONDITIONALLY whenever the supplied config
// differs from the device's CURRENT (pre-update) config — a stamp recorded
// against one config must never be left describing DIFFERENT hardware
// after a PATCH swaps in a new agent_name/ip/port (Finding 1, bot review
// PR #83 round 2): TenantHasTestedDefaultPrinter's readiness check reads
// straight off this column, so the invariant has to hold at the row level,
// not just be something callers are expected to remember. Every
// expression in a Postgres UPDATE's SET list is evaluated against the
// row's OLD values simultaneously — so `config IS DISTINCT FROM $4::jsonb`
// in the test_passed_at CASE compares the OLD config to the NEW value even
// though `config` is ALSO being set to $4 earlier in this same SET list.
// jsonb equality here is semantic (key order and whitespace insensitive,
// not a byte comparison) — which is the RIGHT equality for this check: a
// PATCH that reserializes the SAME logical config (e.g. a rename-only
// request that round-trips config unchanged) must preserve the stamp, and
// jsonb IS DISTINCT FROM does exactly that. On 0 rows this returns
// ErrDeviceNotFound. Real-Postgres behavior (pgxmock cannot evaluate a
// CASE expression, only pin the SQL text) is proven by
// TestEquipmentRegistry_RealPostgres_SchemaGuarantees's
// "UpdateEquipmentDevice clears test_passed_at only when config actually
// changed" subtest.
func (s *PGStore) UpdateEquipmentDevice(ctx context.Context, tenantID, deviceID uuid.UUID, displayName string, config json.RawMessage) error {
	tag, err := s.db.Exec(ctx,
		`UPDATE equipment_devices SET display_name = $3, config = $4, test_passed_at = CASE WHEN config IS DISTINCT FROM $4::jsonb THEN NULL ELSE test_passed_at END, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
		tenantID, deviceID, displayName, []byte(config))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrDeviceNotFound
	}
	return nil
}

// DeleteEquipmentDevice removes a device outright. On 0 rows this returns
// ErrDeviceNotFound. No special-case code exists for "was this the default
// printer" — the row's deletion also removes the partial unique index
// entry it held; the spec forbids silently promoting another device to
// default.
func (s *PGStore) DeleteEquipmentDevice(ctx context.Context, tenantID, deviceID uuid.UUID) error {
	tag, err := s.db.Exec(ctx,
		`DELETE FROM equipment_devices WHERE tenant_id = $1 AND id = $2`,
		tenantID, deviceID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrDeviceNotFound
	}
	return nil
}

// SetDefaultEquipmentPrinter repoints the default printer for one
// (tenantID, machineID). deviceID = nil clears the default with no
// replacement (a single, non-transactional statement — 0 rows affected is
// not an error, since there may have been no previous default). deviceID
// != nil clears then sets inside one transaction, guarded on
// class = 'printer'; when the set-UPDATE affects 0 rows (missing, foreign,
// or not a printer) the WHOLE transaction rolls back — including the
// clear — so the prior default (if any) is left exactly as it was, and
// this returns ErrDeviceNotFound.
func (s *PGStore) SetDefaultEquipmentPrinter(ctx context.Context, tenantID, machineID uuid.UUID, deviceID *uuid.UUID) error {
	if deviceID == nil {
		return clearDefaultEquipmentPrinter(ctx, s.db, tenantID, machineID)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() {
		if rbErr := tx.Rollback(ctx); rbErr != nil && !errors.Is(rbErr, pgx.ErrTxClosed) {
			log.Printf("rollback set default equipment printer: %v", rbErr)
		}
	}()

	if err := clearDefaultEquipmentPrinter(ctx, tx, tenantID, machineID); err != nil {
		return err
	}

	tag, err := tx.Exec(ctx,
		`UPDATE equipment_devices SET is_default = true, updated_at = now() WHERE tenant_id = $1 AND machine_id = $2 AND id = $3 AND class = 'printer'`,
		tenantID, machineID, *deviceID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrDeviceNotFound
	}
	return tx.Commit(ctx)
}

// MarkEquipmentDeviceTestPassed stamps test_passed_at = now() on a
// successful test-print/test-scan. On 0 rows this returns ErrDeviceNotFound.
func (s *PGStore) MarkEquipmentDeviceTestPassed(ctx context.Context, tenantID, deviceID uuid.UUID) error {
	tag, err := s.db.Exec(ctx,
		`UPDATE equipment_devices SET test_passed_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2`,
		tenantID, deviceID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrDeviceNotFound
	}
	return nil
}

// TenantHasTestedDefaultPrinter reports whether any device across any of
// the tenant's machines is currently the default printer AND has a
// non-null test_passed_at.
func (s *PGStore) TenantHasTestedDefaultPrinter(ctx context.Context, tenantID uuid.UUID) (bool, error) {
	var exists bool
	err := s.db.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM equipment_devices WHERE tenant_id = $1 AND is_default AND class = 'printer' AND test_passed_at IS NOT NULL)`,
		tenantID,
	).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists, nil
}

// ListEquipmentPrintersForTenant returns every network printer across all of
// the tenant's machines (joined to equipment_machines for the hostname), the
// data source for the pairing-QR CSV export. Non-network printers and
// scanners are excluded at the SQL level — only kind='network' devices carry
// a reachable ip:port a mobile device can pair to. Ordered (hostname,
// display_name) so the export reads machine-by-machine.
func (s *PGStore) ListEquipmentPrintersForTenant(ctx context.Context, tenantID uuid.UUID) ([]models.EquipmentPrinterExport, error) {
	rows, err := s.db.Query(ctx,
		`SELECT d.id, d.machine_id, d.class, d.kind, d.display_name, d.config, m.hostname
		 FROM equipment_devices d
		 JOIN equipment_machines m ON m.tenant_id = d.tenant_id AND m.machine_id = d.machine_id
		 WHERE d.tenant_id = $1 AND d.class = 'printer' AND d.kind = 'network'
		 ORDER BY m.hostname, d.display_name`,
		tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]models.EquipmentPrinterExport, 0)
	for rows.Next() {
		var d models.EquipmentDevice
		var configJSON []byte
		var hostname string
		if err := rows.Scan(&d.ID, &d.MachineID, &d.Class, &d.Kind, &d.DisplayName, &configJSON, &hostname); err != nil {
			return nil, err
		}
		d.TenantID = tenantID
		d.Config = json.RawMessage(configJSON)
		out = append(out, models.EquipmentPrinterExport{Device: d, Hostname: hostname})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}
