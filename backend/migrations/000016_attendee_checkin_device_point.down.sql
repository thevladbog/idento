-- backend/migrations/000016_attendee_checkin_device_point.down.sql
ALTER TABLE attendees DROP COLUMN IF EXISTS checked_in_device_number;
ALTER TABLE attendees DROP COLUMN IF EXISTS checked_in_point_name;
