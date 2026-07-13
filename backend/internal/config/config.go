// Package config is the single source of runtime configuration for the
// backend. All environment variables are read here and nowhere else.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Deployment modes. OnPrem is the default: a binary running outside our
// infrastructure must not expose SaaS surfaces unless explicitly configured.
const (
	ModeSaaS   = "saas"
	ModeOnPrem = "onprem"
)

// Config holds validated runtime configuration.
type Config struct {
	DatabaseURL        string
	JWTSecret          string
	CORSAllowedOrigins []string
	Port               string
	DeploymentMode     string
	AdminEmail         string // on-prem bootstrap
	AdminPassword      string // on-prem bootstrap
	AdminOrgName       string // on-prem bootstrap; empty means "apply the default at bootstrap time"
	// TenantRetentionDays is how long an archived tenant is kept before the
	// purge job deletes it permanently. 0 disables auto-purge.
	TenantRetentionDays int
}

var current *Config

// Load reads and validates configuration from the environment and stores it
// for package-level accessors. Call once at startup, before serving.
func Load() (*Config, error) {
	cfg := &Config{
		DatabaseURL:    os.Getenv("DATABASE_URL"),
		JWTSecret:      os.Getenv("JWT_SECRET"),
		Port:           os.Getenv("PORT"),
		DeploymentMode: os.Getenv("DEPLOYMENT_MODE"),
		AdminEmail:     os.Getenv("IDENTO_ADMIN_EMAIL"),
		AdminPassword:  os.Getenv("IDENTO_ADMIN_PASSWORD"),
		AdminOrgName:   os.Getenv("IDENTO_ORG_NAME"),
	}

	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is not set (copy .env.example to .env for local development)")
	}
	if cfg.JWTSecret == "" {
		return nil, fmt.Errorf("JWT_SECRET is not set — refusing to start (set it in .env / environment)")
	}
	for _, o := range strings.Split(os.Getenv("CORS_ALLOWED_ORIGINS"), ",") {
		if trimmed := strings.TrimSpace(o); trimmed != "" {
			cfg.CORSAllowedOrigins = append(cfg.CORSAllowedOrigins, trimmed)
		}
	}
	if len(cfg.CORSAllowedOrigins) == 0 {
		return nil, fmt.Errorf("CORS_ALLOWED_ORIGINS is not set — refusing to start (see .env.example)")
	}
	if cfg.Port == "" {
		cfg.Port = "8008"
	}
	switch cfg.DeploymentMode {
	case "":
		cfg.DeploymentMode = ModeOnPrem
	case ModeSaaS, ModeOnPrem:
	default:
		return nil, fmt.Errorf("DEPLOYMENT_MODE must be %q or %q, got %q", ModeSaaS, ModeOnPrem, cfg.DeploymentMode)
	}

	switch raw := os.Getenv("TENANT_RETENTION_DAYS"); raw {
	case "":
		cfg.TenantRetentionDays = 90
	default:
		n, err := strconv.Atoi(raw)
		if err != nil || n < 0 {
			return nil, fmt.Errorf("TENANT_RETENTION_DAYS must be a non-negative integer (0 disables auto-purge), got %q", raw)
		}
		cfg.TenantRetentionDays = n
	}

	current = cfg
	return cfg, nil
}

// JWTSecret returns the loaded JWT secret. Before Load (unit tests that
// exercise handlers directly) it falls back to the environment variable.
func JWTSecret() string {
	if current != nil {
		return current.JWTSecret
	}
	return os.Getenv("JWT_SECRET")
}
