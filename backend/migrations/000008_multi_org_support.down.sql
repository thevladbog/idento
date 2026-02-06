-- Rollback multi-org support
DROP TABLE IF EXISTS user_tenants;

-- Remove tenant settings fields
ALTER TABLE tenants DROP COLUMN IF EXISTS settings;
ALTER TABLE tenants DROP COLUMN IF EXISTS logo_url;
ALTER TABLE tenants DROP COLUMN IF EXISTS website;
ALTER TABLE tenants DROP COLUMN IF EXISTS contact_email;


