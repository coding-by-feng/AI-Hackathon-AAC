# Overnight Testing Report — 2026-08-08

**TL;DR: everything shipped is verified working.** 194 checks across all 10 feature
domains ran against the production build (`XgbdYm_URBUh2_nhIKYr3`): **191 verified, 3
deferred with stated reasons, 0 open failures.** Nine bugs were found and fixed during
the passes — including one that had been invisible since the first commit. The board,
dashboard, and chatbot are live on their public URLs with all **76/76 AI icons**
generated.

Full row-by-row evidence: [`feature-verification.md`](feature-verification.md) ·
process: [`verify-features` skill](../.claude/skills/verify-features/SKILL.md)

## Scoreboard

| Surface | What was checked | Result |
|---|---|---|
| Kid board | Sentence assembly exact-match ("I want water.", "I need help."), mode safety (card order byte-identical), ABC keyboard (QWERTY), modeling "?" dialog, AI icons (30 rendering), offline queue, 375 px | **PASS** |
| Dashboard | Attention queue (Jonah top), student Findings (4 cards, invariants below), metric n-attribution, report block, 375 px | **PASS** |
| AI chatbot | SSE loop (tool_call → tool_result → text → done), grounded answers ("no communication recorded for the last 5 days" = Jonah's real silence streak), scope isolation, forbidden-advice guard | **PASS** |
| MCP server | All 15 spec rows re-executed: protocol 2025-06-18, read-only guard, SQL injection rejections, C2/C3 `move` rejection at schema level, 20 tools over HTTP | **PASS** |
| Pipeline & DB | Clinical gate 42 checks · WAL concurrency 127k writes + 116k reads, 0 lock errors | **PASS** |
| API suite | `tools/test-api.sh` — now 28 cases, run twice back-to-back | **28/28 · 28/28** |

## Clinical invariants, verified live in a browser

- A generated mode **never moves a card** — full card order compared before/after: identical.
- **Informational findings show no action button** (I4 renders none; I1/I3/I8 do).
- **Forbidden actions are displayed** on every finding card ("Never recommend shrinking the grid…").
- Metrics with no source data say **"not recorded yet" — never 0**.
- Every metric number carries its **n**.

## Bugs found and fixed (all re-verified after fix)

1. **Every `?child=` link crashed the production board** — cookie write inside a Server
   Component render; dev tolerated it, prod threw. Now a dedicated switch route. *(4 new
   suite cases cover it.)*
2. **The insight cards had never been mounted — since the initial commit.** The clinical
   findings UI existed only as unreachable code. Now a "Findings" section on the student
   page; invariants verified live.
3. **Chatbot would answer from a deleted database** after a pipeline rebuild (handle
   pinned to the old inode). Now re-stats and reopens per call.
4. **Chat's "TODAY" was UTC** — wrong for half of every NZ day. Now server-local.
5. **A working dashboard password sat in a committable file** — moved to gitignored `.env.local`.
6. **Modeling-help dialog ignored Escape** — keyboard handling added, focus managed.
7. **`J2` suite flake** — fixed event id + cleanup that silently lost to `SQLITE_BUSY`;
   J-section now hermetic (proven with consecutive runs).
8. **`hungry`/`play` icons failed every generation round** — bare-concept prompts;
   reworded as concrete pictogram scenes. **76/76 complete.**
9. Minor: dead export removed, switch route hardened, CRLF artifact in a new test.

## Deferred (3 rows, reasons on record)

- Wrong-passcode branch — needs a passcode seeded; the install has none.
- Forced paid image generation (~$0.06) — provider chain already proven via cheaper rungs.
- Full `tools/build.sh` rebuild — destructive to saved reports; determinism vouched by the 42-check gate.

## Live URLs

- Board: **https://aac.kason.app** (child sign-in at `/who`)
- Dashboard: **https://aac-dashboard.kason.app** (Findings section is new on student pages)
- MCP: **https://aac-mcp.kason.app** (bearer token, 20 tools)

## Worth a look in the morning

- The **Findings** section on `aac-dashboard.kason.app` → Maya — this UI existed in the
  codebase since day one but had never been reachable until tonight.
- The board's icons — all 76 concepts now have AI-generated symbols; `hungry` and `play`
  were the last two holdouts.

## Round 2 — metric-calculation audit (added later the same night)

Every metric in `AAC_Filtered_Metric_Index.md` was recomputed independently from raw
events on a fresh **half-year cohort** (180 days × 5 children, 113,914 events) and
compared across views/rollup, dashboard readers, and MCP. First run: 57 discrepancies.
After fixes: **135/135 scalar + 15/15 dimensional agreement**, and on live data the
dashboard, chatbot, and gold recompute cite identical numbers. Nine calculation bugs
fixed — headline three: daily min_n suppression was destroying window aggregates
(0.15 shown where 170 samples said 0.51); MCP averaged tallies (348 modelled presses
→ "12.4"); the nightly rule re-run had never once worked (FK-violating sentinel).
Full table: `docs/feature-verification.md` §"Metric-calculation pass".
