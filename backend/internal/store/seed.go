package store

import (
	"context"
	"fmt"

	"idento/backend/internal/config"
)

// saasPlanSeeds mirrors the tiers previously seeded by migration 000009.
const saasPlanSeeds = `
INSERT INTO subscription_plans (name, slug, tier, description, price_monthly, price_yearly, limits, features, sort_order) VALUES
('Free', 'free', 'free', 'For small events and testing', 0, 0,
 '{"events_per_month": 2, "attendees_per_event": 50, "users": 2, "storage_mb": 100}',
 '{"custom_branding": false, "api_access": false, "priority_support": false}', 1),
('Starter', 'starter', 'starter', 'For growing organizations', 29, 290,
 '{"events_per_month": 10, "attendees_per_event": 500, "users": 5, "storage_mb": 1000}',
 '{"custom_branding": true, "api_access": false, "priority_support": false}', 2),
('Professional', 'pro', 'pro', 'For professional event organizers', 99, 990,
 '{"events_per_month": -1, "attendees_per_event": 5000, "users": 20, "storage_mb": 10000}',
 '{"custom_branding": true, "api_access": true, "priority_support": true}', 3),
('Enterprise', 'enterprise', 'enterprise', 'Custom solution for large organizations', 0, 0,
 '{"events_per_month": -1, "attendees_per_event": -1, "users": -1, "storage_mb": -1}',
 '{"custom_branding": true, "api_access": true, "priority_support": true, "dedicated_support": true}', 4)
ON CONFLICT (slug) DO NOTHING`

// onPremPlanSeeds: one hidden, unlimited plan — self-hosted installs are not metered.
const onPremPlanSeeds = `
INSERT INTO subscription_plans (name, slug, tier, description, price_monthly, price_yearly, limits, features, is_public, sort_order) VALUES
('Unlimited', 'unlimited', 'custom', 'Self-hosted unlimited plan', 0, 0,
 '{"events_per_month": -1, "attendees_per_event": -1, "users": -1, "storage_mb": -1}',
 '{"custom_branding": true, "api_access": true, "priority_support": false}', FALSE, 0)
ON CONFLICT (slug) DO NOTHING`

// EnsureSeedData inserts the mode's subscription plans if missing and
// guarantees exactly one default plan. Idempotent; runs on every startup
// after migrations (seeds deliberately live outside the migration chain so
// the chain is identical in both deployment modes).
func (s *PGStore) EnsureSeedData(ctx context.Context, mode string) error {
	seeds, defaultSlug := saasPlanSeeds, "free"
	if mode == config.ModeOnPrem {
		seeds, defaultSlug = onPremPlanSeeds, "unlimited"
	}
	if _, err := s.db.Exec(ctx, seeds); err != nil {
		return fmt.Errorf("seed subscription plans: %w", err)
	}
	// Single-default invariant is enforced by the partial unique index from
	// migration 000012; only set a default when none exists yet.
	if _, err := s.db.Exec(ctx, `
		UPDATE subscription_plans SET is_default = TRUE
		WHERE slug = $1
		  AND NOT EXISTS (SELECT 1 FROM subscription_plans WHERE is_default)`,
		defaultSlug); err != nil {
		return fmt.Errorf("ensure default plan: %w", err)
	}
	return nil
}
