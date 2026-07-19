package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"idento/backend/internal/models"
	"idento/backend/internal/store"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/labstack/echo/v4"
)

// Equipment device registry (P4.3 spec §4.1): a per-tenant, per-machine
// registry of printers/scanners keyed by the agent's persisted
// machine_id. These are ORG-level resources — no requireEventOwnership
// anywhere in this file; tenant_id from tenantIDFromContext plus the
// store's WHERE tenant_id = $1 IS the ownership check (missing/foreign
// both collapse to the house 404 masking, same idiom as
// GetEventByIDForTenant/GetAttendeeByIDForTenant elsewhere).

// EquipmentMachineResponse is the response body for both PUT and GET
// /api/equipment/machines/{machine_id} — the machine root plus every
// device registered under it. Devices is always a JSON array (never
// null, including when empty) since store.GetEquipmentMachine guarantees
// a non-nil slice.
type EquipmentMachineResponse struct {
	Machine models.EquipmentMachine  `json:"machine"`
	Devices []models.EquipmentDevice `json:"devices"`
}

// EquipmentMachineUpsertRequest is the request body for PUT
// /api/equipment/machines/{machine_id}. SeenDeviceIDs additionally
// touches last_seen_at on every one of this tenant/machine's devices the
// agent's report still names as attached — a device absent from the list
// is left untouched, never deleted (store.UpsertEquipmentMachine).
type EquipmentMachineUpsertRequest struct {
	Hostname      string      `json:"hostname"`
	AgentVersion  string      `json:"agent_version"`
	SeenDeviceIDs []uuid.UUID `json:"seen_device_ids"`
}

// UpsertEquipmentMachine registers/refreshes a machine (idempotent — a
// fresh (tenant_id, machine_id) pair inserts, re-reporting the same one
// updates hostname/agent_version/last_seen_at) and returns the
// post-upsert state (the same shape as GetEquipmentMachine).
func (h *Handler) UpsertEquipmentMachine(c echo.Context) error {
	machineID, err := uuid.Parse(c.Param("machine_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid machine ID"})
	}
	tenantID, err := tenantIDFromContext(c)
	if err != nil {
		return writeErr(c, err)
	}

	var req EquipmentMachineUpsertRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	m := &models.EquipmentMachine{
		TenantID:     tenantID,
		MachineID:    machineID,
		Hostname:     req.Hostname,
		AgentVersion: req.AgentVersion,
	}
	if err := h.Store.UpsertEquipmentMachine(c.Request().Context(), m, req.SeenDeviceIDs); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to save machine"})
	}

	machine, devices, err := h.Store.GetEquipmentMachine(c.Request().Context(), tenantID, machineID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load machine"})
	}
	if machine == nil {
		// Unreachable in practice: the upsert above just wrote this exact
		// row. Treated as a store-consistency failure, not the "never
		// registered" 404 GetEquipmentMachine (the GET handler) returns.
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load machine"})
	}

	return c.JSON(http.StatusOK, EquipmentMachineResponse{Machine: *machine, Devices: devices})
}

// GetEquipmentMachine returns the machine root plus every device
// registered under it. 404 ("Machine not found") means (tenant_id,
// machine_id) has never been registered — the panel renders that as an
// empty registry, not an error state.
func (h *Handler) GetEquipmentMachine(c echo.Context) error {
	machineID, err := uuid.Parse(c.Param("machine_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid machine ID"})
	}
	tenantID, err := tenantIDFromContext(c)
	if err != nil {
		return writeErr(c, err)
	}

	machine, devices, err := h.Store.GetEquipmentMachine(c.Request().Context(), tenantID, machineID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load machine"})
	}
	if machine == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Machine not found"})
	}

	return c.JSON(http.StatusOK, EquipmentMachineResponse{Machine: *machine, Devices: devices})
}

// validKindsByClass gates class/kind pairs (spec §4.1). camera is reserved:
// accepted by the DB CHECK for forward-compat, rejected here until the
// camera cycle ships.
var validKindsByClass = map[string]map[string]bool{
	"printer": {"system": true, "network": true},
	"scanner": {"usb_wedge": true, "com": true},
}

// validWedgeTerminators enumerates the only accepted values of
// scannerConfigShape.Terminator for kind=usb_wedge.
var validWedgeTerminators = map[string]bool{
	"enter": true,
	"tab":   true,
	"none":  true,
}

// printerConfigShape is the strict shape a class=printer device's config
// must decode into (unknown fields rejected). agent_name is required for
// both kinds — the stable agent-side device identity link; ip/port are
// additionally required for kind=network only; dpi is always optional.
type printerConfigShape struct {
	AgentName string `json:"agent_name"`
	IP        string `json:"ip"`
	Port      int    `json:"port"`
	DPI       *int   `json:"dpi"`
}

// scannerConfigShape is the strict shape a class=scanner device's config
// must decode into (unknown fields rejected). port_name is required for
// kind=com; terminator is required (one of enter/tab/none) for
// kind=usb_wedge — the two kinds' fields are mutually exclusive in
// practice but share one struct, same idiom as printerConfigShape.
type scannerConfigShape struct {
	PortName   string `json:"port_name"`
	Terminator string `json:"terminator"`
}

// decodeStrictConfig decodes raw into v, rejecting unknown fields — the
// same DisallowUnknownFields idiom as checkin_settings.go's
// validateCheckinSettings. A missing/empty raw defaults to "{}" so a
// device with no config at all still runs through the same required-field
// checks (and fails them) rather than skipping validation entirely.
func decodeStrictConfig(raw json.RawMessage, v interface{}) error {
	if len(raw) == 0 {
		raw = json.RawMessage(`{}`)
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return fmt.Errorf("invalid config: %w", err)
	}
	return nil
}

// validateEquipmentDeviceConfig checks a device's raw config against the
// per-class shape rules for the given (already validated) class/kind
// pair. Shared by CreateEquipmentDevice (class/kind from the request) and
// PatchEquipmentDevice (class/kind from the existing, immutable device).
func validateEquipmentDeviceConfig(class, kind string, raw json.RawMessage) error {
	switch class {
	case "printer":
		var shape printerConfigShape
		if err := decodeStrictConfig(raw, &shape); err != nil {
			return err
		}
		if strings.TrimSpace(shape.AgentName) == "" {
			return errors.New("config.agent_name is required")
		}
		if kind == "network" {
			if strings.TrimSpace(shape.IP) == "" {
				return errors.New("config.ip is required")
			}
			if shape.Port < 1 || shape.Port > 65535 {
				return errors.New("config.port must be between 1 and 65535")
			}
		}
		return nil
	case "scanner":
		var shape scannerConfigShape
		if err := decodeStrictConfig(raw, &shape); err != nil {
			return err
		}
		if kind == "com" {
			if strings.TrimSpace(shape.PortName) == "" {
				return errors.New("config.port_name is required")
			}
			return nil
		}
		// kind == "usb_wedge" — the only other class/kind pair
		// validKindsByClass permits for scanner.
		if !validWedgeTerminators[shape.Terminator] {
			return errors.New("config.terminator must be one of enter, tab, none")
		}
		return nil
	default:
		// Unreachable: callers only invoke this once class is already
		// known to be "printer" or "scanner".
		return fmt.Errorf("unknown class %q", class)
	}
}

// EquipmentDeviceCreateRequest is the request body for POST
// /api/equipment/machines/{machine_id}/devices (spec §4.1). Config is
// stored verbatim (the request's raw bytes, unmodified) after being
// validated against a parsed COPY — checkin_settings.go's
// verbatim-storage precedent. TestPassed, when true, additionally stamps
// test_passed_at at create time.
type EquipmentDeviceCreateRequest struct {
	Class       string          `json:"class"`
	Kind        string          `json:"kind"`
	DisplayName string          `json:"display_name"`
	Config      json.RawMessage `json:"config"`
	MakeDefault bool            `json:"make_default"`
	TestPassed  bool            `json:"test_passed"`
}

// validateEquipmentDeviceCreate checks req against the P4.3 spec §4.1
// shape rules, in order: class/kind pair, display_name, make_default
// eligibility, then the per-class config shape. Returns a non-nil,
// human-readable error on the first violation found — CreateEquipmentDevice
// must never surface the equipment_devices_default_is_printer CHECK's raw
// constraint error; this pre-validation is what prevents that (Task 2
// reviewer note: the CHECK is a last-resort guard only).
func validateEquipmentDeviceCreate(req *EquipmentDeviceCreateRequest) error {
	if req.Class == "camera" {
		return errors.New("camera devices are not supported yet")
	}
	kinds, ok := validKindsByClass[req.Class]
	if !ok {
		return fmt.Errorf("unknown class %q", req.Class)
	}
	if !kinds[req.Kind] {
		return fmt.Errorf("kind %q is not valid for class %q", req.Kind, req.Class)
	}
	if strings.TrimSpace(req.DisplayName) == "" {
		return errors.New("display_name is required")
	}
	if req.MakeDefault && req.Class != "printer" {
		return errors.New("make_default is only allowed for printer devices")
	}
	return validateEquipmentDeviceConfig(req.Class, req.Kind, req.Config)
}

// CreateEquipmentDevice registers a new device under a machine. On
// success it responds 201 with the stored device — never wrapped, unlike
// the machine endpoints' {"machine":...,"devices":...} shape.
func (h *Handler) CreateEquipmentDevice(c echo.Context) error {
	machineID, err := uuid.Parse(c.Param("machine_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid machine ID"})
	}
	tenantID, err := tenantIDFromContext(c)
	if err != nil {
		return writeErr(c, err)
	}

	var req EquipmentDeviceCreateRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}
	if err := validateEquipmentDeviceCreate(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	d := &models.EquipmentDevice{
		TenantID:    tenantID,
		MachineID:   machineID,
		Class:       req.Class,
		Kind:        req.Kind,
		DisplayName: req.DisplayName,
		Config:      req.Config,
	}

	if err := h.Store.CreateEquipmentDevice(c.Request().Context(), d, req.MakeDefault); err != nil {
		// 23505 is the partial unique index (equipment_devices_one_default)
		// firing on a race with a concurrent default-printer write — the
		// pre-validation above already rejected the ordinary
		// make_default-on-non-printer mistake, so this is purely a
		// concurrency case, mapped to a clean 409, never a raw constraint
		// error.
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return c.JSON(http.StatusConflict, map[string]string{"error": "This machine already has a default printer"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create device"})
	}

	if req.TestPassed {
		if err := h.Store.MarkEquipmentDeviceTestPassed(c.Request().Context(), tenantID, d.ID); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to record test result"})
		}
		now := time.Now().UTC()
		d.TestPassedAt = &now
	}

	return c.JSON(http.StatusCreated, d)
}

// EquipmentDevicePatchRequest is the request body for PATCH
// /api/equipment/devices/{device_id}. Both fields are optional — an
// omitted field keeps the device's current value; class/kind/machine_id
// are immutable and not settable here. When Config IS supplied it is
// validated against the device's EXISTING class/kind (fetched first),
// the same per-class shape rules as EquipmentDeviceCreateRequest.Config.
type EquipmentDevicePatchRequest struct {
	DisplayName *string         `json:"display_name"`
	Config      json.RawMessage `json:"config"`
}

// PatchEquipmentDevice renames a device and/or replaces its config.
func (h *Handler) PatchEquipmentDevice(c echo.Context) error {
	deviceID, err := uuid.Parse(c.Param("device_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid device ID"})
	}
	tenantID, err := tenantIDFromContext(c)
	if err != nil {
		return writeErr(c, err)
	}

	// Ownership/existence first (BadgeTemplate/CheckinSettings precedent):
	// a foreign/missing device must 404 here, not surface later as a
	// misleading 500 from the guarded UPDATE's silent no-op — and
	// class/kind must be known up front so a supplied config can be
	// validated against them.
	existing, err := h.Store.GetEquipmentDeviceForTenant(c.Request().Context(), tenantID, deviceID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Internal error"})
	}
	if existing == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Device not found"})
	}

	var req EquipmentDevicePatchRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	displayName := existing.DisplayName
	if req.DisplayName != nil {
		if strings.TrimSpace(*req.DisplayName) == "" {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "display_name must not be empty"})
		}
		displayName = *req.DisplayName
	}

	config := existing.Config
	if len(req.Config) > 0 {
		if err := validateEquipmentDeviceConfig(existing.Class, existing.Kind, req.Config); err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
		}
		config = req.Config
	}

	if err := h.Store.UpdateEquipmentDevice(c.Request().Context(), tenantID, deviceID, displayName, config); err != nil {
		if errors.Is(err, store.ErrDeviceNotFound) {
			// Reachable only via a concurrent-delete race after the
			// existence check above passed — same masking as every other
			// *NotFound sentinel in this package.
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Device not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update device"})
	}

	existing.DisplayName = displayName
	existing.Config = config
	existing.UpdatedAt = time.Now().UTC()
	return c.JSON(http.StatusOK, existing)
}

// DeleteEquipmentDevice removes a device outright. No special-case
// handling for "was this the default printer" — it is simply gone, and
// the spec forbids silently promoting another device to default.
func (h *Handler) DeleteEquipmentDevice(c echo.Context) error {
	deviceID, err := uuid.Parse(c.Param("device_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid device ID"})
	}
	tenantID, err := tenantIDFromContext(c)
	if err != nil {
		return writeErr(c, err)
	}

	if err := h.Store.DeleteEquipmentDevice(c.Request().Context(), tenantID, deviceID); err != nil {
		if errors.Is(err, store.ErrDeviceNotFound) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Device not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to delete device"})
	}

	return c.NoContent(http.StatusNoContent)
}

// EquipmentDefaultPrinterRequest is both the request body for PUT
// /api/equipment/machines/{machine_id}/default-printer and its 200
// response shape (it echoes back what was set). DeviceID = nil clears
// the machine's default printer with no replacement; a non-nil DeviceID
// must be an existing class=printer device of THIS machine (404
// otherwise — store.ErrDeviceNotFound).
type EquipmentDefaultPrinterRequest struct {
	DeviceID *uuid.UUID `json:"device_id"`
}

// PutDefaultEquipmentPrinter repoints (or clears) the machine's default
// printer.
func (h *Handler) PutDefaultEquipmentPrinter(c echo.Context) error {
	machineID, err := uuid.Parse(c.Param("machine_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid machine ID"})
	}
	tenantID, err := tenantIDFromContext(c)
	if err != nil {
		return writeErr(c, err)
	}

	var req EquipmentDefaultPrinterRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	if err := h.Store.SetDefaultEquipmentPrinter(c.Request().Context(), tenantID, machineID, req.DeviceID); err != nil {
		if errors.Is(err, store.ErrDeviceNotFound) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Device not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to set default printer"})
	}

	return c.JSON(http.StatusOK, EquipmentDefaultPrinterRequest{DeviceID: req.DeviceID})
}

// MarkEquipmentDeviceTestPassed stamps test_passed_at = now() on a
// successful test-print/test-scan (the panel wizard's "Test" step).
func (h *Handler) MarkEquipmentDeviceTestPassed(c echo.Context) error {
	deviceID, err := uuid.Parse(c.Param("device_id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid device ID"})
	}
	tenantID, err := tenantIDFromContext(c)
	if err != nil {
		return writeErr(c, err)
	}

	if err := h.Store.MarkEquipmentDeviceTestPassed(c.Request().Context(), tenantID, deviceID); err != nil {
		if errors.Is(err, store.ErrDeviceNotFound) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Device not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to record test result"})
	}

	return c.NoContent(http.StatusNoContent)
}
