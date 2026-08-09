-- Bind QR login credentials to the tenant and role they were issued for.
-- Scope is nullable so deleting a tenant can invalidate a credential without
-- blocking tenant removal; the login handler fails closed on incomplete scope.
ALTER TABLE users
  ADD COLUMN qr_token_tenant_id UUID
    CONSTRAINT users_qr_token_tenant_fk
    REFERENCES tenants(id) ON DELETE SET NULL,
  ADD COLUMN qr_token_role VARCHAR(50)
    CONSTRAINT users_qr_token_role_check
    CHECK (qr_token_role IN ('admin', 'manager', 'staff'));

-- Existing credentials were global and cannot be assigned a tenant/role
-- safely. Invalidate them instead of silently inheriting users.tenant_id/role.
UPDATE users
SET qr_token = NULL,
    qr_token_created_at = NULL,
    qr_token_tenant_id = NULL,
    qr_token_role = NULL
WHERE qr_token IS NOT NULL
   OR qr_token_created_at IS NOT NULL;
