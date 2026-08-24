-- 000001 already created attendees.checked_in_by with a plain FK (no ON
-- DELETE action), so 000005's `ADD COLUMN IF NOT EXISTS ... ON DELETE SET
-- NULL` silently no-oped: the column pre-existed and its constraint was
-- never replaced. Deleting a user who performed check-ins therefore fails
-- with an FK violation instead of nulling the attribution -- the exact
-- behavior 000005 documented as intended. Replace the constraint for real.
ALTER TABLE attendees DROP CONSTRAINT IF EXISTS attendees_checked_in_by_fkey;

-- NOT VALID + explicit VALIDATE keeps the existing-row scan off the ALTER
-- TABLE lock on a populated attendees table (same pattern as 000026's
-- legacy-QR constraint).
ALTER TABLE attendees
  ADD CONSTRAINT attendees_checked_in_by_fkey
  FOREIGN KEY (checked_in_by) REFERENCES users(id) ON DELETE SET NULL NOT VALID;

ALTER TABLE attendees VALIDATE CONSTRAINT attendees_checked_in_by_fkey;
