package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"idento/backend/internal/models"
	"idento/backend/internal/store"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/labstack/echo/v4"
)

// --- path helpers (house pattern: monitorPath/setMonitorPathParams) ---

func equipmentMachinePath(machineID uuid.UUID) string {
	return "/api/equipment/machines/" + machineID.String()
}

func equipmentMachineDevicesPath(machineID uuid.UUID) string {
	return equipmentMachinePath(machineID) + "/devices"
}

func equipmentDefaultPrinterPath(machineID uuid.UUID) string {
	return equipmentMachinePath(machineID) + "/default-printer"
}

func equipmentDevicePath(deviceID uuid.UUID) string {
	return "/api/equipment/devices/" + deviceID.String()
}

func equipmentDeviceTestPassedPath(deviceID uuid.UUID) string {
	return equipmentDevicePath(deviceID) + "/test-passed"
}

func setEquipmentMachinePathParams(c echo.Context, machineID uuid.UUID) {
	c.SetPath("/api/equipment/machines/:machine_id")
	c.SetParamNames("machine_id")
	c.SetParamValues(machineID.String())
}

func setEquipmentMachineDevicesPathParams(c echo.Context, machineID uuid.UUID) {
	c.SetPath("/api/equipment/machines/:machine_id/devices")
	c.SetParamNames("machine_id")
	c.SetParamValues(machineID.String())
}

func setEquipmentDefaultPrinterPathParams(c echo.Context, machineID uuid.UUID) {
	c.SetPath("/api/equipment/machines/:machine_id/default-printer")
	c.SetParamNames("machine_id")
	c.SetParamValues(machineID.String())
}

func setEquipmentDevicePathParams(c echo.Context, deviceID uuid.UUID) {
	c.SetPath("/api/equipment/devices/:device_id")
	c.SetParamNames("device_id")
	c.SetParamValues(deviceID.String())
}

func setEquipmentDeviceTestPassedPathParams(c echo.Context, deviceID uuid.UUID) {
	c.SetPath("/api/equipment/devices/:device_id/test-passed")
	c.SetParamNames("device_id")
	c.SetParamValues(deviceID.String())
}

// --- PUT /api/equipment/machines/{machine_id} ---

func TestOpenAPIContract_UpsertEquipmentMachine_200RoundTrip(t *testing.T) {
	tenantID := uuid.New()
	machineID := uuid.New()
	now := time.Now().UTC()

	var upserted *models.EquipmentMachine
	h := New(&fakeStore{
		upsertEquipmentMachine: func(m *models.EquipmentMachine, seenDeviceIDs []uuid.UUID) error {
			if m.TenantID != tenantID || m.MachineID != machineID {
				t.Fatalf("upsert scoping = tenant %s machine %s, want %s/%s", m.TenantID, m.MachineID, tenantID, machineID)
			}
			if m.Hostname != "REG-1" || m.AgentVersion != "1.9.0" {
				t.Fatalf("upsert fields = %+v", m)
			}
			if len(seenDeviceIDs) != 0 {
				t.Fatalf("seenDeviceIDs = %v, want empty", seenDeviceIDs)
			}
			upserted = &models.EquipmentMachine{
				TenantID: tenantID, MachineID: machineID,
				Hostname: m.Hostname, AgentVersion: m.AgentVersion,
				LastSeenAt: now, CreatedAt: now,
			}
			return nil
		},
		getEquipmentMachine: func(tid, mid uuid.UUID) (*models.EquipmentMachine, []models.EquipmentDevice, error) {
			if tid != tenantID || mid != machineID {
				t.Fatalf("get scoping mismatch: %s/%s", tid, mid)
			}
			return upserted, []models.EquipmentDevice{}, nil
		},
	})

	e := echo.New()
	path := equipmentMachinePath(machineID)
	body := `{"hostname":"REG-1","agent_version":"1.9.0","seen_device_ids":[]}`
	c, rec := newAuthedContext(e, http.MethodPut, path, body, tenantID.String(), "staff")
	setEquipmentMachinePathParams(c, machineID)

	if err := h.UpsertEquipmentMachine(c); err != nil {
		t.Fatalf("UpsertEquipmentMachine: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}

	var got EquipmentMachineResponse
	if err := jsonUnmarshalBody(rec, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Machine.Hostname != "REG-1" || got.Machine.AgentVersion != "1.9.0" {
		t.Fatalf("machine = %+v", got.Machine)
	}
	if len(got.Devices) != 0 {
		t.Fatalf("devices = %+v, want empty", got.Devices)
	}

	validateResponse(t, http.MethodPut, path, rec)
}

func TestOpenAPIContract_UpsertEquipmentMachine_InvalidUUID400(t *testing.T) {
	tenantID := uuid.New()
	h := New(&fakeStore{})

	e := echo.New()
	path := "/api/equipment/machines/not-a-uuid"
	c, rec := newAuthedContext(e, http.MethodPut, path, `{}`, tenantID.String(), "staff")
	c.SetPath("/api/equipment/machines/:machine_id")
	c.SetParamNames("machine_id")
	c.SetParamValues("not-a-uuid")

	if err := h.UpsertEquipmentMachine(c); err != nil {
		t.Fatalf("UpsertEquipmentMachine: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPut, path, rec)
}

func TestOpenAPIContract_UpsertEquipmentMachine_NoToken401(t *testing.T) {
	machineID := uuid.New()
	h := New(&fakeStore{})

	e := echo.New()
	path := equipmentMachinePath(machineID)
	body := `{"hostname":"REG-1","agent_version":"1.9.0","seen_device_ids":[]}`
	c, rec := newUnauthedContext(e, http.MethodPut, path, body)
	setEquipmentMachinePathParams(c, machineID)

	if err := h.UpsertEquipmentMachine(c); err != nil {
		t.Fatalf("UpsertEquipmentMachine: %v", err)
	}
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPut, path, rec)
}

// --- GET /api/equipment/machines/{machine_id} ---

func TestOpenAPIContract_GetEquipmentMachine_200WithDevices(t *testing.T) {
	tenantID := uuid.New()
	machineID := uuid.New()
	deviceID := uuid.New()
	now := time.Now().UTC()

	machine := &models.EquipmentMachine{
		TenantID: tenantID, MachineID: machineID,
		Hostname: "REG-1", AgentVersion: "1.9.0",
		LastSeenAt: now, CreatedAt: now,
	}
	devices := []models.EquipmentDevice{
		{
			ID: deviceID, TenantID: tenantID, MachineID: machineID,
			Class: "printer", Kind: "network", DisplayName: "Zebra ZD421",
			Config:    json.RawMessage(`{"agent_name":"Zebra ZD421","ip":"192.168.1.44","port":9100}`),
			IsDefault: true, CreatedAt: now, UpdatedAt: now,
		},
	}

	h := New(&fakeStore{
		getEquipmentMachine: func(tid, mid uuid.UUID) (*models.EquipmentMachine, []models.EquipmentDevice, error) {
			if tid != tenantID || mid != machineID {
				t.Fatalf("scoping mismatch: %s/%s", tid, mid)
			}
			return machine, devices, nil
		},
	})

	e := echo.New()
	path := equipmentMachinePath(machineID)
	c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "staff")
	setEquipmentMachinePathParams(c, machineID)

	if err := h.GetEquipmentMachine(c); err != nil {
		t.Fatalf("GetEquipmentMachine: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}

	var got EquipmentMachineResponse
	if err := jsonUnmarshalBody(rec, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(got.Devices) != 1 || got.Devices[0].DisplayName != "Zebra ZD421" {
		t.Fatalf("devices = %+v", got.Devices)
	}

	validateResponse(t, http.MethodGet, path, rec)
}

func TestOpenAPIContract_GetEquipmentMachine_Unregistered404(t *testing.T) {
	tenantID := uuid.New()
	machineID := uuid.New()

	h := New(&fakeStore{
		getEquipmentMachine: func(uuid.UUID, uuid.UUID) (*models.EquipmentMachine, []models.EquipmentDevice, error) {
			return nil, nil, nil
		},
	})

	e := echo.New()
	path := equipmentMachinePath(machineID)
	c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "staff")
	setEquipmentMachinePathParams(c, machineID)

	if err := h.GetEquipmentMachine(c); err != nil {
		t.Fatalf("GetEquipmentMachine: %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodGet, path, rec)
}

// --- POST /api/equipment/machines/{machine_id}/devices ---

// TestOpenAPIContract_CreateEquipmentDevice_201Printer additionally guards
// Finding 2 (bot review, PR #83 round 2): test_passed:true must stamp
// test_passed_at atomically INSIDE the CreateEquipmentDevice store call
// (its testPassed param) — MarkEquipmentDeviceTestPassed must never be
// called as a second, separate write afterward. The fake store's
// createEquipmentDevice closure plays the role of the real INSERT...
// RETURNING test_passed_at, stamping d.TestPassedAt itself only when
// testPassed is true, exactly as store.insertEquipmentDeviceRow does.
func TestOpenAPIContract_CreateEquipmentDevice_201Printer(t *testing.T) {
	tenantID := uuid.New()
	machineID := uuid.New()
	now := time.Now().UTC()

	h := New(&fakeStore{
		createEquipmentDevice: func(d *models.EquipmentDevice, makeDefault bool, testPassed bool) error {
			if d.TenantID != tenantID || d.MachineID != machineID {
				t.Fatalf("scoping mismatch: %s/%s", d.TenantID, d.MachineID)
			}
			if !makeDefault {
				t.Fatalf("makeDefault = false, want true")
			}
			if !testPassed {
				t.Fatalf("testPassed = false, want true")
			}
			d.ID = uuid.New()
			d.IsDefault = makeDefault
			d.CreatedAt = now
			d.UpdatedAt = now
			if testPassed {
				stampedAt := now
				d.TestPassedAt = &stampedAt
			}
			return nil
		},
		markEquipmentDeviceTestPassed: func(uuid.UUID, uuid.UUID) error {
			t.Fatalf("MarkEquipmentDeviceTestPassed must not be called — Finding 2 requires the stamp be atomic with CreateEquipmentDevice's INSERT, not a separate follow-up write")
			return nil
		},
	})

	e := echo.New()
	path := equipmentMachineDevicesPath(machineID)
	body := `{"class":"printer","kind":"network","display_name":"Zebra ZD421","config":{"agent_name":"Zebra ZD421","ip":"192.168.1.44","port":9100},"make_default":true,"test_passed":true}`
	c, rec := newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "staff")
	setEquipmentMachineDevicesPathParams(c, machineID)

	if err := h.CreateEquipmentDevice(c); err != nil {
		t.Fatalf("CreateEquipmentDevice: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d, body=%s", rec.Code, rec.Body.String())
	}

	var got models.EquipmentDevice
	if err := jsonUnmarshalBody(rec, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Class != "printer" || got.Kind != "network" || !got.IsDefault {
		t.Fatalf("device = %+v", got)
	}
	if got.TestPassedAt == nil {
		t.Fatalf("test_passed_at = nil, want set")
	}

	validateResponse(t, http.MethodPost, path, rec)
}

// TestOpenAPIContract_CreateEquipmentDevice_201TestPassedFalseLeavesStampNil
// covers the false branch: test_passed omitted/false must leave
// test_passed_at NULL in the very same create — no second call, no
// after-the-fact stamp.
func TestOpenAPIContract_CreateEquipmentDevice_201TestPassedFalseLeavesStampNil(t *testing.T) {
	tenantID := uuid.New()
	machineID := uuid.New()
	now := time.Now().UTC()

	h := New(&fakeStore{
		createEquipmentDevice: func(d *models.EquipmentDevice, makeDefault bool, testPassed bool) error {
			if testPassed {
				t.Fatalf("testPassed = true, want false")
			}
			d.ID = uuid.New()
			d.IsDefault = makeDefault
			d.CreatedAt = now
			d.UpdatedAt = now
			return nil
		},
		markEquipmentDeviceTestPassed: func(uuid.UUID, uuid.UUID) error {
			t.Fatalf("MarkEquipmentDeviceTestPassed must not be called when test_passed is false")
			return nil
		},
	})

	e := echo.New()
	path := equipmentMachineDevicesPath(machineID)
	body := `{"class":"scanner","kind":"com","display_name":"COM3 Scanner","config":{"port_name":"COM3"}}`
	c, rec := newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "staff")
	setEquipmentMachineDevicesPathParams(c, machineID)

	if err := h.CreateEquipmentDevice(c); err != nil {
		t.Fatalf("CreateEquipmentDevice: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d, body=%s", rec.Code, rec.Body.String())
	}

	var got models.EquipmentDevice
	if err := jsonUnmarshalBody(rec, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.TestPassedAt != nil {
		t.Fatalf("test_passed_at = %v, want nil", got.TestPassedAt)
	}

	validateResponse(t, http.MethodPost, path, rec)
}

func TestOpenAPIContract_CreateEquipmentDevice_400(t *testing.T) {
	tenantID := uuid.New()
	machineID := uuid.New()
	path := equipmentMachineDevicesPath(machineID)

	cases := []struct {
		name    string
		body    string
		wantErr string // checked when non-empty
	}{
		{"unknown class", `{"class":"toaster","kind":"network","display_name":"X","config":{}}`, ""},
		{"camera reserved", `{"class":"camera","kind":"system","display_name":"X","config":{}}`, "camera devices are not supported yet"},
		{"printer/usb_wedge mismatch", `{"class":"printer","kind":"usb_wedge","display_name":"X","config":{}}`, ""},
		{"scanner/network mismatch", `{"class":"scanner","kind":"network","display_name":"X","config":{}}`, ""},
		{"empty display_name", `{"class":"printer","kind":"system","display_name":"","config":{"agent_name":"A"}}`, ""},
		{"printer missing agent_name", `{"class":"printer","kind":"system","display_name":"X","config":{}}`, ""},
		{"com scanner missing port_name", `{"class":"scanner","kind":"com","display_name":"X","config":{}}`, ""},
		{"wedge scanner missing terminator", `{"class":"scanner","kind":"usb_wedge","display_name":"X","config":{}}`, ""},
		// Finding 3 (bot review, PR #83): per-kind config decode must
		// reject cross-kind keys, not just accept-and-store them verbatim
		// under a shared shape — a usb_wedge config carrying port_name (a
		// com-only key), a com config carrying terminator (a usb_wedge-only
		// key), or a system printer carrying ip (a network-only key) must
		// all 400.
		{"wedge scanner with com's port_name is rejected", `{"class":"scanner","kind":"usb_wedge","display_name":"X","config":{"terminator":"enter","port_name":"COM3"}}`, ""},
		{"com scanner with wedge's terminator is rejected", `{"class":"scanner","kind":"com","display_name":"X","config":{"port_name":"COM3","terminator":"enter"}}`, ""},
		{"system printer with network's ip is rejected", `{"class":"printer","kind":"system","display_name":"X","config":{"agent_name":"A","ip":"192.168.1.1"}}`, ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := New(&fakeStore{
				createEquipmentDevice: func(*models.EquipmentDevice, bool, bool) error {
					t.Fatalf("CreateEquipmentDevice store call should not happen for an invalid request")
					return nil
				},
			})
			e := echo.New()
			c, rec := newAuthedContext(e, http.MethodPost, path, tc.body, tenantID.String(), "staff")
			setEquipmentMachineDevicesPathParams(c, machineID)

			if err := h.CreateEquipmentDevice(c); err != nil {
				t.Fatalf("CreateEquipmentDevice: %v", err)
			}
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("want 400, got %d, body=%s", rec.Code, rec.Body.String())
			}
			if tc.wantErr != "" {
				var got map[string]string
				if err := jsonUnmarshalBody(rec, &got); err != nil {
					t.Fatalf("unmarshal: %v", err)
				}
				if got["error"] != tc.wantErr {
					t.Fatalf("error = %q, want %q", got["error"], tc.wantErr)
				}
			}
			validateResponse(t, http.MethodPost, path, rec)
		})
	}
}

func TestOpenAPIContract_CreateEquipmentDevice_DefaultConflict409(t *testing.T) {
	tenantID := uuid.New()
	machineID := uuid.New()

	h := New(&fakeStore{
		createEquipmentDevice: func(*models.EquipmentDevice, bool, bool) error {
			return fmt.Errorf("insert equipment device: %w", &pgconn.PgError{Code: "23505", ConstraintName: "equipment_devices_one_default"})
		},
	})

	e := echo.New()
	path := equipmentMachineDevicesPath(machineID)
	body := `{"class":"printer","kind":"network","display_name":"Zebra ZD421","config":{"agent_name":"Zebra ZD421","ip":"192.168.1.44","port":9100},"make_default":true}`
	c, rec := newAuthedContext(e, http.MethodPost, path, body, tenantID.String(), "staff")
	setEquipmentMachineDevicesPathParams(c, machineID)

	if err := h.CreateEquipmentDevice(c); err != nil {
		t.Fatalf("CreateEquipmentDevice: %v", err)
	}
	if rec.Code != http.StatusConflict {
		t.Fatalf("want 409, got %d, body=%s", rec.Code, rec.Body.String())
	}

	var got map[string]string
	if err := jsonUnmarshalBody(rec, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got["error"] != "This machine already has a default printer" {
		t.Fatalf("error = %q", got["error"])
	}

	validateResponse(t, http.MethodPost, path, rec)
}

// --- PATCH /api/equipment/devices/{device_id} ---

// newPatchEquipmentFakeStore builds a STATEFUL fake for the PATCH handler:
// getEquipmentDeviceForTenant serves copies of `stored` (the handler calls
// it twice — the ownership/existence pre-check AND the post-update re-read
// the response body is built from), and updateEquipmentDevice mutates
// `stored` the way the real store's UPDATE does, including Finding 1's
// row-level invariant: a config that differs from the stored one clears
// test_passed_at (the fake compares raw bytes where the real SQL compares
// jsonb-semantically — equivalent here since these tests resend config
// bytes either verbatim or genuinely changed, never merely reserialized).
func newPatchEquipmentFakeStore(t *testing.T, tenantID, deviceID uuid.UUID, stored *models.EquipmentDevice) *fakeStore {
	t.Helper()
	return &fakeStore{
		getEquipmentDeviceForTenant: func(tid, did uuid.UUID) (*models.EquipmentDevice, error) {
			if tid != tenantID || did != deviceID {
				t.Fatalf("scoping mismatch: %s/%s", tid, did)
			}
			cp := *stored
			return &cp, nil
		},
		updateEquipmentDevice: func(tid, did uuid.UUID, displayName string, config json.RawMessage) error {
			if tid != tenantID || did != deviceID {
				t.Fatalf("update scoping mismatch: %s/%s", tid, did)
			}
			if string(config) != string(stored.Config) {
				stored.TestPassedAt = nil
			}
			stored.DisplayName = displayName
			stored.Config = config
			stored.UpdatedAt = time.Now().UTC()
			return nil
		},
	}
}

func TestOpenAPIContract_PatchEquipmentDevice_200Rename(t *testing.T) {
	tenantID := uuid.New()
	deviceID := uuid.New()
	machineID := uuid.New()
	now := time.Now().UTC()
	testPassedAt := now.Add(-time.Hour)

	stored := &models.EquipmentDevice{
		ID: deviceID, TenantID: tenantID, MachineID: machineID,
		Class: "printer", Kind: "network", DisplayName: "Old Name",
		Config:       json.RawMessage(`{"agent_name":"Zebra ZD421","ip":"192.168.1.44","port":9100}`),
		TestPassedAt: &testPassedAt,
		CreatedAt:    now, UpdatedAt: now,
	}
	originalConfig := string(stored.Config)

	h := New(newPatchEquipmentFakeStore(t, tenantID, deviceID, stored))

	e := echo.New()
	path := equipmentDevicePath(deviceID)
	body := `{"display_name":"New Name"}`
	c, rec := newAuthedContext(e, http.MethodPatch, path, body, tenantID.String(), "staff")
	setEquipmentDevicePathParams(c, deviceID)

	if err := h.PatchEquipmentDevice(c); err != nil {
		t.Fatalf("PatchEquipmentDevice: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if stored.DisplayName != "New Name" {
		t.Fatalf("stored display_name = %q, want New Name", stored.DisplayName)
	}
	if string(stored.Config) != originalConfig {
		t.Fatalf("config changed unexpectedly: %s", stored.Config)
	}

	var got models.EquipmentDevice
	if err := jsonUnmarshalBody(rec, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.DisplayName != "New Name" {
		t.Fatalf("response display_name = %q", got.DisplayName)
	}
	// A rename-only PATCH leaves config unchanged, so the stamp survives —
	// and the response (built from the post-update re-read) must show it.
	if got.TestPassedAt == nil {
		t.Fatalf("response test_passed_at = nil, want preserved (config unchanged)")
	}

	validateResponse(t, http.MethodPatch, path, rec)
}

// TestOpenAPIContract_PatchEquipmentDevice_ConfigChangeResponseShowsClearedStamp
// guards the response-accuracy addendum to Finding 1 (bot review PR #83
// round 2): the store's UPDATE clears test_passed_at when config actually
// changes, and the HTTP response must reflect THAT row — re-read after the
// update — not the pre-PATCH in-memory copy, which would echo a stale
// non-null stamp for hardware that never passed a test.
func TestOpenAPIContract_PatchEquipmentDevice_ConfigChangeResponseShowsClearedStamp(t *testing.T) {
	tenantID := uuid.New()
	deviceID := uuid.New()
	machineID := uuid.New()
	now := time.Now().UTC()
	testPassedAt := now.Add(-time.Hour)

	stored := &models.EquipmentDevice{
		ID: deviceID, TenantID: tenantID, MachineID: machineID,
		Class: "printer", Kind: "network", DisplayName: "Front Desk Printer",
		Config:       json.RawMessage(`{"agent_name":"Zebra ZD421","ip":"192.168.1.44","port":9100}`),
		TestPassedAt: &testPassedAt,
		CreatedAt:    now, UpdatedAt: now,
	}

	h := New(newPatchEquipmentFakeStore(t, tenantID, deviceID, stored))

	e := echo.New()
	path := equipmentDevicePath(deviceID)
	body := `{"config":{"agent_name":"Zebra ZD421","ip":"192.168.1.99","port":9100}}`
	c, rec := newAuthedContext(e, http.MethodPatch, path, body, tenantID.String(), "staff")
	setEquipmentDevicePathParams(c, deviceID)

	if err := h.PatchEquipmentDevice(c); err != nil {
		t.Fatalf("PatchEquipmentDevice: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if stored.TestPassedAt != nil {
		t.Fatalf("stored test_passed_at = %v, want nil (config changed)", stored.TestPassedAt)
	}

	var got models.EquipmentDevice
	if err := jsonUnmarshalBody(rec, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.TestPassedAt != nil {
		t.Fatalf("response test_passed_at = %v, want null — the response must echo the re-read row, not the stale pre-PATCH copy", got.TestPassedAt)
	}
	if got.DisplayName != "Front Desk Printer" {
		t.Fatalf("response display_name = %q, want unchanged Front Desk Printer", got.DisplayName)
	}

	validateResponse(t, http.MethodPatch, path, rec)
}

// TestOpenAPIContract_PatchEquipmentDevice_RereadVanished404 covers the
// concurrent-delete race in the post-update re-read: the pre-check found
// the device and the UPDATE reported success, but the device is gone by
// the time the response re-read runs. Same soft-delete-race mapping as
// PutCheckinSettings' ErrEventNotFound handling (PR #77 Finding C): the
// house 404 shape, never a fabricated 200 echoing state that no longer
// exists.
func TestOpenAPIContract_PatchEquipmentDevice_RereadVanished404(t *testing.T) {
	tenantID := uuid.New()
	deviceID := uuid.New()
	machineID := uuid.New()
	now := time.Now().UTC()

	getCalls := 0
	h := New(&fakeStore{
		getEquipmentDeviceForTenant: func(tid, did uuid.UUID) (*models.EquipmentDevice, error) {
			getCalls++
			if getCalls == 1 {
				return &models.EquipmentDevice{
					ID: deviceID, TenantID: tenantID, MachineID: machineID,
					Class: "printer", Kind: "network", DisplayName: "Doomed Printer",
					Config:    json.RawMessage(`{"agent_name":"Zebra ZD421","ip":"192.168.1.44","port":9100}`),
					CreatedAt: now, UpdatedAt: now,
				}, nil
			}
			// The concurrent delete landed between the UPDATE and this
			// re-read.
			return nil, nil
		},
		updateEquipmentDevice: func(uuid.UUID, uuid.UUID, string, json.RawMessage) error {
			return nil
		},
	})

	e := echo.New()
	path := equipmentDevicePath(deviceID)
	body := `{"display_name":"New Name"}`
	c, rec := newAuthedContext(e, http.MethodPatch, path, body, tenantID.String(), "staff")
	setEquipmentDevicePathParams(c, deviceID)

	if err := h.PatchEquipmentDevice(c); err != nil {
		t.Fatalf("PatchEquipmentDevice: %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if getCalls != 2 {
		t.Fatalf("getEquipmentDeviceForTenant calls = %d, want 2 (pre-check + post-update re-read)", getCalls)
	}
	validateResponse(t, http.MethodPatch, path, rec)
}

func TestOpenAPIContract_PatchEquipmentDevice_ForeignOrMissing404(t *testing.T) {
	tenantID := uuid.New()
	deviceID := uuid.New()

	h := New(&fakeStore{
		getEquipmentDeviceForTenant: func(uuid.UUID, uuid.UUID) (*models.EquipmentDevice, error) {
			return nil, nil
		},
	})

	e := echo.New()
	path := equipmentDevicePath(deviceID)
	body := `{"display_name":"New Name"}`
	c, rec := newAuthedContext(e, http.MethodPatch, path, body, tenantID.String(), "staff")
	setEquipmentDevicePathParams(c, deviceID)

	if err := h.PatchEquipmentDevice(c); err != nil {
		t.Fatalf("PatchEquipmentDevice: %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPatch, path, rec)
}

// --- DELETE /api/equipment/devices/{device_id} ---

func TestOpenAPIContract_DeleteEquipmentDevice_204(t *testing.T) {
	tenantID := uuid.New()
	deviceID := uuid.New()

	var deletedTenant, deletedDevice uuid.UUID
	h := New(&fakeStore{
		deleteEquipmentDevice: func(tid, did uuid.UUID) error {
			deletedTenant, deletedDevice = tid, did
			return nil
		},
	})

	e := echo.New()
	path := equipmentDevicePath(deviceID)
	c, rec := newAuthedContext(e, http.MethodDelete, path, "", tenantID.String(), "staff")
	setEquipmentDevicePathParams(c, deviceID)

	if err := h.DeleteEquipmentDevice(c); err != nil {
		t.Fatalf("DeleteEquipmentDevice: %v", err)
	}
	if rec.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if deletedTenant != tenantID || deletedDevice != deviceID {
		t.Fatalf("delete scoping = %s/%s, want %s/%s", deletedTenant, deletedDevice, tenantID, deviceID)
	}

	validateResponse(t, http.MethodDelete, path, rec)
}

func TestOpenAPIContract_DeleteEquipmentDevice_404(t *testing.T) {
	tenantID := uuid.New()
	deviceID := uuid.New()

	h := New(&fakeStore{
		deleteEquipmentDevice: func(uuid.UUID, uuid.UUID) error {
			return store.ErrDeviceNotFound
		},
	})

	e := echo.New()
	path := equipmentDevicePath(deviceID)
	c, rec := newAuthedContext(e, http.MethodDelete, path, "", tenantID.String(), "staff")
	setEquipmentDevicePathParams(c, deviceID)

	if err := h.DeleteEquipmentDevice(c); err != nil {
		t.Fatalf("DeleteEquipmentDevice: %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodDelete, path, rec)
}

// --- PUT /api/equipment/machines/{machine_id}/default-printer ---

func TestOpenAPIContract_PutDefaultEquipmentPrinter_200Set(t *testing.T) {
	tenantID := uuid.New()
	machineID := uuid.New()
	deviceID := uuid.New()

	var gotDeviceID *uuid.UUID
	h := New(&fakeStore{
		setDefaultEquipmentPrinter: func(tid, mid uuid.UUID, did *uuid.UUID) error {
			if tid != tenantID || mid != machineID {
				t.Fatalf("scoping mismatch: %s/%s", tid, mid)
			}
			gotDeviceID = did
			return nil
		},
	})

	e := echo.New()
	path := equipmentDefaultPrinterPath(machineID)
	body := `{"device_id":"` + deviceID.String() + `"}`
	c, rec := newAuthedContext(e, http.MethodPut, path, body, tenantID.String(), "staff")
	setEquipmentDefaultPrinterPathParams(c, machineID)

	if err := h.PutDefaultEquipmentPrinter(c); err != nil {
		t.Fatalf("PutDefaultEquipmentPrinter: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if gotDeviceID == nil || *gotDeviceID != deviceID {
		t.Fatalf("device_id passed to store = %v, want %s", gotDeviceID, deviceID)
	}

	validateResponse(t, http.MethodPut, path, rec)
}

func TestOpenAPIContract_PutDefaultEquipmentPrinter_200Clear(t *testing.T) {
	tenantID := uuid.New()
	machineID := uuid.New()

	var gotDeviceID *uuid.UUID
	called := false
	h := New(&fakeStore{
		setDefaultEquipmentPrinter: func(tid, mid uuid.UUID, did *uuid.UUID) error {
			called = true
			gotDeviceID = did
			return nil
		},
	})

	e := echo.New()
	path := equipmentDefaultPrinterPath(machineID)
	body := `{"device_id":null}`
	c, rec := newAuthedContext(e, http.MethodPut, path, body, tenantID.String(), "staff")
	setEquipmentDefaultPrinterPathParams(c, machineID)

	if err := h.PutDefaultEquipmentPrinter(c); err != nil {
		t.Fatalf("PutDefaultEquipmentPrinter: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if !called {
		t.Fatalf("SetDefaultEquipmentPrinter was not called")
	}
	if gotDeviceID != nil {
		t.Fatalf("device_id passed to store = %v, want nil", gotDeviceID)
	}

	var got map[string]interface{}
	if err := jsonUnmarshalBody(rec, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if v, ok := got["device_id"]; !ok || v != nil {
		t.Fatalf("device_id = %v, want null", v)
	}

	validateResponse(t, http.MethodPut, path, rec)
}

// TestOpenAPIContract_PutDefaultEquipmentPrinter_MissingFieldIs400 guards
// Finding 2 (bot review, PR #83): an accidentally-omitted device_id field
// must never be treated the same as an explicit `{"device_id":null}`
// clear-request — that would silently wipe the machine's default printer.
// The store must not even be called.
func TestOpenAPIContract_PutDefaultEquipmentPrinter_MissingFieldIs400(t *testing.T) {
	tenantID := uuid.New()
	machineID := uuid.New()

	h := New(&fakeStore{
		setDefaultEquipmentPrinter: func(uuid.UUID, uuid.UUID, *uuid.UUID) error {
			t.Fatalf("SetDefaultEquipmentPrinter store call should not happen when device_id is omitted")
			return nil
		},
	})

	e := echo.New()
	path := equipmentDefaultPrinterPath(machineID)
	body := `{}`
	c, rec := newAuthedContext(e, http.MethodPut, path, body, tenantID.String(), "staff")
	setEquipmentDefaultPrinterPathParams(c, machineID)

	if err := h.PutDefaultEquipmentPrinter(c); err != nil {
		t.Fatalf("PutDefaultEquipmentPrinter: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}

	var got map[string]string
	if err := jsonUnmarshalBody(rec, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got["error"] != "device_id is required; send null to clear" {
		t.Fatalf("error = %q", got["error"])
	}

	validateResponse(t, http.MethodPut, path, rec)
}

// TestOpenAPIContract_PutDefaultEquipmentPrinter_MalformedUUIDIs400 guards
// the other half of Finding 2's decode: a present-but-invalid device_id
// must 400, not fall through to the store as a zero-value/garbage id.
func TestOpenAPIContract_PutDefaultEquipmentPrinter_MalformedUUIDIs400(t *testing.T) {
	tenantID := uuid.New()
	machineID := uuid.New()

	h := New(&fakeStore{
		setDefaultEquipmentPrinter: func(uuid.UUID, uuid.UUID, *uuid.UUID) error {
			t.Fatalf("SetDefaultEquipmentPrinter store call should not happen for a malformed device_id")
			return nil
		},
	})

	e := echo.New()
	path := equipmentDefaultPrinterPath(machineID)
	body := `{"device_id":"not-a-uuid"}`
	c, rec := newAuthedContext(e, http.MethodPut, path, body, tenantID.String(), "staff")
	setEquipmentDefaultPrinterPathParams(c, machineID)

	if err := h.PutDefaultEquipmentPrinter(c); err != nil {
		t.Fatalf("PutDefaultEquipmentPrinter: %v", err)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPut, path, rec)
}

func TestOpenAPIContract_PutDefaultEquipmentPrinter_TargetMissing404(t *testing.T) {
	tenantID := uuid.New()
	machineID := uuid.New()
	deviceID := uuid.New()

	h := New(&fakeStore{
		setDefaultEquipmentPrinter: func(uuid.UUID, uuid.UUID, *uuid.UUID) error {
			return store.ErrDeviceNotFound
		},
	})

	e := echo.New()
	path := equipmentDefaultPrinterPath(machineID)
	body := `{"device_id":"` + deviceID.String() + `"}`
	c, rec := newAuthedContext(e, http.MethodPut, path, body, tenantID.String(), "staff")
	setEquipmentDefaultPrinterPathParams(c, machineID)

	if err := h.PutDefaultEquipmentPrinter(c); err != nil {
		t.Fatalf("PutDefaultEquipmentPrinter: %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPut, path, rec)
}

// --- POST /api/equipment/devices/{device_id}/test-passed ---

func TestOpenAPIContract_MarkEquipmentDeviceTestPassed_204(t *testing.T) {
	tenantID := uuid.New()
	deviceID := uuid.New()

	var gotTenant, gotDevice uuid.UUID
	h := New(&fakeStore{
		markEquipmentDeviceTestPassed: func(tid, did uuid.UUID) error {
			gotTenant, gotDevice = tid, did
			return nil
		},
	})

	e := echo.New()
	path := equipmentDeviceTestPassedPath(deviceID)
	c, rec := newAuthedContext(e, http.MethodPost, path, "", tenantID.String(), "staff")
	setEquipmentDeviceTestPassedPathParams(c, deviceID)

	if err := h.MarkEquipmentDeviceTestPassed(c); err != nil {
		t.Fatalf("MarkEquipmentDeviceTestPassed: %v", err)
	}
	if rec.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if gotTenant != tenantID || gotDevice != deviceID {
		t.Fatalf("scoping = %s/%s, want %s/%s", gotTenant, gotDevice, tenantID, deviceID)
	}

	validateResponse(t, http.MethodPost, path, rec)
}

func TestOpenAPIContract_MarkEquipmentDeviceTestPassed_404(t *testing.T) {
	tenantID := uuid.New()
	deviceID := uuid.New()

	h := New(&fakeStore{
		markEquipmentDeviceTestPassed: func(uuid.UUID, uuid.UUID) error {
			return store.ErrDeviceNotFound
		},
	})

	e := echo.New()
	path := equipmentDeviceTestPassedPath(deviceID)
	c, rec := newAuthedContext(e, http.MethodPost, path, "", tenantID.String(), "staff")
	setEquipmentDeviceTestPassedPathParams(c, deviceID)

	if err := h.MarkEquipmentDeviceTestPassed(c); err != nil {
		t.Fatalf("MarkEquipmentDeviceTestPassed: %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}
	validateResponse(t, http.MethodPost, path, rec)
}
