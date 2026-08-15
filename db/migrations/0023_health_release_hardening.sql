-- 0023_health_release_hardening — remove legacy WHOOP upstream error text.
-- Diagnostic fields retain only bounded fixed codes; upstream bodies are never copied.

UPDATE whoop_tokens
SET last_error = CASE
  WHEN last_error IN (
    'WHOOP_DATA_PARTIAL_SYNC',
    'WHOOP_DATA_SYNC_FAILED',
    'WHOOP_DATA_SESSION_CHANGED'
  ) THEN last_error
  ELSE 'WHOOP_DATA_SYNC_FAILED'
END
WHERE last_error IS NOT NULL;

UPDATE whoop_tokens
SET auth_error = CASE
  WHEN auth_error IN (
    'WHOOP_AUTH_FAILED',
    'WHOOP_AUTH_REFRESH_FAILED',
    'WHOOP_AUTH_PROFILE_CHECK_FAILED',
    'WHOOP_AUTH_SESSION_CHANGED'
  ) THEN auth_error
  ELSE 'WHOOP_AUTH_FAILED'
END
WHERE auth_error IS NOT NULL;
