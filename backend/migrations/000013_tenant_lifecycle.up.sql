-- P1.4: tenant lifecycle. Suspension/archival are enforced on the request
-- path by the TenantGate middleware; subscription.status stays billing-only.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE tenants ADD CONSTRAINT chk_tenants_status CHECK (status IN ('active', 'suspended', 'archived'));
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status) WHERE status <> 'active';
