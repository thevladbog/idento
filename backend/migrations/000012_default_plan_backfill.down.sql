DROP INDEX IF EXISTS idx_subscription_plans_single_default;
ALTER TABLE subscription_plans DROP COLUMN IF EXISTS is_default;
-- Backfilled subscriptions are intentionally kept: removing them would
-- re-break tenants (limits middleware requires a subscription row).
