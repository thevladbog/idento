-- backend/migrations/000015_mobile_stations.up.sql
-- Phase B (mobile redesign): time-windowed zone access rules, station
-- provisioning/registry, check-in override audit log, idempotent batch
-- check-in log, and a zone-scan log feeding live KPI stats.

ALTER TABLE zone_access_rules ADD COLUMN IF NOT EXISTS time_from VARCHAR(5);
ALTER TABLE zone_access_rules ADD COLUMN IF NOT EXISTS time_to VARCHAR(5);

CREATE TABLE IF NOT EXISTS stations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    device_number INT NOT NULL,
    staff_user_id UUID NOT NULL REFERENCES users(id),
    device_info JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(event_id, device_number)
);

CREATE TABLE IF NOT EXISTS station_provisioning_tokens (
    token VARCHAR(64) PRIMARY KEY,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    staff_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES users(id),
    expires_at TIMESTAMP NOT NULL,
    consumed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS checkin_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attendee_id UUID NOT NULL REFERENCES attendees(id) ON DELETE CASCADE,
    zone_id UUID REFERENCES event_zones(id) ON DELETE SET NULL,
    context VARCHAR(30) NOT NULL,
    staff_user_id UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS batch_checkin_log (
    client_uuid UUID PRIMARY KEY,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    attendee_id UUID NOT NULL REFERENCES attendees(id) ON DELETE CASCADE,
    kind VARCHAR(20) NOT NULL,
    zone_id UUID REFERENCES event_zones(id) ON DELETE SET NULL,
    device_number INT,
    checked_in_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS zone_scan_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zone_id UUID NOT NULL REFERENCES event_zones(id) ON DELETE CASCADE,
    attendee_id UUID REFERENCES attendees(id) ON DELETE SET NULL,
    verdict VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_zone_scan_log_zone_created ON zone_scan_log(zone_id, created_at);
CREATE INDEX IF NOT EXISTS idx_batch_checkin_log_event ON batch_checkin_log(event_id);
CREATE INDEX IF NOT EXISTS idx_station_provisioning_tokens_event ON station_provisioning_tokens(event_id);
CREATE INDEX IF NOT EXISTS idx_checkin_overrides_attendee ON checkin_overrides(attendee_id);
CREATE INDEX IF NOT EXISTS idx_batch_checkin_log_attendee ON batch_checkin_log(attendee_id);
CREATE INDEX IF NOT EXISTS idx_zone_scan_log_attendee ON zone_scan_log(attendee_id);
