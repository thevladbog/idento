-- Add bcrypt hash column for API key verification (OWASP-recommended slow hash).
-- key_hash remains for indexed lookup; key_hash_bcrypt used for verification when set.
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS key_hash_bcrypt TEXT NULL;
