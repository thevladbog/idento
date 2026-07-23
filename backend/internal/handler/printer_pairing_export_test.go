package handler

import (
	"encoding/csv"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"idento/backend/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
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
	if !strings.HasPrefix(body, "\ufeff") {
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

	body := strings.TrimPrefix(rec.Body.String(), "\ufeff")
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
