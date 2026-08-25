// Package config is the single source of runtime configuration for the
// backend. All environment variables are read here and nowhere else.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
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
	// SubscriptionLifecycleInterval is how often (SaaS mode only) the
	// lifecycle ticker checks for overdue trial/active subscriptions to
	// expire. 0 disables the ticker.
	SubscriptionLifecycleInterval time.Duration
	// Seller requisites for RF invoices ("сумма прописью" / «Продавец»
	// block). All optional at Load time; BillingSellerConfigured reports
	// whether enough are set to render an invoice.
	BillingSellerName            string // BILLING_SELLER_NAME
	BillingSellerINN             string // BILLING_SELLER_INN
	BillingSellerBankName        string // BILLING_SELLER_BANK_NAME
	BillingSellerBankAccount     string // BILLING_SELLER_BANK_ACCOUNT (р/с)
	BillingSellerBankBIK         string // BILLING_SELLER_BANK_BIK
	BillingSellerBankCorrAccount string // BILLING_SELLER_BANK_CORR_ACCOUNT (к/с, optional)
}

// BillingSellerConfigured reports whether all required seller requisites are
// set. The correspondent account (к/с) is optional — not every bank
// relationship uses one.
func (c *Config) BillingSellerConfigured() bool {
	return c.BillingSellerName != "" &&
		c.BillingSellerINN != "" &&
		c.BillingSellerBankName != "" &&
		c.BillingSellerBankAccount != "" &&
		c.BillingSellerBankBIK != ""
}

// SellerRequisites is the seller ("Продавец") block rendered on RF invoices.
type SellerRequisites struct {
	Name            string
	INN             string
	BankName        string
	BankAccount     string
	BankBIK         string
	BankCorrAccount string
	Configured      bool
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

		BillingSellerName:            os.Getenv("BILLING_SELLER_NAME"),
		BillingSellerINN:             os.Getenv("BILLING_SELLER_INN"),
		BillingSellerBankName:        os.Getenv("BILLING_SELLER_BANK_NAME"),
		BillingSellerBankAccount:     os.Getenv("BILLING_SELLER_BANK_ACCOUNT"),
		BillingSellerBankBIK:         os.Getenv("BILLING_SELLER_BANK_BIK"),
		BillingSellerBankCorrAccount: os.Getenv("BILLING_SELLER_BANK_CORR_ACCOUNT"),
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

	switch raw := os.Getenv("SUBSCRIPTION_LIFECYCLE_INTERVAL"); raw {
	case "":
		cfg.SubscriptionLifecycleInterval = time.Hour
	case "0":
		cfg.SubscriptionLifecycleInterval = 0
	default:
		d, err := time.ParseDuration(raw)
		if err != nil || d < 0 {
			return nil, fmt.Errorf("SUBSCRIPTION_LIFECYCLE_INTERVAL must be a Go duration (e.g. 1h) or 0 to disable, got %q", raw)
		}
		cfg.SubscriptionLifecycleInterval = d
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

// Seller returns the loaded config's seller requisites block for invoice
// handlers. Before Load (unit tests that exercise handlers directly) it
// falls back to direct environment reads, mirroring JWTSecret().
func Seller() SellerRequisites {
	if current != nil {
		return SellerRequisites{
			Name:            current.BillingSellerName,
			INN:             current.BillingSellerINN,
			BankName:        current.BillingSellerBankName,
			BankAccount:     current.BillingSellerBankAccount,
			BankBIK:         current.BillingSellerBankBIK,
			BankCorrAccount: current.BillingSellerBankCorrAccount,
			Configured:      current.BillingSellerConfigured(),
		}
	}
	c := Config{
		BillingSellerName:            os.Getenv("BILLING_SELLER_NAME"),
		BillingSellerINN:             os.Getenv("BILLING_SELLER_INN"),
		BillingSellerBankName:        os.Getenv("BILLING_SELLER_BANK_NAME"),
		BillingSellerBankAccount:     os.Getenv("BILLING_SELLER_BANK_ACCOUNT"),
		BillingSellerBankBIK:         os.Getenv("BILLING_SELLER_BANK_BIK"),
		BillingSellerBankCorrAccount: os.Getenv("BILLING_SELLER_BANK_CORR_ACCOUNT"),
	}
	return SellerRequisites{
		Name:            c.BillingSellerName,
		INN:             c.BillingSellerINN,
		BankName:        c.BillingSellerBankName,
		BankAccount:     c.BillingSellerBankAccount,
		BankBIK:         c.BillingSellerBankBIK,
		BankCorrAccount: c.BillingSellerBankCorrAccount,
		Configured:      c.BillingSellerConfigured(),
	}
}
