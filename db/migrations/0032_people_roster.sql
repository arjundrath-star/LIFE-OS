-- 0032: roster flag on people. Roster rows are club E-board members imported from public club pages
-- that Arjun has not met yet. They show on club pages as targets and stay out of the Network tab
-- until a real interaction (manual edit, capture, or email) promotes them.
ALTER TABLE people ADD COLUMN roster INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_people_roster ON people(roster, archived);
