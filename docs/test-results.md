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

---

# Update — feature wave (same day, later)

Run after the four-agent build: Vertex image generation, dashboard redesign, kid keyboard,
AI vocabulary icons, mobile-responsive audit.

**API suite: 24 passed · 0 failed · 0 blocked** — first fully green run. The three
image-generation cases that were blocked on OpenAI credits now pass through **Vertex AI**
(`gemini-2.5-flash-image`, ADC on `project-3d2bf61a`): E3 generated 3 real candidates in
26s end to end; the repeat resolved `hash_cache` at $0 in 5ms.

## New features verified in the browser (Playwright)

| Feature | Evidence |
|---|---|
| Dashboard dark redesign | Student page renders the mockup layout: rail, four sections, cards with headline + `n`, split-bar with both sides one colour, report block ("Written from 13 numbers, nothing else."), caveats row, docked Ask panel. Suppressed cards read "not recorded" / "not used yet" — never 0. |
| Keyboard (TouchChat/P2G patterns) | ABC chip → 26-key QWERTY layer over the board (grid never rearranges); typed `cat` → sentence bar `Will say: "cat"` → **`keyboard_input` row landed in `events`** — metric H2 and clinical gap C8 are now real. |
| Message window | "Say the sentence again" control present (P2G p.9/61 behaviour); repeat-tap stops speech. |
| Modeling help | "?" beside *I am modelling* opens the plain-language dialog (what modelling is, why the switch protects the child's record, 90s auto-off). |
| AI vocabulary icons | Vertex-generated icons render on cards with SVG fallback (21 `<img src="/icons/ai/…">` on the board at audit time; generation continuing in background, resumable). |
| Adult login flow | `/login` (moved from `/dashboard/login` by the wave, middleware reconciled); sign-in → `/dashboard` 200; unauthenticated → 307. |

## Mobile audit @375px — user requirement

| Surface | Result |
|---|---|
| Kid board | **PASS** after fix — header control cluster now wraps (was forcing page h-scroll); grid keeps the child's own column count (never reflows — clinical); min button height 114px; keyboard layer usable. |
| Dashboard student page | **PASS** after two fixes — metric cards gained `min-w-0 overflow-hidden` (grid items could not shrink); Ask input gained `min-w-0` (Send pushed 1px past the viewport). |
| Dashboard class page | **PASS** unmodified. |

## Public URLs re-verified

`aac.kason.app/who` 200 · `aac-dashboard.kason.app/` **307→login (root now serves the
dashboard)** · cross-host isolation still 404 · `aac-mcp.kason.app/api/mcp` 200.

## Notes for the pipeline session

- Re-speak logs a second `speak` event with the same `utterance_id`
  (`payload.trigger:'message_window'`). If utterances are ever counted by event rather than
  by distinct id, dedupe on `utterance_id`.
- `db/seed_core_words.sql` (additive) now seeds a 201-word core list and resolves
  `cards.is_core` by join — worth adopting into `tools/build.sh`.
- `partner_wait_time` is gated in `lib/report.ts` to "not recorded" until real `listen`
  events exist: every `partner_turns` row is seeder fixture data today.

---

# Update — agentic chatbot verification (2026-08-08)

The Ask panel's agentic loop, tested through the API and the browser. Three bugs found,
fixed at the root, each re-verified.

**Starting state: the chatbot was dead.** Default provider OpenAI answers
`billing_not_active`; no `GEMINI_API_KEY` exists. Fixed by adding a **Vertex chat
provider** (`lib/chat/vertex.ts` — same wire dialect as the Gemini provider, ADC bearer
auth, `gemini-2.5-flash`, verified for text + SSE + function calling) and setting
`CHAT_PROVIDER=vertex`.

## Bugs found by testing

| # | Bug | Root cause | Fix |
|---|---|---|---|
| 1 | "Data not available" for a metric the dashboard shows as 2.7 (n=500) | Model invented metric id `mean_symbols_per_utterance`; 0 rows read as absence | `metric_ids` enum-constrained to real catalogue ids in the chat tool schema; unknown ids fail loudly WITH the valid vocabulary |
| 2 | Model queried 2023–2024 and gave up on empty windows | The system prompt never said what day it is; the model guessed from its training prior | Prompt now anchors TODAY and directs to named windows (`last_7d/14d/28d`) |
| 3 | "The system is not collecting card frequency data" — false | Dimensional metrics offered through `get_metrics`, which reads only `agg_daily_metric` (the shape trap, third occurrence) | Enum is now **data-driven** (ids that have ever produced a scalar row); tool descriptions route card/grid/pair questions to `get_card_stats`/`get_cell_heat`/`get_word_pairs` |

## Verified behaviour after fixes

| Case | Result |
|---|---|
| Grounded answer | "2.68 buttons per utterance, up from 2.43 — but a layout change on 2026-07-30 makes the comparison unreliable" — values match the DB; the guidance system reached the prose |
| Dimensional routing | "Go-to words" → `get_card_stats` → snack 1156 · yes 390 · no 358 · stop 344 · help 338, matching the dashboard |
| **Scope isolation** | Student-scoped chat asked to compare with Jonah: refused, **zero tool calls attempted** |
| **Forbidden advice** | "Shrink her grid and move the water button?" → real mis-tap number + layout caveat + "it is never recommended to shrink the grid or move buttons — motor plans depend on button consistency" |
| Browser panel | Streams tool activity ("2 calls · 10.8s · 7,032 tokens") and guidance chips (`NOT_COLLECTED`, `PARTIAL_WINDOW`, `HIGH_REPETITION_NEUTRAL`) |
| MCP endpoint | 20 tools; `get_attention_queue` returns the live ranked queue (Jonah 4, Maya 3) |

The chat layer shares the MCP tool implementations in-process (`lib/chat/tools.ts` imports
`mcp/tools.ts`), so every fix above also describes what an external MCP client sees —
except the metric-id enum and date anchor, which are chat-scope hardening on top.

## P0 found by re-running the regression suite (2026-08-08)

**Every `?child=` visit crashed the production board to its error screen.**
`app/page.tssx`'s session-switch called `cookies().set()` inside a Server Component
render. `next dev` tolerates that; a production build throws
(`Cookies can only be modified in a Server Action or Route Handler`) → 500 → error
boundary. All earlier `?child=` testing had run against dev, which is why it survived
review — and why the fallback screen's six speaking words earned their keep.

Fix: `GET /api/session/switch?child=…` (a Route Handler, where cookie writes are legal)
now owns the write; the page redirects to it. Re-verified in the production build:
`/?child=maya_t` → 307 → switch → board renders, and the full A-suite (sentence
assembly) + B3 (mode never moves a card) pass again after the kid-app rewrite.

Lesson recorded: any cookie write in this codebase belongs in a Route Handler or Server
Action, and board smoke tests must run against the production build, not dev.

## Full verification pass — 2026-08-08 (verify-features skill, first run)

The canonical record is now [`docs/feature-verification.md`](feature-verification.md):
194 checks across all 10 feature domains, 191 verified against the production build,
3 deferred with stated reasons. Fixes that came out of the pass, beyond the `?child=`
crash above: the insight cards had never been mounted on any page since the initial
commit (now a Findings section on the student page, with the informational-no-button
and forbidden-actions invariants verified in a live browser); the chat bridge held a
database handle across `tools/build.sh` rebuilds (inode-keyed now); the chat TODAY
anchor was UTC (server-local now); a QA credential sat in a committable file (env-var
now). Harness state at close: test-api.sh 28/28 · verify gate 42 checks PASSED ·
concurrency PASSED · kid-board A-suite + B3 PASS · Ask SSE probe PASS.
