-- backend/migrations/000018_badge_template_column.down.sql
ALTER TABLE events DROP COLUMN badge_template_version, DROP COLUMN badge_template;
