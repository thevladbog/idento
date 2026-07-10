package main

import (
	"os"
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
