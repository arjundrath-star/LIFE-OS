#!/usr/bin/env python3
"""Deterministic official-bot Discord deal watcher. Silent when idle/unconfigured."""
from __future__ import annotations
import json, os, re, sqlite3, sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

PRICE_RE = re.compile(r"(?<![\w$])\$\s*(\d{1,5}(?:\.\d{1,2})?)\b")
URL_RE = re.compile(r"https://[^\s<>]+")
RELEVANCE = re.compile(r"\b(pok[eé]mon|pokemon|booster|elite trainer box|\betb\b|sealed|scarlet|violet|prismatic|151|surging sparks|destined rivals|journey together|white flare|black bolt|ascended heroes)\b", re.I)
MAX_PAGES = 5

def parse_price(text: str) -> int | None:
    match = PRICE_RE.search(text)
    if not match: return None
    value = round(float(match.group(1)) * 100)
    return value if 50 <= value <= 1_000_000 else None

def relevant(text: str) -> bool: return bool(RELEVANCE.search(text)) and (parse_price(text) is not None or "deal" in text.lower() or "sale" in text.lower())
def excerpt(text: str, limit: int = 280) -> str: return re.sub(r"[\x00-\x1f\x7f]+", " ", text).strip()[:limit]
def product_text(text: str) -> str:
    clean = excerpt(URL_RE.sub("", text), 140)
    return clean.split("$")[0].strip(" -:|") or "Pokemon deal"

def load_secret_file() -> dict[str,str]:
    values: dict[str,str] = {}
    target = Path(os.environ.get("RATHWORKSPACE_SECRETS_PATH", str(Path.home()/".config/rathworkspace/secrets.env")))
    try:
        for raw in target.read_text().splitlines():
            line=raw.strip()
            if not line or line.startswith("#") or "=" not in line: continue
            key,value=line.split("=",1); values[key.strip()]=value.strip().strip('"\'')
    except OSError: pass
    values.update({k:v for k,v in os.environ.items() if v})
    return values

def ensure_schema(db: sqlite3.Connection) -> None:
    db.executescript("""CREATE TABLE IF NOT EXISTS pk_discord_deals(id INTEGER PRIMARY KEY AUTOINCREMENT,source_guild_id TEXT,channel_id TEXT NOT NULL,message_id TEXT NOT NULL,product_text TEXT NOT NULL,price_cents INTEGER,url TEXT,observed_at TEXT NOT NULL,matching_status TEXT NOT NULL DEFAULT 'unmatched' CHECK (matching_status IN ('unmatched','matched','ignored')),raw_excerpt TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),UNIQUE(channel_id,message_id));CREATE INDEX IF NOT EXISTS idx_pk_discord_deals_observed ON pk_discord_deals(observed_at DESC);CREATE TABLE IF NOT EXISTS pk_discord_cursors(channel_id TEXT PRIMARY KEY,last_message_id TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));""")

def fetch_messages(token: str, channel: str, after: str | None) -> list[dict]:
    query={"limit":"100"}
    if after: query["after"]=after
    req=Request(f"https://discord.com/api/v10/channels/{channel}/messages?{urlencode(query)}",headers={"Authorization":f"Bot {token}","User-Agent":"RathworkspaceDiscordWatcher/1.0"})
    with urlopen(req,timeout=8) as res: return json.load(res)

def store_messages(db: sqlite3.Connection, channel: str, messages: list[dict]) -> int:
    added=0
    for msg in sorted(messages,key=lambda m:int(m.get("id","0"))):
        text=str(msg.get("content") or "")
        if relevant(text):
            urls=URL_RE.findall(text); url=urls[0].rstrip(".,)") if urls else None
            cur=db.execute("INSERT OR IGNORE INTO pk_discord_deals(source_guild_id,channel_id,message_id,product_text,price_cents,url,observed_at,matching_status,raw_excerpt) VALUES(?,?,?,?,?,?,?,?,?)",(msg.get("guild_id"),channel,str(msg["id"]),product_text(text),parse_price(text),url,msg.get("timestamp") or "1970-01-01T00:00:00Z","unmatched",excerpt(text)))
            added += cur.rowcount
    if messages:
        newest=max((str(m["id"]) for m in messages),key=int)
        db.execute("INSERT INTO pk_discord_cursors(channel_id,last_message_id) VALUES(?,?) ON CONFLICT(channel_id) DO UPDATE SET last_message_id=excluded.last_message_id,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",(channel,newest))
    return added

def drain_channel(db: sqlite3.Connection, token: str, channel: str, after: str | None, max_pages: int = MAX_PAGES) -> int:
    total=0; cursor=after
    for _ in range(max_pages):
        messages=fetch_messages(token,channel,cursor)
        if not messages: break
        total += store_messages(db,channel,messages)
        newest=max((str(m["id"]) for m in messages),key=int)
        if cursor is not None and int(newest) <= int(cursor): break
        cursor=newest
        if len(messages) < 100: break
    return total

def main() -> int:
    secrets=load_secret_file(); token=secrets.get("DISCORD_BOT_TOKEN","").strip(); channels=[c.strip() for c in secrets.get("DISCORD_WATCH_CHANNEL_IDS","").split(",") if c.strip()]
    if not token or not channels: return 0
    if any(not re.fullmatch(r"\d{15,22}",c) for c in channels): print("Discord watcher configuration has an invalid channel ID.",file=sys.stderr); return 2
    db_path=Path(secrets.get("RATHWORKSPACE_DB", str(Path.cwd()/"data/rathworkspace.db")))
    try:
        db=sqlite3.connect(db_path); ensure_schema(db); total=0
        for channel in channels:
            row=db.execute("SELECT last_message_id FROM pk_discord_cursors WHERE channel_id=?",(channel,)).fetchone()
            total += drain_channel(db,token,channel,row[0] if row else None)
        db.commit(); db.close()
        if total: print(f"{total} new Pokemon deal{'s' if total != 1 else ''} found on Discord.")
        return 0
    except HTTPError as exc: print(f"Discord watcher API request failed with status {exc.code}.",file=sys.stderr); return 3
    except (URLError,TimeoutError): print("Discord watcher could not reach the Discord API.",file=sys.stderr); return 4
    except (OSError,sqlite3.Error): print("Discord watcher could not update its local state.",file=sys.stderr); return 5

if __name__ == "__main__": raise SystemExit(main())
