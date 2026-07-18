-- backend/migrations/000020_checkin_loop_composite_fk.down.sql

ALTER TABLE checkin_actions
    DROP CONSTRAINT checkin_actions_station_id_event_id_fkey,
    ADD CONSTRAINT checkin_actions_station_id_fkey
        FOREIGN KEY (station_id) REFERENCES checkin_stations(id) ON DELETE SET NULL;

ALTER TABLE checkin_actions
    DROP CONSTRAINT checkin_actions_attendee_id_event_id_fkey,
    ADD CONSTRAINT checkin_actions_attendee_id_fkey
        FOREIGN KEY (attendee_id) REFERENCES attendees(id) ON DELETE CASCADE;

ALTER TABLE checkin_stations
    DROP CONSTRAINT checkin_stations_zone_id_event_id_fkey,
    ADD CONSTRAINT checkin_stations_zone_id_fkey
        FOREIGN KEY (zone_id) REFERENCES event_zones(id) ON DELETE SET NULL;

ALTER TABLE checkin_stations DROP CONSTRAINT checkin_stations_id_event_id_key;
ALTER TABLE attendees DROP CONSTRAINT attendees_id_event_id_key;
ALTER TABLE event_zones DROP CONSTRAINT event_zones_id_event_id_key;
