# Printer Pairing QR Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let operators export the pairing data of registered **network (ethernet) printers** from the panel — a per-printer QR PNG and a bulk CSV with a ready `qr_payload` column — so labels can be mass-produced in an external label tool; the mobile scan-to-connect half already exists.

**Architecture:** One backend helper (`buildPrinterQRPayload`) is the single source of truth mapping an `equipment_devices` row → the exact `PrinterQRData` JSON the mobile app parses. Two authed, tenant-scoped GET endpoints reuse it: a PNG (one device) and a CSV (all tenant network printers). The panel adds a per-printer "Download pairing QR" action and a hub-level "Export printers (CSV)" button, both fetching through the existing authed `api` client and saving via a Blob→anchor download.

**Tech Stack:** Go 1.25 + Echo + pgx v5 (backend); `github.com/skip2/go-qrcode` (already a dep) for the PNG; stdlib `encoding/csv` for the CSV (no new deps). Panel: React 19 + TS + Vite, `openapi-fetch`/`openapi-react-query` (`$api`), react-i18next, Vitest + MSW.

## Global Constraints

- Direct push to `origin/main` is BLOCKED — work on branch `feat/printer-pairing-qr-export` (already created), merge via PR.
- **No new backend dependencies.** CSV via stdlib `encoding/csv` (the `ExportAttendeesCSV` precedent); PNG via the already-vendored `github.com/skip2/go-qrcode`.
- Any edit to `backend/openapi.yaml` MUST be followed by `npm run generate:api -w panel` and the regenerated `panel/src/shared/api/schema.d.ts` committed — otherwise CI's "Test Panel" drift check fails.
- Panel typecheck is `npm run typecheck` (run in `panel/`), never bare `tsc`.
- Every new user-facing panel string goes into BOTH `panel/src/shared/i18n/en.json` and `ru.json` — `keyParity.test.ts` fails if a key exists in only one.
- Tenant scoping: both endpoints hang off the authed `api` group (`middleware.JWT` + `TenantGate`) and derive the tenant from `tenantIDFromContext(c)`; the store's `WHERE tenant_id = $1` is the ownership check (house 404/empty masking, per `equipment.go`'s existing idiom).
- Scope guard: only `class=printer, kind=network` devices are eligible. `system`/CUPS printers and scanners are excluded (a mobile device cannot reach them). Bluetooth printers are not in the registry at all — out of scope.

---

### Task 1: `buildPrinterQRPayload` helper + `EquipmentPrinterExport` model

**Files:**
- Create: `backend/internal/handler/printer_pairing_export.go`
- Create: `backend/internal/handler/printer_pairing_export_test.go`
- Modify: `backend/internal/models/equipment.go` (append one struct)

**Interfaces:**
- Consumes: `models.PrinterQRData`, `models.PrinterSettings`, `models.PrinterTypeIdentifier/Version/Ethernet` (existing, `backend/internal/models/printer_qr.go`); `networkPrinterConfigShape` and `decodeStrictConfig` (existing, `backend/internal/handler/equipment.go`).
- Produces: `buildPrinterQRPayload(device models.EquipmentDevice) (models.PrinterQRData, error)` and the sentinel `errPairingQRUnsupportedDevice`; `models.EquipmentPrinterExport{Device models.EquipmentDevice; Hostname string}`.

- [ ] **Step 1: Write the failing test**

Create `backend/internal/handler/printer_pairing_export_test.go`:

```go
package handler

import (
	"encoding/json"
	"testing"

	"idento/backend/internal/models"
)

func networkDevice(config string) models.EquipmentDevice {
	return models.EquipmentDevice{
		Class:       "printer",
		Kind:        "network",
		DisplayName: "Zebra ZD421 — Вход",
		Config:      json.RawMessage(config),
	}
}

func TestBuildPrinterQRPayload_NetworkDevice(t *testing.T) {
	dev := networkDevice(`{"agent_name":"zebra1","ip":"192.168.1.50","port":9100,"dpi":203}`)
	got, err := buildPrinterQRPayload(dev)
	if err != nil {
		t.Fatalf("buildPrinterQRPayload: %v", err)
	}
	if got.Type != "idento_printer" || got.Version != "1.0" || got.PrinterType != "ethernet" {
		t.Errorf("header fields = %+v", got)
	}
	if got.Name != "Zebra ZD421 — Вход" {
		t.Errorf("name = %q", got.Name)
	}
	if got.IP == nil || *got.IP != "192.168.1.50" {
		t.Errorf("ip = %v", got.IP)
	}
	if got.Port == nil || *got.Port != 9100 {
		t.Errorf("port = %v", got.Port)
	}
	if got.Settings == nil || got.Settings.DPI == nil || *got.Settings.DPI != 203 {
		t.Errorf("settings.dpi = %+v", got.Settings)
	}
}

func TestBuildPrinterQRPayload_OmitsSettingsWhenNoDPI(t *testing.T) {
	dev := networkDevice(`{"agent_name":"zebra1","ip":"10.0.0.9","port":9100}`)
	got, err := buildPrinterQRPayload(dev)
	if err != nil {
		t.Fatalf("buildPrinterQRPayload: %v", err)
	}
	if got.Settings != nil {
		t.Errorf("settings = %+v, want nil", got.Settings)
	}
	raw, _ := json.Marshal(got)
	want := `{"type":"idento_printer","version":"1.0","printer_type":"ethernet","name":"Zebra ZD421 — Вход","ip":"10.0.0.9","port":9100}`
	if string(raw) != want {
		t.Errorf("marshaled = %s\nwant       = %s", raw, want)
	}
}

func TestBuildPrinterQRPayload_RejectsNonNetwork(t *testing.T) {
	cases := []models.EquipmentDevice{
		{Class: "printer", Kind: "system", DisplayName: "CUPS", Config: json.RawMessage(`{"agent_name":"x"}`)},
		{Class: "scanner", Kind: "com", DisplayName: "Scan", Config: json.RawMessage(`{"port_name":"COM3"}`)},
	}
	for _, dev := range cases {
		if _, err := buildPrinterQRPayload(dev); err == nil {
			t.Errorf("buildPrinterQRPayload(%s/%s) = nil error, want rejection", dev.Class, dev.Kind)
		}
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && go test ./internal/handler/ -run TestBuildPrinterQRPayload`
Expected: FAIL — `undefined: buildPrinterQRPayload`.

- [ ] **Step 3: Add the model struct**

Append to `backend/internal/models/equipment.go`:

```go
// EquipmentPrinterExport is one network printer paired with its machine's
// hostname — the row shape ListEquipmentPrintersForTenant returns for the
// pairing-QR CSV export. Hostname is a display-only column; the mobile
// PrinterQRData payload never carries it.
type EquipmentPrinterExport struct {
	Device   EquipmentDevice
	Hostname string
}
```

- [ ] **Step 4: Write the helper**

Create `backend/internal/handler/printer_pairing_export.go`:

```go
package handler

import (
	"errors"
	"strings"

	"idento/backend/internal/models"
)

// errPairingQRUnsupportedDevice is returned by buildPrinterQRPayload for any
// device that cannot yield a mobile-scannable pairing QR: only a
// class=printer, kind=network device (a reachable ip:port) qualifies. A
// system/CUPS printer is bound to a machine's local agent and a scanner is
// not a printer at all — the mobile app can reach neither directly.
var errPairingQRUnsupportedDevice = errors.New("pairing QR is only available for network printers")

// buildPrinterQRPayload turns a registry device row into the exact
// PrinterQRData the mobile app parses (PrinterQRData.kt). It is the SINGLE
// source of truth for that mapping — both the PNG endpoint and the CSV
// export call it, so the qr_payload column and the scanned PNG are
// byte-identical (both json.Marshal(payload)). Returns
// errPairingQRUnsupportedDevice for anything but a class=printer/kind=network
// device, and the same config.ip/port errors as the equipment config
// validator when a network config is malformed.
func buildPrinterQRPayload(device models.EquipmentDevice) (models.PrinterQRData, error) {
	if device.Class != "printer" || device.Kind != "network" {
		return models.PrinterQRData{}, errPairingQRUnsupportedDevice
	}

	var shape networkPrinterConfigShape
	if err := decodeStrictConfig(device.Config, &shape); err != nil {
		return models.PrinterQRData{}, err
	}
	if strings.TrimSpace(shape.IP) == "" {
		return models.PrinterQRData{}, errors.New("config.ip is required")
	}
	if shape.Port < 1 || shape.Port > 65535 {
		return models.PrinterQRData{}, errors.New("config.port must be between 1 and 65535")
	}

	ip := shape.IP
	port := shape.Port
	payload := models.PrinterQRData{
		Type:        models.PrinterTypeIdentifier,
		Version:     models.PrinterTypeVersion,
		PrinterType: models.PrinterTypeEthernet,
		Name:        device.DisplayName,
		IP:          &ip,
		Port:        &port,
	}
	if shape.DPI != nil {
		payload.Settings = &models.PrinterSettings{DPI: shape.DPI}
	}
	return payload, nil
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && go test ./internal/handler/ -run TestBuildPrinterQRPayload -v`
Expected: PASS (all three tests).

- [ ] **Step 6: Commit**

```bash
git add backend/internal/handler/printer_pairing_export.go backend/internal/handler/printer_pairing_export_test.go backend/internal/models/equipment.go
git commit -m "feat(backend): buildPrinterQRPayload — registry row -> PrinterQRData"
```

---

### Task 2: Store `ListEquipmentPrintersForTenant`

**Files:**
- Modify: `backend/internal/store/interface.go` (add one interface method near the equipment block, ~line 497)
- Modify: `backend/internal/store/pg_store_equipment.go` (add the method)
- Modify: `backend/internal/handler/testsupport_test.go` (add fakeStore field + method)
- Modify: `backend/internal/store/pg_store_equipment_test.go` (SQL-pattern const + pgxmock test)

**Interfaces:**
- Consumes: `models.EquipmentPrinterExport` (Task 1); `newEquipmentMock(t) (pgxmock.PgxPoolIface, *PGStore)` (existing test helper).
- Produces: `Store.ListEquipmentPrintersForTenant(ctx context.Context, tenantID uuid.UUID) ([]models.EquipmentPrinterExport, error)`.

- [ ] **Step 1: Write the failing store test**

Add to `backend/internal/store/pg_store_equipment_test.go` (a SQL-pattern const alongside the others near the top, and the test with the other `Test...` funcs):

```go
// listEquipmentPrintersForTenantSQLPattern pins ListEquipmentPrintersForTenant —
// a tenant-wide JOIN of every network printer to its machine's hostname,
// filtered to class='printer' AND kind='network' (the only devices that
// yield a mobile-scannable ethernet pairing QR), ordered (hostname,
// display_name) for a machine-by-machine export.
const listEquipmentPrintersForTenantSQLPattern = `SELECT d\.id, d\.machine_id, d\.class, d\.kind, d\.display_name, d\.config, m\.hostname FROM equipment_devices d JOIN equipment_machines m ON m\.tenant_id = d\.tenant_id AND m\.machine_id = d\.machine_id WHERE d\.tenant_id = \$1 AND d\.class = 'printer' AND d\.kind = 'network' ORDER BY m\.hostname, d\.display_name`

func TestListEquipmentPrintersForTenant_ReturnsNetworkPrintersWithHostname(t *testing.T) {
	mock, s := newEquipmentMock(t)

	tenantID := uuid.New()
	dev1, dev2 := uuid.New(), uuid.New()
	m1, m2 := uuid.New(), uuid.New()

	mock.ExpectQuery(listEquipmentPrintersForTenantSQLPattern).
		WithArgs(tenantID).
		WillReturnRows(pgxmock.NewRows([]string{"id", "machine_id", "class", "kind", "display_name", "config", "hostname"}).
			AddRow(dev1, m1, "printer", "network", "Entrance", json.RawMessage(`{"agent_name":"z1","ip":"10.0.0.5","port":9100}`), "kiosk-1").
			AddRow(dev2, m2, "printer", "network", "Hall B", json.RawMessage(`{"agent_name":"z2","ip":"10.0.0.6","port":9100,"dpi":300}`), "kiosk-2"))

	got, err := s.ListEquipmentPrintersForTenant(context.Background(), tenantID)
	if err != nil {
		t.Fatalf("ListEquipmentPrintersForTenant: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("len = %d, want 2", len(got))
	}
	if got[0].Device.ID != dev1 || got[0].Hostname != "kiosk-1" {
		t.Errorf("row 0 = %+v", got[0])
	}
	if got[1].Device.ID != dev2 || got[1].Hostname != "kiosk-2" {
		t.Errorf("row 1 = %+v", got[1])
	}
	if got[0].Device.TenantID != tenantID {
		t.Errorf("tenant not stamped: %+v", got[0].Device)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}
```

- [ ] **Step 2: Run to verify it fails (compile error)**

Run: `cd backend && go test ./internal/store/ -run TestListEquipmentPrintersForTenant`
Expected: FAIL — `s.ListEquipmentPrintersForTenant undefined`.

- [ ] **Step 3: Add the interface method**

In `backend/internal/store/interface.go`, add inside the `Store` interface next to `GetEquipmentDeviceForTenant` (~line 497):

```go
	// ListEquipmentPrintersForTenant returns every class=printer,
	// kind=network device across ALL of the tenant's machines, each paired
	// with its machine's hostname, for the pairing-QR CSV export. Ordered by
	// (hostname, display_name). Returns an empty (non-nil) slice when the
	// tenant has no network printers.
	ListEquipmentPrintersForTenant(ctx context.Context, tenantID uuid.UUID) ([]models.EquipmentPrinterExport, error)
```

- [ ] **Step 4: Implement in PGStore**

Append to `backend/internal/store/pg_store_equipment.go`:

```go
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
```

- [ ] **Step 5: Add the fakeStore stub (keeps handler tests compiling)**

In `backend/internal/handler/testsupport_test.go`, add a field to the `fakeStore` struct next to the other equipment func-fields:

```go
	listEquipmentPrintersForTenant func(tenantID uuid.UUID) ([]models.EquipmentPrinterExport, error)
```

and the method next to the other equipment stubs (~line 503):

```go
func (f *fakeStore) ListEquipmentPrintersForTenant(_ context.Context, tenantID uuid.UUID) ([]models.EquipmentPrinterExport, error) {
	return f.listEquipmentPrintersForTenant(tenantID)
}
```

- [ ] **Step 6: Run store + handler tests to verify pass/compile**

Run: `cd backend && go test ./internal/store/ -run TestListEquipmentPrintersForTenant -v && go build ./...`
Expected: PASS; build OK (fakeStore still satisfies `store.Store`).

- [ ] **Step 7: Commit**

```bash
git add backend/internal/store/interface.go backend/internal/store/pg_store_equipment.go backend/internal/store/pg_store_equipment_test.go backend/internal/handler/testsupport_test.go
git commit -m "feat(backend): store ListEquipmentPrintersForTenant (network printers + hostname)"
```

---

### Task 3: PNG endpoint `GET /api/equipment/devices/:device_id/pairing-qr.png`

**Files:**
- Modify: `backend/internal/handler/printer_pairing_export.go` (add slug helper + handler; expand imports)
- Modify: `backend/internal/handler/printer_pairing_export_test.go` (handler tests)
- Modify: `backend/internal/handler/handler.go` (route, after line 203)
- Modify: `backend/openapi.yaml` (path)
- Regenerate: `panel/src/shared/api/schema.d.ts`

**Interfaces:**
- Consumes: `buildPrinterQRPayload` (Task 1); `tenantIDFromContext`, `writeErr` (existing, `authz.go`); `h.Store.GetEquipmentDeviceForTenant` (existing); `qrcode.Encode` (existing dep); `newAuthedContext` (existing test helper).
- Produces: `(*Handler).GetPrinterPairingQR(c echo.Context) error`; `slugForFilename(name string, id uuid.UUID) string`.

- [ ] **Step 1: Write the failing handler tests**

Add to `backend/internal/handler/printer_pairing_export_test.go` (extend the import block to include `"net/http"`, `"strings"`, `"github.com/google/uuid"`, `"github.com/labstack/echo/v4"`):

```go
func TestGetPrinterPairingQR_NetworkDeviceReturnsPNG(t *testing.T) {
	e := echo.New()
	tenantID, deviceID := uuid.New(), uuid.New()
	fs := &fakeStore{
		getEquipmentDeviceForTenant: func(_, _ uuid.UUID) (*models.EquipmentDevice, error) {
			return &models.EquipmentDevice{
				ID: deviceID, Class: "printer", Kind: "network",
				DisplayName: "Entrance",
				Config:      json.RawMessage(`{"agent_name":"z1","ip":"10.0.0.5","port":9100}`),
			}, nil
		},
	}
	h := &Handler{Store: fs}
	c, rec := newAuthedContext(e, http.MethodGet, "/x", "", tenantID.String(), "admin")
	c.SetParamNames("device_id")
	c.SetParamValues(deviceID.String())

	if err := h.GetPrinterPairingQR(c); err != nil {
		t.Fatalf("GetPrinterPairingQR: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "image/png" {
		t.Errorf("content-type = %q, want image/png", ct)
	}
	if cd := rec.Header().Get("Content-Disposition"); !strings.Contains(cd, "Entrance-pairing-qr.png") {
		t.Errorf("content-disposition = %q", cd)
	}
	if rec.Body.Len() == 0 {
		t.Errorf("empty PNG body")
	}
}

func TestGetPrinterPairingQR_SystemPrinterIs422(t *testing.T) {
	e := echo.New()
	tenantID, deviceID := uuid.New(), uuid.New()
	fs := &fakeStore{
		getEquipmentDeviceForTenant: func(_, _ uuid.UUID) (*models.EquipmentDevice, error) {
			return &models.EquipmentDevice{
				ID: deviceID, Class: "printer", Kind: "system",
				DisplayName: "CUPS", Config: json.RawMessage(`{"agent_name":"x"}`),
			}, nil
		},
	}
	h := &Handler{Store: fs}
	c, rec := newAuthedContext(e, http.MethodGet, "/x", "", tenantID.String(), "admin")
	c.SetParamNames("device_id")
	c.SetParamValues(deviceID.String())
	if err := h.GetPrinterPairingQR(c); err != nil {
		t.Fatalf("handler err: %v", err)
	}
	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("status = %d, want 422", rec.Code)
	}
}

func TestGetPrinterPairingQR_MissingDeviceIs404(t *testing.T) {
	e := echo.New()
	tenantID, deviceID := uuid.New(), uuid.New()
	fs := &fakeStore{
		getEquipmentDeviceForTenant: func(_, _ uuid.UUID) (*models.EquipmentDevice, error) {
			return nil, nil
		},
	}
	h := &Handler{Store: fs}
	c, rec := newAuthedContext(e, http.MethodGet, "/x", "", tenantID.String(), "admin")
	c.SetParamNames("device_id")
	c.SetParamValues(deviceID.String())
	if err := h.GetPrinterPairingQR(c); err != nil {
		t.Fatalf("handler err: %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && go test ./internal/handler/ -run TestGetPrinterPairingQR`
Expected: FAIL — `h.GetPrinterPairingQR undefined`.

- [ ] **Step 3: Add the handler + slug helper**

Replace the import block of `backend/internal/handler/printer_pairing_export.go` with:

```go
import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/skip2/go-qrcode"
)
```

and append to the same file:

```go
// slugForFilename reduces a device display_name to an ASCII filename stem
// (letters/digits kept, spaces/-/_ collapsed to '-'), falling back to the
// device id when nothing printable survives — e.g. an all-Cyrillic name.
func slugForFilename(name string, id uuid.UUID) string {
	var b strings.Builder
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == ' ' || r == '-' || r == '_':
			b.WriteRune('-')
		}
	}
	slug := strings.Trim(b.String(), "-")
	if slug == "" {
		return id.String()
	}
	return slug
}

// GetPrinterPairingQR streams a PNG QR code the mobile app scans to connect
// to this network printer. Only class=printer, kind=network devices are
// eligible (422 otherwise). The QR encodes the same PrinterQRData JSON the
// CSV export's qr_payload column carries — both come from
// buildPrinterQRPayload.
func (h *Handler) GetPrinterPairingQR(c echo.Context) error {
	deviceID, err := uuid.Parse(c.Param("device_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid device ID"})
	}
	tenantID, err := tenantIDFromContext(c)
	if err != nil {
		return writeErr(c, err)
	}

	device, err := h.Store.GetEquipmentDeviceForTenant(c.Request().Context(), tenantID, deviceID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Internal error"})
	}
	if device == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Device not found"})
	}

	payload, err := buildPrinterQRPayload(*device)
	if err != nil {
		return c.JSON(http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to encode printer data"})
	}
	png, err := qrcode.Encode(string(jsonData), qrcode.Medium, 512)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to generate QR code"})
	}

	c.Response().Header().Set("Content-Disposition",
		fmt.Sprintf(`attachment; filename="%s-pairing-qr.png"`, slugForFilename(device.DisplayName, device.ID)))
	return c.Blob(http.StatusOK, "image/png", png)
}
```

Note: `errors` stays imported — it is used by Task 1's `buildPrinterQRPayload` in the same file.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && go test ./internal/handler/ -run TestGetPrinterPairingQR -v`
Expected: PASS (all three).

- [ ] **Step 5: Register the route**

In `backend/internal/handler/handler.go`, add immediately after line 203 (`api.POST("/equipment/devices/:device_id/test-passed", ...)`):

```go
	api.GET("/equipment/devices/:device_id/pairing-qr.png", h.GetPrinterPairingQR)
```

- [ ] **Step 6: Document in OpenAPI**

In `backend/openapi.yaml`, add this block in the `paths:` section right after the `/api/equipment/devices/{device_id}/test-passed:` block (which ends ~line 5658):

```yaml
  /api/equipment/devices/{device_id}/pairing-qr.png:
    get:
      operationId: getPrinterPairingQR
      summary: >
        PNG QR code the mobile app scans to connect to this network printer
        (encodes the PrinterQRData JSON). Only class=printer, kind=network
        devices are eligible.
      security: [{ bearerAuth: [] }]
      parameters:
        - name: device_id
          in: path
          required: true
          schema: { type: string, format: uuid }
      responses:
        "200":
          description: PNG image of the pairing QR.
          content:
            image/png:
              schema: { type: string, format: binary }
        "400":
          description: device_id is not a UUID.
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "404":
          description: device_id does not exist or belongs to a different tenant.
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "422":
          description: >
            Device is not a network printer (no reachable ip:port for a
            mobile pairing QR).
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "500":
          description: QR generation failed.
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
```

- [ ] **Step 7: Regenerate the panel client**

Run: `npm run generate:api -w panel`
Expected: `panel/src/shared/api/schema.d.ts` now contains the `"/api/equipment/devices/{device_id}/pairing-qr.png"` path. `cd panel && npm run typecheck` passes.

- [ ] **Step 8: Commit**

```bash
git add backend/internal/handler/printer_pairing_export.go backend/internal/handler/printer_pairing_export_test.go backend/internal/handler/handler.go backend/openapi.yaml panel/src/shared/api/schema.d.ts
git commit -m "feat(backend): pairing-qr.png endpoint for network printers"
```

---

### Task 4: CSV endpoint `GET /api/equipment/printers/pairing-export.csv`

**Files:**
- Modify: `backend/internal/handler/printer_pairing_export.go` (add handler; expand imports)
- Modify: `backend/internal/handler/printer_pairing_export_test.go` (handler tests)
- Modify: `backend/internal/handler/handler.go` (route)
- Modify: `backend/openapi.yaml` (path)
- Regenerate: `panel/src/shared/api/schema.d.ts`

**Interfaces:**
- Consumes: `buildPrinterQRPayload` (Task 1); `h.Store.ListEquipmentPrintersForTenant` (Task 2); `sanitizeCSVField` (existing, `attendee_codes.go`); `tenantIDFromContext`, `writeErr`.
- Produces: `(*Handler).ExportPrinterPairingCSV(c echo.Context) error`.

- [ ] **Step 1: Write the failing handler tests**

Add to `backend/internal/handler/printer_pairing_export_test.go` (extend imports with `"encoding/csv"`):

```go
func TestExportPrinterPairingCSV_HeaderBOMAndRow(t *testing.T) {
	e := echo.New()
	tenantID, dev1 := uuid.New(), uuid.New()
	fs := &fakeStore{
		listEquipmentPrintersForTenant: func(_ uuid.UUID) ([]models.EquipmentPrinterExport, error) {
			return []models.EquipmentPrinterExport{{
				Device: models.EquipmentDevice{
					ID: dev1, Class: "printer", Kind: "network",
					DisplayName: "Entrance",
					Config:      json.RawMessage(`{"agent_name":"z1","ip":"10.0.0.5","port":9100,"dpi":203}`),
				},
				Hostname: "kiosk-1",
			}}, nil
		},
	}
	h := &Handler{Store: fs}
	c, rec := newAuthedContext(e, http.MethodGet, "/x", "", tenantID.String(), "admin")

	if err := h.ExportPrinterPairingCSV(c); err != nil {
		t.Fatalf("ExportPrinterPairingCSV: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "text/csv" {
		t.Errorf("content-type = %q, want text/csv", ct)
	}
	body := rec.Body.String()
	if !strings.HasPrefix(body, "﻿") {
		t.Errorf("body missing UTF-8 BOM")
	}
	if !strings.Contains(body, "name,machine,printer_type,ip,port,dpi,qr_payload,device_id") {
		t.Errorf("header row missing:\n%s", body)
	}
	if !strings.Contains(body, "Entrance") || !strings.Contains(body, "kiosk-1") || !strings.Contains(body, "10.0.0.5") {
		t.Errorf("printer row missing fields:\n%s", body)
	}
}

func TestExportPrinterPairingCSV_QRPayloadRoundTrips(t *testing.T) {
	e := echo.New()
	tenantID, dev1 := uuid.New(), uuid.New()
	fs := &fakeStore{
		listEquipmentPrintersForTenant: func(_ uuid.UUID) ([]models.EquipmentPrinterExport, error) {
			return []models.EquipmentPrinterExport{{
				Device: models.EquipmentDevice{
					ID: dev1, Class: "printer", Kind: "network",
					DisplayName: "Зал А",
					Config:      json.RawMessage(`{"agent_name":"z1","ip":"10.0.0.7","port":9100}`),
				},
				Hostname: "kiosk-2",
			}}, nil
		},
	}
	h := &Handler{Store: fs}
	c, rec := newAuthedContext(e, http.MethodGet, "/x", "", tenantID.String(), "admin")
	if err := h.ExportPrinterPairingCSV(c); err != nil {
		t.Fatalf("handler: %v", err)
	}

	body := strings.TrimPrefix(rec.Body.String(), "﻿")
	records, err := csv.NewReader(strings.NewReader(body)).ReadAll()
	if err != nil {
		t.Fatalf("parse csv: %v", err)
	}
	if len(records) != 2 {
		t.Fatalf("rows = %d, want header+1", len(records))
	}
	col := map[string]int{}
	for i, name := range records[0] {
		col[name] = i
	}
	var payload models.PrinterQRData
	if err := json.Unmarshal([]byte(records[1][col["qr_payload"]]), &payload); err != nil {
		t.Fatalf("qr_payload not valid JSON: %v", err)
	}
	if payload.Type != "idento_printer" || payload.PrinterType != "ethernet" || payload.Name != "Зал А" {
		t.Errorf("payload = %+v", payload)
	}
	if payload.IP == nil || *payload.IP != "10.0.0.7" {
		t.Errorf("payload.ip = %v", payload.IP)
	}
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && go test ./internal/handler/ -run TestExportPrinterPairingCSV`
Expected: FAIL — `h.ExportPrinterPairingCSV undefined`.

- [ ] **Step 3: Add the handler**

Extend the import block of `backend/internal/handler/printer_pairing_export.go` to add `"encoding/csv"` and `"strconv"` (final import list: `encoding/csv`, `encoding/json`, `errors`, `fmt`, `net/http`, `strconv`, `strings`, `idento/backend/internal/models`, `github.com/google/uuid`, `github.com/labstack/echo/v4`, `github.com/skip2/go-qrcode`). Append the handler:

```go
// ExportPrinterPairingCSV streams a CSV of every network printer in the
// tenant's registry, one row per printer, with a ready-to-bind qr_payload
// column (the exact PrinterQRData JSON) plus the human-readable fields a
// label tool prints alongside the QR. UTF-8 BOM so Excel opens Cyrillic
// names correctly; encoding/csv escaping (the ExportAttendeesCSV precedent),
// and sanitizeCSVField against formula injection on free-text columns.
func (h *Handler) ExportPrinterPairingCSV(c echo.Context) error {
	tenantID, err := tenantIDFromContext(c)
	if err != nil {
		return writeErr(c, err)
	}

	printers, err := h.Store.ListEquipmentPrintersForTenant(c.Request().Context(), tenantID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load printers"})
	}

	var buf strings.Builder
	buf.WriteString("﻿") // UTF-8 BOM for Excel
	w := csv.NewWriter(&buf)

	if err := w.Write([]string{"name", "machine", "printer_type", "ip", "port", "dpi", "qr_payload", "device_id"}); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to write CSV header"})
	}

	for _, p := range printers {
		payload, err := buildPrinterQRPayload(p.Device)
		if err != nil {
			// A network printer with a malformed config (no ip/port) cannot
			// yield a scannable QR — skip it rather than emit a broken row.
			continue
		}
		jsonData, err := json.Marshal(payload)
		if err != nil {
			continue
		}

		ip := ""
		if payload.IP != nil {
			ip = *payload.IP
		}
		port := ""
		if payload.Port != nil {
			port = strconv.Itoa(*payload.Port)
		}
		dpi := ""
		if payload.Settings != nil && payload.Settings.DPI != nil {
			dpi = strconv.Itoa(*payload.Settings.DPI)
		}

		row := []string{
			sanitizeCSVField(p.Device.DisplayName),
			sanitizeCSVField(p.Hostname),
			"ethernet",
			sanitizeCSVField(ip),
			port,
			dpi,
			sanitizeCSVField(string(jsonData)),
			p.Device.ID.String(),
		}
		if err := w.Write(row); err != nil {
			c.Logger().Errorf("Failed to write CSV row: %v", err)
			continue
		}
	}

	w.Flush()
	if err := w.Error(); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to generate CSV"})
	}

	c.Response().Header().Set("Content-Type", "text/csv")
	c.Response().Header().Set("Content-Disposition", `attachment; filename="printers-pairing.csv"`)
	return c.String(http.StatusOK, buf.String())
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && go test ./internal/handler/ -run TestExportPrinterPairingCSV -v`
Expected: PASS (both).

- [ ] **Step 5: Register the route**

In `backend/internal/handler/handler.go`, add after the pairing-qr.png route from Task 3:

```go
	api.GET("/equipment/printers/pairing-export.csv", h.ExportPrinterPairingCSV)
```

- [ ] **Step 6: Document in OpenAPI**

In `backend/openapi.yaml`, add after the `/api/equipment/devices/{device_id}/pairing-qr.png:` block from Task 3:

```yaml
  /api/equipment/printers/pairing-export.csv:
    get:
      operationId: exportPrinterPairingCSV
      summary: >
        CSV of every network printer in the tenant's registry with a ready
        qr_payload column, for bulk label generation in an external tool.
        UTF-8 with BOM; one row per network printer.
      security: [{ bearerAuth: [] }]
      responses:
        "200":
          description: CSV (UTF-8 with BOM).
          content:
            text/csv:
              schema: { type: string }
        "403":
          description: tenant_suspended from the tenant gate.
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "500":
          description: Store failure loading printers.
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
```

- [ ] **Step 7: Regenerate the panel client + full backend suite**

Run: `npm run generate:api -w panel && cd backend && go test ./... && cd ../panel && npm run typecheck`
Expected: schema.d.ts contains both new paths; backend tests green; panel typecheck green.

- [ ] **Step 8: Commit**

```bash
git add backend/internal/handler/printer_pairing_export.go backend/internal/handler/printer_pairing_export_test.go backend/internal/handler/handler.go backend/openapi.yaml panel/src/shared/api/schema.d.ts
git commit -m "feat(backend): pairing-export.csv endpoint (all tenant network printers)"
```

---

### Task 5: Panel data layer — `pairingExport.ts`

**Files:**
- Create: `panel/src/features/equipment/pairingExport.ts`
- Create: `panel/src/features/equipment/pairingExport.test.ts`

**Interfaces:**
- Consumes: `api` (existing, `panel/src/shared/api/http.ts`) with the typed paths added in Tasks 3–4; `startMswServer` (existing, `panel/src/test/msw.ts`).
- Produces: `downloadPrinterPairingQr(deviceId: string, displayName: string): Promise<void>`; `downloadPrinterPairingCsv(): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `panel/src/features/equipment/pairingExport.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { startMswServer } from "../../test/msw";
import { downloadPrinterPairingCsv, downloadPrinterPairingQr } from "./pairingExport";

startMswServer(
  http.get("http://api.test/api/equipment/devices/:deviceId/pairing-qr.png", () =>
    HttpResponse.arrayBuffer(new Uint8Array([137, 80, 78, 71]).buffer, {
      headers: { "Content-Type": "image/png" },
    }),
  ),
  http.get(
    "http://api.test/api/equipment/printers/pairing-export.csv",
    () =>
      new HttpResponse("﻿name,machine\nEntrance,kiosk-1\n", {
        headers: { "Content-Type": "text/csv" },
      }),
  ),
);

describe("pairingExport", () => {
  let downloadName = "";

  beforeEach(() => {
    window.__ENV__ = { API_URL: "http://api.test", AGENT_URL: "http://agent.test" };
    localStorage.clear();
    localStorage.setItem("token", "jwt-test");
    downloadName = "";
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloadName = this.download;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("downloads a pairing QR PNG named from the display name", async () => {
    await downloadPrinterPairingQr("dev-123", "Entrance");
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect((URL.createObjectURL as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBeInstanceOf(Blob);
    expect(downloadName).toBe("Entrance-pairing-qr.png");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock");
  });

  it("falls back to the device id for an all-Cyrillic name", async () => {
    await downloadPrinterPairingQr("dev-xyz", "Зал А");
    expect(downloadName).toBe("dev-xyz-pairing-qr.png");
  });

  it("downloads the pairing CSV", async () => {
    await downloadPrinterPairingCsv();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(downloadName).toBe("printers-pairing.csv");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd panel && npx vitest run src/features/equipment/pairingExport.test.ts`
Expected: FAIL — cannot resolve `./pairingExport`.

- [ ] **Step 3: Implement the module**

Create `panel/src/features/equipment/pairingExport.ts`:

```ts
import { api } from "../../shared/api/http";

// Blob -> save-to-disk side effect (temporary anchor click). Mirrors
// attendees/exportCsv.ts's downloadCsv mechanics but takes an already-built
// Blob so it can carry authed bytes (PNG or CSV) fetched from the API rather
// than a client-built string. Never navigates or window.open()s.
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

// filenameStem reduces a printer display name to an ASCII filename stem,
// falling back to the id when nothing printable survives (e.g. a fully
// Cyrillic name) — the client-side twin of the backend's slugForFilename,
// needed because a manual anchor download ignores the server's
// Content-Disposition filename.
function filenameStem(name: string, deviceId: string): string {
  const slug = name.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || deviceId;
}

// downloadPrinterPairingQr fetches one network printer's pairing-QR PNG
// through the authed api client (Bearer token via http.ts middleware) and
// saves it. Throws ApiError (errors middleware) on a non-2xx response.
export async function downloadPrinterPairingQr(deviceId: string, displayName: string): Promise<void> {
  const { data } = await api.GET("/api/equipment/devices/{device_id}/pairing-qr.png", {
    params: { path: { device_id: deviceId } },
    parseAs: "blob",
  });
  if (!data) throw new Error("Empty pairing-QR response");
  saveBlob(data, `${filenameStem(displayName, deviceId)}-pairing-qr.png`);
}

// downloadPrinterPairingCsv fetches the tenant's network-printer pairing CSV
// (all printers) through the authed api client and saves it.
export async function downloadPrinterPairingCsv(): Promise<void> {
  const { data } = await api.GET("/api/equipment/printers/pairing-export.csv", {
    parseAs: "blob",
  });
  if (!data) throw new Error("Empty pairing-CSV response");
  saveBlob(data, "printers-pairing.csv");
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd panel && npx vitest run src/features/equipment/pairingExport.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add panel/src/features/equipment/pairingExport.ts panel/src/features/equipment/pairingExport.test.ts
git commit -m "feat(panel): pairingExport — authed download of printer QR PNG + CSV"
```

---

### Task 6: Panel UI — per-printer QR action + hub CSV export button

**Files:**
- Modify: `panel/src/features/equipment/DeviceCard.tsx` (new optional prop + network-gated menu item)
- Modify: `panel/src/features/equipment/EquipmentPage.tsx` (wire prop, add header Export button)
- Modify: `panel/src/shared/i18n/en.json` and `panel/src/shared/i18n/ru.json` (2 keys each)
- Modify: `panel/src/features/equipment/EquipmentPage.test.tsx` (UI wiring tests)

**Interfaces:**
- Consumes: `downloadPrinterPairingQr`, `downloadPrinterPairingCsv` (Task 5); existing `DeviceCard` props/patterns; existing `printerRows`/`printerLive()` fixture in the test.
- Produces: `DeviceCardProps.onDownloadPairingQr?: (device: EquipmentDevice) => void`.

- [ ] **Step 1: Write the failing UI tests**

At the TOP of `panel/src/features/equipment/EquipmentPage.test.tsx` (module scope, before other imports of `./EquipmentPage` run), mock the data layer, then add tests inside the existing `describe`:

```tsx
// --- add near the top imports ---
import { downloadPrinterPairingCsv, downloadPrinterPairingQr } from "./pairingExport";

vi.mock("./pairingExport", () => ({
  downloadPrinterPairingQr: vi.fn(),
  downloadPrinterPairingCsv: vi.fn(),
}));
```

```tsx
// --- add inside the existing describe(...) block ---
it("enables Export printers and downloads the CSV when a network printer exists", async () => {
  const printer = printerLive(); // kind: "network" fixture
  machineDevices = [printer];
  renderPage();

  const exportBtn = await screen.findByRole("button", { name: "Export printers (CSV)" });
  expect(exportBtn).toBeEnabled();

  await userEvent.click(exportBtn);
  expect(downloadPrinterPairingCsv).toHaveBeenCalledTimes(1);
});

it("disables Export printers when there is no network printer", async () => {
  machineDevices = [scannerWedge()];
  renderPage();
  const exportBtn = await screen.findByRole("button", { name: "Export printers (CSV)" });
  expect(exportBtn).toBeDisabled();
});

it("downloads a pairing QR from a network printer's row menu", async () => {
  const printer = printerLive();
  machineDevices = [printer];
  renderPage();

  await userEvent.click(
    await screen.findByRole("button", { name: `More actions for ${printer.display_name}` }),
  );
  await userEvent.click(await screen.findByText("Download pairing QR"));

  expect(downloadPrinterPairingQr).toHaveBeenCalledWith(printer.id, printer.display_name);
});
```

(If `scannerWedge` is not already a fixture in this file, reuse whichever existing scanner fixture the file defines; the point is a device with `kind !== "network"`.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd panel && npx vitest run src/features/equipment/EquipmentPage.test.tsx`
Expected: FAIL — no "Export printers (CSV)" button / no "Download pairing QR" menu item.

- [ ] **Step 3: Add the DeviceCard prop + menu item**

In `panel/src/features/equipment/DeviceCard.tsx`, add to `DeviceCardProps` (near `onEditAddress?`):

```tsx
  onDownloadPairingQr?: (device: EquipmentDevice) => void;
```

Add it to the component's destructured props, then add this menu item in the `DropdownMenuContent`, immediately after the network-gated "Edit address" item:

```tsx
                          {onDownloadPairingQr && device.kind === "network" ? (
                            <DropdownMenuItem onSelect={() => onDownloadPairingQr(device)}>
                              {t("equipmentDownloadPairingQr")}
                            </DropdownMenuItem>
                          ) : null}
```

- [ ] **Step 4: Wire EquipmentPage + add the Export button**

In `panel/src/features/equipment/EquipmentPage.tsx`:

Add the import:

```tsx
import { downloadPrinterPairingCsv, downloadPrinterPairingQr } from "./pairingExport";
```

Just after `printerRows` is computed, derive the gate:

```tsx
  const hasNetworkPrinter = printerRows.some((row) => row.device.kind === "network");
```

Replace the header's `<div className="ml-auto">` wrapper (around the Add-device dropdown) with a flex row that also holds the Export button:

```tsx
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={!hasNetworkPrinter}
            onClick={() => {
              void downloadPrinterPairingCsv();
            }}
          >
            {t("equipmentExportPrinters")}
          </Button>
          <DropdownMenu>
            {/* ...existing Add-device dropdown unchanged... */}
          </DropdownMenu>
        </div>
```

Pass the per-device handler to the printers `DeviceCard` (add the prop to the `testId="equipment-printers-card"` instance only):

```tsx
        onDownloadPairingQr={(device) => {
          void downloadPrinterPairingQr(device.id, device.display_name);
        }}
```

- [ ] **Step 5: Add i18n keys**

In `panel/src/shared/i18n/en.json`, in the equipment key block:

```json
  "equipmentDownloadPairingQr": "Download pairing QR",
  "equipmentExportPrinters": "Export printers (CSV)",
```

In `panel/src/shared/i18n/ru.json`, same keys:

```json
  "equipmentDownloadPairingQr": "Скачать QR подключения",
  "equipmentExportPrinters": "Экспорт принтеров (CSV)",
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd panel && npx vitest run src/features/equipment/EquipmentPage.test.tsx src/shared/i18n/keyParity.test.ts`
Expected: PASS (new UI tests + i18n parity green).

- [ ] **Step 7: Full panel gate + commit**

Run: `cd panel && npm run typecheck && npx vitest run src/features/equipment`
Expected: typecheck clean; equipment suite green.

```bash
git add panel/src/features/equipment/DeviceCard.tsx panel/src/features/equipment/EquipmentPage.tsx panel/src/features/equipment/EquipmentPage.test.tsx panel/src/shared/i18n/en.json panel/src/shared/i18n/ru.json
git commit -m "feat(panel): equipment hub — download pairing QR + export printers CSV"
```

---

## Self-Review

**Spec coverage:**
- Source = registry ethernet printers, tenant-wide → Task 2 store query (`class='printer' AND kind='network'`, tenant-scoped). ✓
- PNG per printer → Task 3. ✓
- CSV of all → Task 4, columns exactly `name, machine, printer_type, ip, port, dpi, qr_payload, device_id` per spec table. ✓
- Single-source-of-truth invariant (`qr_payload` == PNG payload) → `buildPrinterQRPayload` (Task 1), asserted by the round-trip test (Task 4 Step 1). ✓
- CSV format: UTF-8 BOM, stdlib `encoding/csv`, no new deps → Task 4. ✓
- Panel: per-network-printer action + hub button, i18n RU/EN, authed download → Tasks 5–6. ✓
- Edge cases: non-network → 422 (Task 3), missing → 404 (Task 3), malformed/no-ip row skipped in CSV (Task 4), all-Cyrillic filename fallback (Task 3 backend slug + Task 5 client stem), no network printers → disabled button (Task 6). ✓
- Gotchas: openapi regen after every yaml edit (Tasks 3 & 4 Step 7), branch not main (Global Constraints). ✓

**Out of scope (unchanged, per spec):** Bluetooth/CUPS printers, in-agent label printing, xlsx, mobile scan flow.

**Type consistency:** `buildPrinterQRPayload(models.EquipmentDevice) (models.PrinterQRData, error)`, `ListEquipmentPrintersForTenant(...) ([]models.EquipmentPrinterExport, error)`, and `EquipmentPrinterExport{Device, Hostname}` are used identically across store, handler, fakeStore, and tests. Panel: `downloadPrinterPairingQr(deviceId, displayName)` / `downloadPrinterPairingCsv()` match between `pairingExport.ts`, its test, and the EquipmentPage wiring/mocks.

**Placeholder scan:** none — every code step carries complete code; every run step names the command and expected result.
