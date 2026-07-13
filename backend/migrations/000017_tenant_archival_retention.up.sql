-- Retention half of P1.4 tenant archival (soft-delete + retention policy).
-- archived_at is stamped on archive and cleared on reactivate; the purge job
-- deletes archived tenants once NOW() - archived_at exceeds the configured
-- retention. Pre-existing archived tenants start their clock at deploy time.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
UPDATE tenants SET archived_at = NOW() WHERE status = 'archived' AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tenants_archived_at ON tenants(archived_at) WHERE status = 'archived';

-- System-initiated purges are audit-logged without an admin actor.
ALTER TABLE admin_audit_log ALTER COLUMN admin_user_id DROP NOT NULL;
