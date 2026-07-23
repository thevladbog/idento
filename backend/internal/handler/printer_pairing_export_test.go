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
