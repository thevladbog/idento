-- NULL-actor rows must go before NOT NULL can be restored.
DELETE FROM admin_audit_log WHERE admin_user_id IS NULL;
ALTER TABLE admin_audit_log ALTER COLUMN admin_user_id SET NOT NULL;
DROP INDEX IF EXISTS idx_tenants_archived_at;
ALTER TABLE tenants DROP COLUMN IF EXISTS archived_at;
