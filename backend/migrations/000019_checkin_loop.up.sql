-- backend/migrations/000019_checkin_loop.up.sql
-- P4.1 (check-in loop): dedicated, verbatim-JSON per-event check-in
-- settings column (mirrors the badge_template column pattern — operator-
-- only config, no optimistic-concurrency version needed), a check-in
-- station registry (name-scoped per event, optionally bound to a zone),
-- and a durable check-in/undo/reprint actions feed.

ALTER TABLE events ADD COLUMN checkin_settings JSONB NULL;

CREATE TABLE checkin_stations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    zone_id UUID NULL REFERENCES event_zones(id) ON DELETE SET NULL,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(event_id, name)
);

CREATE TABLE checkin_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    attendee_id UUID NOT NULL REFERENCES attendees(id) ON DELETE CASCADE,
    station_id UUID NULL REFERENCES checkin_stations(id) ON DELETE SET NULL,
    action TEXT NOT NULL CHECK (action IN ('checkin', 'undo', 'reprint')),
    staff_user_id UUID NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_checkin_actions_event_created ON checkin_actions(event_id, created_at DESC);
