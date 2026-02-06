-- Event Zones table
CREATE TABLE IF NOT EXISTS event_zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    zone_type VARCHAR(50) NOT NULL DEFAULT 'general', -- registration, general, vip, workshop, etc
    order_index INT DEFAULT 0,
    
    -- Time constraints (NULL = no constraint)
    open_time TIME,
    close_time TIME,
    
    -- Special flags
    is_registration_zone BOOLEAN DEFAULT FALSE,
    requires_registration BOOLEAN DEFAULT TRUE, -- Need to be registered before entering
    is_active BOOLEAN DEFAULT TRUE,
    
    -- Additional settings (display templates, instructions, etc)
    settings JSONB DEFAULT '{}',
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(event_id, name)
);

CREATE INDEX idx_event_zones_event ON event_zones(event_id);
CREATE INDEX idx_event_zones_type ON event_zones(zone_type);

-- Zone access rules by category (from attendee custom_fields)
CREATE TABLE IF NOT EXISTS zone_access_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zone_id UUID NOT NULL REFERENCES event_zones(id) ON DELETE CASCADE,
    category VARCHAR(100) NOT NULL, -- Value from custom_fields['category']
    allowed BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_zone_access_rules_zone ON zone_access_rules(zone_id);
CREATE UNIQUE INDEX idx_zone_access_rules_unique ON zone_access_rules(zone_id, category);

-- Individual attendee access overrides
CREATE TABLE IF NOT EXISTS attendee_zone_access (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attendee_id UUID NOT NULL REFERENCES attendees(id) ON DELETE CASCADE,
    zone_id UUID NOT NULL REFERENCES event_zones(id) ON DELETE CASCADE,
    allowed BOOLEAN DEFAULT TRUE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(attendee_id, zone_id)
);

CREATE INDEX idx_attendee_zone_access_attendee ON attendee_zone_access(attendee_id);
CREATE INDEX idx_attendee_zone_access_zone ON attendee_zone_access(zone_id);

-- Zone check-ins (separate from general event check-in)
CREATE TABLE IF NOT EXISTS zone_checkins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attendee_id UUID NOT NULL REFERENCES attendees(id) ON DELETE CASCADE,
    zone_id UUID NOT NULL REFERENCES event_zones(id) ON DELETE CASCADE,
    checked_in_at TIMESTAMP DEFAULT NOW(),
    checked_in_by UUID REFERENCES users(id),
    event_day DATE NOT NULL, -- Which day of multi-day event
    metadata JSONB DEFAULT '{}', -- Additional info (device, location, etc)
    
    UNIQUE(attendee_id, zone_id, event_day) -- One check-in per zone per day
);

CREATE INDEX idx_zone_checkins_attendee ON zone_checkins(attendee_id);
CREATE INDEX idx_zone_checkins_zone ON zone_checkins(zone_id, event_day);
CREATE INDEX idx_zone_checkins_day ON zone_checkins(event_day);

-- Staff zone assignments
CREATE TABLE IF NOT EXISTS staff_zone_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    zone_id UUID NOT NULL REFERENCES event_zones(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP DEFAULT NOW(),
    assigned_by UUID REFERENCES users(id),
    
    UNIQUE(user_id, zone_id)
);

CREATE INDEX idx_staff_zone_assignments_user ON staff_zone_assignments(user_id);
CREATE INDEX idx_staff_zone_assignments_zone ON staff_zone_assignments(zone_id);

-- Add fields to attendees table
ALTER TABLE attendees ADD COLUMN IF NOT EXISTS packet_delivered BOOLEAN DEFAULT FALSE;
ALTER TABLE attendees ADD COLUMN IF NOT EXISTS registered_at TIMESTAMP;
ALTER TABLE attendees ADD COLUMN IF NOT EXISTS registration_zone_id UUID REFERENCES event_zones(id);

-- Create update_updated_at_column function if not exists
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Update triggers
CREATE TRIGGER update_event_zones_updated_at BEFORE UPDATE ON event_zones
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_attendee_zone_access_updated_at BEFORE UPDATE ON attendee_zone_access
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

