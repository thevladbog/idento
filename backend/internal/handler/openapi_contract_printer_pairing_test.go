package handler

import (
	"encoding/json"
	"net/http"
	"testing"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// Contract tests for the printer pairing-export endpoints. These call
// validateResponse so the OPENAPI_COVERAGE=1 gate (openapi_contract_test.go's
// TestMain) sees both operations exercised against backend/openapi.yaml —
// the same house pattern as openapi_contract_equipment_p4_test.go.

// --- path helpers ---

func printerPairingQRPath(deviceID uuid.UUID) string {
	return "/api/equipment/devices/" + deviceID.String() + "/pairing-qr.png"
}

func setPrinterPairingQRPathParams(c echo.Context, deviceID uuid.UUID) {
	c.SetPath("/api/equipment/devices/:device_id/pairing-qr.png")
	c.SetParamNames("device_id")
	c.SetParamValues(deviceID.String())
}

const printerPairingExportPath = "/api/equipment/printers/pairing-export.csv"

// --- GET /api/equipment/devices/{device_id}/pairing-qr.png ---

func TestOpenAPIContract_GetPrinterPairingQR_200PNG(t *testing.T) {
	tenantID := uuid.New()
	deviceID := uuid.New()

	h := New(&fakeStore{
		getEquipmentDeviceForTenant: func(tid, did uuid.UUID) (*models.EquipmentDevice, error) {
			if tid != tenantID || did != deviceID {
				t.Fatalf("scoping mismatch: %s/%s", tid, did)
			}
			return &models.EquipmentDevice{
				ID: deviceID, TenantID: tenantID, Class: "printer", Kind: "network",
				DisplayName: "Zebra ZD421",
				Config:      json.RawMessage(`{"agent_name":"Zebra ZD421","ip":"192.168.1.44","port":9100}`),
			}, nil
		},
	})

	e := echo.New()
	path := printerPairingQRPath(deviceID)
	c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "staff")
	setPrinterPairingQRPathParams(c, deviceID)

	if err := h.GetPrinterPairingQR(c); err != nil {
		t.Fatalf("GetPrinterPairingQR: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "image/png" {
		t.Fatalf("content-type = %q, want image/png", ct)
	}

	validateResponse(t, http.MethodGet, path, rec)
}

func TestOpenAPIContract_GetPrinterPairingQR_NonNetwork422(t *testing.T) {
	tenantID := uuid.New()
	deviceID := uuid.New()

	h := New(&fakeStore{
		getEquipmentDeviceForTenant: func(uuid.UUID, uuid.UUID) (*models.EquipmentDevice, error) {
			return &models.EquipmentDevice{
				ID: deviceID, TenantID: tenantID, Class: "printer", Kind: "system",
				DisplayName: "CUPS Printer", Config: json.RawMessage(`{"agent_name":"CUPS Printer"}`),
			}, nil
		},
	})

	e := echo.New()
	path := printerPairingQRPath(deviceID)
	c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "staff")
	setPrinterPairingQRPathParams(c, deviceID)

	if err := h.GetPrinterPairingQR(c); err != nil {
		t.Fatalf("GetPrinterPairingQR: %v", err)
	}
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("want 422, got %d, body=%s", rec.Code, rec.Body.String())
	}

	validateResponse(t, http.MethodGet, path, rec)
}

func TestOpenAPIContract_GetPrinterPairingQR_Missing404(t *testing.T) {
	tenantID := uuid.New()
	deviceID := uuid.New()

	h := New(&fakeStore{
		getEquipmentDeviceForTenant: func(uuid.UUID, uuid.UUID) (*models.EquipmentDevice, error) {
			return nil, nil
		},
	})

	e := echo.New()
	path := printerPairingQRPath(deviceID)
	c, rec := newAuthedContext(e, http.MethodGet, path, "", tenantID.String(), "staff")
	setPrinterPairingQRPathParams(c, deviceID)

	if err := h.GetPrinterPairingQR(c); err != nil {
		t.Fatalf("GetPrinterPairingQR: %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d, body=%s", rec.Code, rec.Body.String())
	}

	validateResponse(t, http.MethodGet, path, rec)
}

// --- GET /api/equipment/printers/pairing-export.csv ---

func TestOpenAPIContract_ExportPrinterPairingCSV_200(t *testing.T) {
	tenantID := uuid.New()
	deviceID := uuid.New()
	machineID := uuid.New()

	h := New(&fakeStore{
		listEquipmentPrintersForTenant: func(tid uuid.UUID) ([]models.EquipmentPrinterExport, error) {
			if tid != tenantID {
				t.Fatalf("scoping = %s, want %s", tid, tenantID)
			}
			return []models.EquipmentPrinterExport{{
				Device: models.EquipmentDevice{
					ID: deviceID, TenantID: tenantID, MachineID: machineID,
					Class: "printer", Kind: "network", DisplayName: "Zebra ZD421",
					Config: json.RawMessage(`{"agent_name":"Zebra ZD421","ip":"192.168.1.44","port":9100}`),
				},
				Hostname: "REG-1",
			}}, nil
		},
	})

	e := echo.New()
	c, rec := newAuthedContext(e, http.MethodGet, printerPairingExportPath, "", tenantID.String(), "staff")

	if err := h.ExportPrinterPairingCSV(c); err != nil {
		t.Fatalf("ExportPrinterPairingCSV: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "text/csv" {
		t.Fatalf("content-type = %q, want text/csv", ct)
	}

	validateResponse(t, http.MethodGet, printerPairingExportPath, rec)
}
