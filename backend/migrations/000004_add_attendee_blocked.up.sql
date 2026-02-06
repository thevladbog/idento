-- Add blocked field to attendees table
ALTER TABLE attendees ADD COLUMN blocked BOOLEAN DEFAULT FALSE NOT NULL;
ALTER TABLE attendees ADD COLUMN block_reason TEXT;

