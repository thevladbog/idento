-- backend/migrations/000016_attendee_checkin_device_point.up.sql
-- M1c (mobile redesign): record which station (device_number) and which
-- registration work-point (point_name, from the station's StationConfig)
-- performed an attendee's check-in, so the mobile client can render an
-- "already checked in — where and by which device" verdict detail.

ALTER TABLE attendees ADD COLUMN IF NOT EXISTS checked_in_device_number INT;
ALTER TABLE attendees ADD COLUMN IF NOT EXISTS checked_in_point_name VARCHAR(120);
