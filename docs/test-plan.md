# Test plan

Every case is **precondition → input → expected output**, specific enough to fail.
A case that cannot fail is not a test.

**Result vocabulary**

| | |
|---|---|
| **PASS** | ran, matched the expectation |
| **FAIL** | ran, did not match |
| **BLOCKED** | could not run — an external dependency, not a defect. Never recorded as a pass. |

**Base URLs** — local `http://localhost:3000`, live `https://aac.kason.app`,
`https://aac-dashboard.kason.app`, `https://aac-mcp.kason.app`

---

## A. Sentence assembly

The bug this replaced: chaining `spoken_text` produced *"I I want I want water."*

| # | Input | Expected |
|---|---|---|
| A1 | Tap `water` alone, read the preview | `Will say: "I want water."` — one card speaks its whole phrase |
| A2 | Tap `I`, `want`, `water` | `Will say: "I want water."` — word forms joined, no repetition |
| A3 | Tap `more` alone | `Will say: "More, please."` |
| A4 | Tap `toilet` alone | `Will say: "I need the toilet."` |
| A5 | Tap `help` alone | `Will say: "I need help."` — essential words always speak in full |
| A6 | Tap `I`, `want`, `more` | `Will say: "I want more."` |
| A7 | Press **Speak** with 3 cards | Composer clears; a `speak` event is written with `symbolCount: 3` |
| A8 | Press **Undo** after 3 taps | Last chip removed; a `delete_last` event carries `ms_delta` |
| A9 | Press **Clear** with 2 cards | Composer empties; an `abandon` event with `reason: cleared` |

## B. The board

| # | Input | Expected |
|---|---|---|
| B1 | Load `/?child=maya_t` | 4×4 grid, 15 cards, 6 essential words in the bottom rail |
| B2 | Count `<svg>` elements | ≥ 21 — every card has a picture, no fallback initials |
| B3 | Record card order, switch to **Snack time**, record again | **Order identical.** A mode dims and highlights; it never moves a card *(clinical C2/C4)* |
| B4 | Under Snack time, read dim state | Some cards dimmed, some lit — a filter, not a new board |
| B5 | Switch back to **All words** | Order still identical to B3 |
| B6 | Resize the window to 400px wide | Still 4 columns. Reflowing would relocate learned buttons |
| B7 | Press an essential word while a mode is active | It is never dimmed and always reachable |

## C. Categories

| # | Input | Expected |
|---|---|---|
| C1 | `GET /api/categories?child=maya_t` | 9+ categories, seeded from the built-in constant, all `built_in: 1` |
| C2 | Open **Feelings** | 8 words: happy, sad, angry, scared, tired, excited, hungry, thirsty |
| C3 | Pick `angry` | Enters the sentence; drawer closes; `card_tap` logged with `nav_depth: 1`, `source: search` |
| C4 | `POST {action: create, name: "Swimming club"}` | `built_in: 0`, appended to the end |
| C5 | `POST {action: show, childId: maya_t, categoryId: numbers, shown: false}` then read both children | Maya `shown: false`, **Jonah `shown: true`** — visibility is per child |
| C6 | Re-show Numbers for Maya | All 10 words return. Hiding never deletes |
| C7 | `POST {action: delete, categoryId: feelings}` | **Rejected** — "Built-in categories can be hidden but not deleted" |
| C8 | Delete a category you created | Succeeds; its words go with it |
| C9 | Add a word to a category | Appears in the drawer; usable in a sentence |

## D. Card customisation

| # | Input | Expected |
|---|---|---|
| D1 | Press **Edit cards** | Blue banner; every card gains an "edit" tag |
| D2 | Press a card in edit mode | Settings sheet opens. **Nothing is spoken and nothing is logged** |
| D3 | Rename `water` → `my bottle`, save | Board shows "my bottle" **and keeps the water symbol** — renaming must not strip the picture |
| D4 | Load `/?child=liam_w` | "my bottle" absent. Customisation is per child; `cards` is shared |
| D5 | Edit the word form and spoken phrase separately | Both persist; A1/A2 use the right one |
| D6 | **Reset to default** | Original label, phrase and symbol return |

## E. Pictures — the resolution ladder

| # | Input | Expected |
|---|---|---|
| E1 | `POST /api/visuals {concept: "water"}` | `resolvedBy: icon_pack`, `costUsd: 0`, under 50 ms |
| E2 | `{concept: "Toilet"}` — different case | `resolvedBy: icon_pack`. Case must not cost a lookup |
| E3 | `{concept: "chocolate milkshake"}` | Reaches step 5, returns 3 candidates, `costUsd > 0` |
| E4 | Repeat E3 | `resolvedBy: hash_cache`, `costUsd: 0` — never pay twice for the same concept |
| E5 | `{concept: "a drink of water"}` | `resolvedBy: semantic` or `icon_pack`, `costUsd ≈ 0` |
| E6 | Any of the above | A `gap_detected` event records `resolvedBy` and `costUsd` |
| E7 | `{concept: "Mrs Patel"}` | The outbound prompt contains no name — the sanitiser strips titles |
| E8 | With no API key | `resolvedBy: failed`, the card keeps its existing picture, the board is unaffected |

## F. Sign-in and data attribution

| # | Input | Expected |
|---|---|---|
| F1 | `GET /` with no session | **307** to `/who` |
| F2 | `/who` | All five children as photo tiles, no password field |
| F3 | `POST /api/session {childId: jonah_k}` | `aac_child` cookie set; a `session_start` event carries `via: sign_in` |
| F4 | Load `/` with that cookie | Jonah's board — not the alphabetically first child |
| F5 | Tap cards as Jonah, then as Maya | Events land under **their own** `child_id`, not merged |
| F6 | Sign out | A `session_end` brackets the session, so a device switch is visible in the data |

## G. Dashboard login

| # | Input | Expected |
|---|---|---|
| G1 | `/dashboard` with no session | Redirect to `/dashboard/login` |
| G2 | First visit, no account exists | Setup form: choose adult, username, password twice |
| G3 | Create an account | Signed in and redirected to `/dashboard` |
| G4 | `POST {setup: true}` again | **409** — setup closes permanently after the first account |
| G5 | Sign in with the wrong password | 401, *"Those details do not match"* — never which field was wrong |
| G6 | Sign in with an unknown username | Same message, comparable response time |
| G7 | `/dashboard/student/maya_t` with no session | Redirect to login |

## H. Dashboard content

| # | Input | Expected |
|---|---|---|
| H1 | `/dashboard` | Attention Queue ranked by need. Jonah (silent 4 days) above Maya (mis-taps) |
| H2 | Read a queue row | The score breakdown is visible — `+3 silence`, `+2 mis-tap` |
| H3 | Every KPI tile | Carries **n**. A rate without its sample size is not a claim |
| H4 | `repeat_tap_rate` tile | Reads *"not a target"*, never red *(clinical C1 — repetition is communication)* |
| H5 | `words_per_minute` | Caption text, never a tile |
| H6 | `/access` | Two heat maps rendered as a pair, 32 cells |
| H7 | Adjacency ≥ 60% | Reads as a **reach** problem, not a comprehension one |
| H8 | `/access` action buttons | Offers *mask* and *add a copy*. **Never** resize or move |
| H9 | `/ai-impact` with no suggestion data | *"not being recorded yet"*, **never 0%** |
| H10 | Partner-speech panel as a teacher | Locked, with what you can and cannot see stated |

## I. Insights

| # | Input | Expected |
|---|---|---|
| I1 | Open an insight, press **What number caused this?** | Measured values *and* the thresholds they were compared against |
| I2 | Any insight card | `forbidden_actions` shown in plain English — "change the grid size", "move a card she already knows" |
| I3 | I4 (unused word) | **No action list.** `action_kind: informational` renders no intervention *(a refusal is not a training gap)* |
| I4 | I8 | Badged *"about our software"* — the rule that points at us |
| I5 | Dismiss with a reason | `fired_rules.dismiss_reason` and `dismissed_by` written; the queue re-ranks |
| I6 | A child inside their 14-day baseline | Real numbers shown, **no flags, no insights** |

## J. Event integrity

| # | Input | Expected |
|---|---|---|
| J1 | `card_tap` with `source: board`, no `grid_row` | **Rejected** — the five starred fields cannot be reconstructed later |
| J2 | `card_tap` with `source: search`, `nav_depth: 1`, no coordinates | **Accepted** — a folder word has no cell; a fabricated (0,0) would corrupt the heat maps |
| J3 | Post the same `event_id` twice | `accepted: 0, duplicates: 1` — the offline queue can retry safely |
| J4 | Unknown `scene` or `type` | Rejected, naming the field |
| J5 | Replace `aac.db` under a running server, then post | The row lands in the **current** file. A stale handle silently loses data |
| J6 | Enable Private Mode, tap cards | Nothing is written at all — not queued, not hidden |

## K. Hostname isolation

| # | Input | Expected |
|---|---|---|
| K1 | `aac.kason.app/` | 200 — the board |
| K2 | `aac.kason.app/dashboard` | **404** — a child's tablet cannot reach the analytics |
| K3 | `aac-dashboard.kason.app/` | **404** |
| K4 | `aac-dashboard.kason.app/dashboard` | 200 |
| K5 | `aac-mcp.kason.app/dashboard` | **404** |
| K6 | `aac-mcp.kason.app/api/mcp` | 200 |
| K7 | Any dashboard response | `X-Robots-Tag: noindex, nofollow, noarchive` |
| K8 | 404 responses | Plain 404, **not a redirect** — a redirect confirms the route exists |

## L. MCP

| # | Input | Expected |
|---|---|---|
| L1 | `POST /api/mcp` no token | **401** |
| L2 | Wrong token | **401**, comparable response time |
| L3 | Correct token, `tools/list` | ≥ 14 tools. Not a fixed count — the analytics session adds tools independently, and a hard number turns their work into a red build |
| L4 | `tools/call list_children` | Five children with real data |
| L5 | `AAC_MCP_TOKEN` unset | Refuses everything — fails closed, never open |

## M. Resilience

| # | Input | Expected |
|---|---|---|
| M1 | Kill the server process | launchd restarts it; the public URL returns 200 |
| M2 | Load the board offline | Board, composer and TTS all still work |
| M3 | Tap cards offline, then reconnect | Queued events flush; nothing is lost |
| M4 | A React error on the board | Fallback screen offers **help · stop · yes · no · toilet · hurt**, each speaking directly |
| M5 | Browser without speech synthesis | Sentence bar still shows the text to be read aloud |

---

## Running it

```bash
# API-level cases (E, F, J, K, L) — no browser needed
bash tools/test-api.sh

# Browser cases (A, B, C, D, G, H, I) — Playwright
playwright-cli open --headed --persistent \
  --profile=$HOME/.claude/browser-profiles/default --browser=chrome \
  http://localhost:3000/?child=maya_t
```

Results are recorded in [`test-results.md`](./test-results.md) against these case numbers.
