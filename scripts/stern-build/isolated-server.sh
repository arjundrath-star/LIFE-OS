#!/usr/bin/env bash
# Boot or stop an isolated production-mode server for one worktree on its own port with its own DB copy.
# Requires a prior `next build` in that worktree (gate.sh does it). Usage:
#   scripts/stern-build/isolated-server.sh start <worktree-dir> <db-copy-path> <port>
#   scripts/stern-build/isolated-server.sh stop <port>
#   scripts/stern-build/isolated-server.sh cookie   # prints a session cookie value via scripts/pokemon-ops-mint-session.ts
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
CMD="${1:?start|stop|cookie}"
case "$CMD" in
  start)
    WT="${2:?worktree}"; DB="${3:?db copy}"; PORT="${4:?port}"
    case "$DB" in "$STERN_MAIN_REPO"/*) echo "refusing to boot against the prod DB"; exit 2;; esac
    [ "$PORT" = "3000" ] && { echo "port 3000 is prod"; exit 2; }
    [ -d "$WT/.next" ] || { echo "no .next build in $WT; run gate.sh first"; exit 2; }
    PIDF="$STERN_LOGS/server-$PORT.pid"; LOG="$STERN_LOGS/server-$PORT.log"
    [ -f "$PIDF" ] && kill "$(cat "$PIDF")" 2>/dev/null; sleep 1
    ( cd "$WT" && set -a && . /home/Arjun/.config/rathworkspace/secrets.env && set +a && \
      NODE_ENV=production PORT="$PORT" HOST=127.0.0.1 RATHWORKSPACE_DB="$DB" nohup npx tsx server.ts >"$LOG" 2>&1 & echo $! >"$PIDF" )
    for i in $(seq 1 30); do curl -s -o /dev/null "http://127.0.0.1:$PORT/signin" && { echo "up on $PORT pid $(cat "$PIDF") log $LOG"; exit 0; }; sleep 1; done
    echo "server did not come up; see $LOG"; exit 1;;
  stop)
    PORT="${2:?port}"; PIDF="$STERN_LOGS/server-$PORT.pid"
    [ -f "$PIDF" ] && kill "$(cat "$PIDF")" 2>/dev/null && rm -f "$PIDF" && echo "stopped $PORT" || echo "nothing on $PORT";;
  cookie)
    ( cd "$STERN_MAIN_REPO" && npx tsx scripts/pokemon-ops-mint-session.ts 2>/dev/null | tail -1 );;
  *) echo "unknown command"; exit 2;;
esac
