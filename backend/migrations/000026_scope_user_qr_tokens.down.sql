ALTER TABLE users
  DROP COLUMN IF EXISTS qr_token_role,
  DROP COLUMN IF EXISTS qr_token_tenant_id;
