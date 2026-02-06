-- Add field_schema and custom_fields to events table
ALTER TABLE events ADD COLUMN IF NOT EXISTS field_schema TEXT[];
ALTER TABLE events ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}'::jsonb;

-- Add index for custom_fields
CREATE INDEX IF NOT EXISTS idx_events_custom_fields ON events USING gin(custom_fields);

