#!/bin/bash
# Embedded file browser. Bound to localhost only; reachable solely through the gated
# /files proxy. noauth because the dashboard gate is the auth boundary.
#
# FILES_ROOT is the only directory this exposes. Set it to the narrowest scope
# the operator actually browses; the auth gate is the boundary, but the root is
# the blast radius behind it.
set -e
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FB="${FILEBROWSER_BIN:-$HOME/.local/bin/filebrowser}"
DB="${FILEBROWSER_DB:-$REPO/data/filebrowser.db}"
ROOT="${FILES_ROOT:-$HOME}"
PORT="${FILEBROWSER_PORT:-8088}"

if [ ! -f "$DB" ]; then
  "$FB" config init -d "$DB"
  "$FB" config set -d "$DB" \
    --auth.method=noauth \
    --baseURL=/files \
    --root="$ROOT" \
    --branding.name="files"
  # noauth needs a default admin user to assume
  "$FB" users add admin "$(head -c16 /dev/urandom | base64)" --perm.admin -d "$DB" 2>/dev/null || true
fi
chmod 600 "$DB" 2>/dev/null || true

exec "$FB" -d "$DB" -a 127.0.0.1 -p "$PORT" --baseURL /files --root "$ROOT"
