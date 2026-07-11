package config

import "testing"

func setRequiredEnv(t *testing.T) {
	t.Helper()
	t.Setenv("DATABASE_URL", "postgres://u:p@localhost:5432/db")
	t.Setenv("JWT_SECRET", "test-secret")
	t.Setenv("CORS_ALLOWED_ORIGINS", "http://localhost:5173, http://localhost:5174")
}

func TestLoadDefaults(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("PORT", "")
	t.Setenv("DEPLOYMENT_MODE", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if cfg.Port != "8008" {
		t.Errorf("Port = %q, want 8008", cfg.Port)
	}
	if cfg.DeploymentMode != ModeOnPrem {
		t.Errorf("DeploymentMode = %q, want %q", cfg.DeploymentMode, ModeOnPrem)
	}
	if len(cfg.CORSAllowedOrigins) != 2 || cfg.CORSAllowedOrigins[1] != "http://localhost:5174" {
		t.Errorf("CORSAllowedOrigins = %v, want two trimmed origins", cfg.CORSAllowedOrigins)
	}
}

func TestLoadRejectsMissingRequired(t *testing.T) {
	for _, missing := range []string{"DATABASE_URL", "JWT_SECRET", "CORS_ALLOWED_ORIGINS"} {
		t.Run(missing, func(t *testing.T) {
			setRequiredEnv(t)
			t.Setenv(missing, "")
			if _, err := Load(); err == nil {
				t.Fatalf("Load() succeeded with %s unset, want error", missing)
			}
		})
	}
}

func TestLoadRejectsInvalidMode(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("DEPLOYMENT_MODE", "cloud")
	if _, err := Load(); err == nil {
		t.Fatal("Load() succeeded with DEPLOYMENT_MODE=cloud, want error")
	}
}

func TestJWTSecretFallsBackToEnv(t *testing.T) {
	current = nil // package not loaded
	t.Setenv("JWT_SECRET", "env-secret")
	if got := JWTSecret(); got != "env-secret" {
		t.Errorf("JWTSecret() = %q, want env-secret", got)
	}
}

func TestLoadReadsAdminOrgNameWithoutDefaulting(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("IDENTO_ORG_NAME", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if cfg.AdminOrgName != "" {
		t.Errorf("AdminOrgName = %q, want empty (Load must not apply the bootstrap default)", cfg.AdminOrgName)
	}

	t.Setenv("IDENTO_ORG_NAME", "Acme Events")
	cfg, err = Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if cfg.AdminOrgName != "Acme Events" {
		t.Errorf("AdminOrgName = %q, want %q", cfg.AdminOrgName, "Acme Events")
	}
}
