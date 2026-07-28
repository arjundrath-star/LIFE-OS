-- 0002_seed: illustrative Accounts & Links hub rows + the spec's seeded to-dos.
-- These are starting points only; the hub is user-editable from the UI afterward.
-- A fresh clone seeds placeholder identities; real accounts are added through the UI.

INSERT INTO accounts (label, kind, email, url, surface, status, note, sort) VALUES
  ('ops@example.com',         'google',  'ops@example.com',       NULL, 'gws default',  'active',   'Ops mailbox + automated memos, CLI default config', 10),
  ('founder@example.com',     'google',  'founder@example.com',   NULL, 'gws-founder',  'active',   'Founder mailbox', 11),
  ('partner@example.com',     'google',  'partner@example.com',   NULL, 'gws-partner',  'active',   'Partner mailbox, Gmail+Sheets+Drive', 12),
  ('personal@example.com',    'google',  'personal@example.com',  NULL, 'personal',     'active',   'Personal account', 13),
  ('student@university.example', 'google', 'student@university.example', NULL, 'school', 'active',  'University managed; term calendar from 2026-08-29', 14),
  ('Higgsfield CLI',          'service', 'personal@example.com', 'https://higgsfield.ai', 'claude', 'active', 'Ad video generation', 20),
  ('Hermes',                  'service', NULL, 'http://localhost:9119', 'hermes', 'active', 'Personal agent OS gateway, private-network only', 21),
  ('Telegram bot',            'service', NULL, NULL, 'claude', 'active', 'Ops alert bot, long-poll listener', 22),
  ('Tailscale',               'service', NULL, 'https://login.tailscale.com', 'vps', 'active', 'Private network for internal services', 23),
  ('Cloudflare',              'service', NULL, 'https://dash.cloudflare.com', 'dashboard', 'active', 'DNS + dashboard tunnel', 24),
  ('Codex CLI',               'service', NULL, NULL, 'vps', 'active', 'Daily code audit', 25),
  ('Vercel',                  'service', NULL, 'https://vercel.com', 'dashboard', 'active', 'Marketing site deploys', 26),
  ('Supabase',                'service', NULL, 'https://supabase.com', 'claude', 'active', 'Managed Postgres for the data pipeline', 27),
  ('Marketing site',          'link',    NULL, 'https://example.com', 'dashboard', 'active', 'Public marketing site', 30),
  ('Dashboard',               'link',    NULL, 'https://dashboard.example.com', 'dashboard', 'active', 'This dashboard', 31),
  ('GitHub',                  'link',    NULL, 'https://github.com', 'dashboard', 'active', 'Code org', 32);

INSERT INTO todos (text, source, due) VALUES
  ('Add a Claude Code Stop-hook + CLAUDE.md line so each session writes its activity to the dashboard', 'spec', NULL),
  ('Wire revenue reporting once the business bank account is connected', 'spec', NULL),
  ('Layer in the school calendar', 'spec', '2026-08-29');
