# Pre-Demo Test Harnesses

## Function
Two harnesses that run outside the build: `tools/concurrency_test.py` drives one writer and N readers against a copy of the WAL database and fails on lock errors or a reader p99 above 1000 ms, and `tools/test-api.sh` runs the API-level cases from `docs/test-plan.md` against a running Next server with `curl`.

## Purpose
`concurrency_test.py`'s header: *"The API server writes events while the MCP server reads for the dashboard and the analysis model. SQLite locking problems appear under exactly the conditions a live demo creates and not before, so this runs before demo day rather than during it. Works on a COPY. It never touches the database you point it at."*

This harness produced the finding that shaped the whole read path. Its own comment records it: *"The MCP server's real access pattern: materialised tables only. Querying the live insight views here produced a p99 of 5 seconds, which is exactly the finding that moved rule evaluation into `tools/run_rules.py`."*

`test-api.sh`'s header: *"API-level cases from `docs/test-plan.md`. Browser cases are run with Playwright."*

Neither is invoked by `tools/build.sh` — the build only prints the concurrency command as a suggested next step.

## Source Files
| File | Role |
|------|------|
| `tools/concurrency_test.py` | WAL writer/reader load harness, latency stats, pass/fail policy |
| `tools/test-api.sh` | `curl`-driven API acceptance cases — 33 assertions across eight lettered sections (E, F, J, L, C, G, H, K) |

## Implementation

### `concurrency_test.py`

```bash
python3 tools/concurrency_test.py --db aac.db --seconds 15    # npm run concurrency
```

| Flag | Type | Default |
|---|---|---|
| `--db` | str | `<repo root>/aac.db` |
| `--seconds` | int | `15` |
| `--readers` | int | `3` |

**Setup.** `shutil.copy(args.db, tempfile.mkdtemp()/"concurrency.db")`, then `PRAGMA journal_mode=WAL` on the copy. If the reported mode is not `wal`, it prints *"WAL is not enabled. Concurrent access will fail."* and returns `1` before starting any thread. Note the copy takes the main database file only, not its `-wal` / `-shm` siblings.

**Writer thread** — *"Stands in for the Node API ingesting events from the browser."*
- `sqlite3.connect(path, timeout=5.0)`, `PRAGMA busy_timeout = 5000`, `PRAGMA foreign_keys = ON`.
- Seeds from `MAX(day_local)` and `MAX(ts)` in `events`; session id `sess_<8 hex>`.
- Loops committing **batches of 20** rows via `executemany("INSERT INTO events VALUES (" + ",".join("?" * 21) + ")")` — *"batched, as the API does"*. Each row is a fixed `maya_t` `card_tap`: `ts + n*1000`, `tz_offset_min 720`, scene `classroom`, actor `child`, `utterance_id = utt_conc_{n // 3}`, board `board_maya_t`, card and label `want`, grid `(0,1)` on a `4×4`, `nav_depth 0`, source `board`, `ms_delta 900`, payload `{}`.

**Reader threads** — *"Stands in for the MCP server answering the dashboard and the model."*
- Same connect + `busy_timeout`, plus `PRAGMA query_only = ON` and an authorizer denying `SQLITE_ATTACH` / `SQLITE_DETACH`. The comment repeats the MCP rule: *"NOT `mode=ro`: SQLite cannot open a WAL database read-only. `query_only` plus a deny-ATTACH authorizer is the equivalent that actually works. `docs/mcp-api.md` §10."*
- Cycles six queries, **all against materialised tables**:
  1. `agg_daily_metric` for `maya_t` where `day_local >= '2026-08-01'`
  2. `fired_rules` for `maya_t` where `dismissed_at IS NULL AND superseded_by IS NULL`
  3. `agg_cell_heat` for `maya_t`
  4. `agg_card_stats` for `maya_t` `ORDER BY taps DESC LIMIT 25`
  5. `agg_word_pairs` for `liam_w` where `together = 0 LIMIT 20`
  6. `SELECT child_id, display_name FROM children`

**`Stats` dataclass.** `ok`, `busy`, `errors`, `latencies_ms`, guarded by a `threading.Lock`. `fail()` classifies an exception as a busy retry when its message contains `"locked"` or `"busy"`, otherwise as an error; both paths `time.sleep(0.01)` in the caller. `p(pct)` sorts the latency list and indexes at `min(int(len * pct), len - 1)`.

**Pass/fail.** Threads are daemons; `main` sleeps `--seconds`, sets the stop event, joins with `timeout=10`. Failure conditions:

| Condition | Message |
|---|---|
| any writer error | `writer errors: [first 3]` |
| any reader error | `reader errors: [first 3]` |
| `writer.ok == 0` | `writer never committed` |
| `readers.ok == 0` | `readers never completed a query` |
| `reader p99 > 1000` ms | `reader p99 <n>ms — dashboard would stall under load` |

The p99 budget's rationale: *"A reader p99 above a second means the dashboard stalls whenever a class is mid-session. That is a demo-day failure even though nothing errored."*

On success it prints `PASSED — <writer.ok * 20> events written and <readers.ok> reads served concurrently, no lock errors`, and, if any busy retries occurred, a dim note that they were *"absorbed by `busy_timeout` (expected under WAL; not an error)"*.

### `test-api.sh`

```bash
BASE=http://localhost:3000 ./tools/test-api.sh      # BASE defaults to that value
```

Counters `PASS` / `FAIL` / `BLOCK` with helpers `ok`, `no`, `bl` and `eq <id> <got> <want> <label>`. The script exits with `[ $FAIL -eq 0 ]`, so any failure is a non-zero exit. It requires `curl`, `python3`, `sqlite3`, a running server, and `.env.local` in the cwd.

| Case | Assertion |
|---|---|
| **E. Pictures — resolution ladder** | |
| E1 | `POST /api/visuals {"concept":"water","childId":"maya_t"}` → `resolvedBy == "icon_pack"` (*built-in symbol, free*) |
| E2 | same with `"Toilet"` → `icon_pack` (case-insensitive) |
| E3 | `"chocolate milkshake"` with `--max-time 90` → `resolvedBy` accepted via `case` as any of `generated\|hash_cache\|semantic`. Script comment: *"First run generates; every later run must hit the cache — both prove the paid step works, and re-generating on each test run would spend real money."* If the response matches `credit\|quota\|API key`, E3, E4 and E5 are all reported **BLOCK** instead. E4 and E5 have no implementation on the success path — they exist only as blocked cases. |
| E6 | `sqlite3 aac.db "SELECT count(*) FROM events WHERE type='gap_detected';"` > 0 |
| **F. Sign-in and attribution** | |
| F1 | `GET /` with no session → HTTP `307` |
| F2 | `/who` mentions exactly 5 distinct names from `Maya\|Jonah\|Amara\|Liam\|Sofia` |
| F3 | `POST /api/session {"childId":"jonah_k"}` → `ok == True`, cookie jar `/tmp/t.jar` |
| F4 | board loads as Jonah. **Emitted twice**: an `eq F4` comparing two identical `curl` invocations (always passes, a no-op assertion), then a real `grep -c 'Jonah' > 0` check. |
| **J. Event integrity** | event ids are per-run: `EID="j$(date +%s)"`. Script comment: *"a fixed event_id only passes if the previous run's cleanup succeeded, and that DELETE can silently lose to SQLITE_BUSY under WAL — which made J2 a flake that failed exactly once after any interrupted run."* |
| J1 | a `card_tap` with `source: "board"` and no `grid_row`/`grid_col` → response contains `requires grid_row` |
| J2 | a `card_tap` with `source: "search"`, `nav_depth: 1`, no coordinates → `accepted == 1` |
| J3 | replaying the identical J2 body → `duplicates == 1` (idempotent replay) |
| J4 | `scene: "moon"` → response contains `unknown scene` |
| cleanup | `sqlite3 -cmd ".timeout 3000" aac.db "DELETE FROM events WHERE session_id='t';"` — the `.timeout` is what stops the DELETE losing to `SQLITE_BUSY` under WAL |
| **L. MCP** | `TOKEN=$(grep AAC_MCP_TOKEN .env.local \| cut -d= -f2)` |
| L1 | `POST /api/mcp` with no `Authorization` → `401` |
| L2 | `Authorization: Bearer wrong` → `401` |
| L3 | `tools/list` with the real token → at least **14** tools |
| L4 | `tools/call list_children {adult_id: adult_patel}` → 5 children |
| L5 | `get_metrics` with `window: "28d"` → error message contains `not a window` (loud rejection). Script comment: *"An unknown window token must reject loudly, never silently fall back to 7d — a model that asked for a month and got a week would caption it as a month."* |
| **C. Categories** | |
| C1 | `GET /api/categories?child=maya_t` → 10 categories |
| C2 | the `Feelings` category has 8 words |
| C5 | hiding `numbers` for `maya_t` leaves it shown for `jonah_k` (per-child visibility, no leak) |
| C6 | re-showing `numbers` restores all 10 words |
| C7 | `POST /api/categories {"action":"delete","categoryId":"feelings"}` → response matches `not deleted\|cannot be deleted` |
| **G. Dashboard login** | |
| G1 | `GET /dashboard` with no session → `307` |
| G7 | `GET /dashboard/student/maya_t` with no session → `307` |
| **H. Child session switch** | script comment: *"?child= must never render in-page (cookie writes are illegal in a Server Component — this exact path 500'd in production once). It bounces through the switch route, which owns the cookie write."* |
| H1 | `GET /?child=maya_t` → `%{redirect_url}` is `$BASE/api/session/switch?child=maya_t` (board hands `?child=` to the switch route) |
| H2 | `GET /api/session/switch?child=maya_t` → response headers include `set-cookie: aac_child=` |
| H3 | same response → `location:` ends in `/` (switch lands back on the board) |
| H4 | `GET /api/session/switch?child=not_a_child` → **no** `set-cookie` header (unknown child sets no cookie) |
| **K. Hostname surface routing (static assets)** | Host-header spoofing against localhost reproduces the tunnel. Script comment: *"Card icons under `/icons/ai/` must be served on both browser surfaces — they 404'd on the public site once while localhost (surface 'any') hid it. MCP serves nothing but `/api/mcp`."* |
| K1 | `Host: aac.kason.app` → `GET /icons/ai/want.png` → `200` (board host serves card icons) |
| K2 | `Host: aac-dashboard.kason.app` → `GET /icons/ai/want.png` → `200` (dashboard host serves card icons) |
| K3 | `Host: aac-mcp.kason.app` → `GET /icons/ai/want.png` → `404` (mcp host serves no static assets) |
| K4 | `Host: aac.kason.app` → `GET /dashboard` → `404` (board host still refuses `/dashboard`) |

The script mutates the live `aac.db` — J1–J4 write events through the API and the J-section cleanup deletes them by `session_id='t'`; E3 may generate and cache a real image; C5/C6 toggle category visibility and restore it. Case ids are non-contiguous (E4, E5 only appear blocked; C3, C4, G2–G6 are absent) because the numbering follows `docs/test-plan.md`, of which this covers the API-level subset.

## Dependencies & Connections

### Depends On
- [L2 Rollup](l2-rollup.md) and [Nightly Rule Materialisation](rule-materialisation.md) — the reader queries hit `agg_*` and `fired_rules`; the whole point is that they are materialised
- [Seed Cohort Generation](seed-generation.md) — `maya_t`, `liam_w`, `board_maya_t`, the five children and `adult_patel` are all seeded ids
- [Analytics Schema and Indices](../database/schema.md) — the 21-column `events` insert is positional against `db/schema.sql`
- [Event Ingest](../api/event-ingest.md) — section J asserts its validation rules
- [Visual Resolution Endpoint](../api/visual-resolution-endpoint.md) — section E asserts the resolution ladder
- [Board Content Endpoints](../api/board-content-endpoints.md) — section C asserts category behaviour
- [Child Sign-In](../kid-app/child-sign-in.md) and [Adult Sign-In](../auth/adult-sign-in.md) — sections F and G
- [MCP stdio Server](../mcp/stdio-server.md) — section L asserts the tool count and auth on `/api/mcp`

### Depended On By
- [Deterministic Build Pipeline](build-pipeline.md) — prints the concurrency command as the suggested post-build check
- `docs/test-plan.md` / `docs/test-results.md` — the recorded results come from this script

### Shared Resources
- A temp copy of `aac.db` under `tempfile.mkdtemp()` (concurrency), and the **live** `aac.db` (test-api)
- `.env.local` → `AAC_MCP_TOKEN`
- `/tmp/t.jar` cookie jar
- `BASE` environment variable, default `http://localhost:3000`
- The three spoofed `Host` values — `aac.kason.app`, `aac-dashboard.kason.app`, `aac-mcp.kason.app` — which section K sends against localhost; they are the same prefixes `middleware.ts` matches, so renaming a public hostname changes this script too
- `public/icons/ai/want.png` — the asset K1–K3 fetch; its absence would fail K1/K2 with a 404 for a non-routing reason

## Change Risks
- **Pointing the reader queries at the live insight views instead of `agg_*` reproduces the 5-second p99** the header records, and the harness will fail at `reader p99 > 1000 ms` — which is the harness doing its job, and the reason [Nightly Rule Materialisation](rule-materialisation.md) exists at all.
- **Changing the `events` column count or order** breaks the writer's positional 21-placeholder insert with an opaque SQLite error, not a helpful one.
- **Removing `busy_timeout = 5000`** turns absorbed retries into hard `database is locked` errors, and the harness will report them as failures rather than as the dim "busy retries" note.
- **Copying only the main database file** means a source database with uncheckpointed WAL frames produces a copy missing recent rows. The harness still passes — it measures locking, not completeness — but reader row counts will look wrong.
- **Running `test-api.sh` against anything but a local dev database mutates it.** It POSTs events, deletes rows with raw `sqlite3`, and toggles category visibility. It also reads `aac.db` by a hardcoded relative path, so it only works from the repo root.
- **Changing the tool count on the MCP server below 14** fails L3; adding tools is safe (the assertion is `>= 14`).
- **Changing the unauthenticated redirect status** from `307` breaks F1, G1 and G7 together.
- **The duplicated F4 assertion inflates the pass count by one** and can never fail; anyone reading the totals should know one PASS is structural.
- **E4 and E5 are only ever reported when E3 is blocked.** They have no success-path implementation of their own — but E3's `generated|hash_cache|semantic` acceptance means the cache path *is* exercised in practice: the first run generates, every later run hits the cache, and either outcome passes. What E3 cannot tell you is *which* path ran on a given execution; a regression that silently re-generates (and spends money) on every run still passes.
- **Narrowing `SHARED_PREFIXES` in `middleware.ts`** (currently `['/icons/']`) fails K1/K2 — and that is the harness doing its job, because the icons would 404 on both public hostnames while localhost (surface `'any'`) hides it. Widening it onto the mcp surface fails K3. The K section is the only automated check of this contract.
- **Making `get_metrics` fall back silently on an unknown window token** fails L5, which pins the loud `not a window` rejection. The failure L5 guards against is a model asking for a month, getting a week, and captioning it as a month.
