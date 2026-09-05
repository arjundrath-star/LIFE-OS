#!/usr/bin/env bash
# Nightly SQLite backup of the production rathworkspace DB (WP7 deliverable 5).
# Usage: scripts/stern-backup.sh [--db <path>] [--dest <dir>] [--keep-days <n>]
# Uses `sqlite3 .backup` (online, WAL-safe, read-only on the source). Keeps 14 days by default.
# Installed as a user crontab entry at 03:30 with the ( cd "$REPO" && ... ) pattern:
#   30 3 * * * ( cd /home/Arjun/rathworkspace && bash scripts/stern-backup.sh ) >> /home/Arjun/stern-build/logs/backup.log 2>&1
set -uo pipefail
export PATH="/home/Arjun/.local/bin:/home/Arjun/.npm-global/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
DB="${RATHWORKSPACE_DB:-/home/Arjun/rathworkspace/data/rathworkspace.db}"
DEST=/home/Arjun/stern-build/db/backups
KEEP=14
while [ $# -gt 0 ]; do case "$1" in --db) DB="$2"; shift;; --dest) DEST="$2"; shift;; --keep-days) KEEP="$2"; shift;; *) echo "unknown arg $1"; exit 2;; esac; shift; done
[ -f "$DB" ] || { echo "$(date -u +%FT%TZ) backup skipped: no DB at $DB"; exit 1; }
mkdir -p "$DEST"; chmod 700 "$DEST"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$DEST/rathworkspace-$STAMP.db"
if sqlite3 "$DB" ".backup '$OUT'"; then
  chmod 600 "$OUT"
  if sqlite3 "$OUT" "PRAGMA integrity_check;" | grep -qx ok; then
    SIZE=$(stat -c %s "$OUT")
    echo "$(date -u +%FT%TZ) backup ok $OUT ${SIZE} bytes"
  else
    echo "$(date -u +%FT%TZ) backup FAILED integrity check: $OUT"; exit 1
  fi
else
  echo "$(date -u +%FT%TZ) backup FAILED: sqlite3 .backup from $DB"; exit 1
fi
# Retention: delete backups older than KEEP days (only files this script names).
find "$DEST" -maxdepth 1 -type f -name 'rathworkspace-*.db' -mtime "+$KEEP" -print -delete | sed 's/^/pruned /'
exit 0
