-- Store scoped credentials outside users so a legacy backend cannot read a
-- new tenant-bound credential and reinterpret it as home-tenant/global-role.
CREATE TABLE user_qr_credentials (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Only the SHA-256 hex digest of the bearer is ever stored; the plaintext
  -- credential exists solely in the mint response.
  token_digest VARCHAR(64) NOT NULL UNIQUE
    CHECK (char_length(token_digest) = 64),
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

-- NOT VALID keeps the full-table validation scan out of the ALTER TABLE
-- ACCESS EXCLUSIVE lock on a populated users table; the explicit VALIDATE
-- then checks existing rows under its weaker SHARE UPDATE EXCLUSIVE lock.
ALTER TABLE users
  ADD CONSTRAINT users_legacy_qr_disabled
  CHECK (qr_token IS NULL AND qr_token_created_at IS NULL) NOT VALID;

ALTER TABLE users VALIDATE CONSTRAINT users_legacy_qr_disabled;
