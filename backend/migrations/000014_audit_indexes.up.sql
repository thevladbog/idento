-- P1.7: the audit log is queried newest-first and filtered by action
-- (e.g. impersonate_tenant, impersonated_request).
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_log(action);
