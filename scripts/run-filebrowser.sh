#!/bin/bash
# Embedded file browser. Bound to localhost only; reachable solely through the gated
# /files proxy. noauth because the dashboard gate is the auth boundary.
set -e
FB=/home/Arjun/.local/bin/filebrowser
DB=/home/Arjun/rathworkspace/data/filebrowser.db

if [ ! -f "$DB" ]; then
  "$FB" config init -d "$DB"
  "$FB" config set -d "$DB" \
    --auth.method=noauth \
    --baseURL=/files \
    --root=/home/Arjun \
    --branding.name="rathworkspace files"
  # noauth needs a default admin user to assume
  "$FB" users add admin "$(head -c16 /dev/urandom | base64)" --perm.admin -d "$DB" 2>/dev/null || true
fi
chmod 600 "$DB" 2>/dev/null || true

exec "$FB" -d "$DB" -a 127.0.0.1 -p 8088 --baseURL /files --root /home/Arjun
