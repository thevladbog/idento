-- Store scoped credentials outside users so a legacy backend cannot read a
-- new tenant-bound credential and reinterpret it as home-tenant/global-role.
CREATE TABLE user_qr_credentials (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token VARCHAR(255) NOT NULL UNIQUE,
  role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'manager', 'staff')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Existing credentials were global and cannot be scoped safely. The CHECK
-- also makes overlapping legacy writers fail closed after this migration.
UPDATE users
SET qr_token = NULL,
    qr_token_created_at = NULL
WHERE qr_token IS NOT NULL
   OR qr_token_created_at IS NOT NULL;

ALTER TABLE users
  ADD CONSTRAINT users_legacy_qr_disabled
  CHECK (qr_token IS NULL AND qr_token_created_at IS NULL);
