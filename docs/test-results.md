# Test results

Run against [`test-plan.md`](./test-plan.md) on 2026-08-07, local build plus the live
tunnel hostnames.

| | |
|---|---|
| **Passed** | 43 |
| **Failed** | 0 |
| **Blocked** | 3 — OpenAI account has no credits |
| **Bugs found** | 3, all fixed and re-verified |

Automated portion: `bash tools/test-api.sh` → **23 passed, 0 failed, 3 blocked**.
Browser portion driven with Playwright.

---

## A. Sentence assembly — 6/6

The bug this replaced produced *"I I want I want water."*

| # | Result | Observed |
|---|---|---|
| A1 | PASS | `[water]` → *"I want water."* |
| A2 | PASS | `[I][want][water]` → *"I want water."* — no repetition |
| A3 | PASS | `[more]` → *"More, please."* |
| A4 | PASS | `[toilet]` → *"I need the toilet."* |
| A5 | PASS | `[help]` → *"I need help."* |
| A6 | PASS | `[I][want][more]` → *"I want more."* |

## B. Board — 6/6

| # | Result | Observed |
|---|---|---|
| B1 | PASS | 15 cards, 6 essentials, 21 SVGs |
| B2 | PASS | 0 cards fell back to an initial |
| B3 | PASS | **Order byte-identical before and after switching mode** |
| B4 | PASS | `dim LIT LIT dim dim dim dim dim LIT dim dim dim LIT LIT dim` — a filter, not a new board |
| B5 | PASS | Returning to All words restores the same order |
| B6 | PASS | 4 columns at a 400px viewport |

B3 is the clinical constraint that matters most: a mode must never relocate a learned button.

## C. Categories — 7/7

| # | Result | Observed |
|---|---|---|
| C1 | PASS | 10 categories seeded from the constant |
| C2 | PASS | Feelings holds all 8 words |
| C3 | PASS | Picking `angry` enters the sentence and closes the drawer |
| C4 | PASS | "Swimming club" created, `built_in: 0` |
| C5 | PASS | Unticked for Liam → `liam: False`, **`maya: True`** |
| C6 | PASS | Re-ticking restores all 10 words |
| C7 | PASS | Deleting a built-in refused: *"can be hidden but not deleted"* |

## D. Card customisation — 3/3 verified earlier

| # | Result | Observed |
|---|---|---|
| D1 | PASS | Edit banner appears, cards gain an edit tag |
| D3 | PASS | Renaming `water` → `my bottle` **keeps the water symbol** |
| D4 | PASS | Liam's board unaffected — customisation is per child |

## E. Pictures — 3 passed, 3 blocked

| # | Result | Observed |
|---|---|---|
| E1 | PASS | `water` → `icon_pack`, $0, 0 ms |
| E2 | PASS | `Toilet` → `icon_pack` — case costs nothing |
| E3 | **BLOCKED** | `429 insufficient_quota` — the OpenAI account has no credits |
| E4 | **BLOCKED** | Cache reuse cannot be shown without E3 |
| E5 | **BLOCKED** | Semantic match needs embeddings, same account |
| E6 | PASS | `gap_detected` written for every attempt, with `resolvedBy` |

The request was built, sanitised and sent correctly; OpenAI answered with a billing
error and it surfaced cleanly rather than crashing. **Recorded as blocked, not passed** —
nothing about step 5 has actually been demonstrated.

## F. Sign-in and attribution — 4/4

| # | Result | Observed |
|---|---|---|
| F1 | PASS | `/` with no session → **307** to `/who` |
| F2 | PASS | Five children as photo tiles, no password field |
| F3 | PASS | Sign-in sets the cookie and writes `session_start via: sign_in` |
| F4 | PASS | The board loads the signed-in child, not the alphabetically first |

## G. Dashboard login — 5/5

| # | Result | Observed |
|---|---|---|
| G1 | PASS | `/dashboard` → redirect to login |
| G3 | PASS | First account created and signed in |
| G4 | PASS | Second setup attempt → *"Setup is closed"* |
| G5 | PASS | Wrong password → *"Those details do not match"* |
| G6 | PASS | Unknown username → **the same message** |
| G7 | PASS | Student page requires a session |

## H. Dashboard content — 8/8

| # | Result | Observed |
|---|---|---|
| H1 | PASS | Queue: Jonah → Liam → Maya |
| H2 | PASS | Reasons shown: *"Has not spoken for 4 days"*, *"Gives up on 28%"*, *"13% of presses"* |
| H3 | PASS | `n =` present on tiles |
| H4 | PASS | `repeat_tap_rate` reads *"not a target"*, never red |
| H5 | PASS | Words per minute rendered as caption text |
| H7 | PASS | Adjacency reads as a *reach problem* |
| H8 | PASS | **No resize, no move offered anywhere** |
| H9 | PASS | *"not being recorded yet"*, and **no fabricated 0%** |

## I. Insights — 3/3

| # | Result | Observed |
|---|---|---|
| I2 | PASS | Forbidden actions rendered in plain English |
| I4 | PASS | I8 badged *"about our software"* |
| I5 | PASS | Dismissal writes `dismiss_reason` and re-ranks the queue |

## J. Event integrity — 5/5

| # | Result | Observed |
|---|---|---|
| J1 | PASS | Grid tap without coordinates **rejected** by name |
| J2 | PASS | Folder tap accepted with `nav_depth` only |
| J3 | PASS | Replay → `duplicates: 1` |
| J4 | PASS | Unknown scene rejected |
| J5 | PASS | Row lands in the current file after the database is replaced |

## K. Hostname isolation — 4/4, over the public internet

| # | Result | Observed |
|---|---|---|
| K1 | PASS | `aac.kason.app/who` → 200 |
| K2 | PASS | `aac.kason.app/dashboard` → **404** |
| K3 | PASS | `aac-dashboard.kason.app/` → **404** |
| K6 | PASS | `aac-mcp.kason.app/api/mcp` → 200 |

## L. MCP — 4/4

| # | Result | Observed |
|---|---|---|
| L1 | PASS | No token → 401 |
| L2 | PASS | Wrong token → 401 |
| L3 | PASS | 19 tools (14 mine, 5 added by the analytics session) |
| L4 | PASS | `list_children` returns all five with real data |

---

## Bugs found during this run

**1. Cache-first service worker served stale code indefinitely — and then broke the site.**

The most serious of the three. `public/sw.js` returned `hit ?? network`, so once the board
was cached the browser never saw a new deploy. It cost about twenty minutes of chasing a
"missing" Categories button that was present in the source, present in the built chunk,
and present in the server's response — the browser simply never fetched it. Clearing the
cache mid-session then left Chrome unable to load the site at all (`ERR_FAILED`) while
`curl` was perfectly healthy.

Fixed by splitting the strategy: **network-first for the board**, cache-first only for
`/_next/static/*`, whose filenames contain a content hash and therefore never change
meaning. Cache version bumped to `aac-v2` to evict the poisoned entries, and a real
offline page instead of an opaque failure. Verified: the fixed worker took over, the site
recovered, and the Categories button appeared.

**2. Writes reported success while going into a deleted file.**

`tools/build.sh` replaces `aac.db`. Cached SQLite handles kept pointing at the old inode,
so `POST /api/events` answered `accepted: 1` and the row was not in the database. Every
event the board sent after a rebuild was silently lost.

Fixed in `lib/sqlite.ts`: connections are keyed on the file's inode and reopened when it
changes. Verified by replacing the database under a running server — writes landed before
and after, integrity clean.

**3. Renaming a card destroyed its picture.** *(found earlier, re-verified here)*

Symbols are looked up by label, so `water` → `my bottle` fell through to the letter **M**.
A child losing a picture they recognise because an adult reworded a caption is a real
harm. Renamed cards now keep the original symbol.

## Two test bugs, worth separating from the above

Both were wrong expectations, not defects:

- **L3** asserted exactly 14 MCP tools. The analytics session has since added five. Now
  asserts *at least* 14 — a hard count turns their work into a red build.
- **C7** grepped for `"not be deleted"` against the real message
  `"hidden but not deleted"`. The guard worked the whole time.

## What is not covered

- **Image generation (E3–E5)** — blocked on account credits.
- **Offline behaviour (M2, M3)** — needs real network interruption; the service-worker
  rewrite above changes this behaviour and it should be re-tested deliberately.
- **Crash recovery (M1)** — verified earlier by killing the process; not re-run today.
- **Real speech output** — the Speak button fires and the composer clears, but whether
  audio is audible and intelligible needs a person listening.
