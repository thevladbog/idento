package store

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"testing"
	"time"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestEquipmentRegistry_RealPostgres_SchemaGuarantees proves, against a REAL
// Postgres database, the migration-000023 guarantees pgxmock cannot: the
// partial unique index enforcing at most one default printer per
// (tenant_id, machine_id), the CHECK forbidding a non-printer default, that
// deleting a machine cascades its devices, and that the SAME machine_id
// under two different tenants keeps fully disjoint registries. It also
// exercises the store methods themselves (not just raw constraint probes)
// end-to-end — including UpsertEquipmentMachine's `id = ANY($3)`
// UUID-array bind, which pgxmock only echoes back rather than proving the
// real wire encoding round-trips.
//
// Gated behind TEST_DATABASE_URL (this codebase has no real-database CI
// harness — see pg_store_attendees_page_integration_test.go) and SKIPS, not
// fails, when it's unset. To run it locally against the docker-compose db:
//
//	TEST_DATABASE_URL="postgres://idento:idento_password@localhost:5438/idento_db?sslmode=disable" \
//	  go test ./internal/store/ -run TestEquipmentRegistry_RealPostgres -v
func TestEquipmentRegistry_RealPostgres_SchemaGuarantees(t *testing.T) {
	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping real-Postgres equipment-registry test (see doc comment for how to run it)")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("Ping: %v", err)
	}

	s := &PGStore{db: pool}
	if err := s.RunMigrations(); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}

	tenantA := uuid.New()
	tenantB := uuid.New()
	now := time.Now()

	for i, tenantID := range []uuid.UUID{tenantA, tenantB} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO tenants (id, name, created_at, updated_at) VALUES ($1, $2, $3, $3)`,
			tenantID, "Equipment Registry Test Tenant "+tenantID.String(), now,
		); err != nil {
			t.Fatalf("insert tenant[%d]: %v", i, err)
		}
	}
	t.Cleanup(func() {
		// Cascades through equipment_machines -> equipment_devices.
		cctx, ccancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer ccancel()
		if _, err := pool.Exec(cctx, `DELETE FROM tenants WHERE id = ANY($1)`, []uuid.UUID{tenantA, tenantB}); err != nil {
			t.Logf("cleanup: failed to delete tenants: %v", err)
		}
	})

	assertSQLState := func(t *testing.T, err error, code string) {
		t.Helper()
		if err == nil {
			t.Fatalf("expected a SQLSTATE %s error, got no error", code)
		}
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) {
			t.Fatalf("expected a *pgconn.PgError, got %T: %v", err, err)
		}
		if pgErr.Code != code {
			t.Fatalf("expected SQLSTATE %s, got %s: %v", code, pgErr.Code, err)
		}
	}

	// (d) same machine_id under two tenants coexists — registered via the
	// store method itself, proving UpsertEquipmentMachine's ON CONFLICT
	// target is (tenant_id, machine_id), not machine_id alone.
	sharedMachineID := uuid.New()
	if err := s.UpsertEquipmentMachine(ctx, &models.EquipmentMachine{
		TenantID: tenantA, MachineID: sharedMachineID, Hostname: "shared-kiosk", AgentVersion: "1.0.0",
	}, nil); err != nil {
		t.Fatalf("UpsertEquipmentMachine tenantA: %v", err)
	}
	if err := s.UpsertEquipmentMachine(ctx, &models.EquipmentMachine{
		TenantID: tenantB, MachineID: sharedMachineID, Hostname: "shared-kiosk", AgentVersion: "2.0.0",
	}, nil); err != nil {
		t.Fatalf("UpsertEquipmentMachine tenantB: %v", err)
	}

	machineA, devicesA, err := s.GetEquipmentMachine(ctx, tenantA, sharedMachineID)
	if err != nil {
		t.Fatalf("GetEquipmentMachine tenantA: %v", err)
	}
	if machineA == nil || machineA.AgentVersion != "1.0.0" {
		t.Fatalf("machineA = %+v, want AgentVersion=1.0.0", machineA)
	}
	if len(devicesA) != 0 {
		t.Fatalf("devicesA = %+v, want empty", devicesA)
	}

	machineB, _, err := s.GetEquipmentMachine(ctx, tenantB, sharedMachineID)
	if err != nil {
		t.Fatalf("GetEquipmentMachine tenantB: %v", err)
	}
	if machineB == nil || machineB.AgentVersion != "2.0.0" {
		t.Fatalf("machineB = %+v, want AgentVersion=2.0.0 (disjoint from tenantA's row)", machineB)
	}

	// Register a second machine under tenantA for the delete-cascade case
	// below, so deleting IT doesn't disturb the shared-machine fixture the
	// rest of this test still needs.
	cascadeMachineID := uuid.New()
	if err := s.UpsertEquipmentMachine(ctx, &models.EquipmentMachine{
		TenantID: tenantA, MachineID: cascadeMachineID, Hostname: "cascade-kiosk", AgentVersion: "1.0.0",
	}, nil); err != nil {
		t.Fatalf("UpsertEquipmentMachine cascade machine: %v", err)
	}

	printer1 := &models.EquipmentDevice{
		TenantID: tenantA, MachineID: sharedMachineID, Class: "printer", Kind: "network",
		DisplayName: "Front Desk Printer", Config: json.RawMessage(`{"agent_name":"Zebra ZD420"}`),
	}
	if err := s.CreateEquipmentDevice(ctx, printer1, true, false); err != nil {
		t.Fatalf("CreateEquipmentDevice printer1 (makeDefault): %v", err)
	}
	if !printer1.IsDefault {
		t.Fatalf("printer1.IsDefault = false, want true")
	}

	scanner1 := &models.EquipmentDevice{
		TenantID: tenantA, MachineID: sharedMachineID, Class: "scanner", Kind: "usb_wedge",
		DisplayName: "Handheld Scanner", Config: json.RawMessage(`{}`),
	}
	if err := s.CreateEquipmentDevice(ctx, scanner1, false, false); err != nil {
		t.Fatalf("CreateEquipmentDevice scanner1: %v", err)
	}

	// A device under the SEPARATE cascade-test machine, for case (c) below.
	cascadeDevice := &models.EquipmentDevice{
		TenantID: tenantA, MachineID: cascadeMachineID, Class: "camera", Kind: "usb_wedge",
		DisplayName: "Badge Camera", Config: json.RawMessage(`{}`),
	}
	if err := s.CreateEquipmentDevice(ctx, cascadeDevice, false, false); err != nil {
		t.Fatalf("CreateEquipmentDevice cascadeDevice: %v", err)
	}

	t.Run("a) second default printer for the same tenant+machine violates the partial unique index", func(t *testing.T) {
		_, err := pool.Exec(ctx,
			`INSERT INTO equipment_devices (tenant_id, machine_id, class, kind, display_name, is_default) VALUES ($1, $2, 'printer', 'network', 'Second Default', true)`,
			tenantA, sharedMachineID,
		)
		assertSQLState(t, err, "23505") // unique_violation
	})

	t.Run("b) is_default=true with class='scanner' violates the CHECK constraint", func(t *testing.T) {
		_, err := pool.Exec(ctx,
			`INSERT INTO equipment_devices (tenant_id, machine_id, class, kind, display_name, is_default) VALUES ($1, $2, 'scanner', 'usb_wedge', 'Illegally Default Scanner', true)`,
			tenantA, sharedMachineID,
		)
		assertSQLState(t, err, "23514") // check_violation
	})

	t.Run("c) deleting a machine cascades its devices", func(t *testing.T) {
		if _, err := pool.Exec(ctx,
			`DELETE FROM equipment_machines WHERE tenant_id = $1 AND machine_id = $2`,
			tenantA, cascadeMachineID,
		); err != nil {
			t.Fatalf("delete cascade machine: %v", err)
		}
		var count int
		if err := pool.QueryRow(ctx,
			`SELECT count(*) FROM equipment_devices WHERE tenant_id = $1 AND machine_id = $2`,
			tenantA, cascadeMachineID,
		).Scan(&count); err != nil {
			t.Fatalf("count devices after cascade: %v", err)
		}
		if count != 0 {
			t.Errorf("devices remaining after machine delete = %d, want 0 (cascade)", count)
		}
	})

	t.Run("d) same machine_id under two tenants: already proved by the fixture setup above", func(t *testing.T) {
		if machineA.MachineID != machineB.MachineID {
			t.Fatalf("machineA/machineB machine_id mismatch: %v vs %v", machineA.MachineID, machineB.MachineID)
		}
		if machineA.TenantID == machineB.TenantID {
			t.Fatalf("machineA/machineB unexpectedly share a tenant_id")
		}
	})

	t.Run("UpsertEquipmentMachine touches last_seen_at on seen devices via ANY($3)", func(t *testing.T) {
		var before *time.Time
		if err := pool.QueryRow(ctx, `SELECT last_seen_at FROM equipment_devices WHERE id = $1`, scanner1.ID).Scan(&before); err != nil {
			t.Fatalf("read scanner1.last_seen_at before: %v", err)
		}
		if before != nil {
			t.Fatalf("scanner1.last_seen_at should start NULL, got %v", before)
		}

		if err := s.UpsertEquipmentMachine(ctx, &models.EquipmentMachine{
			TenantID: tenantA, MachineID: sharedMachineID, Hostname: "shared-kiosk", AgentVersion: "1.0.1",
		}, []uuid.UUID{scanner1.ID}); err != nil {
			t.Fatalf("UpsertEquipmentMachine with seenDeviceIDs: %v", err)
		}

		var after *time.Time
		if err := pool.QueryRow(ctx, `SELECT last_seen_at FROM equipment_devices WHERE id = $1`, scanner1.ID).Scan(&after); err != nil {
			t.Fatalf("read scanner1.last_seen_at after: %v", err)
		}
		if after == nil {
			t.Fatalf("scanner1.last_seen_at still NULL after UpsertEquipmentMachine with seenDeviceIDs containing it")
		}

		// printer1 was NOT in seenDeviceIDs — its last_seen_at must remain untouched (still NULL).
		var printerLastSeen *time.Time
		if err := pool.QueryRow(ctx, `SELECT last_seen_at FROM equipment_devices WHERE id = $1`, printer1.ID).Scan(&printerLastSeen); err != nil {
			t.Fatalf("read printer1.last_seen_at: %v", err)
		}
		if printerLastSeen != nil {
			t.Errorf("printer1.last_seen_at = %v, want nil/NULL (it was not in seenDeviceIDs)", printerLastSeen)
		}
	})

	var printer2ID uuid.UUID
	t.Run("SetDefaultEquipmentPrinter + MarkEquipmentDeviceTestPassed feed TenantHasTestedDefaultPrinter", func(t *testing.T) {
		printer2 := &models.EquipmentDevice{
			TenantID: tenantA, MachineID: sharedMachineID, Class: "printer", Kind: "system",
			DisplayName: "Second Printer", Config: json.RawMessage(`{}`),
		}
		if err := s.CreateEquipmentDevice(ctx, printer2, false, false); err != nil {
			t.Fatalf("CreateEquipmentDevice printer2: %v", err)
		}
		printer2ID = printer2.ID

		hasTested, err := s.TenantHasTestedDefaultPrinter(ctx, tenantA)
		if err != nil {
			t.Fatalf("TenantHasTestedDefaultPrinter (before): %v", err)
		}
		if hasTested {
			t.Fatalf("TenantHasTestedDefaultPrinter = true before any printer is both default and tested")
		}

		// Repoint the default from printer1 to printer2 — proves the
		// clear-then-set transaction actually clears printer1 (otherwise
		// this insert/update would collide with the partial unique index).
		if err := s.SetDefaultEquipmentPrinter(ctx, tenantA, sharedMachineID, &printer2.ID); err != nil {
			t.Fatalf("SetDefaultEquipmentPrinter: %v", err)
		}

		var printer1IsDefault bool
		if err := pool.QueryRow(ctx, `SELECT is_default FROM equipment_devices WHERE id = $1`, printer1.ID).Scan(&printer1IsDefault); err != nil {
			t.Fatalf("read printer1.is_default: %v", err)
		}
		if printer1IsDefault {
			t.Errorf("printer1.is_default = true, want false (repointed to printer2)")
		}

		if err := s.MarkEquipmentDeviceTestPassed(ctx, tenantA, printer2.ID); err != nil {
			t.Fatalf("MarkEquipmentDeviceTestPassed: %v", err)
		}

		hasTested, err = s.TenantHasTestedDefaultPrinter(ctx, tenantA)
		if err != nil {
			t.Fatalf("TenantHasTestedDefaultPrinter (after): %v", err)
		}
		if !hasTested {
			t.Fatalf("TenantHasTestedDefaultPrinter = false, want true (printer2 is default and tested)")
		}

		// tenantB has no tested default printer at all.
		hasTestedB, err := s.TenantHasTestedDefaultPrinter(ctx, tenantB)
		if err != nil {
			t.Fatalf("TenantHasTestedDefaultPrinter tenantB: %v", err)
		}
		if hasTestedB {
			t.Fatalf("TenantHasTestedDefaultPrinter tenantB = true, want false")
		}
	})

	t.Run("SetDefaultEquipmentPrinter with a foreign/missing device rolls back, leaving the PRIOR default untouched", func(t *testing.T) {
		// A real ROLLBACK undoes BOTH statements in the transaction — the
		// clear AND the (failed) set — so this is a true no-op: printer2
		// (made default in the previous subtest) is still exactly and only
		// the default, never uncommitted-cleared and never silently
		// replaced by the foreign id.
		foreignID := uuid.New()
		err := s.SetDefaultEquipmentPrinter(ctx, tenantA, sharedMachineID, &foreignID)
		if !errors.Is(err, ErrDeviceNotFound) {
			t.Fatalf("err = %v, want ErrDeviceNotFound", err)
		}

		_, devices, err := s.GetEquipmentMachine(ctx, tenantA, sharedMachineID)
		if err != nil {
			t.Fatalf("GetEquipmentMachine: %v", err)
		}
		var defaultIDs []uuid.UUID
		for _, d := range devices {
			if d.IsDefault {
				defaultIDs = append(defaultIDs, d.ID)
			}
		}
		if len(defaultIDs) != 1 || defaultIDs[0] != printer2ID {
			t.Errorf("defaults after a rolled-back SetDefaultEquipmentPrinter = %v, want exactly [printer2.ID=%v] unchanged", defaultIDs, printer2ID)
		}
	})

	t.Run("UpdateEquipmentDevice and DeleteEquipmentDevice round-trip, then 0-row ErrDeviceNotFound after delete", func(t *testing.T) {
		newConfig := json.RawMessage(`{"renamed":true}`)
		if err := s.UpdateEquipmentDevice(ctx, tenantA, scanner1.ID, "Renamed Scanner", newConfig); err != nil {
			t.Fatalf("UpdateEquipmentDevice: %v", err)
		}
		got, err := s.GetEquipmentDeviceForTenant(ctx, tenantA, scanner1.ID)
		if err != nil {
			t.Fatalf("GetEquipmentDeviceForTenant: %v", err)
		}
		if got == nil || got.DisplayName != "Renamed Scanner" {
			t.Fatalf("got = %+v, want DisplayName=Renamed Scanner", got)
		}

		if err := s.DeleteEquipmentDevice(ctx, tenantA, scanner1.ID); err != nil {
			t.Fatalf("DeleteEquipmentDevice: %v", err)
		}
		gotAfterDelete, err := s.GetEquipmentDeviceForTenant(ctx, tenantA, scanner1.ID)
		if err != nil {
			t.Fatalf("GetEquipmentDeviceForTenant after delete: %v", err)
		}
		if gotAfterDelete != nil {
			t.Errorf("got after delete = %+v, want nil", gotAfterDelete)
		}

		if err := s.DeleteEquipmentDevice(ctx, tenantA, scanner1.ID); !errors.Is(err, ErrDeviceNotFound) {
			t.Fatalf("second DeleteEquipmentDevice err = %v, want ErrDeviceNotFound", err)
		}
		// Cross-tenant guard: scanner-owned-by-tenantA's id, called under
		// tenantB, must also be reported as not-found (never cross-tenant
		// deletable), and GetEquipmentDeviceForTenant must not leak it.
		if got, err := s.GetEquipmentDeviceForTenant(ctx, tenantB, printer1.ID); err != nil || got != nil {
			t.Errorf("GetEquipmentDeviceForTenant(tenantB, printer1.ID) = %+v, %v, want nil, nil (printer1 belongs to tenantA)", got, err)
		}
	})

	// Finding 2 (bot review, PR #83 round 2): test_passed=true must stamp
	// test_passed_at atomically in CreateEquipmentDevice's own INSERT —
	// there is no separate MarkEquipmentDeviceTestPassed call to fail
	// independently and leave a wrongly-unstamped, already-visible device
	// behind. Proven here against a real Postgres, not just pinned SQL
	// text (pgxmock cannot evaluate the CASE WHEN $8 THEN now() ELSE NULL
	// END expression).
	t.Run("CreateEquipmentDevice testPassed=true stamps test_passed_at atomically in the same INSERT", func(t *testing.T) {
		testPassedDevice := &models.EquipmentDevice{
			TenantID: tenantA, MachineID: sharedMachineID, Class: "printer", Kind: "system",
			DisplayName: "Pre-Tested Printer", Config: json.RawMessage(`{"agent_name":"Zebra ZD888"}`),
		}
		if err := s.CreateEquipmentDevice(ctx, testPassedDevice, false, true); err != nil {
			t.Fatalf("CreateEquipmentDevice(testPassed=true): %v", err)
		}
		if testPassedDevice.TestPassedAt == nil {
			t.Fatalf("testPassedDevice.TestPassedAt = nil immediately after create, want set")
		}

		var storedTestPassedAt *time.Time
		if err := pool.QueryRow(ctx, `SELECT test_passed_at FROM equipment_devices WHERE id = $1`, testPassedDevice.ID).Scan(&storedTestPassedAt); err != nil {
			t.Fatalf("read test_passed_at: %v", err)
		}
		if storedTestPassedAt == nil {
			t.Fatalf("stored test_passed_at = nil, want set (same INSERT, not a separate write)")
		}

		notTestPassedDevice := &models.EquipmentDevice{
			TenantID: tenantA, MachineID: sharedMachineID, Class: "printer", Kind: "system",
			DisplayName: "Never-Tested Printer", Config: json.RawMessage(`{"agent_name":"Zebra ZD889"}`),
		}
		if err := s.CreateEquipmentDevice(ctx, notTestPassedDevice, false, false); err != nil {
			t.Fatalf("CreateEquipmentDevice(testPassed=false): %v", err)
		}
		if notTestPassedDevice.TestPassedAt != nil {
			t.Errorf("notTestPassedDevice.TestPassedAt = %v, want nil (testPassed=false)", notTestPassedDevice.TestPassedAt)
		}
	})

	// Finding 1 (bot review, PR #83 round 2): a PATCH (UpdateEquipmentDevice)
	// that actually changes the device's config must unconditionally clear
	// test_passed_at — the stamp must never be left describing DIFFERENT
	// hardware. A rename-only call that resends the SAME config (even
	// reserialized with different key order/whitespace, proving the
	// comparison is jsonb-semantic, not a byte comparison) must preserve
	// it.
	t.Run("UpdateEquipmentDevice clears test_passed_at only when config actually changed", func(t *testing.T) {
		device := &models.EquipmentDevice{
			TenantID: tenantA, MachineID: sharedMachineID, Class: "printer", Kind: "network",
			DisplayName: "Patch-Target Printer",
			Config:      json.RawMessage(`{"agent_name":"Zebra ZD500","ip":"192.168.1.50","port":9100}`),
		}
		if err := s.CreateEquipmentDevice(ctx, device, false, false); err != nil {
			t.Fatalf("CreateEquipmentDevice: %v", err)
		}
		if err := s.MarkEquipmentDeviceTestPassed(ctx, tenantA, device.ID); err != nil {
			t.Fatalf("MarkEquipmentDeviceTestPassed: %v", err)
		}

		var beforeRename *time.Time
		if err := pool.QueryRow(ctx, `SELECT test_passed_at FROM equipment_devices WHERE id = $1`, device.ID).Scan(&beforeRename); err != nil {
			t.Fatalf("read test_passed_at before rename: %v", err)
		}
		if beforeRename == nil {
			t.Fatalf("test_passed_at before rename = nil, want set (MarkEquipmentDeviceTestPassed just stamped it)")
		}

		// Rename-only: resend the SAME config, but reserialized with
		// different key order and extra whitespace — proves the CASE's
		// `IS DISTINCT FROM` is jsonb-semantic equality, not a raw byte
		// comparison, since a byte comparison would (wrongly) see this as
		// changed and clear the stamp.
		reserializedSameConfig := json.RawMessage(`{ "port": 9100, "ip": "192.168.1.50", "agent_name": "Zebra ZD500" }`)
		if err := s.UpdateEquipmentDevice(ctx, tenantA, device.ID, "Renamed, Same Config", reserializedSameConfig); err != nil {
			t.Fatalf("UpdateEquipmentDevice (rename-only): %v", err)
		}
		var afterRename *time.Time
		if err := pool.QueryRow(ctx, `SELECT test_passed_at FROM equipment_devices WHERE id = $1`, device.ID).Scan(&afterRename); err != nil {
			t.Fatalf("read test_passed_at after rename-only: %v", err)
		}
		if afterRename == nil {
			t.Fatalf("test_passed_at after rename-only PATCH = nil, want PRESERVED (config is semantically unchanged)")
		}
		if !afterRename.Equal(*beforeRename) {
			t.Errorf("test_passed_at changed on a rename-only PATCH: before=%v after=%v", beforeRename, afterRename)
		}

		// Now actually change the config (different ip) — the stamp must
		// be cleared, since it can no longer be trusted to describe this
		// device's current hardware.
		changedConfig := json.RawMessage(`{"agent_name":"Zebra ZD500","ip":"192.168.1.51","port":9100}`)
		if err := s.UpdateEquipmentDevice(ctx, tenantA, device.ID, "Renamed, Same Config", changedConfig); err != nil {
			t.Fatalf("UpdateEquipmentDevice (config changed): %v", err)
		}
		var afterConfigChange *time.Time
		if err := pool.QueryRow(ctx, `SELECT test_passed_at FROM equipment_devices WHERE id = $1`, device.ID).Scan(&afterConfigChange); err != nil {
			t.Fatalf("read test_passed_at after config change: %v", err)
		}
		if afterConfigChange != nil {
			t.Errorf("test_passed_at after a config-changing PATCH = %v, want nil (cleared — stamp can no longer describe this device's hardware)", afterConfigChange)
		}
	})
}
