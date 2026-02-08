-- Add checked_in_by column to track who performed the check-in
ALTER TABLE attendees ADD COLUMN IF NOT EXISTS checked_in_by UUID REFERENCES users(id) ON DELETE SET NULL;

