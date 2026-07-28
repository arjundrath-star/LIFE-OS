#!/usr/bin/env bash
# pokemon-ops-alerts.sh — Phase 5 deterministic Telegram alerts + morning
# digest. Plain OS cron + bash + curl so it works even if Hermes is down.
# All SQL/business logic lives in scripts/pokemon-ops-alerts-data.ts (tsx);
# this script only sends/logs/marks based on that CLI's JSON output.
#
# Modes:
#   (default)        immediate: unalerted open action/urgent recommendations
#                    + unalerted sourcing observations beating benchmark by
#                    alert_threshold_pct -> one Telegram message each;
#                    alerted_at is set ONLY after a confirmed "ok":true send
#                    (send-then-mark — a failed send stays unalerted for the
#                    next run).
#   --digest         07:30 morning KPI summary. Sends one message
#                    unconditionally; never marks anything.
#   --dry-run        print exact message payloads without sending or marking.
#                    Combine with --digest for the digest payload. Accepts
#                    --as-of passthrough for deterministic tests.
#   --test           send a single fixed test message and print the raw
#                    Telegram JSON response. NEVER run this from an agent —
#                    it is a live send; only the human orchestrator runs it.
#
# Cron PATH trap (Learnings 2026-05-05): cron's minimal environment lacks
# node/tsx/jq/curl on PATH — export a full one before anything else runs.
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_CLI="$REPO_ROOT/scripts/pokemon-ops-alerts-data.ts"
TSX_BIN="$REPO_ROOT/node_modules/.bin/tsx"
LOG_DIR="$REPO_ROOT/logs"
LOG_FILE="$LOG_DIR/pokemon-ops-alerts.log"
# Delivery config comes from the environment (cron exports it):
#   POKEMON_ALERTS_CHAT_ID  target Telegram chat id (required for live sends)
#   TELEGRAM_BOT_TOKEN      bot token, or
#   TELEGRAM_ENV_FILE       path to an env file that defines TELEGRAM_BOT_TOKEN
CHAT_ID="${POKEMON_ALERTS_CHAT_ID:-}"

mkdir -p "$LOG_DIR"

log() {
  echo "[$(date -u '+%F %T UTC')] $*" >> "$LOG_FILE"
}

tsx_cli() {
  # Subshell-cd to the repo: tsx resolves the tsconfig "@/" path alias relative
  # to cwd, and cron's cwd is $HOME — without this every cron run dies with
  # MODULE_NOT_FOUND '@/db' (bit us on the first live cron ticks 2026-07-17).
  ( cd "$REPO_ROOT" && "$TSX_BIN" "$DATA_CLI" "$@" )
}

# curl -s + a Telegram-shaped JSON fallback so callers can always `jq .ok`
# without checking curl's own exit code separately.
send_telegram() {
  local text="$1"
  local token="${TELEGRAM_BOT_TOKEN:-}"
  if [ -z "$token" ] && [ -n "${TELEGRAM_ENV_FILE:-}" ]; then
    token=$(grep -E '^TELEGRAM_BOT_TOKEN=' "$TELEGRAM_ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"') || true
  fi
  if [ -z "${token:-}" ]; then
    echo '{"ok":false,"error_description":"no TELEGRAM_BOT_TOKEN found"}'
    return 0
  fi
  if [ -z "${CHAT_ID:-}" ]; then
    echo '{"ok":false,"error_description":"POKEMON_ALERTS_CHAT_ID not set"}'
    return 0
  fi
  curl -s -m 10 "https://api.telegram.org/bot${token}/sendMessage" \
    -d "chat_id=${CHAT_ID}" \
    --data-urlencode "text=${text}" \
    || echo '{"ok":false,"error_description":"curl request failed"}'
}

DIGEST=0
# Non-live-DB safety: alerts computed from a test/temp DB must never reach
# the operator's phone. If RATHWORKSPACE_DB points anywhere but the production
# DB, force dry-run (incident 2026-07-17: a dispatcher dry run against a temp
# DB live-sent two real alerts).
if [ -n "${RATHWORKSPACE_DB:-}" ] && [ "${RATHWORKSPACE_DB}" != "$REPO_ROOT/data/rathworkspace.db" ]; then
  FORCE_DRY_NONLIVE=1
else
  FORCE_DRY_NONLIVE=0
fi

DRY_RUN=0
TEST_MODE=0
AS_OF=""

while [ $# -gt 0 ]; do
  case "$1" in
    --digest) DIGEST=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --test) TEST_MODE=1; shift ;;
    --as-of) AS_OF="${2:-}"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$AS_OF" ]; then
  AS_OF="$(date -u '+%Y-%m-%dT%H:%M:%S.000Z')"
fi

if [ "$FORCE_DRY_NONLIVE" = "1" ] && [ "$DRY_RUN" != "1" ]; then
  echo "non-live RATHWORKSPACE_DB detected: forcing --dry-run (no sends, no marks)" >&2
  DRY_RUN=1
  TEST_MODE=0
fi

if [ "$TEST_MODE" = "1" ]; then
  resp="$(send_telegram "pokemon-ops alerts: test send OK")"
  echo "$resp"
  log "TEST send response: $resp"
  exit 0
fi

if [ "$DIGEST" = "1" ]; then
  message="$(tsx_cli digest --as-of "$AS_OF" | jq -r '.message')"
  if [ "$DRY_RUN" = "1" ]; then
    echo "$message"
    exit 0
  fi
  resp="$(send_telegram "$message")"
  ok="$(echo "$resp" | jq -r '.ok // false')"
  log "digest sent (ok=$ok)"
  exit 0
fi

# ---- immediate mode ----
alerts_json="$(tsx_cli pending --as-of "$AS_OF")"

if [ "$DRY_RUN" = "1" ]; then
  echo "$alerts_json" | jq -r '.alerts[] | "DRY kind=\(.kind) id=\(.id) :: \(.message)"'
  exit 0
fi

count="$(echo "$alerts_json" | jq '.alerts | length')"
if [ "$count" -eq 0 ]; then
  log "0 alerts"
  exit 0
fi

while IFS= read -r alert; do
  kind="$(echo "$alert" | jq -r '.kind')"
  id="$(echo "$alert" | jq -r '.id')"
  message="$(echo "$alert" | jq -r '.message')"
  resp="$(send_telegram "$message")"
  ok="$(echo "$resp" | jq -r '.ok // false')"
  if [ "$ok" = "true" ]; then
    tsx_cli mark --kind "$kind" --id "$id" --at "$AS_OF" > /dev/null
    log "sent+marked kind=$kind id=$id"
  else
    log "SEND FAILED kind=$kind id=$id resp=$resp"
  fi
done < <(echo "$alerts_json" | jq -c '.alerts[]')
