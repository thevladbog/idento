package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestGenerateAuthToken(t *testing.T) {
	tok, err := generateAuthToken()
	if err != nil {
		t.Fatalf("generateAuthToken: %v", err)
	}
	if len(tok) != 64 { // 32 bytes hex
		t.Fatalf("want 64 hex chars, got %d (%q)", len(tok), tok)
	}
	tok2, _ := generateAuthToken()
	if tok == tok2 {
		t.Fatal("tokens must be random, got duplicate")
	}
}

func TestEnsureAuthToken(t *testing.T) {
	cfg := &AgentConfig{}
	changed, err := ensureAuthToken(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if !changed || cfg.AuthToken == "" {
		t.Fatalf("expected a token to be generated, changed=%v token=%q", changed, cfg.AuthToken)
	}
	// idempotent: second call keeps the existing token
	prev := cfg.AuthToken
	changed2, _ := ensureAuthToken(cfg)
	if changed2 || cfg.AuthToken != prev {
		t.Fatalf("second call must not change token")
	}
}

func TestResolveAllowedOrigins_Default(t *testing.T) {
	os.Unsetenv("AGENT_ALLOWED_ORIGINS")
	got := resolveAllowedOrigins(&AgentConfig{})
	if len(got) != 3 || got[0] != "http://localhost:5173" {
		t.Fatalf("unexpected default origins: %v", got)
	}
}

func TestResolveAllowedOrigins_EnvOverride(t *testing.T) {
	t.Setenv("AGENT_ALLOWED_ORIGINS", "https://app.example.com, https://kiosk.example.com ")
	got := resolveAllowedOrigins(&AgentConfig{})
	if len(got) != 2 || got[0] != "https://app.example.com" || got[1] != "https://kiosk.example.com" {
		t.Fatalf("env override not parsed: %v", got)
	}
}

// TestResolveAllowedOrigins_EnvExplicitlyEmpty ensures an operator can
// disable browser Origin auth entirely via AGENT_ALLOWED_ORIGINS="" — the env
// var being *present but empty* must not fall through to the dev defaults.
func TestResolveAllowedOrigins_EnvExplicitlyEmpty(t *testing.T) {
	t.Setenv("AGENT_ALLOWED_ORIGINS", "")
	got := resolveAllowedOrigins(&AgentConfig{})
	if len(got) != 0 {
		t.Fatalf("explicit empty env override must yield no origins, got: %v", got)
	}
}

// TestResolveAllowedOrigins_ConfigExplicitlyEmpty ensures a config file with
// allowed_origins: [] (a non-nil empty slice) is honored as-is and does not
// fall through to the dev defaults.
func TestResolveAllowedOrigins_ConfigExplicitlyEmpty(t *testing.T) {
	os.Unsetenv("AGENT_ALLOWED_ORIGINS")
	got := resolveAllowedOrigins(&AgentConfig{AllowedOrigins: []string{}})
	if len(got) != 0 {
		t.Fatalf("explicit empty config allowlist must yield no origins, got: %v", got)
	}
}

// TestResolveAllowedOrigins_ConfigNilFallsBackToDefaults ensures an absent
// allowed_origins key (nil slice) with no env override still yields the dev
// defaults, matching TestResolveAllowedOrigins_Default.
func TestResolveAllowedOrigins_ConfigNilFallsBackToDefaults(t *testing.T) {
	os.Unsetenv("AGENT_ALLOWED_ORIGINS")
	got := resolveAllowedOrigins(&AgentConfig{AllowedOrigins: nil})
	if len(got) != 3 || got[0] != "http://localhost:5173" {
		t.Fatalf("unexpected origins for nil config allowlist: %v", got)
	}
}

// TestSaveConfig_ForcesMode0600OnPreExistingFile guards against the bearer
// token becoming group/world-readable: os.Root.WriteFile does not change the
// mode of an existing file, so a pre-existing looser-perm config file must be
// explicitly chmod'd back to 0600 after every save.
func TestSaveConfig_ForcesMode0600OnPreExistingFile(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)

	configDir := filepath.Join(homeDir, ".idento")
	if err := os.MkdirAll(configDir, 0750); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	configPath := filepath.Join(configDir, "agent_config.json")
	// Pre-create the file with an overly permissive mode, as if it were
	// created before 0600 enforcement existed (or hand-edited by an operator).
	if err := os.WriteFile(configPath, []byte(`{}`), 0644); err != nil {
		t.Fatalf("seed config file: %v", err)
	}

	if err := saveConfig(&AgentConfig{AuthToken: "secret-token"}); err != nil {
		t.Fatalf("saveConfig: %v", err)
	}

	info, err := os.Stat(configPath)
	if err != nil {
		t.Fatalf("Stat: %v", err)
	}
	if got := info.Mode().Perm(); got != 0600 {
		t.Fatalf("want mode 0600 on pre-existing config file after save, got %o", got)
	}
}
