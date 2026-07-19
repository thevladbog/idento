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

func insertEquipmentDeviceRow(ctx context.Context, q equipmentDeviceInserter, d *models.EquipmentDevice) error {
	config := d.Config
	if len(config) == 0 {
		config = json.RawMessage(`{}`)
	}
	return q.QueryRow(ctx,
		`INSERT INTO equipment_devices (tenant_id, machine_id, class, kind, display_name, config, is_default)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 RETURNING id, created_at, updated_at`,
		d.TenantID, d.MachineID, d.Class, d.Kind, d.DisplayName, []byte(config), d.IsDefault,
	).Scan(&d.ID, &d.CreatedAt, &d.UpdatedAt)
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
// d.UpdatedAt from the RETURNING clause and stamping d.IsDefault =
// makeDefault. When makeDefault is true, the clear-existing-default and
// insert statements run inside one transaction so a crash between them can
// never leave two printers marked default.
func (s *PGStore) CreateEquipmentDevice(ctx context.Context, d *models.EquipmentDevice, makeDefault bool) error {
	d.IsDefault = makeDefault

	if !makeDefault {
		return insertEquipmentDeviceRow(ctx, s.db, d)
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
	if err := insertEquipmentDeviceRow(ctx, tx, d); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// UpdateEquipmentDevice renames a device and/or replaces its config. On 0
// rows this returns ErrDeviceNotFound.
func (s *PGStore) UpdateEquipmentDevice(ctx context.Context, tenantID, deviceID uuid.UUID, displayName string, config json.RawMessage) error {
	tag, err := s.db.Exec(ctx,
		`UPDATE equipment_devices SET display_name = $3, config = $4, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
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
