-- 0003_email_recent — store a small per-account recent-message list so Home and the
-- Email page can render a scannable cross-inbox feed (sender · subject · account · time),
-- not just the single latest subject. JSON blob is a snapshot, overwrite each poll.
ALTER TABLE email_state ADD COLUMN recent_json TEXT;
