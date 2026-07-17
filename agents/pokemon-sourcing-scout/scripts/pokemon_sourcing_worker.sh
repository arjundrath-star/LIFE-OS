#!/usr/bin/env bash
# Dispatcher for pokemon-ops Phase 6 (Hermes sourcing scanner). Deterministic
# path: runs the TCGplayer + eBay price scrapers, imports both CSVs via the
# shared observations importer, archives the run, then (optionally) dispatches
# the retail-restock agentic phase to the dedicated pokemon-scout Hermes
# profile and imports whatever it staged. Finally emits exactly one terminal
# dashboard event and runs the Phase 5 immediate-alerts pass.
#
# Architecture mirrors agents/pokemon-vending-lead-scout/scripts/
# pokemon_machines_profile_worker.sh: env-overridable config block, strict
# bash mode, stage tracking, a durable per-run archive dir, and a trap-based
# finalizer that guarantees the one terminal agent-event fires on every exit
# path (success, scraper failure, import failure, or an unhandled error).
#
# Idempotency note (no separate sink-state file): unlike the lead-scout
# worker, this dispatcher does not need its own sink-state JSON. Each price
# scrape is genuinely new data every run (new observed_date), and the
# downstream importer (lib/pokemon-ops/import-observations.ts) already owns
# idempotency at two layers — file-level sha256 receipt (pk_import_receipts)
# and row-level UNIQUE(source, listing_ref, observed_date, product_id) —
# so calling it repeatedly with the same or overlapping content is always
# safe and correctly reports imported/skipped counts. Re-inventing that here
# would just duplicate logic the importer already guarantees.
set -Eeuo pipefail

RATH_DIR="${POKEMON_SOURCING_RATH_DIR:-/home/Arjun/rathworkspace}"
AGENT_DIR="$RATH_DIR/agents/pokemon-sourcing-scout"
SOURCING_PYTHON="${POKEMON_SOURCING_PYTHON:-$AGENT_DIR/venv/bin/python}"
EBAY_SCRAPER="${POKEMON_SOURCING_EBAY_SCRAPER:-$AGENT_DIR/scripts/ebay_scraper.py}"
TCG_SCRAPER="${POKEMON_SOURCING_TCG_SCRAPER:-$AGENT_DIR/scripts/tcgplayer_scraper.py}"
DB_PATH="${RATHWORKSPACE_DB:-$RATH_DIR/data/rathworkspace.db}"
EBAY_MAX_PER_SET="${POKEMON_SOURCING_EBAY_MAX_PER_SET:-10}"

RUN_ID="${POKEMON_SOURCING_RUN_ID:-pokemon-sourcing-$(date -u +%Y%m%dT%H%M%SZ)}"
ARCHIVE_ROOT="${POKEMON_SOURCING_ARCHIVE_ROOT:-/home/Arjun/command-center/Pokemon Machines/Archive/sourcing}"
ARCHIVE_DATE="${POKEMON_SOURCING_ARCHIVE_DATE:-$(date -u +%F)}"
ARCHIVE_DIR="$ARCHIVE_ROOT/$ARCHIVE_DATE/$RUN_ID"
OBSERVED_DATE="${POKEMON_SOURCING_OBSERVED_DATE:-$(date -u +%F)}"

AGENT_SLUG="${POKEMON_SOURCING_AGENT_SLUG:-pokemon-sourcing-scout}"
AGENT_DISPLAY_NAME="${POKEMON_SOURCING_AGENT_DISPLAY_NAME:-Pokemon Sourcing Scout}"
AGENT_DESCRIPTION="${POKEMON_SOURCING_AGENT_DESCRIPTION:-Deterministic daily price-feed scanner (TCGplayer + eBay) plus an agentic Target/Costco/Sams Club/Walmart reprint-wave restock watch for pokemon-ops. Writes dated pk_price_observations; never contacts venues or spends money.}"
AGENT_SCHEDULE_LABEL="${POKEMON_SOURCING_SCHEDULE_LABEL:-daily 06:15 ET}"
TRIGGER_TYPE="${POKEMON_SOURCING_TRIGGER_TYPE:-manual}"
TRIGGER_SOURCE="${POKEMON_SOURCING_TRIGGER_SOURCE:-pokemon-sourcing-scout worker}"

RUN_AGENTIC="${RUN_AGENTIC:-1}"
HERMES_PROFILE="${POKEMON_SOURCING_HERMES_PROFILE:-pokemon-scout}"
HERMES_SKILL="${POKEMON_SOURCING_HERMES_SKILL:-pokemon-sourcing-scout}"
STAGING_CSV="$ARCHIVE_DIR/retail_restock_staging.csv"

ALERTS_SCRIPT="${POKEMON_SOURCING_ALERTS_SCRIPT:-$RATH_DIR/scripts/pokemon-ops-alerts.sh}"
RUN_ALERTS="${POKEMON_SOURCING_RUN_ALERTS:-1}"

STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
STAGE="initializing_archive"
SUMMARY="Worker initialized"
TCG_IMPORTED=0; TCG_SKIPPED=0
EBAY_IMPORTED=0; EBAY_SKIPPED=0
RETAIL_IMPORTED=0; RETAIL_SKIPPED=0
RETAIL_ACTION="not_run"
ALERTS_ACTION="not_run"
TERMINAL_EVENT_EMITTED=0

umask 077
mkdir -p "$ARCHIVE_DIR"
printf '%s\n' "$STARTED_AT" > "$ARCHIVE_DIR/started-at.txt"
: > "$ARCHIVE_DIR/worker.stderr.log"

finalize() {
  local rc=$?
  trap - EXIT
  set +e
  local status kind level completed_at
  completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [[ $rc -eq 0 ]]; then
    status="completed"; kind="completed"; level="success"
  else
    status="failed"; kind="failed"; level="error"
    SUMMARY="${SUMMARY:-Worker failed} (stage: $STAGE, exit: $rc)"
  fi

  STATUS="$status" COMPLETED_AT="$completed_at" RC="$rc" python3 - "$ARCHIVE_DIR" "$RUN_ID" "$STARTED_AT" "$STAGE" "$SUMMARY" <<'PY'
import hashlib, json, os, sys
from pathlib import Path
archive = Path(sys.argv[1])
run_id, started, stage, summary = sys.argv[2:6]
status, completed, rc = os.environ['STATUS'], os.environ['COMPLETED_AT'], int(os.environ['RC'])
artifacts = []
for item in sorted(archive.iterdir()):
    if item.is_file() and item.name not in {'manifest.json', 'manifest.md'}:
        digest = hashlib.sha256(item.read_bytes()).hexdigest()
        artifacts.append({'name': item.name, 'path': str(item), 'size': item.stat().st_size, 'sha256': digest})
summary_data = {
    'schema_version': 1, 'run_id': run_id, 'status': status, 'exit_code': rc,
    'started_at': started, 'completed_at': completed, 'final_stage': stage,
    'summary': summary, 'archive_dir': str(archive),
}
(archive / 'run-summary.json').write_text(json.dumps(summary_data, indent=2) + '\n', encoding='utf-8')
(archive / 'run-summary.md').write_text(
    '# Pokemon sourcing scout archive\n\n'
    f'- Run id: {run_id}\n- Status: {status}\n- Exit code: {rc}\n'
    f'- Started UTC: {started}\n- Completed UTC: {completed}\n- Final stage: {stage}\n'
    f'- Summary: {summary}\n\nNo venue/retailer outreach, purchases, or accounts were created by this worker.\n',
    encoding='utf-8')
artifacts = []
for item in sorted(archive.iterdir()):
    if item.is_file() and item.name not in {'manifest.json', 'manifest.md'}:
        artifacts.append({'name': item.name, 'path': str(item), 'size': item.stat().st_size, 'sha256': hashlib.sha256(item.read_bytes()).hexdigest()})
manifest = {'schema_version': 1, 'run_id': run_id, 'status': status, 'archive_dir': str(archive), 'artifacts': artifacts}
(archive / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
(archive / 'manifest.md').write_text('# Manifest\n\n' + ''.join(f"- `{a['name']}`: `{a['path']}` ({a['size']} bytes, sha256 `{a['sha256']}`)\n" for a in artifacts), encoding='utf-8')
PY

  python3 - "$ARCHIVE_ROOT" "$ARCHIVE_DIR" "$RUN_ID" "$status" "$SUMMARY" "$completed_at" <<'PY'
import json, os, sys
from pathlib import Path
root, archive = Path(sys.argv[1]), Path(sys.argv[2])
run_id, status, summary, completed = sys.argv[3:7]
data = {'schema_version': 1, 'run_id': run_id, 'status': status, 'completed_at': completed, 'archive_dir': str(archive), 'summary': summary}
root.mkdir(parents=True, exist_ok=True)
j = root / 'latest-run.json'; m = root / 'latest-run.md'
jt = j.with_suffix('.json.tmp'); mt = m.with_suffix('.md.tmp')
jt.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')
mt.write_text(f'# Latest Pokemon sourcing scout run\n\n- Date: {completed[:10]}\n- Run id: {run_id}\n- Status: {status}\n- Archive: {archive}\n- Summary: {summary}\n', encoding='utf-8')
os.replace(jt, j); os.replace(mt, m)
if status == 'completed':
    j2 = root / 'latest-successful-run.json'; m2 = root / 'latest-successful-run.md'
    j2t = j2.with_suffix('.json.tmp'); m2t = m2.with_suffix('.md.tmp')
    j2t.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')
    m2t.write_text(f'# Latest successful Pokemon sourcing scout run\n\n- Date: {completed[:10]}\n- Run id: {run_id}\n- Status: {status}\n- Archive: {archive}\n- Summary: {summary}\n', encoding='utf-8')
    os.replace(j2t, j2); os.replace(m2t, m2)
PY

  if [[ $TERMINAL_EVENT_EMITTED -eq 0 ]]; then
    (cd "$RATH_DIR" && npm run --silent agent-event -- \
      --agent "$AGENT_SLUG" \
      --run "$RUN_ID" \
      --kind "$kind" \
      --status "$status" \
      --level "$level" \
      --summary "$SUMMARY" \
      --trigger-type "$TRIGGER_TYPE" \
      --trigger-source "$TRIGGER_SOURCE" \
      --display-name "$AGENT_DISPLAY_NAME" \
      --description "$AGENT_DESCRIPTION" \
      --schedule-label "$AGENT_SCHEDULE_LABEL" \
      >"$ARCHIVE_DIR/agent-event.json" 2>>"$ARCHIVE_DIR/worker.stderr.log") || true
    TERMINAL_EVENT_EMITTED=1
  fi
  printf 'Pokemon sourcing scout: %s. Archive: %s\n' "$SUMMARY" "$ARCHIVE_DIR"
  exit "$rc"
}
trap finalize EXIT
trap 'exit 130' INT TERM

STAGE="checking_prerequisites"
[[ -x "$SOURCING_PYTHON" ]] || { SUMMARY="Missing scraper Python runtime: $SOURCING_PYTHON"; exit 1; }
[[ -f "$TCG_SCRAPER" ]] || { SUMMARY="Missing TCGplayer scraper: $TCG_SCRAPER"; exit 1; }
[[ -f "$EBAY_SCRAPER" ]] || { SUMMARY="Missing eBay scraper: $EBAY_SCRAPER"; exit 1; }
[[ -f "$RATH_DIR/package.json" ]] || { SUMMARY="Missing rathworkspace repo at $RATH_DIR"; exit 1; }

# ---- TCGplayer feed ----
STAGE="tcgplayer_scrape"
SUMMARY="Running TCGplayer price scrape"
"$SOURCING_PYTHON" "$TCG_SCRAPER" --live --observed-date "$OBSERVED_DATE" \
  --out "$ARCHIVE_DIR/tcgplayer.csv" 2>"$ARCHIVE_DIR/tcgplayer.stderr.log"

STAGE="tcgplayer_import"
SUMMARY="Importing TCGplayer observations"
(cd "$RATH_DIR" && npm run --silent import:pokemon-ops -- observations "$ARCHIVE_DIR/tcgplayer.csv") \
  >"$ARCHIVE_DIR/tcgplayer_import.json" 2>>"$ARCHIVE_DIR/worker.stderr.log"
TCG_IMPORTED="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('imported',0))" "$ARCHIVE_DIR/tcgplayer_import.json")"
TCG_SKIPPED="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('skipped',0))" "$ARCHIVE_DIR/tcgplayer_import.json")"

# ---- eBay feed ----
STAGE="ebay_scrape"
SUMMARY="Running eBay bulk-lot scrape"
"$SOURCING_PYTHON" "$EBAY_SCRAPER" --live --max-per-set "$EBAY_MAX_PER_SET" \
  --db "$DB_PATH" --observed-date "$OBSERVED_DATE" \
  --out "$ARCHIVE_DIR/ebay.csv" 2>"$ARCHIVE_DIR/ebay.stderr.log"

STAGE="ebay_import"
SUMMARY="Importing eBay observations"
(cd "$RATH_DIR" && npm run --silent import:pokemon-ops -- observations "$ARCHIVE_DIR/ebay.csv") \
  >"$ARCHIVE_DIR/ebay_import.json" 2>>"$ARCHIVE_DIR/worker.stderr.log"
EBAY_IMPORTED="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('imported',0))" "$ARCHIVE_DIR/ebay_import.json")"
EBAY_SKIPPED="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('skipped',0))" "$ARCHIVE_DIR/ebay_import.json")"

# ---- optional agentic retail-restock watch ----
if [[ "$RUN_AGENTIC" == "1" ]]; then
  STAGE="agentic_restock_watch"
  SUMMARY="Running retail-restock agentic phase"
  HERMES_BIN="${HERMES_BIN:-$(command -v hermes || true)}"
  if [[ -z "$HERMES_BIN" && -x /home/Arjun/.local/bin/hermes ]]; then HERMES_BIN="/home/Arjun/.local/bin/hermes"; fi
  if [[ -z "$HERMES_BIN" ]]; then
    RETAIL_ACTION="skipped_no_hermes_cli"
  else
    USER_PROMPT="$(cat <<EOF
Run id: $RUN_ID
Observed date (UTC): $OBSERVED_DATE
Staging file (write your findings here, exact absolute path, create it only
if you have at least one finding — an absent or empty file is fine and
expected on most days): $STAGING_CSV

The dispatcher owns the single terminal dashboard event for this run; do not
emit dashboard events yourself. Do not contact any retailer, buy anything,
create accounts, or submit forms. Follow the pokemon-sourcing-scout skill's
target-product list, retailer list, find criteria, and exact CSV output
format. Report back in one or two sentences what you found (or that you
found nothing) plus the staging file path.
EOF
)"
    set +e
    "$HERMES_BIN" -p "$HERMES_PROFILE" chat --quiet --source pokemon-sourcing-scout-worker \
      --toolsets web,file,terminal,skills --skills "$HERMES_SKILL" --max-turns 60 \
      --query "$USER_PROMPT" >"$ARCHIVE_DIR/agentic.log" 2>&1
    AGENTIC_RC=$?
    set -e
    if [[ $AGENTIC_RC -ne 0 ]]; then
      RETAIL_ACTION="agentic_phase_failed_exit_$AGENTIC_RC"
    else
      RETAIL_ACTION="agentic_phase_completed"
    fi
  fi

  STAGE="retail_restock_import"
  SUMMARY="Importing retail-restock staging rows"
  if [[ -s "$STAGING_CSV" ]] && [[ "$(tail -n +2 "$STAGING_CSV" | grep -c '[^[:space:]]' || true)" -gt 0 ]]; then
    (cd "$RATH_DIR" && npm run --silent import:pokemon-ops -- observations "$STAGING_CSV") \
      >"$ARCHIVE_DIR/retail_restock_import.json" 2>>"$ARCHIVE_DIR/worker.stderr.log"
    RETAIL_IMPORTED="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('imported',0))" "$ARCHIVE_DIR/retail_restock_import.json")"
    RETAIL_SKIPPED="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('skipped',0))" "$ARCHIVE_DIR/retail_restock_import.json")"
  else
    RETAIL_IMPORTED=0
    RETAIL_SKIPPED=0
    [[ "$RETAIL_ACTION" == "not_run" ]] || RETAIL_ACTION="${RETAIL_ACTION}; no_staged_rows"
    [[ "$RETAIL_ACTION" != "not_run" ]] || RETAIL_ACTION="no_staged_rows"
  fi
else
  RETAIL_ACTION="disabled_run_agentic=0"
fi

# ---- immediate alerts (Phase 5 pipeline; send-then-mark idempotent) ----
STAGE="immediate_alerts"
SUMMARY="Running immediate alerts pass"
if [[ "$RUN_ALERTS" == "1" ]] && [[ -f "$ALERTS_SCRIPT" ]]; then
  set +e
  bash "$ALERTS_SCRIPT" >"$ARCHIVE_DIR/alerts.log" 2>&1
  ALERTS_RC=$?
  set -e
  ALERTS_ACTION="exit_$ALERTS_RC"
else
  ALERTS_ACTION="disabled"
fi

STAGE="completed"
SUMMARY="tcgplayer imported=$TCG_IMPORTED skipped=$TCG_SKIPPED; ebay imported=$EBAY_IMPORTED skipped=$EBAY_SKIPPED; retail_restock imported=$RETAIL_IMPORTED skipped=$RETAIL_SKIPPED ($RETAIL_ACTION); alerts=$ALERTS_ACTION"
exit 0
