-- Repairs event_staff, which has been missing columns
-- AssignStaffToEvent (pg_store.go) has always written to. Migration
-- 000002's own `CREATE TABLE IF NOT EXISTS event_staff (id, ...)` silently
-- no-op'd because the table already existed (created narrower by 000001) --
-- Postgres's IF NOT EXISTS does not reconcile an existing table's columns
-- against a new definition, it just skips the statement entirely. Every
-- real deployment's event_staff table has therefore only ever had
-- event_id/user_id/assigned_at, and POST /api/events/{event_id}/staff has
-- always 500'd ("column \"id\" of relation \"event_staff\" does not
-- exist"). (event_id, user_id) remains the primary key --
-- AssignStaffToEvent's `ON CONFLICT (event_id, user_id)` already targets it
-- correctly today, unchanged; id is an additional identity column, not a
-- replacement primary key.
ALTER TABLE event_staff
  ADD COLUMN id UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN assigned_by UUID REFERENCES users(id);
