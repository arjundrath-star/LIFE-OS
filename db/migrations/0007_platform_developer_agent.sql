-- 0007_platform_developer_agent — register the rathworkspace software specialist.
-- Hermes remains the orchestrator; this row is the mostly-idle specialist used for
-- build sessions on the actual rathworkspace.cloud platform.

INSERT OR IGNORE INTO agent_registry (
  slug, display_name, description, enabled, schedule_label, current_status
) VALUES (
  'rathworkspace-platform-developer',
  'Rathworkspace Platform Developer',
  'Software-development specialist for rathworkspace.cloud: Next.js dashboard, auth-gated APIs, WebSocket scheduler, SQLite migrations, and deployment verification. Idle except during build sessions.',
  1,
  'on build session',
  'idle'
);

UPDATE agent_registry
   SET display_name = 'Rathworkspace Platform Developer',
       description = 'Software-development specialist for rathworkspace.cloud: Next.js dashboard, auth-gated APIs, WebSocket scheduler, SQLite migrations, and deployment verification. Idle except during build sessions.',
       schedule_label = 'on build session',
       enabled = 1,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE slug = 'rathworkspace-platform-developer';
