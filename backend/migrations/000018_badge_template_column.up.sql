-- backend/migrations/000018_badge_template_column.up.sql
-- P3.1 (badge editor): moves the badge template out of the untyped
-- event.custom_fields["badgeTemplate"] bag into a dedicated, versioned
-- column pair. badge_template_version is the optimistic-concurrency guard
-- for the store's UpdateEventBadgeTemplate.
ALTER TABLE events ADD COLUMN badge_template JSONB NULL, ADD COLUMN badge_template_version INT NOT NULL DEFAULT 0;

-- One-time backfill: only object-typed legacy values are copied. Legacy
-- string-typed values are deliberately left behind — they are print-broken
-- today (reconciliation #8), so there is nothing valid to migrate forward.
-- The legacy custom_fields->'badgeTemplate' key is NOT deleted.
UPDATE events SET badge_template = custom_fields->'badgeTemplate', badge_template_version = 1 WHERE jsonb_typeof(custom_fields->'badgeTemplate') = 'object';
