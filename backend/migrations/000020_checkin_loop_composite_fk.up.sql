-- backend/migrations/000020_checkin_loop_composite_fk.up.sql
-- Defense-in-depth follow-up to 000019 (PR #77 CodeRabbit review, thread
-- deferred to a follow-up rather than blocking): the app layer already
-- validates on every check-in write path that zone_id, attendee_id, and
-- station_id belong to the same event_id as the row being written
-- (backend/internal/handler/checkin.go, checkin_stations.go), but the
-- single-column foreign keys added in 000019 don't enforce that at the
-- database level, so a cross-event id could slip in from any writer that
-- bypasses those handlers. This adds composite (id, event_id) foreign keys
-- so Postgres itself rejects a cross-event reference.

-- Supplementary composite unique indexes — additive, non-breaking (each
-- table's primary key already makes id unique on its own, so (id, event_id)
-- is trivially unique too; these exist only so the composite foreign keys
-- below have something to reference).
ALTER TABLE event_zones ADD CONSTRAINT event_zones_id_event_id_key UNIQUE (id, event_id);
ALTER TABLE attendees ADD CONSTRAINT attendees_id_event_id_key UNIQUE (id, event_id);
ALTER TABLE checkin_stations ADD CONSTRAINT checkin_stations_id_event_id_key UNIQUE (id, event_id);

-- checkin_stations.zone_id must belong to the same event_id.
-- ON DELETE SET NULL (zone_id) (PG15+ column-list form) preserves the
-- original single-column behavior of nulling only zone_id — without the
-- column list, Postgres would null every column in the composite FK
-- (including event_id, which is NOT NULL and would raise an error).
-- NOT VALID skips scanning existing rows here (that would hold this ALTER's
-- lock for the scan's duration); 000021 validates it separately afterward,
-- under a lock that doesn't block concurrent reads/writes.
ALTER TABLE checkin_stations
    DROP CONSTRAINT checkin_stations_zone_id_fkey,
    ADD CONSTRAINT checkin_stations_zone_id_event_id_fkey
        FOREIGN KEY (zone_id, event_id) REFERENCES event_zones(id, event_id)
        ON DELETE SET NULL (zone_id)
        NOT VALID;

-- checkin_actions.attendee_id must belong to the same event_id. NOT VALID
-- as above — checkin_actions is the table most likely to accumulate rows
-- over an event's lifetime, so this is the constraint where skipping the
-- validation scan here matters most.
ALTER TABLE checkin_actions
    DROP CONSTRAINT checkin_actions_attendee_id_fkey,
    ADD CONSTRAINT checkin_actions_attendee_id_event_id_fkey
        FOREIGN KEY (attendee_id, event_id) REFERENCES attendees(id, event_id)
        ON DELETE CASCADE
        NOT VALID;

-- checkin_actions.station_id must belong to the same event_id. station_id
-- is nullable; Postgres composite foreign keys use MATCH SIMPLE by default,
-- which lets NULL bypass the check, so an actions row with no station is
-- unaffected. NOT VALID as above.
ALTER TABLE checkin_actions
    DROP CONSTRAINT checkin_actions_station_id_fkey,
    ADD CONSTRAINT checkin_actions_station_id_event_id_fkey
        FOREIGN KEY (station_id, event_id) REFERENCES checkin_stations(id, event_id)
        ON DELETE SET NULL (station_id)
        NOT VALID;
