package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"testing"
	"time"
)

var uuidV4Re = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func TestGenerateUUIDv4_Shape(t *testing.T) {
	a, b := generateUUIDv4(), generateUUIDv4()
	if !uuidV4Re.MatchString(a) {
		t.Fatalf("not a v4 uuid: %q", a)
	}
	if a == b {
		t.Fatalf("two calls returned the same id: %q", a)
	}
}

func TestInfoHandler_Shape(t *testing.T) {
	agentStartTime = time.Now().Add(-90 * time.Second)
	rec := httptest.NewRecorder()
	infoHandler("test-machine-id")(rec, httptest.NewRequest(http.MethodGet, "/info", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body struct {
		MachineID     string `json:"machine_id"`
		Hostname      string `json:"hostname"`
		Version       string `json:"version"`
		UptimeSeconds int64  `json:"uptime_seconds"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("not JSON: %v", err)
	}
	if body.MachineID != "test-machine-id" || body.Version != agentVersion {
		t.Fatalf("body = %+v", body)
	}
	if body.UptimeSeconds < 90 || body.UptimeSeconds > 200 {
		t.Fatalf("uptime_seconds = %d, want ~90", body.UptimeSeconds)
	}
}

func TestInfoHandler_MethodNotAllowed(t *testing.T) {
	rec := httptest.NewRecorder()
	infoHandler("id")(rec, httptest.NewRequest(http.MethodPost, "/info", nil))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", rec.Code)
	}
}

// TestLoadConfig_MissingMachineID_GeneratesAndPersists guards the upgrade
// path: an agent_config.json written before MachineID existed must gain a
// stable v4 id on the very next loadConfig() call, with every pre-existing
// field left untouched — this is the same "fixture mechanism" config_auth_test.go
// uses for AuthToken (redirect HOME to a temp dir, seed ~/.idento by hand).
func TestLoadConfig_MissingMachineID_GeneratesAndPersists(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)

	configDir := filepath.Join(homeDir, ".idento")
	if err := os.MkdirAll(configDir, 0750); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	configPath := filepath.Join(configDir, "agent_config.json")

	seed := AgentConfig{
		NetworkPrinters: []NetworkPrinterConfig{{Name: "Zebra_Office", IP: "192.168.0.245", Port: 9100}},
		ScannerPorts:    []string{"COM3"},
		DefaultPrinter:  "Zebra_Office",
		AuthToken:       "pre-existing-token",
		AllowedOrigins:  []string{"http://localhost:5173"},
	}
	seedData, err := json.Marshal(seed)
	if err != nil {
		t.Fatalf("Marshal seed: %v", err)
	}
	// Seed WITHOUT machine_id, as if written by a pre-upgrade agent binary.
	if err := os.WriteFile(configPath, seedData, 0600); err != nil {
		t.Fatalf("seed config file: %v", err)
	}

	cfg, err := loadConfig()
	if err != nil {
		t.Fatalf("loadConfig: %v", err)
	}
	if !uuidV4Re.MatchString(cfg.MachineID) {
		t.Fatalf("MachineID = %q, not a v4 uuid", cfg.MachineID)
	}

	onDisk, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	var persisted AgentConfig
	if err := json.Unmarshal(onDisk, &persisted); err != nil {
		t.Fatalf("Unmarshal persisted config: %v", err)
	}
	if persisted.MachineID != cfg.MachineID {
		t.Fatalf("file on disk MachineID = %q, want %q (loadConfig must persist)", persisted.MachineID, cfg.MachineID)
	}
	if !reflect.DeepEqual(persisted.NetworkPrinters, seed.NetworkPrinters) {
		t.Fatalf("network_printers mutated: got %+v, want %+v", persisted.NetworkPrinters, seed.NetworkPrinters)
	}
	if persisted.DefaultPrinter != seed.DefaultPrinter {
		t.Fatalf("default_printer mutated: got %q, want %q", persisted.DefaultPrinter, seed.DefaultPrinter)
	}
	if persisted.AuthToken != seed.AuthToken {
		t.Fatalf("auth_token mutated: got %q, want %q", persisted.AuthToken, seed.AuthToken)
	}
	if !reflect.DeepEqual(persisted.AllowedOrigins, seed.AllowedOrigins) {
		t.Fatalf("allowed_origins mutated: got %+v, want %+v", persisted.AllowedOrigins, seed.AllowedOrigins)
	}

	cfg2, err := loadConfig()
	if err != nil {
		t.Fatalf("loadConfig (second call): %v", err)
	}
	if cfg2.MachineID != cfg.MachineID {
		t.Fatalf("MachineID not stable across loads: first=%q second=%q", cfg.MachineID, cfg2.MachineID)
	}
}
