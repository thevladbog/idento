-- Rollback super admin billing
DROP TABLE IF EXISTS admin_audit_log;
DROP TABLE IF EXISTS usage_logs;
DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS subscription_plans;

-- Remove super admin column
ALTER TABLE users DROP COLUMN IF EXISTS is_super_admin;

