#!/usr/bin/env bash
# Send a build-progress email to Arjun. Usage:
#   scripts/stern-build/email.sh "<subject>" <body-file or -> [attachment ...]
# From arjun@kladeai.com (gws-arjun config) to arjundrath@gmail.com. Subject is prefixed "[Stern build]".
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
SUBJ="${1:?subject}"; BODY="${2:?body file or -}"; shift 2
if [ "$BODY" = "-" ]; then BODY_TXT="$(cat)"; else BODY_TXT="$(cat "$BODY")"; fi
RAW=$(python3 - "$SUBJ" "$BODY_TXT" "$@" <<'PY'
import sys, base64, os
from email.message import EmailMessage
subj, body = sys.argv[1], sys.argv[2]; atts = sys.argv[3:]
m = EmailMessage()
m['From'] = 'Arjun Rath <arjun@kladeai.com>'; m['To'] = 'arjundrath@gmail.com'
m['Subject'] = '[Stern build] ' + subj
m.set_content(body)
for p in atts:
    if not os.path.isfile(p): continue
    with open(p, 'rb') as f: data = f.read()
    m.add_attachment(data, maintype='text', subtype='plain', filename=os.path.basename(p))
print(base64.urlsafe_b64encode(m.as_bytes()).decode())
PY
)
OUT=$(gws gmail users messages send --params '{"userId":"me"}' --json "{\"raw\":\"$RAW\"}" 2>&1)
RC=$?
echo "$(stern_ts) rc=$RC subject=$SUBJ $(echo "$OUT" | tr -d '\n' | cut -c1-120)" >> "$STERN_LOGS/emails.log"
[ $RC -eq 0 ] && echo "sent: [Stern build] $SUBJ" || { echo "email failed: $OUT" >&2; exit 1; }
