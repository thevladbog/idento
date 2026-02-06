-- Drop triggers
DROP TRIGGER IF EXISTS update_event_zones_updated_at ON event_zones;
DROP TRIGGER IF EXISTS update_attendee_zone_access_updated_at ON attendee_zone_access;

-- Remove added columns from attendees
ALTER TABLE attendees DROP COLUMN IF EXISTS registration_zone_id;
ALTER TABLE attendees DROP COLUMN IF EXISTS registered_at;
ALTER TABLE attendees DROP COLUMN IF EXISTS packet_delivered;

-- Drop indexes
DROP INDEX IF EXISTS idx_staff_zone_assignments_zone;
DROP INDEX IF EXISTS idx_staff_zone_assignments_user;
DROP INDEX IF EXISTS idx_zone_checkins_day;
DROP INDEX IF EXISTS idx_zone_checkins_zone;
DROP INDEX IF EXISTS idx_zone_checkins_attendee;
DROP INDEX IF EXISTS idx_attendee_zone_access_zone;
DROP INDEX IF EXISTS idx_attendee_zone_access_attendee;
DROP INDEX IF EXISTS idx_zone_access_rules_unique;
DROP INDEX IF EXISTS idx_zone_access_rules_zone;
DROP INDEX IF EXISTS idx_event_zones_type;
DROP INDEX IF EXISTS idx_event_zones_event;

-- Drop tables
DROP TABLE IF EXISTS staff_zone_assignments;
DROP TABLE IF EXISTS zone_checkins;
DROP TABLE IF EXISTS attendee_zone_access;
DROP TABLE IF EXISTS zone_access_rules;
DROP TABLE IF EXISTS event_zones;

