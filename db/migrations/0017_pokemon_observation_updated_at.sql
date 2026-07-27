-- Track current-day benchmark corrections without rewriting original creation time.
ALTER TABLE pk_price_observations ADD COLUMN updated_at TEXT;

UPDATE pk_price_observations
   SET updated_at = created_at
 WHERE updated_at IS NULL;
