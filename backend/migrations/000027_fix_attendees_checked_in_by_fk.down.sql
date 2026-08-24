-- Restore the pre-000027 shape: the plain no-action FK that 000001's inline
-- REFERENCES actually created (000005 never managed to replace it).
ALTER TABLE attendees DROP CONSTRAINT IF EXISTS attendees_checked_in_by_fkey;

ALTER TABLE attendees
  ADD CONSTRAINT attendees_checked_in_by_fkey
  FOREIGN KEY (checked_in_by) REFERENCES users(id) NOT VALID;

ALTER TABLE attendees VALIDATE CONSTRAINT attendees_checked_in_by_fkey;
