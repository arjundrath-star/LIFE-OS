# PHASE 5 — Telegram alerts + morning digest (OS cron, no Hermes dependency)

Goal: deterministic alerting. New actionable pk_recommendations and threshold-beating
price observations reach Arjun's Telegram; a morning digest summarizes state. Runs as
plain OS cron + bash + curl so it works even if Hermes is down.

Context: PLAN.md §3 alerts; discovery §3 Telegram (bot token in ~/.hermes/.env; curl
fallback pattern in workspace/scripts/hermes-codex-watchdog.sh; Arjun chat id documented
there). Recommendations/observations carry alerted_at — alerts are rows, never
double-sent.

Work:
1. `scripts/pokemon-ops-alerts.sh`: immediate mode (every 15 min: unalerted open
   recommendations severity action/urgent + unalerted observations beating benchmark by
   alert_threshold_pct → one message each, set alerted_at via the IMMEDIATE-tx CLI) and
   `--digest` mode (07:30: KPI summary, days-of-supply spread, open recs count, best
   current offer per product). `--dry-run` prints exact payloads without sending or
   marking.
2. OS crontab entries (user Arjun) for both modes.
3. Fixture tests for message assembly (golden expected payloads from seeded dev data).

Out of scope: Hermes skills/jobs, scanners, Nayax, UI changes.

DoD:
- `bash scripts/pokemon-ops-alerts.sh --dry-run` output matches fixture expectations
  (diff → empty)
- one real test send → response JSON contains `"ok":true` (paste it)
- `crontab -l | grep pokemon-ops-alerts` → 2 entries
- re-run immediate mode → 0 messages (alerted_at respected)
- verify:pokemon-ops → 0; tag `pokemon-ops/phase-5` pushed
