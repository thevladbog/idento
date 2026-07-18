-- backend/migrations/000021_validate_checkin_composite_fk.up.sql
-- Validates the three composite foreign keys added NOT VALID by 000020.
-- Split into its own migration/transaction (CodeRabbit nitpick on #78) so
-- each VALIDATE CONSTRAINT takes only a SHARE UPDATE EXCLUSIVE lock on the
-- referencing table — it can run concurrently with reads and writes,
-- unlike the ACCESS EXCLUSIVE lock a combined ADD CONSTRAINT + validate
-- would have held for the same scan.

ALTER TABLE checkin_stations VALIDATE CONSTRAINT checkin_stations_zone_id_event_id_fkey;
ALTER TABLE checkin_actions VALIDATE CONSTRAINT checkin_actions_attendee_id_event_id_fkey;
ALTER TABLE checkin_actions VALIDATE CONSTRAINT checkin_actions_station_id_event_id_fkey;
