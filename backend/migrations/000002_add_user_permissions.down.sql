-- Rollback user permissions
DROP FUNCTION IF EXISTS generate_qr_token(UUID);
DROP INDEX IF EXISTS idx_users_qr_token;
DROP INDEX IF EXISTS idx_event_staff_user;
DROP INDEX IF EXISTS idx_event_staff_event;
ALTER TABLE users DROP COLUMN IF EXISTS qr_token_created_at;
ALTER TABLE users DROP COLUMN IF EXISTS qr_token;
DROP TABLE IF EXISTS event_staff;

