#!/bin/bash
# Embedded terminal. Bound to localhost only; reachable solely through the gated
# /terminal proxy in the dashboard. Base path /terminal so ttyd's own assets/ws resolve.
exec /home/Arjun/.local/bin/ttyd \
  -i 127.0.0.1 -p 7681 \
  -b /terminal \
  -W \
  -t fontSize=14 \
  -t 'theme={"background":"#0A0A0B","foreground":"#E5E7EB","cursor":"#06B6D4","selectionBackground":"#0E7490"}' \
  bash
