-- Drop indexes
DROP INDEX IF EXISTS idx_batch_checkin_log_event;
DROP INDEX IF EXISTS idx_zone_scan_log_zone_created;

-- Drop tables
DROP TABLE IF EXISTS zone_scan_log;
DROP TABLE IF EXISTS batch_checkin_log;
DROP TABLE IF EXISTS checkin_overrides;
DROP TABLE IF EXISTS station_provisioning_tokens;
DROP TABLE IF EXISTS stations;

-- Remove added columns from zone_access_rules
ALTER TABLE zone_access_rules DROP COLUMN IF EXISTS time_to;
ALTER TABLE zone_access_rules DROP COLUMN IF EXISTS time_from;
