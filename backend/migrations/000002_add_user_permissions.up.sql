-- Add event_staff mapping table
CREATE TABLE event_staff (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    assigned_by UUID REFERENCES users(id),
    UNIQUE(event_id, user_id)
);

-- Add QR auth token for staff quick login
ALTER TABLE users ADD COLUMN qr_token VARCHAR(255) UNIQUE;
ALTER TABLE users ADD COLUMN qr_token_created_at TIMESTAMP WITH TIME ZONE;

-- Index for performance
CREATE INDEX idx_event_staff_event ON event_staff(event_id);
CREATE INDEX idx_event_staff_user ON event_staff(user_id);
CREATE INDEX idx_users_qr_token ON users(qr_token);

-- Function to generate QR token
CREATE OR REPLACE FUNCTION generate_qr_token(user_uuid UUID)
RETURNS VARCHAR AS $$
BEGIN
    RETURN 'QR_' || user_uuid::text || '_' || EXTRACT(EPOCH FROM NOW())::bigint;
END;
$$ LANGUAGE plpgsql;

