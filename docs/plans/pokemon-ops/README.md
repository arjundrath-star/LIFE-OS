# Pokemon Card Vending Ops System — plan bundle

Drop this whole directory at `~/rathworkspace/docs/plans/pokemon-ops/`, commit it, push.
That is the only install step; sessions do the rest.

Reading order for a human:
1. PLAN.md — the stable spec: architecture, LOCKED database schema, phase index,
   human checklist, session protocol. Supersedes BUILD_PLAN_PROPOSAL.md where they
   differ.
2. BUILD_PLAN_PROPOSAL.md — the original proposal, kept for the architecture
   diagram and provenance. The schema section is superseded by PLAN.md §2
   (pk_benchmarks + pk_sourcing_offers were unified into pk_price_observations).

Operating it:
- PROGRESS.md is the handoff contract between autonomous sessions.
- phases/PHASE-N.md are per-session specs (read-only to build sessions).
- prompts/PHASE-N-prompt.md is the exact text to paste into a fresh Claude Code /
  ultracode session in tmux. Phase order: 0 → 1 → 2 → 3 → 4, then 5/6/7 in any order or
  parallel, 8 stretch after 7.
- Before Phase 1: fill the two MACHINE FACTS placeholders in prompts/PHASE-1-prompt.md.
- Before Phase 7: complete human checklist item 1 (PLAN.md §5). Before 6, item 2 if the
  eBay API path is wanted.
- seeds/carddistro-2026-07-17.csv is the initial supplier-quote seed; Phase 1 imports
  it. The copy in this repo carries synthetic sample prices, not a real quote sheet.
