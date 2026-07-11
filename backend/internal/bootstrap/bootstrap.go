// Package bootstrap provisions the first organization and admin user on a
// fresh on-prem install. It is never invoked in saas mode.
package bootstrap

import (
	"context"
	"fmt"
	"log"
	"strings"

	"idento/backend/internal/config"
	"idento/backend/internal/store"
)

const defaultOrgName = "My Organization"

// OnPremAdmin provisions one organization and one admin user from
// cfg.AdminEmail/AdminPassword when the database has no users yet. It is
// idempotent: once any user exists (from this call or any other path),
// every subsequent call is a no-op. Callers should treat a non-nil error as
// fatal — this only runs at startup, in onprem mode, before the server
// accepts traffic.
func OnPremAdmin(ctx context.Context, s store.Store, cfg *config.Config) error {
	hasUsers, err := s.HasAnyUsers(ctx)
	if err != nil {
		return fmt.Errorf("check for existing users: %w", err)
	}
	if hasUsers {
		return nil
	}
	email := strings.TrimSpace(strings.ToLower(cfg.AdminEmail))
	if email == "" || cfg.AdminPassword == "" {
		return fmt.Errorf("first run with an empty database requires IDENTO_ADMIN_EMAIL and IDENTO_ADMIN_PASSWORD to be set — see INSTALL.md")
	}
	orgName := cfg.AdminOrgName
	if orgName == "" {
		orgName = defaultOrgName
	}
	if _, _, err := s.ProvisionTenantWithAdmin(ctx, orgName, email, cfg.AdminPassword); err != nil {
		return fmt.Errorf("bootstrap admin: %w", err)
	}
	log.Printf("bootstrap: created organization %q with admin %s", orgName, email)
	return nil
}
