# pokemon-sourcing-scout

Phase 6 price-feed scrapers for pokemon-ops. Each feed is deterministic
Python, no LLM calls, emitting the shared carddistro observation CSV format
consumed by `scripts/pokemon-ops-import.ts observations <csv>`:

```
observed_date,source,set_name,form,price_per_pack_usd,lot_size,includes_shipping,includes_tax,listing_ref,notes
```

`listing_ref` is the dedupe key downstream (`UNIQUE(source, listing_ref, observed_date, product_id)` in `pk_price_observations`), so it must be a stable per-product identifier, not something that changes run to run.

## TCGplayer feed

Script: `scripts/tcgplayer_scraper.py`
Fixtures: `fixtures/tcgplayer/`
Tests: `tests/test_tcgplayer_scraper.py`

### Source choice

Chosen source: **tcgcsv.com** (https://tcgcsv.com/), specifically:

- `https://tcgcsv.com/tcgplayer/3/groups` — full list of TCGplayer "groups"
  (sets) for categoryId 3 (Pokemon). 217 groups as of 2026-07-17. Used only
  to build/review the `SET_NAME_TO_GROUP` mapping table below, not called at
  scrape time.
- `https://tcgcsv.com/tcgplayer/3/{groupId}/products` — every product
  (booster packs, boxes, ETBs, code cards, bundles, ...) in a group, with
  `productId`, `name`, `url` (canonical `tcgplayer.com` product page).
- `https://tcgcsv.com/tcgplayer/3/{groupId}/prices` — pricing rows keyed by
  `productId`, with `lowPrice`, `midPrice`, `highPrice`, `marketPrice`,
  `directLowPrice`.

tcgcsv.com is a long-running third-party mirror that republishes
TCGplayer's own category/group/product/price data as daily JSON dumps
(confirmed reachable from this VPS, HTTP 200, 2026-07-17). `tcgplayer.com`
itself is not scraped — it is bot-blocked and out of scope per the task
brief. `api.pokemontcg.io/v2` (card-level data) was evaluated as a fallback
but was not needed: tcgcsv covers all 14 of our mappable sets with
sealed-product pricing directly, so **tcgcsv is the sole path** for this
feed.

**Gotcha (load-bearing):** tcgcsv.com returns HTTP 401 for the default
`requests`/`urllib` Python User-Agent string. A curl-like User-Agent header
(`curl/8.5.0`, set in `USER_AGENT` in the script) is required — confirmed
live 2026-07-17. `curl` itself works with its default UA; only the Python
HTTP clients' default UA gets blocked.

### Product selection rule

Within a mapped group, the target product is the one whose **name is
exactly** `"{set_name} Booster Pack"`. This was verified against the real
product lists for all 14 mapped groups (see `fixtures/tcgplayer/*_products.json`).
An exact match (rather than a `"booster pack" in name` substring match) is
required because every group also carries sibling SKUs that would otherwise
false-positive:

- `"{set_name} Sleeved Booster Pack"` — a different, more expensive product
- `"Code Card - {set_name} Booster Pack"` — a digital code, not a pack
- `"{set_name} Booster Pack Art Bundle [Set of 4]"` — a 4-pack bundle
- `"{set_name} Sleeved Booster Pack Art Bundle [Set of 4]"`

Price: `marketPrice` from the group's `prices` payload, falling back to
`midPrice` if `marketPrice` is null (documented per-row in the `notes`
column as `price=marketPrice` or `price=midPrice_fallback`). In practice all
14 mapped products had a `marketPrice` on 2026-07-17; the fallback path is
exercised only in unit tests (`TestPriceFallback` in the test file), not in
the recorded fixtures. If neither price is available, the product is
skipped with a stderr note and no row is emitted (a required price field
can never be blank downstream).

`listing_ref` is the TCGplayer product page URL as captured in tcgcsv's
`url` field (e.g.
`https://www.tcgplayer.com/product/644352/pokemon-me01-mega-evolution-mega-evolution-booster-pack`).
It is 1:1 with `productId` and stable across days, so it works as the
downstream dedupe key. `includes_shipping=0` and `includes_tax=0` always
(TCGplayer's `marketPrice`/`midPrice` are sticker prices, no shipping or tax
folded in). `lot_size=1` (one pack per row/product).

### SET_NAME_TO_GROUP mapping table

Reviewed 2026-07-17 against the live `https://tcgcsv.com/tcgplayer/3/groups`
listing, for the 15 `pk_products` rows with `active=1 AND form='booster'`:

| set_name              | tcgcsv groupId | tcgcsv group name              | notes |
|-----------------------|---------------:|---------------------------------|-------|
| Phantasmal Flames     | 24448          | ME02: Phantasmal Flames         | |
| Mega Evolution        | 24380          | ME01: Mega Evolution            | fuzzy: substring "Mega Evolution" also matches "ME: Mega Evolution Promo" (24451) and "MEE: Mega Evolution Energies" (24461) — those are spinoff/promo groups, not the base set; hard-coded to 24380. |
| Destined Rivals       | 24269          | SV10: Destined Rivals           | |
| Journey Together      | 24073          | SV09: Journey Together          | |
| Paldean Fates         | 23353          | SV: Paldean Fates               | |
| 151                   | 23237          | SV: Scarlet & Violet 151        | |
| Pitch Black           | 24688          | ME05: Pitch Black               | |
| Chaos Rising          | 24655          | ME04: Chaos Rising              | |
| Perfect Order         | 24587          | ME03: Perfect Order             | |
| Ascended Heroes       | 24541          | ME: Ascended Heroes             | |
| White Flare           | 24326          | SV: White Flare                 | |
| Black Bolt            | 24325          | SV: Black Bolt                  | |
| Surging Sparks        | 23651          | SV08: Surging Sparks            | |
| Prismatic Evolutions  | 23821          | SV: Prismatic Evolutions        | |
| Storm Emerald         | *(none)*       | — | not released yet (`release_date` 2026-07-31 in `pk_products` seed); no TCGplayer group exists as of 2026-07-17. Mapped to `None` in the table and skipped with a stderr note at scrape time rather than omitted, so the table stays a complete, reviewed record of all 15 canonical set names. |

14 of 15 sets had exactly one substring match against the live group list;
"Mega Evolution" was the only genuinely ambiguous (3-way) case.

### Running it

Fixture mode (deterministic, no network):

```
python3 agents/pokemon-sourcing-scout/scripts/tcgplayer_scraper.py \
  --fixture-dir agents/pokemon-sourcing-scout/fixtures/tcgplayer \
  --observed-date 2026-07-17 \
  --out /tmp/tcgplayer.csv
```

Live mode (reads public tcgcsv.com endpoints only):

```
python3 agents/pokemon-sourcing-scout/scripts/tcgplayer_scraper.py \
  --live \
  --out /tmp/tcgplayer.csv
```

Python: any interpreter with `requests`/stdlib `urllib` works — the script
only uses stdlib (`urllib.request`, `json`, `csv`, `argparse`). Verified
against `/home/Arjun/.hermes/google-venv/bin/python` (has `requests` 2.34.2
installed, though the script itself doesn't import it).

### Tests

```
/home/Arjun/.hermes/google-venv/bin/python -m unittest discover \
  -s agents/pokemon-sourcing-scout/tests -p "test_*.py" -v
```

Covers: mapping-table completeness and the Mega Evolution fuzzy-match
regression; exact-name product matching vs. sleeved/code-card/bundle
siblings; marketPrice→midPrice fallback (and the both-missing skip case);
exact expected CSV rows against the recorded fixtures for three sets
(Destined Rivals, Mega Evolution, 151); Storm Emerald mapping-miss skip;
determinism (row-level and full-CLI-run-twice, byte-identical output).

### Fixtures

`fixtures/tcgplayer/` contains real captured responses from 2026-07-17
(no synthetic data):

- `groups.json` — full `/tcgplayer/3/groups` listing (217 groups)
- `{groupId}_products.json` / `{groupId}_prices.json` for all 14 mapped
  groups (a superset of the "at least 3" minimum, kept because it was
  already captured while building the mapping table and makes the fixture
  run reproduce a full 14-row live-equivalent CSV).

## eBay scraper

Script: `scripts/ebay_scraper.py`
Fixtures: `fixtures/ebay/`
Tests: `tests/test_ebay_scraper.py`

Daily scan of eBay SOLD and ACTIVE bulk-lot listings for the target
Pokemon booster sets (`SELECT set_name FROM pk_products WHERE active=1
AND form='booster'`, read read-only from `data/rathworkspace.db`).
Emits the same shared observation CSV as the TCGplayer feed above, with
`source` = `ebay_sold` or `ebay_active`, `form` = `booster` always,
`price_per_pack_usd` = `(price + shipping) / lot_size`,
`includes_shipping=1` always (shipping is folded into the total before
dividing), `includes_tax` left blank (eBay doesn't reliably surface tax
on the search results page). `listing_ref` is the canonical
`https://www.ebay.com/itm/<id>` URL, the downstream dedupe key.

### Fetch path: WAF beaten by a warmed profile, but this box is currency-blocked

The fallback ladder as it stands (verified live 2026-07-17):

| rung | method | result |
|------|--------|--------|
| 1 | `requests` + full desktop-browser headers | `HTTP 403` on every query |
| 2a | cold `/usr/bin/chromium --headless=new --dump-dom` (own subprocess) | HTTP-level 200/exit 0, but the dumped DOM *is* eBay's own `"Error Page \| eBay"` bot-block page |
| 2b-old | the shared firewalled headless Chrome at `[::1]:18800` over CDP | identical block page (real CDP, not the node dashboard on `0.0.0.0:18800`) |
| **2b** | **warmed** chromium: hit `https://www.ebay.com/` once into a persistent `--user-data-dir` to solve the site's JS challenge and store the `challenge-cookie`/`challenge-cookies` cookies, **then** fetch `/sch` reusing that warmed profile | **the real results page — ~60 `.s-card` listing rows, fetch succeeded** |
| 3 | — | only reached if every rung blocks: logs the graceful-degrade note and exits 0 with a header-only CSV |

Rung 2b (added 2026-07-17) is the breakthrough: a *cold* `/sch` hit is
blocked because it carries none of the site's bot protection's challenge
cookies; the eBay homepage passes that challenge and mints them, so
navigating the homepage first in a persistent profile and reusing it for
`/sch` gets admitted. This overturns the earlier "fully blocked from this
box" conclusion — the WAF **is** beatable here without a proxy.

The remaining blocker on *this specific box* is **currency, not the WAF.**
This is a the VPS provider datacenter IP that eBay geolocates to its Brazil site,
so the same global listings come back priced in **BRL** (`R$ 7,493.96`),
and there is no USD figure anywhere in the page markup. The CSV contract
is USD-only and this scraper is deterministic (it must not take a live,
time-varying FX rate), so `build_row` **drops** any non-USD-priced card
with a `non_usd_price` skip (`is_usd_price()` / the `NON_USD_CURRENCY`
regex). Net result of `--live --max-per-set 2` from this box on
2026-07-17: rung 2b fetches the real page and the parser reads all ~60
cards, but every one is BRL-priced and dropped, so **0 usable rows** are
emitted here today. Run the identical rung from a **US-geolocated IP** and
those cards are US-dollar priced and flow straight through to the CSV — no
code change required.

While integrating rung 2b, two live-DOM facts were also fixed:

- **eBay migrated the SRP DOM off `li.s-item` onto `li.s-card`.** The
  hand-built fixtures (and `_card_from_li`) target the legacy markup; a
  live page today is all `.s-card` / `.su-card-container`. `_card_from_scard`
  parses the new shape (title in `.s-card__title` with an "Opens in a new
  window or tab" a11y suffix to strip, price in `.s-card__price`, shipping
  in the `.s-card__attribute-row` mentioning shipping), and
  `parse_search_page` auto-selects whichever generation the page uses.
  Without this, even a US-IP fetch would have parsed 0 rows. Covered by
  `fixtures/ebay/ebay_active_scard_dom.html` + its test.
- **Live titles bracket the lot count** ("Lot of **(72)** ..."), which the
  old `lot_of_n` rule (`lot\s*of\s*(\d+)`) missed; it now tolerates the
  paren.

`--live` still runs the whole ladder for real on every call
(`fetch_via_requests` → cold `fetch_via_chromium` → warmed
`fetch_via_warmed_chromium` → give up per-query); nothing is hardcoded.
`looks_blocked()` sniffs eBay's own error-page markers and accepts either
`s-item` **or** `s-card` as proof of a real results page.

### Lot-size heuristic table

Checked in this order against the lowercased title + subtitle text,
first match wins (box-count rules run before the generic multiplier
rules so "3 booster boxes" isn't misread as `lot_size=3`):

| # | pattern | lot_size | rule name |
|---|---------|----------|-----------|
| 1 | `case of N box(es)` | `N * 36` | `case_of_boxes` |
| 2 | `N box(es)` / `box(es) x N` / `N x box(es)` (booster-box count) | `N * 36` | `n_booster_boxes` |
| 3 | `lot of N` | `N` | `lot_of_n` |
| 4 | `N x` / `x N` (generic multiplier) | `N` | `x_n` |
| 5 | `N pack(s)` / `N pk(s)` | `N` | `n_packs` |
| 6 | bare `"booster box"`, no number found | `36` | `booster_box_default` |
| 7 | nothing matches | — | row dropped, `lot_size_undetermined` logged to stderr (can't compute $/pack without a lot size) |

### Exclusions (checked before lot-size parsing, listing dropped)

- **ETB** — `\betb\b` or `"elite trainer box"` (operator doctrine: box
  premium wasted on ETBs).
- **Graded/slab singles** — `PSA`, `BGS`, `CGC`, `SGC`, `graded`, `slab`.
- **Non-sealed** — `opened`, `unsealed`, `resealed`, `empty box`, `box
  only`, `no packs`, `display only`.

### Set detection

Independent of which query produced the page: each listing's
title+subtitle is matched against the canonical target-set list via
case-insensitive, word-bounded substring search (longest name first).
A listing that doesn't match any target set is dropped as
`unknown_set` — search results are never perfectly on-topic even for a
well-scoped query, so this is a real safety net exercised by both the
fixtures and any future live run, not just test scaffolding.

### Running it

Fixture mode (deterministic, no network):

```
agents/pokemon-sourcing-scout/venv/bin/python \
  agents/pokemon-sourcing-scout/scripts/ebay_scraper.py \
  --fixture-dir agents/pokemon-sourcing-scout/fixtures/ebay \
  --out /tmp/ebay.csv
```

Live mode (runs the full fallback ladder; rung 2b now passes eBay's WAF,
but from this Brazil-geolocated box every row is BRL-priced and dropped
on currency, so it still emits 0 rows / exit 0 here — see the fetch-path
section above; a US-geolocated IP yields real USD rows unchanged):

```
agents/pokemon-sourcing-scout/venv/bin/python \
  agents/pokemon-sourcing-scout/scripts/ebay_scraper.py \
  --live --max-per-set 10 --out /tmp/ebay.csv
```

### Python environment

`/home/Arjun/.hermes/google-venv/bin/python` has `requests` 2.34.2 but
**not** `beautifulsoup4` (`ModuleNotFoundError: No module named 'bs4'`
verified 2026-07-17), and per the build brief that venv is not to be
`pip install`-ed into without checking first. A dedicated venv was
created instead:

```
python3 -m venv agents/pokemon-sourcing-scout/venv
agents/pokemon-sourcing-scout/venv/bin/pip install requests beautifulsoup4 pytest
```

Use `agents/pokemon-sourcing-scout/venv/bin/python` to run this script
and its tests. (System `/usr/bin/python3` also happens to have both
`requests` and `bs4` installed globally, but the dedicated venv is the
one to depend on going forward.)

### Tests

```
agents/pokemon-sourcing-scout/venv/bin/python -m pytest \
  agents/pokemon-sourcing-scout/tests/test_ebay_scraper.py -v
```

26 tests, all passing: every lot-size rule and exclusion rule in
isolation; set detection incl. word-boundary false-positive guard
("151" must not match inside "1510"); price/shipping parsing incl.
"Free shipping" and thousands-comma prices; full price+shipping→$/pack
math on a built row; ETB-drop and unknown-set-drop on synthetic
`ListingCard`s; three fixture-file integration tests asserting the
exact expected row set (by `listing_ref`) and exact `lot_size`/`set_name`
per row; a full-CLI-twice byte-identical determinism check; and a
CSV-shape check (header order, sorted by `listing_ref`, no duplicate
`listing_ref`).

### Fixture provenance: synthetic (documented, not silently faked)

`fixtures/ebay/*.html` are **hand-built, not captured**, because eBay's
search endpoint blocked every fetch rung tried from this box (see
above) — there was no real search-result page to save. Each fixture
file's header HTML comment states this explicitly and explains what it
exercises. They're built to match eBay's search-results-page DOM
convention (`li.s-item` cards with `a.s-item__link` /
`.s-item__title` / `.s-item__subtitle` / `.s-item__price` /
`.s-item__shipping` children, plus eBay's perennial "Shop on eBay"
filler first card) so the parser is pinned against a realistic shape,
not a convenience shape invented to make the parser look good:

- `ebay_sold_pokemon_booster_lots.html` — sold-search page (filename
  convention: `source_from_filename()` tags any fixture with "sold" in
  the name as `ebay_sold`, "active" as `ebay_active` — the real-world
  equivalent is simply which URL/query produced the page, since eBay
  never mixes sold and active results on one page). Covers
  `booster_box_default`, `x_n`, `case_of_boxes`, `lot_of_n`, `n_packs`,
  a graded-slab exclusion, and an unrelated-TCG unknown-set skip.
- `ebay_active_pokemon_booster_lots.html` — active-search page. Covers
  `booster_box_default`, `n_booster_boxes`, `x_n`, an ETB exclusion, and
  a non-sealed ("opened"/"display only") exclusion.
- `ebay_active_etb_exclusion_case.html` — dedicated exclusion-doctrine
  page: two ETB variants, a graded/slab case, a non-sealed case, and one
  clean pass-through row so the file isn't 100% exclusions.
- `ebay_active_scard_dom.html` — the **current** eBay SRP DOM
  (`li.s-card` / `.su-card-container`), modeled on a real live fetch from
  rung 2b (class names, nesting, and the "Opens in a new window or tab"
  title suffix are copied from the live page; only ids/sets/prices are
  hand-set). Two USD cards survive; one BRL card is dropped by the
  currency guard (`non_usd_price`); one ETB card is dropped by doctrine.
  This is what exercises `_card_from_scard` and the currency guard — the
  legacy `s-item` fixtures above cannot.

### Verification run (2026-07-17)

- `pytest` on `test_ebay_scraper.py`: **30 passed** (26 original + 4 new:
  `is_usd_price` accept/reject, `non_usd_price` drop, and the
  current-DOM `.s-card` fixture parse).
- Rung 2b, run for real from this box, fetched the live `.s-card` search
  page (`https://www.ebay.com/sch/i.html?_nkw=pokemon+151+booster+pack+lot`,
  ~2.1 MB, title "Pokemon 151 Booster Pack Lot for sale | eBay", 60 real
  listing cards). Feeding that captured live page through the integrated
  `parse_search_page` gives: `looks_blocked=False` (fetch succeeded), 60 cards
  parsed, **0 usable USD rows** — 46 dropped `non_usd_price` (BRL), 8
  `unknown_set`, 1 graded/slab, 5 non-sealed. So the block is currency,
  full stop; a US-geolocated IP yields real USD rows through the same
  code. Caveat: the warmed `/sch` fetch is a heavy page and its wall-clock
  time is variable on this datacenter box (eBay's SRP fires many
  real-network XHRs that stall chromium's virtual clock); rung 2b runs the
  fetch twice before giving up, and if both attempts overrun it degrades
  to rung 3 gracefully rather than hard-failing.
- Importer validation against a **temp DB only**
  (`RATHWORKSPACE_DB=/tmp/.../test_pokemon_ops.db`, never the live DB):
  `npm run migrate` → `npm run seed:pokemon-ops` → `npm run
  import:pokemon-ops -- observations <fixture-mode CSV>` imported all 9
  rows (`{"imported": 9, "skipped": 0}`); re-running the same import
  immediately after correctly deduped to `{"imported": 0, "skipped":
  9}` via the file-level sha256 receipt.
