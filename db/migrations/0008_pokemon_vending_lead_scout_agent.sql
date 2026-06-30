-- 0008_pokemon_vending_lead_scout_agent - register the Pokemon vending lead scout.
-- Hermes remains the orchestrator; this row is the review-only specialist for
-- Pokemon / trading-card vending machine placement lead research.

INSERT OR IGNORE INTO agent_registry (
  slug, display_name, description, enabled, schedule_label, current_status
) VALUES (
  'pokemon-vending-lead-scout',
  'Pokemon Vending Lead Scout',
  'Lead-scout specialist for Pokemon and trading-card vending machines. Finds, dedupes, and scores high-traffic impulse locations, then prepares review-only packets. Never contacts venues autonomously.',
  1,
  'manual or scheduled',
  'idle'
);

UPDATE agent_registry
   SET display_name = 'Pokemon Vending Lead Scout',
       description = 'Lead-scout specialist for Pokemon and trading-card vending machines. Finds, dedupes, and scores high-traffic impulse locations, then prepares review-only packets. Never contacts venues autonomously.',
       schedule_label = 'manual or scheduled',
       enabled = 1,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE slug = 'pokemon-vending-lead-scout';
