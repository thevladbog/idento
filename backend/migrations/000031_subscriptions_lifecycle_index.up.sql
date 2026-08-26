-- The hourly subscription lifecycle ticker (ExpireOverdueSubscriptions,
-- pg_store_billing.go) runs:
--   UPDATE subscriptions
--      SET status = 'expired', ...
--    WHERE (status = 'trial'  AND trial_end_date < NOW())
--       OR (status = 'active' AND end_date       < NOW())
-- Without an index, each pass is a full sequential scan of subscriptions.
-- Two partial indexes — one per branch of the OR, each scoped to the status
-- it actually applies to — let Postgres pick a cheap index scan instead as
-- the table grows, without wasting index space on rows that can never match
-- either branch (an active subscription is never a candidate for the trial
-- branch, and vice versa).
CREATE INDEX IF NOT EXISTS idx_subscriptions_trial_expiry ON subscriptions (trial_end_date) WHERE status = 'trial';
CREATE INDEX IF NOT EXISTS idx_subscriptions_active_expiry ON subscriptions (end_date) WHERE status = 'active';
