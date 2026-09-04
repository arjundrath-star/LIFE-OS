#!/usr/bin/env bash
# Boot or stop an isolated production-mode server for one worktree on its own port with its own DB copy.
# Requires a prior `next build` in that worktree (gate.sh does it). Usage:
#   scripts/stern-build/isolated-server.sh start <worktree-dir> <db-copy-path> <port>
#   scripts/stern-build/isolated-server.sh stop <port>
#   scripts/stern-build/isolated-server.sh cookie   # prints a session cookie value via scripts/pokemon-ops-mint-session.ts
# The server runs in its own session (setsid) with stdio detached, so `start` returns as soon as the port answers
# even when its output is piped, and `stop` kills the whole process group (npx, sh, node), not just the launcher.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
CMD="${1:?start|stop|cookie}"
SECRETS=/home/Arjun/.config/rathworkspace/secrets.env
kill_port() { # kill anything still listening on the port (belt and braces after the group kill)
  local port="$1" pids
  pids=$(ss -ltnp 2>/dev/null | awk -v p=":$port" '$4 ~ p"$" {print $NF}' | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u)
  [ -n "$pids" ] && kill -TERM $pids 2>/dev/null
  return 0
}
case "$CMD" in
  start)
    WT="${2:?worktree}"; DB="${3:?db copy}"; PORT="${4:?port}"
    case "$DB" in "$STERN_MAIN_REPO"/*) echo "refusing to boot against the prod DB"; exit 2;; esac
    [ "$PORT" = "3000" ] && { echo "port 3000 is prod"; exit 2; }
    [ -d "$WT/.next" ] || { echo "no .next build in $WT; run gate.sh first"; exit 2; }
    [ -f "$SECRETS" ] || { echo "missing $SECRETS"; exit 2; }
    PIDF="$STERN_LOGS/server-$PORT.pid"; LOG="$STERN_LOGS/server-$PORT.log"
    if [ -f "$PIDF" ]; then OLD=$(cat "$PIDF"); kill -TERM -- -"$OLD" 2>/dev/null || kill -TERM "$OLD" 2>/dev/null; fi
    kill_port "$PORT"; sleep 1
    setsid bash -c "cd '$WT' && set -a && . '$SECRETS' && set +a && exec env NODE_ENV=production PORT='$PORT' HOST=127.0.0.1 RATHWORKSPACE_DB='$DB' npx tsx server.ts" >"$LOG" 2>&1 </dev/null &
    echo $! >"$PIDF"
    for i in $(seq 1 60); do
      if curl -s -m 5 -o /dev/null "http://127.0.0.1:$PORT/signin"; then echo "up on $PORT pid $(cat "$PIDF") log $LOG"; exit 0; fi
      kill -0 "$(cat "$PIDF")" 2>/dev/null || { echo "server exited early; see $LOG"; exit 1; }
      sleep 1
    done
    echo "server did not come up in 60 s; see $LOG"; exit 1;;
  stop)
    PORT="${2:?port}"; PIDF="$STERN_LOGS/server-$PORT.pid"
    if [ -f "$PIDF" ]; then
      PID=$(cat "$PIDF")
      kill -TERM -- -"$PID" 2>/dev/null || kill -TERM "$PID" 2>/dev/null
      rm -f "$PIDF"
    fi
    kill_port "$PORT"; sleep 1
    if ss -ltn 2>/dev/null | grep -q ":$PORT "; then kill_port "$PORT"; sleep 1; fi
    ss -ltn 2>/dev/null | grep -q ":$PORT " && { echo "port $PORT still busy"; exit 1; } || echo "stopped $PORT";;
  cookie)
    ( cd "$STERN_MAIN_REPO" && npx tsx scripts/pokemon-ops-mint-session.ts 2>/dev/null | tail -1 );;
  *) echo "unknown command"; exit 2;;
esac
