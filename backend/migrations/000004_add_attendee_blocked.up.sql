-- Add blocked field to attendees table
ALTER TABLE attendees ADD COLUMN IF NOT EXISTS blocked BOOLEAN DEFAULT FALSE NOT NULL;
ALTER TABLE attendees ADD COLUMN IF NOT EXISTS block_reason TEXT;

