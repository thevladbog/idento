-- P5.2: retire the transitional badge-template dual-sync. First, belt-and-
-- suspenders: copy any object-typed legacy custom_fields->'badgeTemplate'
-- into the dedicated column where the column is still NULL (idempotent
-- re-run of 000018's object-typed-only backfill, catching any event a
-- transient log-don't-fail sync missed). String-typed legacy values are
-- print-broken already (per 000018) and are deliberately left un-migrated.
UPDATE events
SET badge_template = custom_fields->'badgeTemplate',
    badge_template_version = GREATEST(badge_template_version, 1)
WHERE badge_template IS NULL
  AND jsonb_typeof(custom_fields->'badgeTemplate') = 'object';

-- The badge_template column is now the sole source of truth; drop the
-- redundant legacy key so the two can never diverge again.
UPDATE events
SET custom_fields = custom_fields - 'badgeTemplate'
WHERE custom_fields ? 'badgeTemplate';
