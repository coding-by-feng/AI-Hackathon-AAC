# AAC Analytics

An AAC (Augmentative and Alternative Communication) system for nonspeaking children: a
symbol-grid communication board, a teacher/therapist analytics dashboard, a SQLite analytics
database with a deterministic rule engine, and an MCP server that is the single seam between
that data and any model allowed to read it.

Two surfaces, one Next.js app, split by hostname:

| Surface | Route | Who |
|---|---|---|
| Communication board | `/` | the AAC user (a child) |
| Dashboard | `/dashboard` | teacher · SLT · parent |

**The thing that makes this project unusual:** several metrics and two insight rules, as
originally specified, would have produced advice that harms AAC users. Those corrections are
recorded in [`docs/aac-clinical-constraints.md`](docs/aac-clinical-constraints.md) as eight
binding constraints (C1–C8), and they are enforced **in the schema and in code**, not in copy.
Read that file before changing anything in the metrics, insights, or board-layout paths.

## Tech stack

| Concern | Choice |
|---|---|
| Web | Next.js 15 (App Router) · React 19 · TypeScript 5.9 · Tailwind 4 |
| Runtime | Node ≥ 24 — `node:sqlite` is built in, so the MCP server has **zero npm dependencies** |
| Database | SQLite in WAL mode. `aac.db` (analytics, pipeline-owned) · `aac_app.db` (app writes: accounts, passcodes, card overrides) |
| Rules | Plain SQL views. Deliberately not a model — a therapist has to be able to trace a finding to a number |
| Analysis model | Gemma 3 4B on a separate device, connecting **outbound** as an MCP client |
| Chat AI | Vertex Gemini 3 (default) · OpenAI · Anthropic · AI-Studio Gemini · **a local model** (Gemma via any OpenAI-compatible server on your own network) — switchable at `/dashboard/settings`. Keys and addresses are server-side only |
| Image AI | Vertex `gemini-2.5-flash-image`, server-side only |
| Pipeline | Python 3 — seed generation, L2 rollup, rule materialisation, verification gate |

## Commands

```bash
./tools/build.sh aac.db     # build the whole database from nothing — 7 stages, deterministic
npm run verify              # clinical-safety gate: 42 checks, non-zero exit on failure
npm run concurrency         # 1 writer + 3 readers against a copy; proves WAL holds up
npm run mcp                 # MCP server over stdio
npm run dev                 # board at /, dashboard at /dashboard
npm run build:web           # next build
npm run typecheck           # tsc --noEmit
```

`tools/build.sh` **deletes and recreates `aac.db`**. Any handle opened before it runs keeps
reading the deleted inode — which is why `lib/sqlite.ts` exists.

## Feature Documentation

**MANDATORY WORKFLOW — Before implementing any new feature or modifying an existing one:**
1. Read this CLAUDE.md to identify which feature domain is involved
2. Read the corresponding feature doc(s) in `docs/feature/` to understand the current implementation, source files, dependencies, and change risks
3. Check the Impact Matrix to identify connected features that may be affected
4. Read those connected feature docs too, so you don't introduce regressions
5. After completing the work, update every feature doc that was affected by the change (via `/update-feature-docs`)

**Feature docs are manifest-backed.** `docs/feature/.manifest.json` is the machine-readable source of truth for file→doc mapping, symbol inventory, and last-aligned timestamps. Skills read and update this file — do not edit it by hand. If it gets out of sync, run `/align-existing-feature-docs` (use `--rebuild-manifest` if the manifest itself is corrupted).

**67 features across 10 domains** — start at [`docs/feature/README.md`](docs/feature/README.md).

| Domain | Covers | Docs |
|---|---|---|
| [`kid-app/`](docs/feature/README.md#kid-app) | Board, sentence bar, speech, symbols, categories, offline queue, child sign-in | 10 |
| [`api/`](docs/feature/README.md#api) | Route handlers and server actions for both surfaces | 8 |
| [`dashboard/`](docs/feature/README.md#dashboard) | Attention queue, student tabs, reports, ask panel, insight cards | 10 |
| [`analytics/`](docs/feature/README.md#analytics) | Metric readers, fired rules, baseline gating, data dictionary | 4 |
| [`ai/`](docs/feature/README.md#ai) | Ask agent, provider split, forbidden-action guard, visual ladder | 8 |
| [`mcp/`](docs/feature/README.md#mcp) | stdio server, tool surface, read-only DB access, validation | 5 |
| [`database/`](docs/feature/README.md#database) | Schema, indices, catalogues, metric views, insight views | 5 |
| [`pipeline/`](docs/feature/README.md#pipeline) | Build, seed, rollup, rule materialisation, verification gate | 8 |
| [`auth/`](docs/feature/README.md#auth) | Adult sign-in, role/consent scoping, host routing | 4 |
| [`deploy/`](docs/feature/README.md#deploy) | Build config, web service, tunnel ingress | 5 |

## Impact Matrix

The precise file→doc mapping is in
[`docs/feature/README.md#impact-matrix`](docs/feature/README.md#impact-matrix) (149 rules,
generated from the manifest). These are the high-leverage ones:

| If you change … | Also check … |
|---|---|
| `db/schema.sql` | 11 docs — every domain reads it. Run `npm run verify` after. |
| `db/views_metrics.sql`, `db/views_insights.sql` | `database/metric-views.md`, `database/insight-views.md`, `analytics/metric-readers.md`, `pipeline/l2-rollup.md`, `pipeline/rule-materialisation.md` |
| `db/seed_catalogues.sql` | `database/catalogues.md`, `analytics/data-dictionary.md`, `dashboard/insight-cards.md`, `ai/forbidden-action-guard.md` |
| `lib/metrics.ts` | `analytics/metric-readers.md` + every dashboard doc that renders a metric |
| `lib/access.ts` | `auth/role-consent-scoping.md` + all 8 dashboard docs and `ai/scoped-tool-bridge.md` |
| `lib/ingest.ts`, `app/api/events/` | `api/event-ingest.md`, `kid-app/event-logging.md`, `pipeline/l2-rollup.md` |
| `mcp/tools.ts` | `mcp/tool-surface.md`, `mcp/argument-validation.md`, `ai/scoped-tool-bridge.md`, `api/mcp-http-transport.md`, `mcp/response-fixtures.md` |
| `components/kid/board-app.tsx` | `kid-app/communication-board.md` + `kid-app/event-logging.md` |
| `tools/seed/*` | 7 pipeline docs — the seeded cohort is what `verify.py` asserts against |

## Module tree

```
app/                  Next.js App Router
  page.tsx            the communication board (kid surface)
  who/                picture-based child sign-in
  login/              adult sign-in
  dashboard/          class view · student tabs · sessions · reports · ask
                      · settings (AI provider/model/keys)
  api/                auth · cards · categories · chat · dashboard/settings
                      · events · mcp · reports (incl. print + pdf) · session
                      · visuals
components/
  kid/                board, card face, category drawer/editor, edit sheet,
                      keyboard layer, modelling help, essential rail,
                      voice picker, who picker, SW registration
  chat/               ask panel + markdown renderer
  *.tsx               charts, heat grid, insight cards, KPI tiles, theme
                      toggle, UI primitives
lib/
  kid/                log (IndexedDB queue) · sentence · speech · voice
  chat/               agent · providers (vertex · openai · anthropic · gemini)
                      · settings · guard · tool bridge
  visuals/            resolution ladder · providers · sanitise · store
  categories/         category store + types
  metrics.ts insights.ts baseline.ts catalog.ts     analytics read layer
  auth.ts access.ts session.ts                      identity and scoping
  db.ts sqlite.ts ingest.ts                         database access + writes
  queue.ts sittings.ts report.ts report-store.ts    dashboard data
db/                   schema · indices · seed_catalogues · views_metrics
                      · views_insights
mcp/                  server (JSON-RPC/stdio) · tools · db · validate · fixtures
tools/                build.sh · seed/ · rollup.py · run_rules.py · verify.py
                      · gen_metric_index.py · concurrency_test.py · export_csv.py
docs/                 specs (analytics-metrics · mcp-api · TECH_STACK
                      · aac-clinical-constraints) + feature/ + pitch.html
middleware.ts         host-based surface routing
```

## Key Invariants

Each of these is a place where the obvious implementation produces harmful behaviour. They
look like details. They are not.

| Invariant | Enforced in |
|---|---|
| A metric whose catalogue polarity is `neutral` can never render as good or bad. `repeat_tap_rate` exists to stop the system pathologising stimming. | `lib/catalog.ts` — `direction()` returns `'flat'` for neutral regardless of delta |
| `action_kind === 'informational'` renders **no action button**. I4 case B is a child refusing something; offering an intervention teaches them their "no" does not count. | `components/insight-card.tsx:139` |
| `forbidden_actions` is **displayed**, not merely obeyed. | `components/insight-card.tsx`, `db/seed_catalogues.sql` |
| Never *resize* or *move* a learned button — relocating destroys the motor plan (C2/C3). The UI offers *mask* and *add a copy* only. | `components/heat-grid.tsx`, `db/seed_catalogues.sql` `forbidden_actions` |
| A generated mode highlights and dims; it never moves a card (C4). Modes hold no independent positions. | `components/kid/board-app.tsx`, `boards.kind ∈ {robust, mode}` |
| Modelling Mode auto-exits after **90 s** idle, so adult presses are never silently attributed to the child. | `components/kid/board-app.tsx:154` |
| Nothing is flagged until a child has **14 active days and 40 utterances of their own**. Gated on activity, not the calendar. | `lib/baseline.ts` — `BASELINE_ACTIVE_DAYS = 14`, `BASELINE_MIN_UTTERANCES = 40` |
| An on-grid `card_tap` missing `grid_row`/`grid_col`/`grid_rows`/`grid_cols`/`nav_depth` is **rejected**, loudly. Those cannot be reconstructed later. | `lib/ingest.ts:92` |
| Role and consent are filtered in the **query layer**, never in a component. A page that forgets to check is a bug; a query that cannot return unauthorised rows is a guarantee. | `lib/access.ts` |
| The web app may write only four statements against `aac.db`. Everything else is pipeline-owned. | `lib/db.ts` — `WRITABLE` regex: `update fired_rules`, `insert into board_change_proposals`, `update board_change_proposals`, `insert into reports` |
| Model prose (`insights`) cannot exist without the `fired_rule_id` that justified it. | `db/schema.sql`, `mcp/tools.ts` `write_insight` |
| Utterance text lives in a separate file the MCP process user **cannot read**. Not a permission setting — a filesystem fact. | `mcp/db.ts` + OS permissions; see `docs/mcp-api.md` §10 |
| `mode=ro` cannot open a WAL database, and `query_only` does not block `ATTACH`. Use a normal handle + `query_only` + a deny-`ATTACH` authorizer. | `mcp/db.ts`, `lib/sqlite.ts` |
| Rules are SQL, never a model — they must stay deterministic and explainable to a speech therapist. | `db/views_insights.sql`, `tools/run_rules.py` |

## Known gaps

Honest list, kept here so nobody rediscovers them as bugs.

1. **`suggestion_acceptance`, `vocabulary_gaps` and `visual_source_split` have no source data.**
   `suggestion_shown`, `suggestion_tap` and `gap_detected` are not emitted by any client, so
   these render "not recorded yet" rather than as zeroes. `tools/verify.py` warns by name.
2. **`keyboard_use` metric is not wired to its events.** The ABC keyboard exists
   (`components/kid/keyboard-layer.tsx`, closing constraint C8) and the board emits
   `keyboard_input` events the ingest whitelist accepts — but no view in
   `db/views_metrics.sql` reads them, so the metric renders "not used yet" even once a child
   spells. Wiring it is a pipeline change (`v_daily_metrics_all`).
3. **`mistap_threshold_ms` is fixed at 1500 ms** in the views. Per-child tuning (2500 ms is
   often truer for athetoid CP) needs a column on `children` — a schema change, so the
   pipeline's call.
4. **No clinician has reviewed C1–C8.** They are read from AssistiveWare's published guidance
   and cited per constraint. That is reading, not review.

> ⚠️ [`docs/web-app.md`](docs/web-app.md) is **stale** on two points: it says there is no
> sign-in (there is — `lib/auth.ts`, scrypt + HMAC-signed cookie) and that board-change
> proposals have no write path (they do — see the `WRITABLE` whitelist). Trust
> `docs/feature/` over it; those docs were generated from the code.
