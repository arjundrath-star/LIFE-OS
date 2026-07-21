#!/usr/bin/env bash
# Dispatcher for the dedicated pokemon-scout Hermes profile.
# The deterministic path owns archive lifecycle, sink idempotency, and the one
# terminal dashboard event for this run.
set -Eeuo pipefail

PROJECT_DIR="${POKEMON_PROJECT_DIR:-/home/Arjun/command-center/Pokemon Machines}"
RATH_DIR="${POKEMON_RATH_DIR:-/home/Arjun/rathworkspace}"
PROMPT_FILE="${POKEMON_PROMPT_FILE:-$RATH_DIR/agents/pokemon-vending-lead-scout/profile-worker-prompt.md}"
RUN_ID="${POKEMON_AGENT_RUN_ID:-pokemon-leads-$(date -u +%Y%m%dT%H%M%SZ)}"
ARCHIVE_ROOT="${POKEMON_ARCHIVE_ROOT:-$PROJECT_DIR/Archive/lead-gen}"
ARCHIVE_DATE="${POKEMON_ARCHIVE_DATE:-$(date -u +%F)}"
ARCHIVE_DIR="$ARCHIVE_ROOT/$ARCHIVE_DATE/$RUN_ID"
POINTER_DIR="${POKEMON_POINTER_DIR:-$PROJECT_DIR/Leads}"
STATE_FILE="${POKEMON_SINK_STATE_FILE:-$ARCHIVE_ROOT/sink-state.json}"
EVENT="${POKEMON_EVENT_CMD:-$PROJECT_DIR/agent_event.sh}"
SCRAPER="${POKEMON_SCRAPER_CMD:-$PROJECT_DIR/scripts/pokemon_lead_system.py}"
SYNC="${POKEMON_SYNC_CMD:-$PROJECT_DIR/scripts/sync_pokemon_vending_drive.py}"
GOOGLE_PY="${POKEMON_PYTHON:-/home/Arjun/.hermes/google-venv/bin/python}"
MIN_CRM_ROWS="${POKEMON_CRM_MIN_ROWS:-100}"
PIPELINE_CSV="$PROJECT_DIR/pokemon vending/Pokemon_Vending_Lead_Pipeline.csv"
ACTIVE_CSV="$PROJECT_DIR/pokemon vending/Pokemon_Vending_Active_Leads.csv"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
STAGE="initializing_archive"
SUMMARY="Worker initialized"
SOURCE_FINGERPRINT=""
CRM_ACTION="not_started"
DRIVE_ACTION="not_started"
TERMINAL_EVENT_EMITTED=0

usage() {
  cat <<'EOF'
Usage: pokemon_machines_profile_worker.sh [--check|--help]

With no arguments, run the deterministic Pokemon lead-scout worker.
  --check  Validate local prerequisites without creating a run or contacting Drive.
  --help   Show this help without creating a run.
EOF
}

case "${1:-}" in
  "")
    [[ $# -eq 0 ]] || { printf 'Unexpected empty argument.\n' >&2; usage >&2; exit 64; }
    ;;
  --help|-h)
    [[ $# -eq 1 ]] || { printf 'Too many arguments.\n' >&2; usage >&2; exit 64; }
    usage
    exit 0
    ;;
  --check)
    [[ $# -eq 1 ]] || { printf 'Too many arguments.\n' >&2; usage >&2; exit 64; }
    HERMES_CHECK="${HERMES_BIN:-$(command -v hermes || true)}"
    if [[ -z "$HERMES_CHECK" && -x /home/Arjun/.local/bin/hermes ]]; then HERMES_CHECK="/home/Arjun/.local/bin/hermes"; fi
    missing=0
    [[ -d "$PROJECT_DIR" ]] || { printf 'Missing project directory: %s\n' "$PROJECT_DIR" >&2; missing=1; }
    [[ -d "$RATH_DIR" ]] || { printf 'Missing Rathworkspace directory: %s\n' "$RATH_DIR" >&2; missing=1; }
    [[ -f "$PROMPT_FILE" ]] || { printf 'Missing prompt file: %s\n' "$PROMPT_FILE" >&2; missing=1; }
    [[ -n "$HERMES_CHECK" && -x "$HERMES_CHECK" ]] || { printf 'Hermes CLI not found.\n' >&2; missing=1; }
    [[ -x "$EVENT" ]] || { printf 'Missing executable event helper: %s\n' "$EVENT" >&2; missing=1; }
    [[ -f "$SCRAPER" || -x "$SCRAPER" ]] || { printf 'Missing scraper: %s\n' "$SCRAPER" >&2; missing=1; }
    [[ -f "$SYNC" || -x "$SYNC" ]] || { printf 'Missing Drive sync: %s\n' "$SYNC" >&2; missing=1; }
    [[ -x "$GOOGLE_PY" ]] || { printf 'Missing Python runtime: %s\n' "$GOOGLE_PY" >&2; missing=1; }
    [[ $missing -eq 0 ]] || exit 1
    printf 'OK: Pokemon lead-scout prerequisites are available; no run was created.\n'
    exit 0
    ;;
  *)
    printf 'Unknown argument: %s\n' "$1" >&2
    usage >&2
    exit 64
    ;;
esac

export POKEMON_SCOUT_RUN_ID="$RUN_ID"
export POKEMON_AGENT_RUN_ID="$RUN_ID"
export POKEMON_AGENT_TRIGGER_TYPE="${POKEMON_AGENT_TRIGGER_TYPE:-manual}"
export POKEMON_AGENT_TRIGGER_SOURCE="${POKEMON_AGENT_TRIGGER_SOURCE:-pokemon-scout profile worker}"
export POKEMON_PROJECT_DIR="$PROJECT_DIR"

# This happens before prompt/CLI/script prerequisites are checked. Even an early
# failure therefore has a durable packet finalized by the EXIT trap.
umask 077
mkdir -p "$ARCHIVE_DIR" "$POINTER_DIR"
printf '%s\n' "$STARTED_AT" > "$ARCHIVE_DIR/started-at.txt"
: > "$ARCHIVE_DIR/worker.stderr.log"

emit_event() {
  local kind="$1" status="$2" summary="$3" level="${4:-success}"
  if [[ -x "$EVENT" ]]; then
    "$EVENT" "$kind" "$status" "$summary" "$level" >/dev/null 2>>"$ARCHIVE_DIR/worker.stderr.log" || true
  fi
}

json_is_true() {
  local file="$1" expression="$2"
  python3 - "$file" "$expression" <<'PY'
import json, sys
from pathlib import Path
try:
    value = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
except Exception:
    raise SystemExit(1)
parts = sys.argv[2].split('.')
for part in parts:
    if not isinstance(value, dict) or part not in value:
        raise SystemExit(1)
    value = value[part]
raise SystemExit(0 if value is True else 1)
PY
}

state_has_success() {
  local sink="$1" fingerprint="$2"
  python3 - "$STATE_FILE" "$sink" "$fingerprint" <<'PY'
import json, sys
from pathlib import Path
try:
    data = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    ok = (
        data.get('version') == 1 and
        data.get('source_fingerprint') == sys.argv[3] and
        data.get('sinks', {}).get(sys.argv[2], {}).get('status') == 'succeeded'
    )
except Exception:
    ok = False
raise SystemExit(0 if ok else 1)
PY
}

record_sink_success() {
  local sink="$1" fingerprint="$2" evidence="$3"
  python3 - "$STATE_FILE" "$sink" "$fingerprint" "$RUN_ID" "$evidence" <<'PY'
import datetime as dt, json, os, sys
from pathlib import Path
path = Path(sys.argv[1])
try:
    data = json.loads(path.read_text(encoding='utf-8'))
except Exception:
    data = {}
if data.get('version') != 1 or data.get('source_fingerprint') != sys.argv[3]:
    data = {'version': 1, 'source_fingerprint': sys.argv[3], 'sinks': {}}
data.setdefault('sinks', {})[sys.argv[2]] = {
    'status': 'succeeded', 'run_id': sys.argv[4], 'evidence': sys.argv[5],
    'recorded_at': dt.datetime.now(dt.timezone.utc).isoformat(),
}
path.parent.mkdir(parents=True, exist_ok=True)
tmp = path.with_suffix(path.suffix + '.tmp')
tmp.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')
os.replace(tmp, path)
PY
}

finalize() {
  local rc=$?
  trap - EXIT
  set +e
  local status terminal_kind completed_at
  completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [[ $rc -eq 0 ]]; then
    status="completed"
    terminal_kind="completed"
  else
    status="failed"
    terminal_kind="failed"
    SUMMARY="${SUMMARY:-Worker failed} (stage: $STAGE, exit: $rc)"
  fi

  # Successful snapshots were captured before sinks. Never label a partial file
  # as a successful snapshot from inside this finalizer.
  STATUS="$status" COMPLETED_AT="$completed_at" RC="$rc" python3 - "$ARCHIVE_DIR" "$RUN_ID" "$STARTED_AT" "$STAGE" "$SUMMARY" "$SOURCE_FINGERPRINT" "$CRM_ACTION" "$DRIVE_ACTION" <<'PY'
import hashlib, json, os, sys
from pathlib import Path
archive = Path(sys.argv[1])
run_id, started, stage, summary, fingerprint, crm_action, drive_action = sys.argv[2:9]
status, completed, rc = os.environ['STATUS'], os.environ['COMPLETED_AT'], int(os.environ['RC'])
artifacts = []
for item in sorted(archive.iterdir()):
    if item.is_file() and item.name not in {'manifest.json', 'manifest.md'}:
        digest = hashlib.sha256(item.read_bytes()).hexdigest()
        artifacts.append({'name': item.name, 'path': str(item), 'size': item.stat().st_size, 'sha256': digest})
summary_data = {
    'schema_version': 1, 'run_id': run_id, 'status': status, 'exit_code': rc,
    'started_at': started, 'completed_at': completed, 'final_stage': stage,
    'summary': summary, 'source_fingerprint': fingerprint or None,
    'sinks': {'crm': crm_action, 'drive': drive_action},
    'archive_dir': str(archive),
}
(archive / 'run-summary.json').write_text(json.dumps(summary_data, indent=2) + '\n', encoding='utf-8')
(archive / 'run-summary.md').write_text(
    '# Pokemon vending lead scout archive\n\n'
    f'- Run id: {run_id}\n- Status: {status}\n- Exit code: {rc}\n'
    f'- Started UTC: {started}\n- Completed UTC: {completed}\n- Final stage: {stage}\n'
    f'- Source fingerprint: {fingerprint or "unavailable"}\n- CRM action: {crm_action}\n'
    f'- Drive action: {drive_action}\n- Summary: {summary}\n\n'
    'No venue outreach was sent by this worker.\n', encoding='utf-8')
# Re-scan after summary creation so the manifest describes every prior artifact.
artifacts = []
for item in sorted(archive.iterdir()):
    if item.is_file() and item.name not in {'manifest.json', 'manifest.md'}:
        artifacts.append({'name': item.name, 'path': str(item), 'size': item.stat().st_size, 'sha256': hashlib.sha256(item.read_bytes()).hexdigest()})
manifest = {'schema_version': 1, 'run_id': run_id, 'status': status, 'archive_dir': str(archive), 'artifacts': artifacts}
(archive / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
(archive / 'manifest.md').write_text('# Manifest\n\n' + ''.join(f"- `{a['name']}`: `{a['path']}` ({a['size']} bytes, sha256 `{a['sha256']}`)\n" for a in artifacts), encoding='utf-8')
PY

  # Stable pointers are atomic. latest-run includes failed runs; successful is
  # advanced only after a zero exit.
  python3 - "$POINTER_DIR" "$ARCHIVE_DIR" "$RUN_ID" "$status" "$SUMMARY" "$completed_at" <<'PY'
import json, os, sys
from pathlib import Path
pointer, archive = Path(sys.argv[1]), Path(sys.argv[2])
run_id, status, summary, completed = sys.argv[3:7]
data = {'schema_version': 1, 'run_id': run_id, 'status': status, 'completed_at': completed, 'archive_dir': str(archive), 'summary': summary}
def write_pair(stem):
    j = pointer / f'{stem}.json'; m = pointer / f'{stem}.md'
    jt = j.with_suffix('.json.tmp'); mt = m.with_suffix('.md.tmp')
    jt.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')
    mt.write_text(f'# {stem.replace("-", " ").title()} Pokemon lead-scout worker archive\n\n- Date: {completed[:10]}\n- Run id: {run_id}\n- Status: {status}\n- Archive: {archive}\n- Summary: {summary}\n', encoding='utf-8')
    os.replace(jt, j); os.replace(mt, m)
write_pair('latest-run')
if status == 'completed': write_pair('latest-successful')
PY

  if [[ $TERMINAL_EVENT_EMITTED -eq 0 ]]; then
    emit_event "$terminal_kind" "$status" "$SUMMARY; stage=$STAGE; archive=$ARCHIVE_DIR" "$([[ $rc -eq 0 ]] && echo success || echo error)"
    TERMINAL_EVENT_EMITTED=1
  fi
  exit "$rc"
}
trap finalize EXIT
trap 'exit 130' INT TERM

STAGE="checking_prerequisites"
HERMES_BIN="${HERMES_BIN:-$(command -v hermes || true)}"
if [[ -z "$HERMES_BIN" && -x /home/Arjun/.local/bin/hermes ]]; then HERMES_BIN="/home/Arjun/.local/bin/hermes"; fi
[[ -f "$PROMPT_FILE" ]] || { SUMMARY="Missing prompt file: $PROMPT_FILE"; exit 1; }
[[ -n "$HERMES_BIN" && -x "$HERMES_BIN" ]] || { SUMMARY="Hermes CLI not found"; exit 1; }
cd "$PROJECT_DIR"
emit_event started running "Pokemon vending lead worker started" success

if [[ "${POKEMON_SCOUT_SMOKE:-}" == "1" ]]; then
  STAGE="hermes_smoke"
  "$HERMES_BIN" -p pokemon-scout chat --quiet --source pokemon-scout-smoke --toolsets file,terminal,skills --skills pokemon-vending-lead-scout --max-turns 6 --query "Smoke test only. Do not edit files, contact businesses, create leads, emit dashboard events, commit, push, or schedule anything. Reply in one sentence with your profile name, project dir $PROJECT_DIR, run id $RUN_ID, and the Pokemon location-fit doctrine."
  SUMMARY="Pokemon scout profile smoke completed"
  exit 0
fi

if [[ "${POKEMON_FIELD_PACKET_RUN:-}" == "1" ]]; then
  STAGE="weekly_field_packet"
  USER_PROMPT="$(cat <<EOF
Run id: $RUN_ID
Project dir: $PROJECT_DIR
Archive dir: $ARCHIVE_DIR
Stable pointer: $PROJECT_DIR/OPEN_THIS_WEEKLY_FIELD_PACKET.md
Terminal workdir symlink: /home/Arjun/command-center/Pokemon_Machines
The dispatcher owns the single terminal dashboard event. Emit progress events only, never completed/failed/blocked.

$(cat "$PROMPT_FILE")
EOF
)"
  "$HERMES_BIN" -p pokemon-scout chat --quiet --source pokemon-weekly-field-packet --toolsets web,file,terminal,skills,session_search,todo --skills pokemon-vending-lead-scout --max-turns 90 --query "$USER_PROMPT"
  [[ -s "$ARCHIVE_DIR/WEEKLY_FIELD_PACKET.md" ]] || { SUMMARY="Weekly field packet was not created"; exit 1; }
  [[ -s "$PROJECT_DIR/OPEN_THIS_WEEKLY_FIELD_PACKET.md" ]] || { SUMMARY="Stable weekly field-packet pointer was not created"; exit 1; }
  SUMMARY="Weekly Pokemon call/walk-in field packet completed"
  exit 0
fi

if [[ "${POKEMON_AGENTIC_RUN:-}" == "1" ]]; then
  STAGE="agentic_worker"
  USER_PROMPT="$(cat <<EOF
Run id: $RUN_ID
Project dir: $PROJECT_DIR
Terminal workdir symlink: /home/Arjun/command-center/Pokemon_Machines
The dispatcher owns the single terminal dashboard event. Emit progress events only, never completed/failed/blocked.

$(cat "$PROMPT_FILE")
EOF
)"
  "$HERMES_BIN" -p pokemon-scout chat --quiet --source pokemon-scout-profile-worker --toolsets web,file,terminal,skills,session_search,todo --skills pokemon-vending-lead-scout --max-turns 90 --query "$USER_PROMPT"
  SUMMARY="Agentic Pokemon scout worker completed"
  exit 0
fi

[[ -x "$EVENT" ]] || { SUMMARY="Missing executable event helper: $EVENT"; exit 1; }
[[ -f "$SCRAPER" || -x "$SCRAPER" ]] || { SUMMARY="Missing scraper: $SCRAPER"; exit 1; }
[[ -f "$SYNC" || -x "$SYNC" ]] || { SUMMARY="Missing Drive sync: $SYNC"; exit 1; }
[[ -x "$GOOGLE_PY" ]] || { SUMMARY="Missing Python runtime: $GOOGLE_PY"; exit 1; }

emit_event context_loaded running "Loaded owner-first Pokemon context and archive boundary" success
STAGE="generating_staging"
SUMMARY="Generating local staging mirrors"
POKEMON_USE_OSM_CACHE=1 "$GOOGLE_PY" "$SCRAPER" >"$ARCHIVE_DIR/pokemon_lead_system.json" 2>>"$ARCHIVE_DIR/worker.stderr.log"
emit_event sheet_build running "Built Pokemon vending staging mirrors" success

STAGE="crm_preflight"
SUMMARY="Running CRM identity and row-count preflight"
(
  cd "$RATH_DIR"
  npm run --silent import-pokemon-pipeline-crm -- --dry-run "$PIPELINE_CSV"
) >"$ARCHIVE_DIR/pokemon_crm_preflight.json" 2>>"$ARCHIVE_DIR/worker.stderr.log"
SOURCE_FINGERPRINT="$(python3 - "$ARCHIVE_DIR/pokemon_crm_preflight.json" "$MIN_CRM_ROWS" <<'PY'
import json, sys
from pathlib import Path
result = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
minimum = int(sys.argv[2])
if result.get('row_count', 0) < minimum:
    raise SystemExit(f"row_count {result.get('row_count')} is below minimum {minimum}")
if result.get('identity', {}).get('blocking_count', 0):
    raise SystemExit(f"blocking identity diagnostics: {result['identity']['diagnostics']}")
print(result['source_fingerprint'])
PY
)"
printf '%s\n' "$SOURCE_FINGERPRINT" > "$ARCHIVE_DIR/source-fingerprint.txt"

# Capture the validated packet before any production sink. cp --preserve keeps
# source permissions/timestamps and the originals remain in place.
STAGE="archiving_validated_source"
cp --preserve=mode,timestamps "$PIPELINE_CSV" "$ARCHIVE_DIR/Pokemon_Vending_Lead_Pipeline.snapshot.csv"
cp --preserve=mode,timestamps "$ACTIVE_CSV" "$ARCHIVE_DIR/Pokemon_Vending_Active_Leads.snapshot.csv"
emit_event dedupe running "Identity diagnostics passed with Lead ID primary and normalized-location shadow checks" success

if [[ "${POKEMON_CRM_DB_SYNC:-1}" == "1" ]]; then
  STAGE="crm_sink"
  if state_has_success crm "$SOURCE_FINGERPRINT"; then
    if (cd "$RATH_DIR" && npm run --silent import-pokemon-pipeline-crm -- --verify-fingerprint "$SOURCE_FINGERPRINT") >"$ARCHIVE_DIR/pokemon_crm_verify.json" 2>>"$ARCHIVE_DIR/worker.stderr.log" && json_is_true "$ARCHIVE_DIR/pokemon_crm_verify.json" verified; then
      CRM_ACTION="skipped_verified"
    else
      CRM_ACTION="verification_failed_fail_open"
    fi
  fi
  if [[ "$CRM_ACTION" != "skipped_verified" ]]; then
    (cd "$RATH_DIR" && npm run --silent import-pokemon-pipeline-crm -- --expect-fingerprint "$SOURCE_FINGERPRINT" --run-id "$RUN_ID" "$PIPELINE_CSV") >"$ARCHIVE_DIR/pokemon_crm_import.json" 2>>"$ARCHIVE_DIR/worker.stderr.log"
    json_is_true "$ARCHIVE_DIR/pokemon_crm_import.json" sink_verified || { SUMMARY="CRM importer did not return a verified transactional receipt"; exit 1; }
    CRM_ACTION="succeeded"
    record_sink_success crm "$SOURCE_FINGERPRINT" "sqlite transactional receipt"
  fi
  emit_event crm_sync running "CRM sink action: $CRM_ACTION" success
else
  CRM_ACTION="disabled"
fi

STAGE="drive_sink"
if [[ "${POKEMON_DRIVE_SYNC:-1}" == "1" ]]; then
  if state_has_success drive "$SOURCE_FINGERPRINT"; then
    if "$GOOGLE_PY" "$SYNC" --verify-fingerprint "$SOURCE_FINGERPRINT" >"$ARCHIVE_DIR/pokemon_drive_verify.json" 2>>"$ARCHIVE_DIR/worker.stderr.log" && json_is_true "$ARCHIVE_DIR/pokemon_drive_verify.json" verified; then
      DRIVE_ACTION="skipped_verified"
    else
      DRIVE_ACTION="verification_failed_fail_open"
    fi
  fi
  if [[ "$DRIVE_ACTION" != "skipped_verified" ]]; then
    "$GOOGLE_PY" "$SYNC" --source-fingerprint "$SOURCE_FINGERPRINT" >"$ARCHIVE_DIR/pokemon_drive_sync.json" 2>>"$ARCHIVE_DIR/worker.stderr.log"
    json_is_true "$ARCHIVE_DIR/pokemon_drive_sync.json" sink_verified || { SUMMARY="Drive sync did not return verified remote receipts"; exit 1; }
    DRIVE_ACTION="succeeded"
    record_sink_success drive "$SOURCE_FINGERPRINT" "remote Drive appProperties receipts"
  fi
  emit_event drive_sync running "Drive sink action: $DRIVE_ACTION" success
else
  DRIVE_ACTION="disabled"
fi

STAGE="summarizing"
SUMMARY="$(python3 - "$PIPELINE_CSV" "$CRM_ACTION" "$DRIVE_ACTION" <<'PY'
import csv, sys
from pathlib import Path
with Path(sys.argv[1]).open(encoding='utf-8', newline='') as handle:
    rows = list(csv.DictReader(handle))
seed = sum(row.get('Source') == 'Initial Claude prospect sheet' for row in rows)
print(f"Pokemon staging validated: {len(rows)} rows ({seed} seed, {len(rows)-seed} scraped); CRM {sys.argv[2]}; Drive {sys.argv[3]}")
PY
)"
STAGE="completed"
printf 'VPS: %s. Archive: %s\n' "$SUMMARY" "$ARCHIVE_DIR"
exit 0
