# PHASE 0 — Repo hygiene (blocker removal)

Goal: make `main` a clean, complete, deployed baseline so every later session builds on
tracked, pushed state. Discovery found prod running unmerged `feature/pokemon-crm-mvp`
(13 ahead of main), a dirty tree (2 modified files), and migration
`0010_pokemon_pipeline_sink_receipts.sql` applied to the live DB but UNTRACKED in git
(a fresh clone would be missing schema production depends on).

Context: SYSTEM_DISCOVERY.md §1 (deploy model: prod runs the checked-out branch from
source), §6.1. Repo `AGENTS.md` rules apply.

Work:
1. `git add db/migrations/0010_pokemon_pipeline_sink_receipts.sql` and commit with a
   message explaining it was applied-but-untracked.
2. Inspect the 2 modified files; commit if coherent work, revert if cruft — either way
   justify in the commit message.
3. Merge `feature/pokemon-crm-mvp` → `main` (discovery says clean fast-forward-able),
   check out `main` in the prod working dir, push.
4. `npm run migrate` (expect no-op), `npm run build`, `sudo systemctl restart rathworkspace`,
   confirm the site answers.

Out of scope: ANY pokemon-ops code, migrations, or schema. No new files beyond commits.

DoD (all must pass, paste outputs into PROGRESS.md):
- `git branch --show-current` → `main`
- `git status --short` → empty
- `git log origin/main..main --oneline` → empty (pushed)
- `npm run migrate` → exit 0, no new migrations applied
- `npm run build` → exit 0
- `curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/` → 200/302/307
- `git tag --list 'pokemon-ops/phase-0'` → shows the annotated tag (pushed)
