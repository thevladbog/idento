-- P0.1: default plan flag + subscription backfill.
-- Register() will auto-provision a subscription to the default plan;
-- existing tenants without any subscription get one here (they are currently
-- hard-403'd by the limits middleware: "no active subscription").

ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;

-- At most one default plan, enforced by the database.
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_plans_single_default
    ON subscription_plans ((TRUE)) WHERE is_default;

UPDATE subscription_plans SET is_default = TRUE WHERE slug = 'free';

INSERT INTO subscriptions (tenant_id, plan_id, status, start_date)
SELECT t.id, p.id, 'active', NOW()
FROM tenants t
CROSS JOIN (SELECT id FROM subscription_plans WHERE is_default LIMIT 1) p
WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id = t.id);
