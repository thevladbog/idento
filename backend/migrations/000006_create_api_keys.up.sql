-- Create API keys table for external integrations
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    key_hash VARCHAR(255) NOT NULL UNIQUE,
    key_preview VARCHAR(20) NOT NULL,
    expires_at TIMESTAMP,
    last_used_at TIMESTAMP,
    revoked_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Index for quick lookup by key_hash
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);

-- Index for event_id
CREATE INDEX IF NOT EXISTS idx_api_keys_event_id ON api_keys(event_id);

-- Index for finding active keys
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(event_id, revoked_at) WHERE revoked_at IS NULL;
