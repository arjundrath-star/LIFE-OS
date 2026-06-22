-- 0002_seed — initial Accounts & Links hub + the spec's seeded to-dos.
-- These are starting points; the hub is user-editable from the UI afterward.

INSERT INTO accounts (label, kind, email, url, surface, status, note, sort) VALUES
  ('ops@example.com',        'google',  'ops@example.com',      NULL, 'gws default',  'active',   'Klade ops + memos, gws default config', 10),
  ('operator@example.com',      'google',  'operator@example.com',    NULL, 'gws-arjun',    'active',   'Founder mailbox', 11),
  ('teammate@example.com',       'google',  'teammate@example.com',     NULL, 'gws-adam',     'active',   'Cofounder, Gmail+Sheets+Drive', 12),
  ('operator@example.com',   'google',  'operator@example.com', NULL, 'personal',     'active',   'Personal + Higgsfield Plus auth', 13),
  ('student@example.edu',        'google',  'student@example.edu',      NULL, 'nyu',          'active',   'NYU managed; school calendar from 2026-08-29', 14),
  ('Higgsfield CLI',         'service', 'operator@example.com', 'https://higgsfield.ai', 'claude', 'active', 'Ad-engine video gen, Plus plan', 20),
  ('Hermes',                 'service', NULL, 'http://OVERLAY_HOST:9119', 'hermes', 'active', 'Personal agent OS, gateway + dashboard on Tailscale', 21),
  ('Telegram bot',           'service', NULL, NULL, 'claude', 'active', 'Klade_Claude_Bot long-poll listener', 22),
  ('Tailscale',              'service', NULL, 'https://login.tailscale.com', 'vps', 'active', 'Tailnet for Hermes + internal services', 23),
  ('Cloudflare',             'service', NULL, 'https://dash.cloudflare.com', 'dashboard', 'active', 'DNS for example.com + rathworkspace tunnel', 24),
  ('Codex CLI',              'service', NULL, NULL, 'vps', 'active', 'Daily audit, ChatGPT Plus auth', 25),
  ('Vercel',                 'service', NULL, 'https://vercel.com', 'dashboard', 'active', 'example.com motion site deploys', 26),
  ('Supabase',               'service', NULL, 'https://supabase.com', 'claude', 'active', 'Klade data engine, 5M+ records', 27),
  ('example.com',            'link',    NULL, 'https://example.com', 'dashboard', 'active', 'Klade ad-studio live site', 30),
  ('rathworkspace.cloud',    'link',    NULL, 'https://rathworkspace.cloud', 'dashboard', 'active', 'This dashboard', 31),
  ('GitHub — KladeAI',       'link',    NULL, 'https://github.com/KladeAI', 'dashboard', 'active', 'Company code org', 32);

INSERT INTO todos (text, source, due) VALUES
  ('Add a Claude Code Stop-hook + CLAUDE.md line so each session writes its activity to the dashboard', 'spec', NULL),
  ('Wire Mercury revenue once the vending LLC starts taking payments', 'spec', NULL),
  ('Layer in the NYU school calendar', 'spec', '2026-08-29');
