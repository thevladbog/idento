-- Reconstruct the legacy key from the column (they held identical bytes
-- while the sync was live). Schema-reversible; the object-typed vs string
-- distinction is not restored (string legacy values were never migrated).
UPDATE events
SET custom_fields = jsonb_set(coalesce(custom_fields, '{}'::jsonb),
                              '{badgeTemplate}', badge_template)
WHERE badge_template IS NOT NULL;
