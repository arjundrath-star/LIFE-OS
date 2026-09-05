# Stern tab prep: fixtures and seed data

Prepared 2026-09-04 for the Stern tab build (club recruiting tracker). Everything here is test data and public seed data. No real students, board members, or professors appear in the fixtures. All individual names and NetID-style addresses are invented. Club names, course codes, room names, and NYU domains are real.

## Files

| File | Purpose |
|---|---|
| `schema/email-classifier.schema.json` | Output contract for the email classifier (existed before this prep). Every fixture's `expected` block validates against it. |
| `fixtures/emails.json` | 20 sample emails, `fx-001` to `fx-020`, one per classifier scenario. Drives WP3 (email and calendar automation) tests. |
| `seeds/clubs-catalog.json` | Public seed for WP1: the Fall 2026 program windows plus the 32 Stern undergraduate clubs with website, short name, category, and Fall 2026 program notes. |
| `scripts/validate-fixtures.py` | Re-runs the fixture checks below. `python3 scripts/validate-fixtures.py` exits 0 on pass. Needs the `jsonschema` module (4.19.2 is installed on this box). |

## fixtures/emails.json

Shape of each object: `id, threadId, messageId, account, labelIds, from, to, cc, date, subject, text, expected`. Two fields beyond the requested shape:

- `messageId`: the RFC 822 Message-ID. Real Gmail exposes this in the `Message-ID` header and it survives forwarding, so it is the right dedupe key. `fx-002` and `fx-020` share one.
- `dedupe_of`: only on `fx-020`, points at `fx-002`.

Conventions:

- Account owner addresses are `netid@stern.nyu.edu` (primary) and `netid@nyu.edu` (forwarding account). `account` is the mailbox the message sits in.
- `people` never includes the account owner. E-board members carry `is_eboard: true` and `club_or_org`. Professors carry `is_eboard: false`. Automated senders (Brightspace, ICC list, Campus Services, SaaS) yield an empty `people` array.
- Every optional schema key is present on every `expected` with a null or empty default, so consumers do not need to check for key presence.
- All timestamps are `-04:00` (America/New_York, EDT). Fixture dates run 2026-09-05 to 2026-09-27; deadline mentions reach to 2026-10-09.
- Confidence: 0.9 or higher on clear cases. Two are deliberately in the ambiguous band: `fx-002`/`fx-020` (0.8, a positive reply that also proposes times, so it borders on `scheduling_proposal`) and `fx-017` (0.78, an exam reminder written as a professor announcement).
- `fx-016` and `fx-017` are addressed to class mailing lists (`tech-ub1-004-fa26@stern.nyu.edu`, `cams-ua110-fa26@nyu.edu`), not to Arjun directly. That is how course mail actually arrives, and the scanner must not drop it.
- Email bodies avoid em and en dashes on purpose.

Scenario map:

| id | category | thread | notes |
|---|---|---|---|
| fx-001 | coffee_chat_request_sent | t-001 | Arjun to Priya Nair, SVS VP (Venture Team). Follows the granola format: name, year, major, reason, ask, offer to accommodate. |
| fx-002 | coffee_chat_reply_positive | t-001 | Priya proposes Tue 9/8 1:45 PM and Thu 9/10 4:00 PM. `requires_reply_from_me: true`. |
| fx-003 | scheduling_confirmed | t-001 | Arjun picks Thu 9/10 4:00 PM, Think Coffee on Mercer. |
| fx-004 | calendar_invite | t-004 | Google Calendar invite from Priya for that chat. |
| fx-005 | coffee_chat_reply_negative | t-005 | Daniel Okafor, MCG VP Recruitment, declines for the cycle. |
| fx-006 | follow_up_sent | t-006 | Arjun bumps Marcus Lindqvist (EEG Startup Team) three days after a Sept 8 request. |
| fx-007 | thank_you_sent | t-001 | Sent 5.5 hours after the chat. |
| fx-008 | icc_newsletter | t-008 | Monday 9/7 5:00 PM. Central application link, both windows, 4 days of general meetings. Six `deadline_mentions` (open, close, decisions for both tracks). |
| fx-009 | club_general_meeting | t-009 | EEG, Thu 9/10 12:30, Tisch Hall LC25. Matches the newsletter listing. |
| fx-010 | club_application_confirmation | t-010 | Business Analytics Club, Freshman Liaison Program (Exploratory). |
| fx-011 | club_interview_invite | t-011 | Blockchain & Fintech Club, Tue 9/22 5:40 PM, Tisch UC13, 20 minutes, business casual. `requires_reply_from_me: true`. |
| fx-012 | club_result_accepted | t-012 | SVS Exploratory Program, 9/27. Reply required by 10/1. |
| fx-013 | club_result_rejected | t-013 | Finance Society Discovery Program, 9/27. |
| fx-014 | brightspace_assignment | t-014 | STAT-UB 103 Problem Set 2, due 9/25 11:59 PM, 50 points. Full `assignment` object. |
| fx-015 | brightspace_grade | t-015 | MKTG-UB 1 Quiz 1, 18/20. |
| fx-016 | course_announcement | t-016 | TECH-UB 1 syllabus change and office hours. Two deadline mentions. |
| fx-017 | exam_reminder | t-017 | CAMS-UA 110 midterm Thu 10/1, Tisch UC50. |
| fx-018 | other_nyu | t-018 | Meal plan change deadline 9/15. |
| fx-019 | irrelevant | t-019 | SaaS marketing (invented product, `.example` domain). |
| fx-020 | coffee_chat_reply_positive | t-020 | Same message as fx-002 in the `netid@nyu.edu` mailbox with a Gmail forwarded-message header block prepended. Same `messageId`, same `expected`. |

Invented people used across the fixtures (all placeholders):

- Priya Nair `pn2041@stern.nyu.edu`, VP Venture Team, Strategic Venture Society
- Sofia Reyes `sr4471@stern.nyu.edu`, President, Strategic Venture Society
- Daniel Okafor `do1893@stern.nyu.edu`, VP Recruitment, Management Consulting Group
- Marcus Lindqvist `ml5120@stern.nyu.edu`, VP Startup Team, Entrepreneurial Exchange Group
- Lena Fischer `lf2210@stern.nyu.edu`, Director of Mentorship, Blockchain & Fintech Club
- Ethan Walsh `ew2934@stern.nyu.edu`, Director of the Discovery Program, Finance Society
- Ingrid Vasquez-Holm `ivh2@stern.nyu.edu`, professor, TECH-UB 1
- Naomi Adler-Stein `na3358@nyu.edu`, professor, CAMS-UA 110
- Miriam Castellano and Helena Marsh, instructors named inside Brightspace bodies only (no address)

One known departure from reality, kept because the task asked for it: fx-012 is an SVS Exploratory acceptance, but the ICC Fall 2026 listing shows SVS running only a Teams program (Venture Team). Do not read the fixture as a statement about SVS's real programs.

## seeds/clubs-catalog.json

- `program_windows`: the two Fall 2026 windows from the Stern Clubs 101 session (Exploratory: apps 9/14 to 9/19, interviews 9/19 to 9/26, decisions 9/27. Teams: apps 9/20 to 9/26, interviews 9/26, decisions 10/4). The ICC site confirms the 9/14 and 9/20 opens at 9:00 AM.
- `clubs`: the 32 clubs from stern.nyu.edu/current-students/undergraduate/community/student-clubs, fetched 2026-09-04, in the page's order. Names follow the Stern page. Where the ICC directory spells a name differently (BlackGen Capital, Luxury & Retail Association, Middle East Business Association, Private Equity Group) the ICC spelling is in `notes`.
- `website`: 32 of 32 filled, every URL copied verbatim from the href on nyusternicc.org/clubs (asserted by the build script, none typed by hand from memory). Two are http, not https, as listed there.
- `instagram`: empty for all 32. The ICC pages carry no per-club Instagram links and the task said not to guess.
- `short_name`: common acronym where one exists. Left empty for Actuarial Society, Net Impact, and Pride Corp. "FinSoc" and "MktSoc" are colloquial rather than official; change them if the club prefers otherwise.
- `category`: one of finance (7), identity (7), industry (6), social_impact (3), accounting (2), entrepreneurship (2), tech (2), consulting (1), marketing (1), law (1). Judgment calls: Black Gen Capital is filed under identity rather than finance; Actuarial Society, Phi Chi Theta, and International Business Association under industry; Stern Political Economy Exchange under social_impact.
- `notes`: the Fall 2026 program names and tracks parsed from nyusternicc.org/fall-2026. Beta Alpha Psi and STEBA show "program information pending" on that page.

The ICC directory lists four clubs that are not on the Stern page and are therefore not in the catalog: Asian Leadership Initiative, Climate & Energy Club, Stern Capital Management, Stern Sports Society. Add them by hand if Arjun wants them tracked.

## Validation results (2026-09-04)

`python3 scripts/validate-fixtures.py`:

- `emails.json` parses. 20 fixtures, ids fx-001 to fx-020 in order.
- All 20 `expected` blocks pass `jsonschema.Draft202012Validator` against `email-classifier.schema.json`. 0 errors.
- Every `evidence_excerpt` is a verbatim substring of its body. Longest is 164 chars (limit 300).
- Every `summary` is 140 chars or fewer. Longest is 123.
- Every `date` is within 2026-09-05 to 2026-10-04 and carries the -04:00 offset. All `proposed_times`, `confirmed_time`, and `assignment.due_at` values are ISO with -04:00. All `deadline_mentions.date` values are YYYY-MM-DD.
- `direction` matches `labelIds` (SENT = outbound) on all 20. Every SENT message is from Arjun.
- No fixture lists the account owner in `people`. Every `is_eboard: true` person has `club_or_org`.
- Confidence values sit in the 0.9+ or 0.6 to 0.8 bands.
- fx-002 and fx-020: same `messageId`, subject, date, and sender; different `account`; identical `expected`; fx-020 body ends with the full fx-002 body.
- No em or en dashes in any subject, body, or summary.

`clubs-catalog.json`: parses, exactly two top-level keys, 32 clubs with exactly the six required keys each, all categories in the allowed set, 32 websites each present verbatim in the fetched ICC directory HTML.
