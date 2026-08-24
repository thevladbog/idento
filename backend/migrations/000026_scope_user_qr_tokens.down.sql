-- Never expose a scoped credential to the legacy users.qr_token reader on
-- rollback. Keep the legacy columns empty before removing v2 storage.
UPDATE users
SET qr_token = NULL,
    qr_token_created_at = NULL;

DROP TABLE IF EXISTS user_qr_credentials;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_legacy_qr_disabled;
