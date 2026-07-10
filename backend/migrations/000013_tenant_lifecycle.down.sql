DROP INDEX IF EXISTS idx_tenants_status;
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS chk_tenants_status;
ALTER TABLE tenants DROP COLUMN IF EXISTS status;
