package store

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	pgxmock "github.com/pashagolub/pgxmock/v4"
)

// upsertEquipmentMachineSQLPattern pins UpsertEquipmentMachine's machine-row
// upsert (P4.3 spec §4.1): a fresh (tenant_id, machine_id) pair inserts;
// re-registering the SAME machine (the agent phones home on every /info
// poll) is idempotent via ON CONFLICT — hostname/agent_version follow the
// agent's latest report and last_seen_at is refreshed to now(), but
// created_at is left untouched (no column in the SET list).
const upsertEquipmentMachineSQLPattern = `INSERT INTO equipment_machines \(tenant_id, machine_id, hostname, agent_version\) VALUES \(\$1, \$2, \$3, \$4\) ON CONFLICT \(tenant_id, machine_id\) DO UPDATE SET hostname = EXCLUDED\.hostname, agent_version = EXCLUDED\.agent_version, last_seen_at = now\(\)`

// touchSeenEquipmentDevicesSQLPattern pins the second, conditional
// statement: only issued when the agent's /info report names at least one
// device it still sees attached — an empty seenDeviceIDs slice must not
// issue this statement at all (proven by mock.ExpectationsWereMet with no
// matching expectation queued).
const touchSeenEquipmentDevicesSQLPattern = `UPDATE equipment_devices SET last_seen_at = now\(\) WHERE tenant_id = \$1 AND machine_id = \$2 AND id = ANY\(\$3\)`

// getEquipmentMachineSQLPattern pins GetEquipmentMachine's machine-row
// SELECT — tenant_id/machine_id are already known from the call's own
// parameters, so they are not re-selected.
const getEquipmentMachineSQLPattern = `SELECT hostname, agent_version, last_seen_at, created_at FROM equipment_machines WHERE tenant_id = \$1 AND machine_id = \$2`

// getEquipmentDevicesForMachineSQLPattern pins GetEquipmentMachine's
// devices SELECT — brief-mandated ordering (class, created_at) so the hub
// UI can render devices grouped by class in registration order within each
// group without a client-side sort.
const getEquipmentDevicesForMachineSQLPattern = `SELECT id, class, kind, display_name, config, is_default, test_passed_at, last_seen_at, created_at, updated_at FROM equipment_devices WHERE tenant_id = \$1 AND machine_id = \$2 ORDER BY class, created_at`

// getEquipmentDeviceForTenantSQLPattern pins GetEquipmentDeviceForTenant —
// scoped by tenant_id only (not machine_id), matching the method's
// tenant-wide device lookup contract.
const getEquipmentDeviceForTenantSQLPattern = `SELECT id, machine_id, class, kind, display_name, config, is_default, test_passed_at, last_seen_at, created_at, updated_at FROM equipment_devices WHERE tenant_id = \$1 AND id = \$2`

// clearDefaultEquipmentPrinterSQLPattern pins the shared clear-the-current-
// default statement used by both CreateEquipmentDevice(makeDefault=true)
// and SetDefaultEquipmentPrinter — a bare boolean-column predicate
// (`AND is_default`), matching the codebase's existing boolean-guard style
// (e.g. CheckInAttendee's `blocked = false`... except here written bare,
// per the brief's pinned text).
const clearDefaultEquipmentPrinterSQLPattern = `UPDATE equipment_devices SET is_default = false, updated_at = now\(\) WHERE tenant_id = \$1 AND machine_id = \$2 AND is_default`

// createEquipmentDeviceSQLPattern pins CreateEquipmentDevice's INSERT —
// RETURNING id/created_at/updated_at since all three are DB-generated
// (gen_random_uuid() / now() defaults).
const createEquipmentDeviceSQLPattern = `INSERT INTO equipment_devices \(tenant_id, machine_id, class, kind, display_name, config, is_default\) VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7\) RETURNING id, created_at, updated_at`

// setDefaultEquipmentPrinterSQLPattern pins SetDefaultEquipmentPrinter's
// set-the-new-default statement — guarded on class = 'printer' so a
// scanner/camera device id can never become the default (belt-and-suspenders
// alongside the equipment_devices_default_is_printer CHECK constraint).
const setDefaultEquipmentPrinterSQLPattern = `UPDATE equipment_devices SET is_default = true, updated_at = now\(\) WHERE tenant_id = \$1 AND machine_id = \$2 AND id = \$3 AND class = 'printer'`

// updateEquipmentDeviceSQLPattern pins UpdateEquipmentDevice — display_name
// and config are the only caller-editable columns (class/kind/machine_id
// are immutable once created; is_default is repointed only via
// SetDefaultEquipmentPrinter).
const updateEquipmentDeviceSQLPattern = `UPDATE equipment_devices SET display_name = \$3, config = \$4, updated_at = now\(\) WHERE tenant_id = \$1 AND id = \$2`

// deleteEquipmentDeviceSQLPattern pins DeleteEquipmentDevice. Deleting the
// current default printer needs no special-case code: the row (and the
// partial unique index entry it held) is simply gone — the spec explicitly
// forbids silently promoting another device to default.
const deleteEquipmentDeviceSQLPattern = `DELETE FROM equipment_devices WHERE tenant_id = \$1 AND id = \$2`

// markEquipmentDeviceTestPassedSQLPattern pins
// MarkEquipmentDeviceTestPassed.
const markEquipmentDeviceTestPassedSQLPattern = `UPDATE equipment_devices SET test_passed_at = now\(\), updated_at = now\(\) WHERE tenant_id = \$1 AND id = \$2`

// tenantHasTestedDefaultPrinterSQLPattern pins
// TenantHasTestedDefaultPrinter — a tenant-wide EXISTS (any machine's
// tested default printer satisfies readiness), not scoped to one machine.
const tenantHasTestedDefaultPrinterSQLPattern = `SELECT EXISTS \(SELECT 1 FROM equipment_devices WHERE tenant_id = \$1 AND is_default AND class = 'printer' AND test_passed_at IS NOT NULL\)`

func newEquipmentMock(t *testing.T) (pgxmock.PgxPoolIface, *PGStore) {
	t.Helper()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)
	return mock, &PGStore{db: mock}
}

// TestUpsertEquipmentMachine_InsertAndSeen covers both the always-issued
// machine upsert and the conditional device-touch statement: non-empty
// seenDeviceIDs issues both statements (in order, same implicit
// transaction-free sequence — no ExpectBegin/ExpectCommit since neither
// statement depends on the other's outcome), empty seenDeviceIDs issues
// only the first.
func TestUpsertEquipmentMachine_InsertAndSeen(t *testing.T) {
	t.Run("WithSeenDevices", func(t *testing.T) {
		mock, s := newEquipmentMock(t)

		tenantID, machineID := uuid.New(), uuid.New()
		dev1, dev2 := uuid.New(), uuid.New()
		seen := []uuid.UUID{dev1, dev2}

		mock.ExpectExec(upsertEquipmentMachineSQLPattern).
			WithArgs(tenantID, machineID, "kiosk-7", "1.4.0").
			WillReturnResult(pgxmock.NewResult("INSERT", 1))
		mock.ExpectExec(touchSeenEquipmentDevicesSQLPattern).
			WithArgs(tenantID, machineID, seen).
			WillReturnResult(pgxmock.NewResult("UPDATE", 2))

		m := &models.EquipmentMachine{TenantID: tenantID, MachineID: machineID, Hostname: "kiosk-7", AgentVersion: "1.4.0"}
		if err := s.UpsertEquipmentMachine(context.Background(), m, seen); err != nil {
			t.Fatalf("UpsertEquipmentMachine: %v", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unmet expectations: %v", err)
		}
	})

	t.Run("EmptySeenDevicesSkipsSecondStatement", func(t *testing.T) {
		mock, s := newEquipmentMock(t)

		tenantID, machineID := uuid.New(), uuid.New()

		mock.ExpectExec(upsertEquipmentMachineSQLPattern).
			WithArgs(tenantID, machineID, "kiosk-8", "1.4.0").
			WillReturnResult(pgxmock.NewResult("INSERT", 1))

		m := &models.EquipmentMachine{TenantID: tenantID, MachineID: machineID, Hostname: "kiosk-8", AgentVersion: "1.4.0"}
		if err := s.UpsertEquipmentMachine(context.Background(), m, nil); err != nil {
			t.Fatalf("UpsertEquipmentMachine: %v", err)
		}
		// No touchSeenEquipmentDevicesSQLPattern expectation was queued —
		// ExpectationsWereMet fails if the implementation issued it anyway,
		// and pgxmock's ordered-queue also fails outright if a THIRD,
		// unexpected statement had been issued.
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unmet expectations: %v", err)
		}
	})
}

// TestGetEquipmentMachine_UnregisteredIsNilNil proves the "never seen this
// machine" case returns (nil, nil, nil) — never an error, never a
// zero-value struct — so handlers can render "not yet registered" without
// special-casing an error type.
func TestGetEquipmentMachine_UnregisteredIsNilNil(t *testing.T) {
	mock, s := newEquipmentMock(t)

	tenantID, machineID := uuid.New(), uuid.New()
	mock.ExpectQuery(getEquipmentMachineSQLPattern).
		WithArgs(tenantID, machineID).
		WillReturnRows(pgxmock.NewRows([]string{"hostname", "agent_version", "last_seen_at", "created_at"}))

	gotMachine, gotDevices, err := s.GetEquipmentMachine(context.Background(), tenantID, machineID)
	if err != nil {
		t.Fatalf("GetEquipmentMachine: %v", err)
	}
	if gotMachine != nil {
		t.Errorf("machine = %+v, want nil", gotMachine)
	}
	if gotDevices != nil {
		t.Errorf("devices = %+v, want nil", gotDevices)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestGetEquipmentMachine_ReturnsDevicesOrdered proves a registered
// machine's devices come back via the class/created_at-ordered SELECT, and
// that TenantID/MachineID are stamped onto the returned machine from the
// call's own parameters (they are not re-selected from the row).
func TestGetEquipmentMachine_ReturnsDevicesOrdered(t *testing.T) {
	mock, s := newEquipmentMock(t)

	tenantID, machineID := uuid.New(), uuid.New()
	now := time.Now()
	dev1, dev2 := uuid.New(), uuid.New()

	mock.ExpectQuery(getEquipmentMachineSQLPattern).
		WithArgs(tenantID, machineID).
		WillReturnRows(pgxmock.NewRows([]string{"hostname", "agent_version", "last_seen_at", "created_at"}).
			AddRow("kiosk-7", "1.4.0", now, now))
	mock.ExpectQuery(getEquipmentDevicesForMachineSQLPattern).
		WithArgs(tenantID, machineID).
		WillReturnRows(pgxmock.NewRows([]string{"id", "class", "kind", "display_name", "config", "is_default", "test_passed_at", "last_seen_at", "created_at", "updated_at"}).
			AddRow(dev1, "camera", "system", "Front Camera", json.RawMessage(`{}`), false, nil, nil, now, now).
			AddRow(dev2, "printer", "network", "Badge Printer", json.RawMessage(`{"ip":"10.0.0.5"}`), true, &now, &now, now, now))

	gotMachine, gotDevices, err := s.GetEquipmentMachine(context.Background(), tenantID, machineID)
	if err != nil {
		t.Fatalf("GetEquipmentMachine: %v", err)
	}
	if gotMachine == nil {
		t.Fatalf("machine = nil, want a machine")
	}
	if gotMachine.TenantID != tenantID || gotMachine.MachineID != machineID {
		t.Errorf("machine tenant/machine = %v/%v, want %v/%v", gotMachine.TenantID, gotMachine.MachineID, tenantID, machineID)
	}
	if gotMachine.Hostname != "kiosk-7" || gotMachine.AgentVersion != "1.4.0" {
		t.Errorf("machine = %+v, want hostname=kiosk-7 agent_version=1.4.0", gotMachine)
	}
	if len(gotDevices) != 2 {
		t.Fatalf("len(devices) = %d, want 2", len(gotDevices))
	}
	if gotDevices[0].ID != dev1 || gotDevices[1].ID != dev2 {
		t.Errorf("devices = %+v, want dev1 then dev2 in SELECT order", gotDevices)
	}
	if !gotDevices[1].IsDefault {
		t.Errorf("devices[1].IsDefault = false, want true")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestGetEquipmentDeviceForTenant_FoundAndMissingOrForeign proves the
// tenant-scoped single-device lookup: a matching row comes back populated,
// and a missing OR foreign-tenant id (same WHERE clause: no row without
// BOTH tenant_id and id matching) comes back (nil, nil) — never an error,
// mirroring GetEventByIDForTenant's not-found idiom (callers cannot
// distinguish "missing" from "foreign" from this method alone).
func TestGetEquipmentDeviceForTenant_FoundAndMissingOrForeign(t *testing.T) {
	t.Run("Found", func(t *testing.T) {
		mock, s := newEquipmentMock(t)

		tenantID, deviceID, machineID := uuid.New(), uuid.New(), uuid.New()
		now := time.Now()
		mock.ExpectQuery(getEquipmentDeviceForTenantSQLPattern).
			WithArgs(tenantID, deviceID).
			WillReturnRows(pgxmock.NewRows([]string{"id", "machine_id", "class", "kind", "display_name", "config", "is_default", "test_passed_at", "last_seen_at", "created_at", "updated_at"}).
				AddRow(deviceID, machineID, "scanner", "usb_wedge", "Barcode Scanner", json.RawMessage(`{}`), false, nil, nil, now, now))

		got, err := s.GetEquipmentDeviceForTenant(context.Background(), tenantID, deviceID)
		if err != nil {
			t.Fatalf("GetEquipmentDeviceForTenant: %v", err)
		}
		if got == nil || got.ID != deviceID || got.MachineID != machineID {
			t.Errorf("got = %+v, want id=%v machine_id=%v", got, deviceID, machineID)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unmet expectations: %v", err)
		}
	})

	t.Run("MissingOrForeign", func(t *testing.T) {
		mock, s := newEquipmentMock(t)

		tenantID, deviceID := uuid.New(), uuid.New()
		mock.ExpectQuery(getEquipmentDeviceForTenantSQLPattern).
			WithArgs(tenantID, deviceID).
			WillReturnRows(pgxmock.NewRows([]string{"id", "machine_id", "class", "kind", "display_name", "config", "is_default", "test_passed_at", "last_seen_at", "created_at", "updated_at"}))

		got, err := s.GetEquipmentDeviceForTenant(context.Background(), tenantID, deviceID)
		if err != nil {
			t.Fatalf("GetEquipmentDeviceForTenant: %v", err)
		}
		if got != nil {
			t.Errorf("got = %+v, want nil", got)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unmet expectations: %v", err)
		}
	})
}

// TestCreateEquipmentDevice_MakeDefaultIsTransactional covers both branches:
// makeDefault=true wraps the clear-then-insert pair in a transaction (so a
// crash between the two statements can never leave two printers marked
// default), makeDefault=false is a plain, non-transactional INSERT.
func TestCreateEquipmentDevice_MakeDefaultIsTransactional(t *testing.T) {
	t.Run("MakeDefault", func(t *testing.T) {
		mock, s := newEquipmentMock(t)

		tenantID, machineID, deviceID := uuid.New(), uuid.New(), uuid.New()
		now := time.Now()

		mock.ExpectBegin()
		mock.ExpectExec(clearDefaultEquipmentPrinterSQLPattern).
			WithArgs(tenantID, machineID).
			WillReturnResult(pgxmock.NewResult("UPDATE", 1))
		mock.ExpectQuery(createEquipmentDeviceSQLPattern).
			WithArgs(tenantID, machineID, "printer", "network", "Badge Printer", []byte(`{}`), true).
			WillReturnRows(pgxmock.NewRows([]string{"id", "created_at", "updated_at"}).AddRow(deviceID, now, now))
		mock.ExpectCommit()

		d := &models.EquipmentDevice{
			TenantID:    tenantID,
			MachineID:   machineID,
			Class:       "printer",
			Kind:        "network",
			DisplayName: "Badge Printer",
			Config:      json.RawMessage(`{}`),
		}
		if err := s.CreateEquipmentDevice(context.Background(), d, true); err != nil {
			t.Fatalf("CreateEquipmentDevice: %v", err)
		}
		if d.ID != deviceID {
			t.Errorf("d.ID = %v, want %v (not filled from RETURNING)", d.ID, deviceID)
		}
		if d.CreatedAt.IsZero() || d.UpdatedAt.IsZero() {
			t.Errorf("d.CreatedAt/UpdatedAt not filled: %+v", d)
		}
		if !d.IsDefault {
			t.Errorf("d.IsDefault = false, want true (makeDefault=true)")
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unmet expectations: %v", err)
		}
	})

	t.Run("NotDefaultPlainInsertNoTx", func(t *testing.T) {
		mock, s := newEquipmentMock(t)

		tenantID, machineID, deviceID := uuid.New(), uuid.New(), uuid.New()
		now := time.Now()

		// No ExpectBegin/ExpectCommit queued — a plain INSERT.
		mock.ExpectQuery(createEquipmentDeviceSQLPattern).
			WithArgs(tenantID, machineID, "scanner", "com", "COM3 Scanner", []byte(`{}`), false).
			WillReturnRows(pgxmock.NewRows([]string{"id", "created_at", "updated_at"}).AddRow(deviceID, now, now))

		d := &models.EquipmentDevice{
			TenantID:    tenantID,
			MachineID:   machineID,
			Class:       "scanner",
			Kind:        "com",
			DisplayName: "COM3 Scanner",
			Config:      json.RawMessage(`{}`),
		}
		if err := s.CreateEquipmentDevice(context.Background(), d, false); err != nil {
			t.Fatalf("CreateEquipmentDevice: %v", err)
		}
		if d.ID != deviceID {
			t.Errorf("d.ID = %v, want %v", d.ID, deviceID)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unmet expectations: %v", err)
		}
	})
}

// TestSetDefaultEquipmentPrinter_ClearThenSet covers all three shapes: a
// successful repoint (clear then set, both in one tx), a missing/wrong-class
// target (set-UPDATE affects 0 rows -> rollback, ErrDeviceNotFound, no
// ExpectCommit queued), and deviceID=nil (clear-only, no tx, no error even
// when there was no previous default to clear).
func TestSetDefaultEquipmentPrinter_ClearThenSet(t *testing.T) {
	t.Run("SetsNewDefault", func(t *testing.T) {
		mock, s := newEquipmentMock(t)

		tenantID, machineID, deviceID := uuid.New(), uuid.New(), uuid.New()

		mock.ExpectBegin()
		mock.ExpectExec(clearDefaultEquipmentPrinterSQLPattern).
			WithArgs(tenantID, machineID).
			WillReturnResult(pgxmock.NewResult("UPDATE", 1))
		mock.ExpectExec(setDefaultEquipmentPrinterSQLPattern).
			WithArgs(tenantID, machineID, deviceID).
			WillReturnResult(pgxmock.NewResult("UPDATE", 1))
		mock.ExpectCommit()

		if err := s.SetDefaultEquipmentPrinter(context.Background(), tenantID, machineID, &deviceID); err != nil {
			t.Fatalf("SetDefaultEquipmentPrinter: %v", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unmet expectations: %v", err)
		}
	})

	t.Run("TargetMissingOrNotPrinterRollsBack", func(t *testing.T) {
		mock, s := newEquipmentMock(t)

		tenantID, machineID, deviceID := uuid.New(), uuid.New(), uuid.New()

		mock.ExpectBegin()
		mock.ExpectExec(clearDefaultEquipmentPrinterSQLPattern).
			WithArgs(tenantID, machineID).
			WillReturnResult(pgxmock.NewResult("UPDATE", 0))
		mock.ExpectExec(setDefaultEquipmentPrinterSQLPattern).
			WithArgs(tenantID, machineID, deviceID).
			WillReturnResult(pgxmock.NewResult("UPDATE", 0))
		mock.ExpectRollback()

		err := s.SetDefaultEquipmentPrinter(context.Background(), tenantID, machineID, &deviceID)
		if !errors.Is(err, ErrDeviceNotFound) {
			t.Fatalf("err = %v, want ErrDeviceNotFound", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unmet expectations: %v", err)
		}
	})

	t.Run("NilDeviceIDClearsOnlyNoTxNoErrorOnZeroRows", func(t *testing.T) {
		mock, s := newEquipmentMock(t)

		tenantID, machineID := uuid.New(), uuid.New()

		// No ExpectBegin/ExpectCommit — and 0 RowsAffected (no previous
		// default existed) is NOT an error.
		mock.ExpectExec(clearDefaultEquipmentPrinterSQLPattern).
			WithArgs(tenantID, machineID).
			WillReturnResult(pgxmock.NewResult("UPDATE", 0))

		if err := s.SetDefaultEquipmentPrinter(context.Background(), tenantID, machineID, nil); err != nil {
			t.Fatalf("SetDefaultEquipmentPrinter: %v", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unmet expectations: %v", err)
		}
	})
}

// TestUpdateEquipmentDevice_ZeroRowsIsErrDeviceNotFound pins
// UpdateEquipmentDevice's statement and proves the 0-row -> ErrDeviceNotFound
// mapping alongside the ordinary success path.
func TestUpdateEquipmentDevice_ZeroRowsIsErrDeviceNotFound(t *testing.T) {
	t.Run("Success", func(t *testing.T) {
		mock, s := newEquipmentMock(t)

		tenantID, deviceID := uuid.New(), uuid.New()
		cfg := json.RawMessage(`{"note":"renamed"}`)
		mock.ExpectExec(updateEquipmentDeviceSQLPattern).
			WithArgs(tenantID, deviceID, "Lobby Printer", []byte(cfg)).
			WillReturnResult(pgxmock.NewResult("UPDATE", 1))

		if err := s.UpdateEquipmentDevice(context.Background(), tenantID, deviceID, "Lobby Printer", cfg); err != nil {
			t.Fatalf("UpdateEquipmentDevice: %v", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unmet expectations: %v", err)
		}
	})

	t.Run("ZeroRows", func(t *testing.T) {
		mock, s := newEquipmentMock(t)

		tenantID, deviceID := uuid.New(), uuid.New()
		cfg := json.RawMessage(`{}`)
		mock.ExpectExec(updateEquipmentDeviceSQLPattern).
			WithArgs(tenantID, deviceID, "Ghost Device", []byte(cfg)).
			WillReturnResult(pgxmock.NewResult("UPDATE", 0))

		err := s.UpdateEquipmentDevice(context.Background(), tenantID, deviceID, "Ghost Device", cfg)
		if !errors.Is(err, ErrDeviceNotFound) {
			t.Fatalf("err = %v, want ErrDeviceNotFound", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unmet expectations: %v", err)
		}
	})
}

// TestDeleteEquipmentDevice_ZeroRowsIsErrDeviceNotFound pins
// DeleteEquipmentDevice's statement and proves the 0-row -> ErrDeviceNotFound
// mapping. No special-case code exists for "was this the default printer" —
// deleting it just removes the row (and the partial unique index entry it
// held); nothing is silently promoted to the new default.
func TestDeleteEquipmentDevice_ZeroRowsIsErrDeviceNotFound(t *testing.T) {
	t.Run("Success", func(t *testing.T) {
		mock, s := newEquipmentMock(t)

		tenantID, deviceID := uuid.New(), uuid.New()
		mock.ExpectExec(deleteEquipmentDeviceSQLPattern).
			WithArgs(tenantID, deviceID).
			WillReturnResult(pgxmock.NewResult("DELETE", 1))

		if err := s.DeleteEquipmentDevice(context.Background(), tenantID, deviceID); err != nil {
			t.Fatalf("DeleteEquipmentDevice: %v", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unmet expectations: %v", err)
		}
	})

	t.Run("ZeroRows", func(t *testing.T) {
		mock, s := newEquipmentMock(t)

		tenantID, deviceID := uuid.New(), uuid.New()
		mock.ExpectExec(deleteEquipmentDeviceSQLPattern).
			WithArgs(tenantID, deviceID).
			WillReturnResult(pgxmock.NewResult("DELETE", 0))

		err := s.DeleteEquipmentDevice(context.Background(), tenantID, deviceID)
		if !errors.Is(err, ErrDeviceNotFound) {
			t.Fatalf("err = %v, want ErrDeviceNotFound", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unmet expectations: %v", err)
		}
	})
}

// TestMarkEquipmentDeviceTestPassed_ZeroRowsIsErrDeviceNotFound pins
// MarkEquipmentDeviceTestPassed's statement and proves the 0-row ->
// ErrDeviceNotFound mapping.
func TestMarkEquipmentDeviceTestPassed_ZeroRowsIsErrDeviceNotFound(t *testing.T) {
	t.Run("Success", func(t *testing.T) {
		mock, s := newEquipmentMock(t)

		tenantID, deviceID := uuid.New(), uuid.New()
		mock.ExpectExec(markEquipmentDeviceTestPassedSQLPattern).
			WithArgs(tenantID, deviceID).
			WillReturnResult(pgxmock.NewResult("UPDATE", 1))

		if err := s.MarkEquipmentDeviceTestPassed(context.Background(), tenantID, deviceID); err != nil {
			t.Fatalf("MarkEquipmentDeviceTestPassed: %v", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unmet expectations: %v", err)
		}
	})

	t.Run("ZeroRows", func(t *testing.T) {
		mock, s := newEquipmentMock(t)

		tenantID, deviceID := uuid.New(), uuid.New()
		mock.ExpectExec(markEquipmentDeviceTestPassedSQLPattern).
			WithArgs(tenantID, deviceID).
			WillReturnResult(pgxmock.NewResult("UPDATE", 0))

		err := s.MarkEquipmentDeviceTestPassed(context.Background(), tenantID, deviceID)
		if !errors.Is(err, ErrDeviceNotFound) {
			t.Fatalf("err = %v, want ErrDeviceNotFound", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unmet expectations: %v", err)
		}
	})
}

// TestTenantHasTestedDefaultPrinter_SQL pins the tenant-wide readiness
// EXISTS query and proves both the true and false results are surfaced
// verbatim (this method never wraps 0 rows in an error — EXISTS always
// returns exactly one row).
func TestTenantHasTestedDefaultPrinter_SQL(t *testing.T) {
	t.Run("True", func(t *testing.T) {
		mock, s := newEquipmentMock(t)

		tenantID := uuid.New()
		mock.ExpectQuery(tenantHasTestedDefaultPrinterSQLPattern).
			WithArgs(tenantID).
			WillReturnRows(pgxmock.NewRows([]string{"exists"}).AddRow(true))

		got, err := s.TenantHasTestedDefaultPrinter(context.Background(), tenantID)
		if err != nil {
			t.Fatalf("TenantHasTestedDefaultPrinter: %v", err)
		}
		if !got {
			t.Errorf("got = false, want true")
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unmet expectations: %v", err)
		}
	})

	t.Run("False", func(t *testing.T) {
		mock, s := newEquipmentMock(t)

		tenantID := uuid.New()
		mock.ExpectQuery(tenantHasTestedDefaultPrinterSQLPattern).
			WithArgs(tenantID).
			WillReturnRows(pgxmock.NewRows([]string{"exists"}).AddRow(false))

		got, err := s.TenantHasTestedDefaultPrinter(context.Background(), tenantID)
		if err != nil {
			t.Fatalf("TenantHasTestedDefaultPrinter: %v", err)
		}
		if got {
			t.Errorf("got = true, want false")
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unmet expectations: %v", err)
		}
	})
}
