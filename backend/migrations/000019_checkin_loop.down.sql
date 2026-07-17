-- backend/migrations/000019_checkin_loop.down.sql
DROP TABLE checkin_actions;
DROP TABLE checkin_stations;
ALTER TABLE events DROP COLUMN checkin_settings;
