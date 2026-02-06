-- Remove blocked field from attendees table
ALTER TABLE attendees DROP COLUMN block_reason;
ALTER TABLE attendees DROP COLUMN blocked;

