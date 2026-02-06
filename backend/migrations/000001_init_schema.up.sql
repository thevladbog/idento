CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'manager', 'staff')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    start_date TIMESTAMP WITH TIME ZONE,
    end_date TIMESTAMP WITH TIME ZONE,
    location VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS print_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    width_mm INTEGER NOT NULL,
    height_mm INTEGER NOT NULL,
    json_schema JSONB NOT NULL, -- Fabric/Konva JSON
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS attendees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    email VARCHAR(255),
    company VARCHAR(255),
    position VARCHAR(255),
    code VARCHAR(100) NOT NULL, -- QR code content
    checkin_status BOOLEAN DEFAULT FALSE,
    checked_in_at TIMESTAMP WITH TIME ZONE,
    printed_count INTEGER DEFAULT 0,
    custom_fields JSONB, -- Flexible fields for badges
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(event_id, code)
);

CREATE TABLE IF NOT EXISTS badges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    attendee_id UUID REFERENCES attendees(id) ON DELETE CASCADE,
    printed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    printed_by UUID REFERENCES users(id) -- ID of the staff who printed
);

-- Indexes for performance and sync
CREATE INDEX IF NOT EXISTS idx_attendees_event_updated ON attendees(event_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_events_tenant_updated ON events(tenant_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_attendees_code ON attendees(code);

-- Add missing columns to users table (if not exists)
ALTER TABLE users ADD COLUMN IF NOT EXISTS qr_token VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS qr_token_created_at TIMESTAMP WITH TIME ZONE;

-- Add missing columns to events table (if not exists)
ALTER TABLE events ADD COLUMN IF NOT EXISTS field_schema JSONB DEFAULT '[]';
ALTER TABLE events ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}';

-- Add missing columns to attendees table (if not exists)
ALTER TABLE attendees ADD COLUMN IF NOT EXISTS checked_in_by UUID REFERENCES users(id);
ALTER TABLE attendees ADD COLUMN IF NOT EXISTS blocked BOOLEAN DEFAULT FALSE;
ALTER TABLE attendees ADD COLUMN IF NOT EXISTS block_reason TEXT;

-- Create event staff assignment table (if not exists)
CREATE TABLE IF NOT EXISTS event_staff (
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (event_id, user_id)
);

-- Create API keys table for external integrations
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    key_hash VARCHAR(255) NOT NULL UNIQUE,
    key_preview VARCHAR(20) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE,
    last_used_at TIMESTAMP WITH TIME ZONE,
    revoked_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for API keys
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_event_id ON api_keys(event_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(event_id, revoked_at) WHERE revoked_at IS NULL;
