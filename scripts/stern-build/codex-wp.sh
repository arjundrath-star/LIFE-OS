#!/usr/bin/env bash
# Launch Codex on one work package in its own worktree, branch, DB copy, and port. Usage:
#   scripts/stern-build/codex-wp.sh <n> [--resume] [--base <branch>] [--notes <file>]
# n = 1..8 -> worktree $STERN_WT/wp<n>, branch stern/wp<n> (from feature/stern-tab unless --base), DB $STERN_DB_DIR/wp<n>.db, port 31<n>0.
# The prompt = preamble + docs/plans/stern/AGENTS-codex.md + docs/plans/stern/wp/WP<n>.md + footer. Log: $STERN_LOGS/wp<n>-codex.log
# Exit code is Codex's. The last assistant message lands in $STERN_REPORTS/wp<n>-last-message.md.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
N="${1:?wp number}"; shift
RESUME=0; BASE=feature/stern-tab; NOTES=""
while [ $# -gt 0 ]; do case "$1" in --resume) RESUME=1;; --base) BASE="$2"; shift;; --notes) NOTES="$2"; shift;; esac; shift; done
WT="$STERN_WT/wp$N"; BR="stern/wp$N"; DB="$STERN_DB_DIR/wp$N.db"; PORT="31${N}0"
INT="$STERN_WT/stern-tab"   # integration worktree holds the plan docs
if [ ! -d "$WT" ]; then
  git -C "$STERN_MAIN_REPO" branch "$BR" "$BASE" 2>/dev/null || true
  git -C "$STERN_MAIN_REPO" worktree add "$WT" "$BR" || exit 1
fi
[ -e "$WT/node_modules" ] || ln -s "$STERN_MAIN_REPO/node_modules" "$WT/node_modules"
if [ $RESUME -eq 0 ] || [ ! -f "$DB" ]; then sqlite3 "$STERN_DB_DIR/stern-dev.db" ".backup $DB"; fi
SPEC="$WT/docs/plans/stern/wp/WP$N.md"; RULES="$WT/docs/plans/stern/AGENTS-codex.md"
[ -f "$SPEC" ] || SPEC="$INT/docs/plans/stern/wp/WP$N.md"; [ -f "$RULES" ] || RULES="$INT/docs/plans/stern/AGENTS-codex.md"
[ -f "$SPEC" ] || { echo "missing spec $SPEC"; exit 2; }
PROMPT="$STERN_BUILD_ROOT/prompts/wp$N-prompt-$(stern_ts).md"
{
  echo "# Work package WP$N for the Stern tab (rathworkspace)"
  echo
  echo "You are Codex, building exactly one work package in an isolated git worktree. Facts for this run:"
  echo "- Worktree (your cwd, the ONLY tree you may edit): $WT on branch $BR"
  echo "- Database copy for every command you run: RATHWORKSPACE_DB=$DB (already exported). Never touch $STERN_MAIN_REPO or its data/ directory."
  echo "- Port reserved for you if you boot a server: $PORT (never 3000)."
  echo "- Plan docs: docs/plans/stern/ in this worktree. Schema contract: docs/plans/stern/schema/0029_stern.sql (already in db/migrations after WP0)."
  echo "- Mechanical gate you must pass before finishing: bash scripts/stern-build/gate.sh $WT $DB wp$N"
  echo "- Write your final report to docs/plans/stern/reports/WP$N-report.md and commit everything on $BR."
  echo "- Resume mode: $RESUME (1 means prior work exists on this branch; read git log and the report first)."
  echo
  echo "---"; echo; cat "$RULES"; echo; echo "---"; echo; cat "$SPEC"; echo; echo "---"
  if [ -n "$NOTES" ] && [ -f "$NOTES" ]; then echo; echo "# Orchestrator notes for this run (findings to fix, highest priority first)"; echo; cat "$NOTES"; echo; echo "---"; fi
  echo
  echo "Finish only when the acceptance checklist is fully met, the gate passes, the report is written, and the branch is committed. Do not ask questions; decide, and record the decision in the report."
} > "$PROMPT"
echo "launching codex on WP$N (model ${STERN_CODEX_MODEL:-gpt-6-astra}, worktree $WT, db $DB, port $PORT, prompt $PROMPT)"
MODEL="${STERN_CODEX_MODEL:-gpt-6-astra}"; EFFORT="${STERN_CODEX_EFFORT:-high}"
cd "$WT" && RATHWORKSPACE_DB="$DB" PORT="$PORT" codex exec \
  --dangerously-bypass-approvals-and-sandbox -C "$WT" -m "$MODEL" -c model_reasoning_effort="$EFFORT" \
  -o "$STERN_REPORTS/wp$N-last-message.md" "$(cat "$PROMPT")" >>"$STERN_LOGS/wp$N-codex.log" 2>&1
RC=$?
echo "$(stern_ts) codex WP$N exit=$RC" | tee -a "$STERN_LOGS/wp$N-codex.log"
exit $RC
