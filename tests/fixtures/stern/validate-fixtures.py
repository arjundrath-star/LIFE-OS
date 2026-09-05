import json, re, sys
from datetime import datetime
import jsonschema

SCHEMA = "/home/Arjun/.openclaw/workspace/stern/prep/schema/email-classifier.schema.json"
FIX = "/home/Arjun/.openclaw/workspace/stern/prep/fixtures/emails.json"
schema = json.load(open(SCHEMA))
fixtures = json.load(open(FIX))
validator = jsonschema.Draft202012Validator(schema)

expected_order = [
 "coffee_chat_request_sent","coffee_chat_reply_positive","scheduling_confirmed","calendar_invite",
 "coffee_chat_reply_negative","follow_up_sent","thank_you_sent","icc_newsletter","club_general_meeting",
 "club_application_confirmation","club_interview_invite","club_result_accepted","club_result_rejected",
 "brightspace_assignment","brightspace_grade","course_announcement","exam_reminder","other_nyu","irrelevant",
 "coffee_chat_reply_positive"]
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-04:00$")
lo, hi = datetime.fromisoformat("2026-09-05T00:00:00-04:00"), datetime.fromisoformat("2026-10-04T23:59:59-04:00")
errors = []
assert len(fixtures) == 20, f"expected 20 fixtures, got {len(fixtures)}"
for i, fx in enumerate(fixtures, 1):
    fid = fx["id"]
    if fid != f"fx-{i:03d}": errors.append(f"{fid}: bad id order")
    for k in ["id","threadId","account","labelIds","from","to","cc","date","subject","text","expected"]:
        if k not in fx: errors.append(f"{fid}: missing top-level {k}")
    exp = fx["expected"]
    for e in validator.iter_errors(exp):
        errors.append(f"{fid}: SCHEMA {list(e.path)}: {e.message}")
    if exp["category"] != expected_order[i-1]:
        errors.append(f"{fid}: category {exp['category']} != scenario {expected_order[i-1]}")
    if exp["evidence_excerpt"] not in fx["text"]:
        errors.append(f"{fid}: evidence_excerpt not verbatim in body")
    if len(exp["summary"]) > 140: errors.append(f"{fid}: summary too long")
    if len(exp["evidence_excerpt"]) > 300: errors.append(f"{fid}: evidence too long")
    d = datetime.fromisoformat(fx["date"])
    if not (lo <= d <= hi): errors.append(f"{fid}: date {fx['date']} outside Sept 5 to Oct 4")
    if not ISO.match(fx["date"]): errors.append(f"{fid}: date not -04:00 ISO")
    sent = "SENT" in fx["labelIds"]
    if sent != (exp["direction"] == "outbound"): errors.append(f"{fid}: direction/label mismatch")
    if sent and not fx["from"].startswith("Arjun Rath <netid@"): errors.append(f"{fid}: SENT but from is not Arjun")
    if fx["account"] not in fx["from"] + fx["to"] + fx["cc"] and fid != "fx-020" and "-fa26@" not in fx["to"]:
        errors.append(f"{fid}: account not in from/to/cc")
    for t in exp.get("proposed_times", []) + ([exp["confirmed_time"]] if exp.get("confirmed_time") else []):
        if not ISO.match(t): errors.append(f"{fid}: time {t} not ISO -04:00")
    if exp.get("assignment") and exp["assignment"].get("due_at") and not ISO.match(exp["assignment"]["due_at"]):
        errors.append(f"{fid}: assignment.due_at not ISO -04:00")
    for dm in exp.get("deadline_mentions", []):
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", dm["date"]): errors.append(f"{fid}: deadline date {dm['date']} not YYYY-MM-DD")
    for p in exp["people"]:
        if "netid@" in p["email"]: errors.append(f"{fid}: account owner listed in people")
        if p.get("is_eboard") and not p.get("club_or_org"): errors.append(f"{fid}: eboard person without club_or_org")
    if exp["confidence"] >= 0.9: band = "clear"
    elif 0.6 <= exp["confidence"] <= 0.8: band = "ambiguous"
    else: errors.append(f"{fid}: confidence {exp['confidence']} outside the 0.9+ / 0.6 to 0.8 bands")
# dedupe pair
a, b = fixtures[1], fixtures[19]
if a["messageId"] != b["messageId"]: errors.append("fx-002/fx-020 messageId differ")
if a["account"] == b["account"]: errors.append("fx-002/fx-020 same account")
if a["expected"] != b["expected"]: errors.append("fx-002/fx-020 expected differ")
if a["subject"] != b["subject"] or a["date"] != b["date"] or a["from"] != b["from"]: errors.append("fx-002/fx-020 header mismatch")
if not b["text"].endswith(a["text"]): errors.append("fx-020 body does not contain fx-002 body")
# dashes in bodies/summaries (house style)
for fx in fixtures:
    for field in ("text","subject"):
        if "—" in fx[field] or "–" in fx[field]: errors.append(f"{fx['id']}: em/en dash in {field}")
    if "—" in fx["expected"]["summary"]: errors.append(f"{fx['id']}: em dash in summary")
# line counts
for fx in fixtures:
    n = len([l for l in fx["text"].split("\n") if l.strip()])
    print(f"{fx['id']} {fx['expected']['category']:32s} conf={fx['expected']['confidence']:<4} lines={n:2d} sum={len(fx['expected']['summary']):3d} ev={len(fx['expected']['evidence_excerpt']):3d} reply={fx['expected']['requires_reply_from_me']}")
print("ERRORS:", len(errors))
for e in errors: print(" -", e)
sys.exit(1 if errors else 0)
