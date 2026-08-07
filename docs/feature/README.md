# Feature Documentation

One file per feature, grouped by domain. Generated from [`.manifest.json`](./.manifest.json) — **do not hand-edit this index**; edit the feature docs and regenerate.

**63 features** across **10 domains**, covering **124 source files**. Last generated `2026-08-07T11:16:46Z`.

> **Hand-added this wave (not yet in the manifest — fold in at next regeneration):** [AI Vocabulary Icons](./kid-app/ai-vocabulary-icons.md) · [Keyboard & Modeling Help](./kid-app/keyboard-and-modeling-help.md) · [Dashboard Redesign](./dashboard/dashboard-redesign.md). The latter two document work still in flight and carry a "verify after integration" banner.

> **Before changing code:** find the feature below, read its doc, then read everything in its *Depends On* / *Depended On By* lists. The [Impact Matrix](#impact-matrix) maps file paths to the docs you must check.

## Index

### `kid-app/`

The child-facing AAC board — the surface a nonspeaking child actually taps.

| Feature | What it does | Key files |
|---|---|---|
| [AI Vocabulary Icons](./kid-app/ai-vocabulary-icons.md) | Build-time Vertex-generated PNG icon per vocabulary word, served as static assets and consumed by `CardFace` above the… | `tools/generate-icons.mjs`, `lib/icons/ai-manifest.ts`, `components/kid/card-face.tsx` |
| [Keyboard & Modeling Help](./kid-app/keyboard-and-modeling-help.md) | *(in flight — verify after integration)* On-board keyboard for alphabet access (clinical gap C8, metric H2) plus adult… | `components/kid/*`, `lib/kid/*` |
| [Card Customisation (Edit Sheet & Overrides)](./kid-app/card-customisation.md) | Lets an adult change a card's wording, its symbol and its picture for **one child**, storing the change as a… | `lib/overrides.ts`, `components/kid/edit-sheet.tsx` |
| [Category Folders](./kid-app/category-folders.md) | A second vocabulary surface: a chip bar above the sentence bar opens a drawer that slides **over** the board with extra… | `lib/vocabulary/categories.ts`, `lib/categories/store.ts`, `lib/categories/types.ts` +2 |
| [Child Sign-In (Who Is Using The Board)](./kid-app/child-sign-in.md) | A picture-based sign-in at `/who` that puts the current child in an httpOnly cookie, with an optional three-symbol… | `lib/session.ts`, `app/who/page.tsx`, `components/kid/who-picker.tsx` |
| [Communication Board](./kid-app/communication-board.md) | The child-facing AAC surface at `/`: a fixed-position symbol grid, an always-on essential rail, a sentence bar with… | `app/page.tsx`, `components/kid/board-app.tsx` |
| [Event Logging & Private Mode](./kid-app/event-logging.md) | An offline-first client event logger that writes every board interaction to IndexedDB and flushes it to… | `lib/kid/log.ts` |
| [Offline & PWA Shell](./kid-app/offline-pwa.md) | The installable-app wrapper around the board: the root layout and viewport lock, the web app manifest and icon, and a… | `app/layout.tsx`, `components/kid/register-sw.tsx`, `public/sw.js` +2 |
| [Symbol Set, Card Faces & Design Tokens](./kid-app/symbol-set.md) | A built-in inline-SVG AAC symbol set (68 symbols) coloured by the Fitzgerald key, the `CardFace` component that renders… | `lib/icons/symbols.tsx`, `components/kid/card-face.tsx`, `app/globals.css` |
| [Utterance Assembly & Speech Output](./kid-app/utterance-and-speech.md) | Turns the selected cards into one sentence (`buildUtterance`), speaks it through the Web Speech API with a ranked… | `lib/kid/sentence.ts`, `lib/kid/speech.ts`, `lib/kid/voice.ts` +1 |

### `api/`

Next.js route handlers and server actions — the HTTP surface for both clients.

| Feature | What it does | Key files |
|---|---|---|
| [Ask Chat Endpoint](./api/ask-chat-endpoint.md) | `POST /api/chat` streams the Ask panel's answer as Server-Sent Events while the agent calls MCP tools; `GET /api/chat`… | `app/api/chat/route.ts` |
| [Board Content Endpoints](./api/board-content-endpoints.md) | `/api/cards` reads, saves and clears per-child card customisations (label, word form, spoken text, symbol, photo)… | `app/api/cards/route.ts`, `app/api/categories/route.ts` |
| [Event Ingest](./api/event-ingest.md) | `POST /api/events` accepts a batch of board events from the browser, validates every row by name against the closed… | `app/api/events/route.ts`, `lib/ingest.ts` |
| [Insight Dismissal Action](./api/insight-dismissal-action.md) | `dismissAction(firedRuleId, reason)` is the root Server Action that marks a `fired_rules` row as dismissed by the… | `app/actions.ts` |
| [MCP HTTP Transport](./api/mcp-http-transport.md) | `POST /api/mcp` speaks JSON-RPC 2.0 MCP over HTTP — `initialize`, `tools/list`, `tools/call`, `resources/list`… | `app/api/mcp/route.ts` |
| [Reporting Endpoints](./api/print-and-generate.md) | `POST /api/reports` generates one stored report per child programmatically, and `GET /api/reports/[id]/print` renders a… | `app/api/reports/route.ts`, `app/api/reports/[id]/print/route.ts` |
| [Sign-in Endpoints](./api/sign-in-endpoints.md) | Two cookie-setting endpoints for two different people: `POST/GET/DELETE /api/auth` signs an adult into the dashboard… | `app/api/auth/route.ts`, `app/api/session/route.ts` |
| [Visual Resolution Endpoint](./api/visual-resolution-endpoint.md) | `POST /api/visuals` takes a concept (a word, optionally with a clarifying detail) and returns a picture for it, along… | `app/api/visuals/route.ts` |

### `dashboard/`

Teacher / SLT / parent surfaces: attention queue, student pages, reports, ask panel.

| Feature | What it does | Key files |
|---|---|---|
| [Dashboard Redesign (Dark Report Layout)](./dashboard/dashboard-redesign.md) | *(in flight — verify after integration)* Restyles the dashboard to the approved dark report mockup on top of… | `app/dashboard/**`, `lib/report.ts` |
| [Ask Panel](./dashboard/ask-panel.md) | The streaming chat surface: a client component that POSTs to `/api/chat` and renders the answer alongside the tools it… | `components/chat/ask-panel.tsx`, `app/dashboard/ask/page.tsx`, `app/dashboard/student/[id]/ask/page.tsx` |
| [Attention Queue (Class View)](./dashboard/attention-queue.md) | The dashboard landing page at `/dashboard`: a ranked "Needs a person today" list built from a five-term additive score… | `app/dashboard/page.tsx`, `lib/queue.ts` |
| [Dashboard Shell & Primitives](./dashboard/dashboard-shell.md) | The `/dashboard` route-group chrome — header, four-item nav, analysis-freshness indicator, viewer identity, footer… | `app/dashboard/layout.tsx`, `app/dashboard/error.tsx`, `app/error.tsx` +2 |
| [Insight Cards (Findings & Dismissal)](./dashboard/insight-cards.md) | The client-side card that renders one fired rule as a hypothesis with its evidence, its thresholds, what usually helps… | `components/insight-card.tsx`, `components/insight-list.tsx`, `lib/dismiss.ts` |
| [Progress Reports](./dashboard/progress-reports.md) | The report-set metric surface in three forms: a **live** Progress tab per child (`/dashboard/student/[id]/report`), a… | `lib/report.ts`, `lib/report-store.ts`, `app/dashboard/student/[id]/report/page.tsx` +5 |
| [Reach & Errors (Access Page)](./dashboard/reach-and-errors.md) | The `/dashboard/student/[id]/access` tab: a pair of board heat maps (presses vs. undone presses) over a 14-day window… | `app/dashboard/student/[id]/access/page.tsx`, `components/heat-grid.tsx` |
| [Sittings (Sessions Page)](./dashboard/sittings.md) | `/dashboard/sessions` — one row per **sitting** at the device across every child on the viewer's roster, with sort and… | `app/dashboard/sessions/page.tsx`, `lib/sittings.ts` |
| [Student Overview & AI Impact](./dashboard/student-overview.md) | The two per-child metric tabs: **Overview** (`/dashboard/student/[id]`) with four KPI tiles, a words-per-minute… | `app/dashboard/student/[id]/page.tsx`, `app/dashboard/student/[id]/ai-impact/page.tsx`, `components/kpi-tile.tsx` |

### `analytics/`

The metric and insight read layer, baseline gating, and the data dictionary.

| Feature | What it does | Key files |
|---|---|---|
| [Baseline Gating](./analytics/baseline-gating.md) | Decides whether a child has accumulated enough of their own history for any threshold in the system to mean anything… | `lib/baseline.ts` |
| [Data Dictionary (metrics_catalog / insights_catalog reader)](./analytics/data-dictionary.md) | Reads `metrics_catalog` and `insights_catalog` out of `aac.db` and exposes every metric's name, unit, polarity, tier… | `lib/catalog.ts` |
| [Fired Rules & Evidence](./analytics/fired-rules-and-evidence.md) | Reads `fired_rules` (deterministic SQL rule firings) joined to `insights` (model narration), hydrates each one with its… | `lib/insights.ts` |
| [Metric Readers](./analytics/metric-readers.md) | The read layer the dashboard renders from: scalar metrics rolled up out of `agg_daily_metric` over a `Window`, plus the… | `lib/metrics.ts` |

### `ai/`

LLM integration: the ask agent with its provider split, and the visual resolution ladder.

| Feature | What it does | Key files |
|---|---|---|
| [Ask Agent Loop](./ai/ask-agent.md) | `runAgent()` drives the question → model → tool calls → results → answer loop for the Ask panel, bounded at… | `lib/chat/agent.ts` |
| [Chat Provider Split (OpenAI / Gemini)](./ai/chat-providers.md) | A two-provider abstraction for the Ask agent: one `ChatProvider` interface, one shared SSE reader, and two… | `lib/chat/provider.ts`, `lib/chat/openai.ts`, `lib/chat/gemini.ts` +1 |
| [Forbidden-Action Guard](./ai/forbidden-action-guard.md) | A regex phrase index that scans the generated answer for advice AAC practice rules out — resizing a grid, relocating a… | `lib/chat/guard.ts` |
| [Image Provider Chain (Gemini / Vertex / OpenAI)](./ai/image-providers.md) | Selects and calls whichever image-generation and embedding service is actually configured — Gemini AI Studio, Vertex AI… | `lib/visuals/provider.ts`, `lib/visuals/gemini.ts`, `lib/visuals/vertex.ts` +1 |
| [Scoped Tool Bridge (in-process MCP)](./ai/scoped-tool-bridge.md) | Exposes the MCP tools from `mcp/tools.ts` to the chat agent **in-process**, rewriting each tool's schema so the model… | `lib/chat/tools.ts` |
| [Generated-Picture Cache](./ai/visual-cache.md) | Stores every generated picture in `generated_visuals` (in `aac_app.db`) as a data: URL with its prompt, model and… | `lib/visuals/store.ts` |
| [Visual Prompt & Concept Sanitisation](./ai/visual-prompt-and-sanitisation.md) | Two small modules that together decide exactly what leaves the device for an image request: `sanitize.ts` strips… | `lib/visuals/sanitize.ts`, `lib/visuals/prompt.ts` |
| [Visual Resolution Ladder](./ai/visual-resolution-ladder.md) | `resolveVisual()` finds a picture for a concept by trying five sources cheapest-first — built-in symbol set, another… | `lib/visuals/ladder.ts` |

### `mcp/`

The MCP server — the single seam between analytics data and every model that reads it.

| Feature | What it does | Key files |
|---|---|---|
| [Tool Argument Validation](./mcp/argument-validation.md) | `validateArgs(schema, args)` checks a tool call's arguments against that tool's JSON Schema before the tool runs… | `mcp/validate.ts` |
| [Read-Only Database Access and the SQL Guard](./mcp/read-only-db-access.md) | A zero-dependency `Db` wrapper over `node:sqlite` that gives every MCP tool a read-only handle, an optional… | `mcp/db.ts` |
| [Captured Response Fixtures](./mcp/response-fixtures.md) | Two committed JSON files holding real MCP responses for `maya_t` and `sofia_r` over a `last_14d` window — 14 tool calls… | `mcp/fixtures/maya_t-last_14d.json`, `mcp/fixtures/sofia_r-last_14d.json` |
| [MCP stdio Server](./mcp/stdio-server.md) | A zero-dependency JSON-RPC 2.0 server over stdin/stdout that exposes the AAC analytics tool surface and four static… | `mcp/server.ts`, `.mcp.json` |
| [MCP Tool Surface and Guidance Envelope](./mcp/tool-surface.md) | Twenty typed tools that read the AAC analytics database and return the universal envelope from `docs/mcp-api.md` §2… | `mcp/tools.ts` |

### `database/`

SQLite schema, indices, seeded catalogues, metric and insight views, connection layer.

| Feature | What it does | Key files |
|---|---|---|
| [Metric and Insight Catalogues](./database/catalogues.md) | Seeds `metrics_catalog` with 41 metric definitions (33 `shown`, 4 `logged`, 4 `cut`) and `insights_catalog` with the 8… | `db/seed_catalogues.sql` |
| [Connection Layer](./database/connection-layer.md) | Provides the Next.js application's access to `aac.db`: an inode-keyed SQLite connection cache that reopens a handle… | `lib/db.ts`, `lib/sqlite.ts` |
| [Insight Rule Views](./database/insight-views.md) | Implements the eight diagnostic rules I1–I8 as 12 plain-SQL views. | `db/views_insights.sql` |
| [Metric Views](./database/metric-views.md) | Defines 41 SQL views that compute every metric from `events`, `utterances` and `partner_turns` — 24 scalar `v_m_<slug>`… | `db/views_metrics.sql` |
| [Analytics Schema and Indices](./database/schema.md) | Defines the entire `aac.db` SQLite database — 31 STRICT tables spanning people/access, vocabulary and boards, the… | `db/schema.sql`, `db/indices.sql` |

### `pipeline/`

Python build tooling: seed generation, rollup, rule materialisation, safety gate.

| Feature | What it does | Key files |
|---|---|---|
| [Deterministic Build Pipeline](./pipeline/build-pipeline.md) | `tools/build.sh` rebuilds `aac.db` from nothing in seven numbered stages plus an unnumbered docs-and-fixtures stage… | `tools/build.sh` |
| [CSV Export and Column Dictionaries](./pipeline/csv-export.md) | `tools/export_csv.py` writes the analytics data to a folder of CSVs — from the database by default, or from an MCP… | `tools/export_csv.py`, `tools/csv_docs.py` |
| [Generated Artefacts — Metric Index and MCP Fixtures](./pipeline/generated-artefacts.md) | Two generators that replace hand-maintained files with regenerated ones: `tools/gen_metric_index.py` rewrites the… | `tools/gen_metric_index.py`, `tools/gen_fixtures.py` |
| [L2 Rollup](./pipeline/l2-rollup.md) | `tools/rollup.py` materialises the four L2 aggregate tables — `agg_daily_metric`, `agg_card_stats`, `agg_cell_heat`… | `tools/rollup.py` |
| [Nightly Rule Materialisation](./pipeline/rule-materialisation.md) | `tools/run_rules.py` evaluates the eight diagnostic insight views (`v_i1_*` … `v_i8_*`), writes one `fired_rules` row… | `tools/run_rules.py` |
| [Seed Cohort Generation](./pipeline/seed-generation.md) | Generates the entire demo database deterministically — five children with deliberately planted clinical conditions… | `tools/seed/generate.py`, `tools/seed/personas.py`, `tools/seed/vocab.py` |
| [Pre-Demo Test Harnesses](./pipeline/test-harnesses.md) | Two harnesses that run outside the build: `tools/concurrency_test.py` drives one writer and N readers against a copy of… | `tools/concurrency_test.py`, `tools/test-api.sh` |
| [Clinical Safety Verification Gate](./pipeline/verification-gate.md) | `tools/verify.py` runs four ordered check sections — SAFETY, COVERAGE, RESTRAINT, INTEGRITY — against the built… | `tools/verify.py` |

### `auth/`

Adult sign-in, role and consent scoping, host-based routing between surfaces.

| Feature | What it does | Key files |
|---|---|---|
| [Adult Sign-In](./auth/adult-sign-in.md) | Stores adult dashboard credentials as scrypt hashes in `aac_app.db`, verifies a username/password pair in constant… | `lib/auth.ts` |
| [Host and Surface Routing](./auth/host-surface-routing.md) | Next.js middleware that maps the request's `Host` header to one of three surfaces — `kid`, `dashboard`, `mcp` — 404s… | `middleware.ts` |
| [Login Page and First-Run Setup](./auth/login-page.md) | The `/login` route: a server component that decides whether any adult account exists yet, and a client form that either… | `app/login/page.tsx`, `components/login-form.tsx` |
| [Role and Consent Scoping](./auth/role-consent-scoping.md) | Resolves the signed-in adult to a `Viewer`, lists the children they may see from the `roster` table (excluding expired… | `lib/access.ts` |

### `deploy/`

Deployment and build configuration.

| Feature | What it does | Key files |
|---|---|---|
| [Cloudflare Tunnel Ingress](./deploy/cloudflare-tunnel-ingress.md) | Publishes the single local Next.js origin on three public hostnames — `aac.kason.app`, `aac-dashboard.kason.app` and… | `deploy/aac.yml`, `deploy/app.kason.aac.tunnel.plist` |
| [Next.js Build Configuration](./deploy/next-build-config.md) | `next.config.ts` sets exactly two things: it marks `node:sqlite` as a server-external package so the data layer can… | `next.config.ts` |
| [Package Manifest and npm Scripts](./deploy/npm-scripts.md) | `package.json` declares the project's three runtime dependencies, six dev dependencies, the Node engine floor (`>=24`)… | `package.json` |
| [Production Web Service (launchd)](./deploy/production-web-service.md) | Runs the single Next.js production server on `localhost:3000` as a macOS launchd job: `app.kason.aac.web` invokes… | `deploy/run-web.sh`, `deploy/app.kason.aac.web.plist` |
| [TypeScript and CSS Toolchain](./deploy/typescript-and-css-toolchain.md) | `tsconfig.json` configures strict, emit-free TypeScript for the whole repo (including the `@/*` path alias), and… | `tsconfig.json`, `postcss.config.mjs` |

## Dependency graph

Edges are `depends_on` relations declared in the manifest. Domains with no outgoing edges are leaves — safe to change in isolation.

```
kid-app    ──▶  api, database
api        ──▶  ai, analytics, auth, dashboard, database, kid-app, mcp
dashboard  ──▶  analytics, api, auth, database, mcp, pipeline
analytics  ──▶  database, mcp, pipeline
ai         ──▶  analytics, api, auth, database, kid-app, mcp
mcp        ──▶  analytics, database, pipeline
database   (no cross-domain deps)
pipeline   ──▶  analytics, api, auth, database, kid-app, mcp
auth       ──▶  api, database, deploy
deploy     ──▶  auth, database, mcp, pipeline
```

### Feature-level edges

| Feature | Depends on |
|---|---|
| [Ask Agent Loop](./ai/ask-agent.md) | [Chat Provider Split (OpenAI / Gemini)](./ai/chat-providers.md), [Forbidden-Action Guard](./ai/forbidden-action-guard.md), [Scoped Tool Bridge (in-process MCP)](./ai/scoped-tool-bridge.md), [MCP Tool Surface and Guidance Envelope](./mcp/tool-surface.md) |
| [Chat Provider Split (OpenAI / Gemini)](./ai/chat-providers.md) | [Tool Argument Validation](./mcp/argument-validation.md), [MCP Tool Surface and Guidance Envelope](./mcp/tool-surface.md) |
| [Forbidden-Action Guard](./ai/forbidden-action-guard.md) | [Fired Rules & Evidence](./analytics/fired-rules-and-evidence.md), [MCP Tool Surface and Guidance Envelope](./mcp/tool-surface.md) |
| [Image Provider Chain (Gemini / Vertex / OpenAI)](./ai/image-providers.md) | [Chat Provider Split (OpenAI / Gemini)](./ai/chat-providers.md) |
| [Scoped Tool Bridge (in-process MCP)](./ai/scoped-tool-bridge.md) | [Role and Consent Scoping](./auth/role-consent-scoping.md), [Analytics Schema and Indices](./database/schema.md), [Tool Argument Validation](./mcp/argument-validation.md), [MCP Tool Surface and Guidance Envelope](./mcp/tool-surface.md) |
| [Generated-Picture Cache](./ai/visual-cache.md) | [Image Provider Chain (Gemini / Vertex / OpenAI)](./ai/image-providers.md), [Visual Prompt & Concept Sanitisation](./ai/visual-prompt-and-sanitisation.md) |
| [Visual Resolution Ladder](./ai/visual-resolution-ladder.md) | [Image Provider Chain (Gemini / Vertex / OpenAI)](./ai/image-providers.md), [Generated-Picture Cache](./ai/visual-cache.md), [Visual Prompt & Concept Sanitisation](./ai/visual-prompt-and-sanitisation.md), [Event Ingest](./api/event-ingest.md), [Analytics Schema and Indices](./database/schema.md), [Symbol Set, Card Faces & Design Tokens](./kid-app/symbol-set.md) |
| [Baseline Gating](./analytics/baseline-gating.md) | [Analytics Schema and Indices](./database/schema.md), [L2 Rollup](./pipeline/l2-rollup.md) |
| [Data Dictionary (metrics_catalog / insights_catalog reader)](./analytics/data-dictionary.md) | [Analytics Schema and Indices](./database/schema.md) |
| [Fired Rules & Evidence](./analytics/fired-rules-and-evidence.md) | [Data Dictionary (metrics_catalog / insights_catalog reader)](./analytics/data-dictionary.md), [Analytics Schema and Indices](./database/schema.md), [MCP Tool Surface and Guidance Envelope](./mcp/tool-surface.md), [Nightly Rule Materialisation](./pipeline/rule-materialisation.md) |
| [Metric Readers](./analytics/metric-readers.md) | [Data Dictionary (metrics_catalog / insights_catalog reader)](./analytics/data-dictionary.md), [Analytics Schema and Indices](./database/schema.md), [L2 Rollup](./pipeline/l2-rollup.md) |
| [Ask Chat Endpoint](./api/ask-chat-endpoint.md) | [Ask Agent Loop](./ai/ask-agent.md), [Scoped Tool Bridge (in-process MCP)](./ai/scoped-tool-bridge.md), [Host and Surface Routing](./auth/host-surface-routing.md), [Role and Consent Scoping](./auth/role-consent-scoping.md), [MCP Tool Surface and Guidance Envelope](./mcp/tool-surface.md) |
| [Board Content Endpoints](./api/board-content-endpoints.md) | [Event Ingest](./api/event-ingest.md), [Analytics Schema and Indices](./database/schema.md), [Card Customisation (Edit Sheet & Overrides)](./kid-app/card-customisation.md), [Category Folders](./kid-app/category-folders.md), [Symbol Set, Card Faces & Design Tokens](./kid-app/symbol-set.md) |
| [Event Ingest](./api/event-ingest.md) | [Connection Layer](./database/connection-layer.md), [Analytics Schema and Indices](./database/schema.md) |
| [Insight Dismissal Action](./api/insight-dismissal-action.md) | [Fired Rules & Evidence](./analytics/fired-rules-and-evidence.md), [Role and Consent Scoping](./auth/role-consent-scoping.md), [Insight Cards (Findings & Dismissal)](./dashboard/insight-cards.md), [Analytics Schema and Indices](./database/schema.md) |
| [MCP HTTP Transport](./api/mcp-http-transport.md) | [Host and Surface Routing](./auth/host-surface-routing.md), [Analytics Schema and Indices](./database/schema.md), [Read-Only Database Access and the SQL Guard](./mcp/read-only-db-access.md), [MCP Tool Surface and Guidance Envelope](./mcp/tool-surface.md) |
| [Reporting Endpoints](./api/print-and-generate.md) | [Role and Consent Scoping](./auth/role-consent-scoping.md), [Progress Reports](./dashboard/progress-reports.md), [Connection Layer](./database/connection-layer.md), [Analytics Schema and Indices](./database/schema.md) |
| [Sign-in Endpoints](./api/sign-in-endpoints.md) | [Event Ingest](./api/event-ingest.md), [Adult Sign-In](./auth/adult-sign-in.md), [Host and Surface Routing](./auth/host-surface-routing.md), [Analytics Schema and Indices](./database/schema.md), [Child Sign-In (Who Is Using The Board)](./kid-app/child-sign-in.md) |
| [Visual Resolution Endpoint](./api/visual-resolution-endpoint.md) | [Image Provider Chain (Gemini / Vertex / OpenAI)](./ai/image-providers.md), [Generated-Picture Cache](./ai/visual-cache.md), [Visual Resolution Ladder](./ai/visual-resolution-ladder.md), [Event Ingest](./api/event-ingest.md), [Symbol Set, Card Faces & Design Tokens](./kid-app/symbol-set.md) |
| [Adult Sign-In](./auth/adult-sign-in.md) | [Connection Layer](./database/connection-layer.md), [Analytics Schema and Indices](./database/schema.md) |
| [Host and Surface Routing](./auth/host-surface-routing.md) | [Adult Sign-In](./auth/adult-sign-in.md), [Login Page and First-Run Setup](./auth/login-page.md), [Cloudflare Tunnel Ingress](./deploy/cloudflare-tunnel-ingress.md) |
| [Login Page and First-Run Setup](./auth/login-page.md) | [Sign-in Endpoints](./api/sign-in-endpoints.md), [Adult Sign-In](./auth/adult-sign-in.md), [Host and Surface Routing](./auth/host-surface-routing.md), [Connection Layer](./database/connection-layer.md), [Analytics Schema and Indices](./database/schema.md) |
| [Role and Consent Scoping](./auth/role-consent-scoping.md) | [Adult Sign-In](./auth/adult-sign-in.md), [Connection Layer](./database/connection-layer.md), [Analytics Schema and Indices](./database/schema.md) |
| [Ask Panel](./dashboard/ask-panel.md) | [Ask Chat Endpoint](./api/ask-chat-endpoint.md), [Role and Consent Scoping](./auth/role-consent-scoping.md), [Dashboard Shell & Primitives](./dashboard/dashboard-shell.md), [MCP Tool Surface and Guidance Envelope](./mcp/tool-surface.md) |
| [Attention Queue (Class View)](./dashboard/attention-queue.md) | [Baseline Gating](./analytics/baseline-gating.md), [Fired Rules & Evidence](./analytics/fired-rules-and-evidence.md), [Metric Readers](./analytics/metric-readers.md), [Role and Consent Scoping](./auth/role-consent-scoping.md), [Dashboard Shell & Primitives](./dashboard/dashboard-shell.md), [Analytics Schema and Indices](./database/schema.md) |
| [Dashboard Shell & Primitives](./dashboard/dashboard-shell.md) | [Fired Rules & Evidence](./analytics/fired-rules-and-evidence.md), [Role and Consent Scoping](./auth/role-consent-scoping.md), [Attention Queue (Class View)](./dashboard/attention-queue.md), [Analytics Schema and Indices](./database/schema.md) |
| [Insight Cards (Findings & Dismissal)](./dashboard/insight-cards.md) | [Fired Rules & Evidence](./analytics/fired-rules-and-evidence.md), [Role and Consent Scoping](./auth/role-consent-scoping.md), [Dashboard Shell & Primitives](./dashboard/dashboard-shell.md), [Analytics Schema and Indices](./database/schema.md) |
| [Progress Reports](./dashboard/progress-reports.md) | [Metric Readers](./analytics/metric-readers.md), [Reporting Endpoints](./api/print-and-generate.md), [Role and Consent Scoping](./auth/role-consent-scoping.md), [Ask Panel](./dashboard/ask-panel.md), [Dashboard Shell & Primitives](./dashboard/dashboard-shell.md), [Analytics Schema and Indices](./database/schema.md) |
| [Reach & Errors (Access Page)](./dashboard/reach-and-errors.md) | [Metric Readers](./analytics/metric-readers.md), [Role and Consent Scoping](./auth/role-consent-scoping.md), [Dashboard Shell & Primitives](./dashboard/dashboard-shell.md), [Analytics Schema and Indices](./database/schema.md) |
| [Sittings (Sessions Page)](./dashboard/sittings.md) | [Role and Consent Scoping](./auth/role-consent-scoping.md), [Dashboard Shell & Primitives](./dashboard/dashboard-shell.md), [Analytics Schema and Indices](./database/schema.md), [L2 Rollup](./pipeline/l2-rollup.md) |
| [Student Overview & AI Impact](./dashboard/student-overview.md) | [Baseline Gating](./analytics/baseline-gating.md), [Fired Rules & Evidence](./analytics/fired-rules-and-evidence.md), [Metric Readers](./analytics/metric-readers.md), [Event Ingest](./api/event-ingest.md), [Role and Consent Scoping](./auth/role-consent-scoping.md), [Dashboard Shell & Primitives](./dashboard/dashboard-shell.md), [Insight Cards (Findings & Dismissal)](./dashboard/insight-cards.md) |
| [Metric and Insight Catalogues](./database/catalogues.md) | [Analytics Schema and Indices](./database/schema.md) |
| [Connection Layer](./database/connection-layer.md) | [Analytics Schema and Indices](./database/schema.md) |
| [Insight Rule Views](./database/insight-views.md) | [Metric and Insight Catalogues](./database/catalogues.md), [Metric Views](./database/metric-views.md), [Analytics Schema and Indices](./database/schema.md) |
| [Metric Views](./database/metric-views.md) | [Metric and Insight Catalogues](./database/catalogues.md), [Analytics Schema and Indices](./database/schema.md) |
| [Cloudflare Tunnel Ingress](./deploy/cloudflare-tunnel-ingress.md) | [Host and Surface Routing](./auth/host-surface-routing.md), [Production Web Service (launchd)](./deploy/production-web-service.md), [MCP stdio Server](./mcp/stdio-server.md) |
| [Next.js Build Configuration](./deploy/next-build-config.md) | [Connection Layer](./database/connection-layer.md), [Package Manifest and npm Scripts](./deploy/npm-scripts.md) |
| [Package Manifest and npm Scripts](./deploy/npm-scripts.md) | [Analytics Schema and Indices](./database/schema.md), [MCP stdio Server](./mcp/stdio-server.md), [Deterministic Build Pipeline](./pipeline/build-pipeline.md) |
| [Production Web Service (launchd)](./deploy/production-web-service.md) | [Next.js Build Configuration](./deploy/next-build-config.md), [Package Manifest and npm Scripts](./deploy/npm-scripts.md), [Deterministic Build Pipeline](./pipeline/build-pipeline.md) |
| [TypeScript and CSS Toolchain](./deploy/typescript-and-css-toolchain.md) | [Package Manifest and npm Scripts](./deploy/npm-scripts.md) |
| [Card Customisation (Edit Sheet & Overrides)](./kid-app/card-customisation.md) | [Board Content Endpoints](./api/board-content-endpoints.md), [Analytics Schema and Indices](./database/schema.md), [Symbol Set, Card Faces & Design Tokens](./kid-app/symbol-set.md) |
| [Category Folders](./kid-app/category-folders.md) | [Board Content Endpoints](./api/board-content-endpoints.md), [Analytics Schema and Indices](./database/schema.md), [Event Logging & Private Mode](./kid-app/event-logging.md), [Symbol Set, Card Faces & Design Tokens](./kid-app/symbol-set.md) |
| [Child Sign-In (Who Is Using The Board)](./kid-app/child-sign-in.md) | [Sign-in Endpoints](./api/sign-in-endpoints.md), [Analytics Schema and Indices](./database/schema.md), [Symbol Set, Card Faces & Design Tokens](./kid-app/symbol-set.md) |
| [Communication Board](./kid-app/communication-board.md) | [Sign-in Endpoints](./api/sign-in-endpoints.md), [Analytics Schema and Indices](./database/schema.md), [Card Customisation (Edit Sheet & Overrides)](./kid-app/card-customisation.md), [Category Folders](./kid-app/category-folders.md), [Child Sign-In (Who Is Using The Board)](./kid-app/child-sign-in.md), [Event Logging & Private Mode](./kid-app/event-logging.md), [Offline & PWA Shell](./kid-app/offline-pwa.md), [Symbol Set, Card Faces & Design Tokens](./kid-app/symbol-set.md), [Utterance Assembly & Speech Output](./kid-app/utterance-and-speech.md) |
| [Event Logging & Private Mode](./kid-app/event-logging.md) | [Event Ingest](./api/event-ingest.md), [Analytics Schema and Indices](./database/schema.md) |
| [Offline & PWA Shell](./kid-app/offline-pwa.md) | [Symbol Set, Card Faces & Design Tokens](./kid-app/symbol-set.md) |
| [Read-Only Database Access and the SQL Guard](./mcp/read-only-db-access.md) | [Analytics Schema and Indices](./database/schema.md) |
| [Captured Response Fixtures](./mcp/response-fixtures.md) | [MCP stdio Server](./mcp/stdio-server.md), [MCP Tool Surface and Guidance Envelope](./mcp/tool-surface.md), [Nightly Rule Materialisation](./pipeline/rule-materialisation.md) |
| [MCP stdio Server](./mcp/stdio-server.md) | [Analytics Schema and Indices](./database/schema.md), [Tool Argument Validation](./mcp/argument-validation.md), [Read-Only Database Access and the SQL Guard](./mcp/read-only-db-access.md), [MCP Tool Surface and Guidance Envelope](./mcp/tool-surface.md) |
| [MCP Tool Surface and Guidance Envelope](./mcp/tool-surface.md) | [Data Dictionary (metrics_catalog / insights_catalog reader)](./analytics/data-dictionary.md), [Fired Rules & Evidence](./analytics/fired-rules-and-evidence.md), [Analytics Schema and Indices](./database/schema.md), [Read-Only Database Access and the SQL Guard](./mcp/read-only-db-access.md), [Nightly Rule Materialisation](./pipeline/rule-materialisation.md) |
| [Deterministic Build Pipeline](./pipeline/build-pipeline.md) | [Analytics Schema and Indices](./database/schema.md), [Generated Artefacts — Metric Index and MCP Fixtures](./pipeline/generated-artefacts.md), [L2 Rollup](./pipeline/l2-rollup.md), [Nightly Rule Materialisation](./pipeline/rule-materialisation.md), [Seed Cohort Generation](./pipeline/seed-generation.md), [Clinical Safety Verification Gate](./pipeline/verification-gate.md) |
| [CSV Export and Column Dictionaries](./pipeline/csv-export.md) | [Data Dictionary (metrics_catalog / insights_catalog reader)](./analytics/data-dictionary.md), [Analytics Schema and Indices](./database/schema.md), [Generated Artefacts — Metric Index and MCP Fixtures](./pipeline/generated-artefacts.md), [L2 Rollup](./pipeline/l2-rollup.md), [Nightly Rule Materialisation](./pipeline/rule-materialisation.md), [Seed Cohort Generation](./pipeline/seed-generation.md) |
| [Generated Artefacts — Metric Index and MCP Fixtures](./pipeline/generated-artefacts.md) | [Analytics Schema and Indices](./database/schema.md), [MCP stdio Server](./mcp/stdio-server.md), [Deterministic Build Pipeline](./pipeline/build-pipeline.md), [L2 Rollup](./pipeline/l2-rollup.md), [Nightly Rule Materialisation](./pipeline/rule-materialisation.md) |
| [L2 Rollup](./pipeline/l2-rollup.md) | [Analytics Schema and Indices](./database/schema.md), [Deterministic Build Pipeline](./pipeline/build-pipeline.md), [Seed Cohort Generation](./pipeline/seed-generation.md) |
| [Nightly Rule Materialisation](./pipeline/rule-materialisation.md) | [Analytics Schema and Indices](./database/schema.md), [Deterministic Build Pipeline](./pipeline/build-pipeline.md), [L2 Rollup](./pipeline/l2-rollup.md), [Seed Cohort Generation](./pipeline/seed-generation.md) |
| [Seed Cohort Generation](./pipeline/seed-generation.md) | [Analytics Schema and Indices](./database/schema.md), [Deterministic Build Pipeline](./pipeline/build-pipeline.md) |
| [Pre-Demo Test Harnesses](./pipeline/test-harnesses.md) | [Board Content Endpoints](./api/board-content-endpoints.md), [Event Ingest](./api/event-ingest.md), [Visual Resolution Endpoint](./api/visual-resolution-endpoint.md), [Adult Sign-In](./auth/adult-sign-in.md), [Analytics Schema and Indices](./database/schema.md), [Child Sign-In (Who Is Using The Board)](./kid-app/child-sign-in.md), [MCP stdio Server](./mcp/stdio-server.md), [L2 Rollup](./pipeline/l2-rollup.md), [Nightly Rule Materialisation](./pipeline/rule-materialisation.md), [Seed Cohort Generation](./pipeline/seed-generation.md) |
| [Clinical Safety Verification Gate](./pipeline/verification-gate.md) | [Analytics Schema and Indices](./database/schema.md), [Deterministic Build Pipeline](./pipeline/build-pipeline.md), [L2 Rollup](./pipeline/l2-rollup.md), [Nightly Rule Materialisation](./pipeline/rule-materialisation.md), [Seed Cohort Generation](./pipeline/seed-generation.md) |

## Impact matrix

If you change a file matching the pattern on the left, read every doc on the right before you finish.

| If you change … | Also check … |
|---|---|
| `.mcp.json` | [`api/mcp-http-transport.md`](./api/mcp-http-transport.md), [`mcp/response-fixtures.md`](./mcp/response-fixtures.md), [`mcp/stdio-server.md`](./mcp/stdio-server.md) |
| `app/actions.ts` | [`api/insight-dismissal-action.md`](./api/insight-dismissal-action.md), [`dashboard/attention-queue.md`](./dashboard/attention-queue.md), [`dashboard/insight-cards.md`](./dashboard/insight-cards.md), [`dashboard/student-overview.md`](./dashboard/student-overview.md), [`mcp/tool-surface.md`](./mcp/tool-surface.md) |
| `app/api/auth/route.ts` | [`api/sign-in-endpoints.md`](./api/sign-in-endpoints.md), [`auth/login-page.md`](./auth/login-page.md), [`auth/role-consent-scoping.md`](./auth/role-consent-scoping.md), [`kid-app/child-sign-in.md`](./kid-app/child-sign-in.md), [`kid-app/communication-board.md`](./kid-app/communication-board.md) |
| `app/api/cards/route.ts` | [`api/board-content-endpoints.md`](./api/board-content-endpoints.md), [`dashboard/student-overview.md`](./dashboard/student-overview.md), [`kid-app/card-customisation.md`](./kid-app/card-customisation.md), [`kid-app/category-folders.md`](./kid-app/category-folders.md), [`kid-app/communication-board.md`](./kid-app/communication-board.md) |
| `app/api/categories/route.ts` | [`api/board-content-endpoints.md`](./api/board-content-endpoints.md), [`dashboard/student-overview.md`](./dashboard/student-overview.md), [`kid-app/card-customisation.md`](./kid-app/card-customisation.md), [`kid-app/category-folders.md`](./kid-app/category-folders.md), [`kid-app/communication-board.md`](./kid-app/communication-board.md) |
| `app/api/chat/route.ts` | [`api/ask-chat-endpoint.md`](./api/ask-chat-endpoint.md), [`dashboard/ask-panel.md`](./dashboard/ask-panel.md) |
| `app/api/events/route.ts` | [`api/board-content-endpoints.md`](./api/board-content-endpoints.md), [`api/event-ingest.md`](./api/event-ingest.md), [`api/sign-in-endpoints.md`](./api/sign-in-endpoints.md), [`api/visual-resolution-endpoint.md`](./api/visual-resolution-endpoint.md), [`kid-app/event-logging.md`](./kid-app/event-logging.md), [`pipeline/l2-rollup.md`](./pipeline/l2-rollup.md) |
| `app/api/mcp/route.ts` | [`api/mcp-http-transport.md`](./api/mcp-http-transport.md), [`mcp/stdio-server.md`](./mcp/stdio-server.md) |
| `app/api/reports/[id]/print/route.ts` | [`api/print-and-generate.md`](./api/print-and-generate.md), [`dashboard/progress-reports.md`](./dashboard/progress-reports.md) |
| `app/api/reports/route.ts` | [`api/print-and-generate.md`](./api/print-and-generate.md), [`dashboard/progress-reports.md`](./dashboard/progress-reports.md) |
| `app/api/session/route.ts` | [`api/sign-in-endpoints.md`](./api/sign-in-endpoints.md), [`auth/login-page.md`](./auth/login-page.md), [`auth/role-consent-scoping.md`](./auth/role-consent-scoping.md), [`kid-app/child-sign-in.md`](./kid-app/child-sign-in.md), [`kid-app/communication-board.md`](./kid-app/communication-board.md) |
| `app/api/visuals/route.ts` | [`api/visual-resolution-endpoint.md`](./api/visual-resolution-endpoint.md), [`dashboard/student-overview.md`](./dashboard/student-overview.md) |
| `app/dashboard/ask/page.tsx` | [`dashboard/ask-panel.md`](./dashboard/ask-panel.md), [`dashboard/dashboard-shell.md`](./dashboard/dashboard-shell.md), [`dashboard/progress-reports.md`](./dashboard/progress-reports.md) |
| `app/dashboard/error.tsx` | [`dashboard/ask-panel.md`](./dashboard/ask-panel.md), [`dashboard/attention-queue.md`](./dashboard/attention-queue.md), [`dashboard/dashboard-shell.md`](./dashboard/dashboard-shell.md), [`dashboard/insight-cards.md`](./dashboard/insight-cards.md), [`dashboard/progress-reports.md`](./dashboard/progress-reports.md), [`dashboard/reach-and-errors.md`](./dashboard/reach-and-errors.md), [`dashboard/sittings.md`](./dashboard/sittings.md), [`dashboard/student-overview.md`](./dashboard/student-overview.md) |
| `app/dashboard/layout.tsx` | [`dashboard/ask-panel.md`](./dashboard/ask-panel.md), [`dashboard/attention-queue.md`](./dashboard/attention-queue.md), [`dashboard/dashboard-shell.md`](./dashboard/dashboard-shell.md), [`dashboard/insight-cards.md`](./dashboard/insight-cards.md), [`dashboard/progress-reports.md`](./dashboard/progress-reports.md), [`dashboard/reach-and-errors.md`](./dashboard/reach-and-errors.md), [`dashboard/sittings.md`](./dashboard/sittings.md), [`dashboard/student-overview.md`](./dashboard/student-overview.md) |
| `app/dashboard/page.tsx` | [`dashboard/ask-panel.md`](./dashboard/ask-panel.md), [`dashboard/attention-queue.md`](./dashboard/attention-queue.md), [`dashboard/dashboard-shell.md`](./dashboard/dashboard-shell.md), [`dashboard/student-overview.md`](./dashboard/student-overview.md) |
| `app/dashboard/reports/*` | [`api/print-and-generate.md`](./api/print-and-generate.md), [`dashboard/dashboard-shell.md`](./dashboard/dashboard-shell.md), [`dashboard/progress-reports.md`](./dashboard/progress-reports.md), [`dashboard/sittings.md`](./dashboard/sittings.md) |
| `app/dashboard/reports/[id]/page.tsx` | [`api/print-and-generate.md`](./api/print-and-generate.md), [`dashboard/dashboard-shell.md`](./dashboard/dashboard-shell.md), [`dashboard/progress-reports.md`](./dashboard/progress-reports.md), [`dashboard/sittings.md`](./dashboard/sittings.md) |
| `app/dashboard/sessions/page.tsx` | [`dashboard/progress-reports.md`](./dashboard/progress-reports.md), [`dashboard/sittings.md`](./dashboard/sittings.md) |
| `app/dashboard/student/[id]/access/page.tsx` | [`dashboard/dashboard-shell.md`](./dashboard/dashboard-shell.md), [`dashboard/progress-reports.md`](./dashboard/progress-reports.md), [`dashboard/reach-and-errors.md`](./dashboard/reach-and-errors.md) |
| `app/dashboard/student/[id]/ai-impact/page.tsx` | [`dashboard/attention-queue.md`](./dashboard/attention-queue.md), [`dashboard/dashboard-shell.md`](./dashboard/dashboard-shell.md), [`dashboard/sittings.md`](./dashboard/sittings.md), [`dashboard/student-overview.md`](./dashboard/student-overview.md) |
| `app/dashboard/student/[id]/ask/page.tsx` | [`dashboard/ask-panel.md`](./dashboard/ask-panel.md), [`dashboard/dashboard-shell.md`](./dashboard/dashboard-shell.md), [`dashboard/progress-reports.md`](./dashboard/progress-reports.md) |
| `app/dashboard/student/[id]/page.tsx` | [`dashboard/attention-queue.md`](./dashboard/attention-queue.md), [`dashboard/dashboard-shell.md`](./dashboard/dashboard-shell.md), [`dashboard/sittings.md`](./dashboard/sittings.md), [`dashboard/student-overview.md`](./dashboard/student-overview.md) |
| `app/dashboard/student/[id]/report/page.tsx` | [`api/print-and-generate.md`](./api/print-and-generate.md), [`dashboard/dashboard-shell.md`](./dashboard/dashboard-shell.md), [`dashboard/progress-reports.md`](./dashboard/progress-reports.md), [`dashboard/sittings.md`](./dashboard/sittings.md) |
| `app/error.tsx` | [`dashboard/ask-panel.md`](./dashboard/ask-panel.md), [`dashboard/attention-queue.md`](./dashboard/attention-queue.md), [`dashboard/dashboard-shell.md`](./dashboard/dashboard-shell.md), [`dashboard/insight-cards.md`](./dashboard/insight-cards.md), [`dashboard/progress-reports.md`](./dashboard/progress-reports.md), [`dashboard/reach-and-errors.md`](./dashboard/reach-and-errors.md), [`dashboard/sittings.md`](./dashboard/sittings.md), [`dashboard/student-overview.md`](./dashboard/student-overview.md) |
| `app/globals.css` | [`dashboard/student-overview.md`](./dashboard/student-overview.md), [`kid-app/card-customisation.md`](./kid-app/card-customisation.md), [`kid-app/category-folders.md`](./kid-app/category-folders.md), [`kid-app/child-sign-in.md`](./kid-app/child-sign-in.md), [`kid-app/communication-board.md`](./kid-app/communication-board.md), [`kid-app/symbol-set.md`](./kid-app/symbol-set.md) |
| `app/layout.tsx` | [`dashboard/attention-queue.md`](./dashboard/attention-queue.md), [`kid-app/communication-board.md`](./kid-app/communication-board.md), [`kid-app/event-logging.md`](./kid-app/event-logging.md), [`kid-app/offline-pwa.md`](./kid-app/offline-pwa.md) |
| `app/login/page.tsx` | [`auth/host-surface-routing.md`](./auth/host-surface-routing.md), [`auth/login-page.md`](./auth/login-page.md), [`dashboard/dashboard-shell.md`](./dashboard/dashboard-shell.md) |
| `app/page.tsx` | [`analytics/metric-readers.md`](./analytics/metric-readers.md), [`dashboard/student-overview.md`](./dashboard/student-overview.md), [`kid-app/communication-board.md`](./kid-app/communication-board.md) |
| `app/who/page.tsx` | [`dashboard/attention-queue.md`](./dashboard/attention-queue.md), [`kid-app/child-sign-in.md`](./kid-app/child-sign-in.md), [`kid-app/communication-board.md`](./kid-app/communication-board.md), [`kid-app/event-logging.md`](./kid-app/event-logging.md) |
| `components/charts.tsx` | [`api/print-and-generate.md`](./api/print-and-generate.md), [`dashboard/dashboard-shell.md`](./dashboard/dashboard-shell.md), [`dashboard/progress-reports.md`](./dashboard/progress-reports.md), [`dashboard/sittings.md`](./dashboard/sittings.md) |
| `components/chat/ask-panel.tsx` | [`dashboard/ask-panel.md`](./dashboard/ask-panel.md), [`dashboard/dashboard-shell.md`](./dashboard/dashboard-shell.md), [`dashboard/progress-reports.md`](./dashboard/progress-reports.md) |
| `components/heat-grid.tsx` | [`dashboard/dashboard-shell.md`](./dashboard/dashboard-shell.md), [`dashboard/progress-reports.md`](./dashboard/progress-reports.md), [`dashboard/reach-and-errors.md`](./dashboard/reach-and-errors.md) |
| `components/insight-card.tsx` | [`dashboard/attention-queue.md`](./dashboard/attention-queue.md), [`dashboard/insight-cards.md`](./dashboard/insight-cards.md), [`dashboard/student-overview.md`](./dashboard/student-overview.md), [`mcp/tool-surface.md`](./mcp/tool-surface.md) |
| `components/insight-list.tsx` | [`dashboard/attention-queue.md`](./dashboard/attention-queue.md), [`dashboard/insight-cards.md`](./dashboard/insight-cards.md), [`dashboard/student-overview.md`](./dashboard/student-overview.md), [`mcp/tool-surface.md`](./mcp/tool-surface.md) |
| `components/kid/board-app.tsx` | [`analytics/metric-readers.md`](./analytics/metric-readers.md), [`dashboard/student-overview.md`](./dashboard/student-overview.md), [`kid-app/communication-board.md`](./kid-app/communication-board.md) |
| `components/kid/card-face.tsx` | [`dashboard/student-overview.md`](./dashboard/student-overview.md), [`kid-app/card-customisation.md`](./kid-app/card-customisation.md), [`kid-app/category-folders.md`](./kid-app/category-folders.md), [`kid-app/child-sign-in.md`](./kid-app/child-sign-in.md), [`kid-app/communication-board.md`](./kid-app/communication-board.md), [`kid-app/symbol-set.md`](./kid-app/symbol-set.md) |
| `components/kid/category-drawer.tsx` | [`dashboard/student-overview.md`](./dashboard/student-overview.md), [`kid-app/category-folders.md`](./kid-app/category-folders.md), [`kid-app/communication-board.md`](./kid-app/communication-board.md) |
| `components/kid/category-editor.tsx` | [`dashboard/student-overview.md`](./dashboard/student-overview.md), [`kid-app/category-folders.md`](./kid-app/category-folders.md), [`kid-app/communication-board.md`](./kid-app/communication-board.md) |
| `components/kid/edit-sheet.tsx` | [`dashboard/student-overview.md`](./dashboard/student-overview.md), [`kid-app/card-customisation.md`](./kid-app/card-customisation.md), [`kid-app/communication-board.md`](./kid-app/communication-board.md), [`kid-app/utterance-and-speech.md`](./kid-app/utterance-and-speech.md) |
| `components/kid/register-sw.tsx` | [`dashboard/attention-queue.md`](./dashboard/attention-queue.md), [`kid-app/communication-board.md`](./kid-app/communication-board.md), [`kid-app/event-logging.md`](./kid-app/event-logging.md), [`kid-app/offline-pwa.md`](./kid-app/offline-pwa.md) |
| `components/kid/voice-picker.tsx` | [`analytics/metric-readers.md`](./analytics/metric-readers.md), [`kid-app/card-customisation.md`](./kid-app/card-customisation.md), [`kid-app/communication-board.md`](./kid-app/communication-board.md), [`kid-app/utterance-and-speech.md`](./kid-app/utterance-and-speech.md) |
| `components/kid/who-picker.tsx` | [`dashboard/attention-queue.md`](./dashboard/attention-queue.md), [`kid-app/child-sign-in.md`](./kid-app/child-sign-in.md), [`kid-app/communication-board.md`](./kid-app/communication-board.md), [`kid-app/event-logging.md`](./kid-app/event-logging.md) |
| `components/kpi-tile.tsx` | [`dashboard/attention-queue.md`](./dashboard/attention-queue.md), [`dashboard/dashboard-shell.md`](./dashboard/dashboard-shell.md), [`dashboard/sittings.md`](./dashboard/sittings.md), [`dashboard/student-overview.md`](./dashboard/student-overview.md) |
| `components/login-form.tsx` | [`auth/host-surface-routing.md`](./auth/host-surface-routing.md), [`auth/login-page.md`](./auth/login-page.md), [`dashboard/dashboard-shell.md`](./dashboard/dashboard-shell.md) |
| `components/metric-card.tsx` | [`api/print-and-generate.md`](./api/print-and-generate.md), [`dashboard/dashboard-shell.md`](./dashboard/dashboard-shell.md), [`dashboard/progress-reports.md`](./dashboard/progress-reports.md), [`dashboard/sittings.md`](./dashboard/sittings.md) |
| `components/status.tsx` | [`dashboard/ask-panel.md`](./dashboard/ask-panel.md), [`dashboard/attention-queue.md`](./dashboard/attention-queue.md), [`dashboard/dashboard-shell.md`](./dashboard/dashboard-shell.md), [`dashboard/insight-cards.md`](./dashboard/insight-cards.md), [`dashboard/progress-reports.md`](./dashboard/progress-reports.md), [`dashboard/reach-and-errors.md`](./dashboard/reach-and-errors.md), [`dashboard/sittings.md`](./dashboard/sittings.md), [`dashboard/student-overview.md`](./dashboard/student-overview.md) |
| `components/ui.tsx` | [`dashboard/ask-panel.md`](./dashboard/ask-panel.md), [`dashboard/attention-queue.md`](./dashboard/attention-queue.md), [`dashboard/dashboard-shell.md`](./dashboard/dashboard-shell.md), [`dashboard/insight-cards.md`](./dashboard/insight-cards.md), [`dashboard/progress-reports.md`](./dashboard/progress-reports.md), [`dashboard/reach-and-errors.md`](./dashboard/reach-and-errors.md), [`dashboard/sittings.md`](./dashboard/sittings.md), [`dashboard/student-overview.md`](./dashboard/student-overview.md) |
| `db/indices.sql` | [`api/event-ingest.md`](./api/event-ingest.md), [`auth/role-consent-scoping.md`](./auth/role-consent-scoping.md), [`database/catalogues.md`](./database/catalogues.md), [`database/connection-layer.md`](./database/connection-layer.md), [`database/insight-views.md`](./database/insight-views.md), [`database/metric-views.md`](./database/metric-views.md), [`database/schema.md`](./database/schema.md), [`mcp/tool-surface.md`](./mcp/tool-surface.md), [`pipeline/build-pipeline.md`](./pipeline/build-pipeline.md), [`pipeline/l2-rollup.md`](./pipeline/l2-rollup.md), [`pipeline/rule-materialisation.md`](./pipeline/rule-materialisation.md) |
| `db/schema.sql` | [`api/event-ingest.md`](./api/event-ingest.md), [`auth/role-consent-scoping.md`](./auth/role-consent-scoping.md), [`database/catalogues.md`](./database/catalogues.md), [`database/connection-layer.md`](./database/connection-layer.md), [`database/insight-views.md`](./database/insight-views.md), [`database/metric-views.md`](./database/metric-views.md), [`database/schema.md`](./database/schema.md), [`mcp/tool-surface.md`](./mcp/tool-surface.md), [`pipeline/build-pipeline.md`](./pipeline/build-pipeline.md), [`pipeline/l2-rollup.md`](./pipeline/l2-rollup.md), [`pipeline/rule-materialisation.md`](./pipeline/rule-materialisation.md) |
| `db/seed_catalogues.sql` | [`analytics/data-dictionary.md`](./analytics/data-dictionary.md), [`analytics/metric-readers.md`](./analytics/metric-readers.md), [`dashboard/student-overview.md`](./dashboard/student-overview.md), [`database/catalogues.md`](./database/catalogues.md), [`database/insight-views.md`](./database/insight-views.md), [`database/metric-views.md`](./database/metric-views.md), [`mcp/stdio-server.md`](./mcp/stdio-server.md), [`mcp/tool-surface.md`](./mcp/tool-surface.md), [`pipeline/l2-rollup.md`](./pipeline/l2-rollup.md), [`pipeline/rule-materialisation.md`](./pipeline/rule-materialisation.md) |
| `db/views_insights.sql` | [`dashboard/insight-cards.md`](./dashboard/insight-cards.md), [`database/insight-views.md`](./database/insight-views.md), [`mcp/tool-surface.md`](./mcp/tool-surface.md), [`pipeline/rule-materialisation.md`](./pipeline/rule-materialisation.md), [`pipeline/verification-gate.md`](./pipeline/verification-gate.md) |
| `db/views_metrics.sql` | [`analytics/metric-readers.md`](./analytics/metric-readers.md), [`database/insight-views.md`](./database/insight-views.md), [`database/metric-views.md`](./database/metric-views.md), [`mcp/tool-surface.md`](./mcp/tool-surface.md), [`pipeline/l2-rollup.md`](./pipeline/l2-rollup.md), [`pipeline/verification-gate.md`](./pipeline/verification-gate.md) |
| `deploy/aac.yml` | [`dashboard/dashboard-shell.md`](./dashboard/dashboard-shell.md), [`deploy/cloudflare-tunnel-ingress.md`](./deploy/cloudflare-tunnel-ingress.md), [`kid-app/communication-board.md`](./kid-app/communication-board.md), [`mcp/stdio-server.md`](./mcp/stdio-server.md) |
| `deploy/app.kason.aac.tunnel.plist` | [`dashboard/dashboard-shell.md`](./dashboard/dashboard-shell.md), [`deploy/cloudflare-tunnel-ingress.md`](./deploy/cloudflare-tunnel-ingress.md), [`kid-app/communication-board.md`](./kid-app/communication-board.md), [`mcp/stdio-server.md`](./mcp/stdio-server.md) |
| `deploy/app.kason.aac.web.plist` | [`auth/host-surface-routing.md`](./auth/host-surface-routing.md), [`dashboard/dashboard-shell.md`](./dashboard/dashboard-shell.md), [`deploy/cloudflare-tunnel-ingress.md`](./deploy/cloudflare-tunnel-ingress.md), [`deploy/production-web-service.md`](./deploy/production-web-service.md), [`mcp/stdio-server.md`](./mcp/stdio-server.md) |
| `deploy/run-web.sh` | [`auth/host-surface-routing.md`](./auth/host-surface-routing.md), [`dashboard/dashboard-shell.md`](./dashboard/dashboard-shell.md), [`deploy/cloudflare-tunnel-ingress.md`](./deploy/cloudflare-tunnel-ingress.md), [`deploy/production-web-service.md`](./deploy/production-web-service.md), [`mcp/stdio-server.md`](./mcp/stdio-server.md) |
| `lib/access.ts` | [`auth/role-consent-scoping.md`](./auth/role-consent-scoping.md), [`dashboard/ask-panel.md`](./dashboard/ask-panel.md), [`dashboard/dashboard-shell.md`](./dashboard/dashboard-shell.md), [`dashboard/progress-reports.md`](./dashboard/progress-reports.md), [`mcp/tool-surface.md`](./mcp/tool-surface.md) |
| `lib/auth.ts` | [`api/sign-in-endpoints.md`](./api/sign-in-endpoints.md), [`auth/adult-sign-in.md`](./auth/adult-sign-in.md), [`auth/host-surface-routing.md`](./auth/host-surface-routing.md), [`auth/login-page.md`](./auth/login-page.md), [`auth/role-consent-scoping.md`](./auth/role-consent-scoping.md) |
| `lib/baseline.ts` | [`analytics/baseline-gating.md`](./analytics/baseline-gating.md), [`dashboard/attention-queue.md`](./dashboard/attention-queue.md), [`dashboard/student-overview.md`](./dashboard/student-overview.md) |
| `lib/catalog.ts` | [`analytics/data-dictionary.md`](./analytics/data-dictionary.md), [`analytics/fired-rules-and-evidence.md`](./analytics/fired-rules-and-evidence.md), [`analytics/metric-readers.md`](./analytics/metric-readers.md), [`dashboard/attention-queue.md`](./dashboard/attention-queue.md), [`dashboard/reach-and-errors.md`](./dashboard/reach-and-errors.md), [`dashboard/student-overview.md`](./dashboard/student-overview.md), [`mcp/tool-surface.md`](./mcp/tool-surface.md) |
| `lib/categories/*` | [`dashboard/student-overview.md`](./dashboard/student-overview.md), [`kid-app/category-folders.md`](./kid-app/category-folders.md), [`kid-app/communication-board.md`](./kid-app/communication-board.md) |
| `lib/chat/agent.ts` | [`ai/ask-agent.md`](./ai/ask-agent.md), [`api/ask-chat-endpoint.md`](./api/ask-chat-endpoint.md), [`dashboard/ask-panel.md`](./dashboard/ask-panel.md) |
| `lib/chat/gemini.ts` | [`ai/ask-agent.md`](./ai/ask-agent.md), [`ai/chat-providers.md`](./ai/chat-providers.md), [`ai/image-providers.md`](./ai/image-providers.md), [`ai/scoped-tool-bridge.md`](./ai/scoped-tool-bridge.md), [`api/ask-chat-endpoint.md`](./api/ask-chat-endpoint.md) |
| `lib/chat/guard.ts` | [`ai/ask-agent.md`](./ai/ask-agent.md), [`ai/forbidden-action-guard.md`](./ai/forbidden-action-guard.md) |
| `lib/chat/openai.ts` | [`ai/ask-agent.md`](./ai/ask-agent.md), [`ai/chat-providers.md`](./ai/chat-providers.md), [`ai/image-providers.md`](./ai/image-providers.md), [`ai/scoped-tool-bridge.md`](./ai/scoped-tool-bridge.md), [`api/ask-chat-endpoint.md`](./api/ask-chat-endpoint.md) |
| `lib/chat/provider.ts` | [`ai/ask-agent.md`](./ai/ask-agent.md), [`ai/chat-providers.md`](./ai/chat-providers.md), [`ai/image-providers.md`](./ai/image-providers.md), [`ai/scoped-tool-bridge.md`](./ai/scoped-tool-bridge.md), [`api/ask-chat-endpoint.md`](./api/ask-chat-endpoint.md) |
| `lib/chat/schema-adapter.ts` | [`ai/ask-agent.md`](./ai/ask-agent.md), [`ai/chat-providers.md`](./ai/chat-providers.md), [`ai/image-providers.md`](./ai/image-providers.md), [`ai/scoped-tool-bridge.md`](./ai/scoped-tool-bridge.md), [`api/ask-chat-endpoint.md`](./api/ask-chat-endpoint.md) |
| `lib/chat/tools.ts` | [`ai/ask-agent.md`](./ai/ask-agent.md), [`ai/scoped-tool-bridge.md`](./ai/scoped-tool-bridge.md), [`api/ask-chat-endpoint.md`](./api/ask-chat-endpoint.md) |
| `lib/db.ts` | [`analytics/data-dictionary.md`](./analytics/data-dictionary.md), [`analytics/metric-readers.md`](./analytics/metric-readers.md), [`api/event-ingest.md`](./api/event-ingest.md), [`dashboard/insight-cards.md`](./dashboard/insight-cards.md), [`dashboard/progress-reports.md`](./dashboard/progress-reports.md), [`dashboard/reach-and-errors.md`](./dashboard/reach-and-errors.md), [`database/connection-layer.md`](./database/connection-layer.md), [`kid-app/category-folders.md`](./kid-app/category-folders.md) |
| `lib/dismiss.ts` | [`dashboard/attention-queue.md`](./dashboard/attention-queue.md), [`dashboard/insight-cards.md`](./dashboard/insight-cards.md), [`dashboard/student-overview.md`](./dashboard/student-overview.md), [`mcp/tool-surface.md`](./mcp/tool-surface.md) |
| `lib/icons/symbols.tsx` | [`dashboard/student-overview.md`](./dashboard/student-overview.md), [`kid-app/card-customisation.md`](./kid-app/card-customisation.md), [`kid-app/category-folders.md`](./kid-app/category-folders.md), [`kid-app/child-sign-in.md`](./kid-app/child-sign-in.md), [`kid-app/communication-board.md`](./kid-app/communication-board.md), [`kid-app/symbol-set.md`](./kid-app/symbol-set.md) |
| `lib/ingest.ts` | [`api/board-content-endpoints.md`](./api/board-content-endpoints.md), [`api/event-ingest.md`](./api/event-ingest.md), [`api/sign-in-endpoints.md`](./api/sign-in-endpoints.md), [`api/visual-resolution-endpoint.md`](./api/visual-resolution-endpoint.md), [`kid-app/event-logging.md`](./kid-app/event-logging.md), [`pipeline/l2-rollup.md`](./pipeline/l2-rollup.md) |
| `lib/insights.ts` | [`analytics/fired-rules-and-evidence.md`](./analytics/fired-rules-and-evidence.md), [`api/insight-dismissal-action.md`](./api/insight-dismissal-action.md), [`dashboard/attention-queue.md`](./dashboard/attention-queue.md), [`dashboard/student-overview.md`](./dashboard/student-overview.md) |
| `lib/kid/log.ts` | [`analytics/metric-readers.md`](./analytics/metric-readers.md), [`kid-app/communication-board.md`](./kid-app/communication-board.md), [`kid-app/event-logging.md`](./kid-app/event-logging.md), [`pipeline/rule-materialisation.md`](./pipeline/rule-materialisation.md) |
| `lib/kid/sentence.ts` | [`analytics/metric-readers.md`](./analytics/metric-readers.md), [`kid-app/card-customisation.md`](./kid-app/card-customisation.md), [`kid-app/communication-board.md`](./kid-app/communication-board.md), [`kid-app/utterance-and-speech.md`](./kid-app/utterance-and-speech.md) |
| `lib/kid/speech.ts` | [`analytics/metric-readers.md`](./analytics/metric-readers.md), [`kid-app/card-customisation.md`](./kid-app/card-customisation.md), [`kid-app/communication-board.md`](./kid-app/communication-board.md), [`kid-app/utterance-and-speech.md`](./kid-app/utterance-and-speech.md) |
| `lib/kid/voice.ts` | [`analytics/metric-readers.md`](./analytics/metric-readers.md), [`kid-app/card-customisation.md`](./kid-app/card-customisation.md), [`kid-app/communication-board.md`](./kid-app/communication-board.md), [`kid-app/utterance-and-speech.md`](./kid-app/utterance-and-speech.md) |
| `lib/metrics.ts` | [`analytics/metric-readers.md`](./analytics/metric-readers.md), [`dashboard/attention-queue.md`](./dashboard/attention-queue.md), [`dashboard/reach-and-errors.md`](./dashboard/reach-and-errors.md), [`dashboard/student-overview.md`](./dashboard/student-overview.md) |
| `lib/overrides.ts` | [`dashboard/student-overview.md`](./dashboard/student-overview.md), [`kid-app/card-customisation.md`](./kid-app/card-customisation.md), [`kid-app/communication-board.md`](./kid-app/communication-board.md), [`kid-app/utterance-and-speech.md`](./kid-app/utterance-and-speech.md) |
| `lib/queue.ts` | [`dashboard/ask-panel.md`](./dashboard/ask-panel.md), [`dashboard/attention-queue.md`](./dashboard/attention-queue.md), [`dashboard/dashboard-shell.md`](./dashboard/dashboard-shell.md), [`dashboard/student-overview.md`](./dashboard/student-overview.md) |
| `lib/report-store.ts` | [`api/print-and-generate.md`](./api/print-and-generate.md), [`dashboard/dashboard-shell.md`](./dashboard/dashboard-shell.md), [`dashboard/progress-reports.md`](./dashboard/progress-reports.md), [`dashboard/sittings.md`](./dashboard/sittings.md) |
| `lib/report.ts` | [`api/print-and-generate.md`](./api/print-and-generate.md), [`dashboard/dashboard-shell.md`](./dashboard/dashboard-shell.md), [`dashboard/progress-reports.md`](./dashboard/progress-reports.md), [`dashboard/sittings.md`](./dashboard/sittings.md) |
| `lib/session.ts` | [`dashboard/attention-queue.md`](./dashboard/attention-queue.md), [`kid-app/child-sign-in.md`](./kid-app/child-sign-in.md), [`kid-app/communication-board.md`](./kid-app/communication-board.md), [`kid-app/event-logging.md`](./kid-app/event-logging.md) |
| `lib/sittings.ts` | [`dashboard/progress-reports.md`](./dashboard/progress-reports.md), [`dashboard/sittings.md`](./dashboard/sittings.md) |
| `lib/sqlite.ts` | [`analytics/data-dictionary.md`](./analytics/data-dictionary.md), [`analytics/metric-readers.md`](./analytics/metric-readers.md), [`api/event-ingest.md`](./api/event-ingest.md), [`dashboard/insight-cards.md`](./dashboard/insight-cards.md), [`dashboard/progress-reports.md`](./dashboard/progress-reports.md), [`dashboard/reach-and-errors.md`](./dashboard/reach-and-errors.md), [`database/connection-layer.md`](./database/connection-layer.md), [`kid-app/category-folders.md`](./kid-app/category-folders.md) |
| `lib/visuals/gemini.ts` | [`ai/image-providers.md`](./ai/image-providers.md), [`ai/visual-cache.md`](./ai/visual-cache.md), [`ai/visual-resolution-ladder.md`](./ai/visual-resolution-ladder.md) |
| `lib/visuals/ladder.ts` | [`ai/visual-resolution-ladder.md`](./ai/visual-resolution-ladder.md), [`analytics/metric-readers.md`](./analytics/metric-readers.md), [`api/visual-resolution-endpoint.md`](./api/visual-resolution-endpoint.md), [`dashboard/attention-queue.md`](./dashboard/attention-queue.md), [`dashboard/student-overview.md`](./dashboard/student-overview.md) |
| `lib/visuals/openai.ts` | [`ai/image-providers.md`](./ai/image-providers.md), [`ai/visual-cache.md`](./ai/visual-cache.md), [`ai/visual-resolution-ladder.md`](./ai/visual-resolution-ladder.md) |
| `lib/visuals/prompt.ts` | [`ai/image-providers.md`](./ai/image-providers.md), [`ai/visual-cache.md`](./ai/visual-cache.md), [`ai/visual-prompt-and-sanitisation.md`](./ai/visual-prompt-and-sanitisation.md), [`ai/visual-resolution-ladder.md`](./ai/visual-resolution-ladder.md) |
| `lib/visuals/provider.ts` | [`ai/image-providers.md`](./ai/image-providers.md), [`ai/visual-cache.md`](./ai/visual-cache.md), [`ai/visual-resolution-ladder.md`](./ai/visual-resolution-ladder.md) |
| `lib/visuals/sanitize.ts` | [`ai/image-providers.md`](./ai/image-providers.md), [`ai/visual-cache.md`](./ai/visual-cache.md), [`ai/visual-prompt-and-sanitisation.md`](./ai/visual-prompt-and-sanitisation.md), [`ai/visual-resolution-ladder.md`](./ai/visual-resolution-ladder.md) |
| `lib/visuals/store.ts` | [`ai/visual-cache.md`](./ai/visual-cache.md), [`ai/visual-resolution-ladder.md`](./ai/visual-resolution-ladder.md) |
| `lib/visuals/vertex.ts` | [`ai/image-providers.md`](./ai/image-providers.md), [`ai/visual-cache.md`](./ai/visual-cache.md), [`ai/visual-resolution-ladder.md`](./ai/visual-resolution-ladder.md) |
| `lib/vocabulary/categories.ts` | [`dashboard/student-overview.md`](./dashboard/student-overview.md), [`kid-app/category-folders.md`](./kid-app/category-folders.md), [`kid-app/communication-board.md`](./kid-app/communication-board.md) |
| `mcp/db.ts` | [`ai/scoped-tool-bridge.md`](./ai/scoped-tool-bridge.md), [`api/mcp-http-transport.md`](./api/mcp-http-transport.md), [`mcp/read-only-db-access.md`](./mcp/read-only-db-access.md), [`mcp/stdio-server.md`](./mcp/stdio-server.md), [`mcp/tool-surface.md`](./mcp/tool-surface.md) |
| `mcp/fixtures/*` | [`ai/scoped-tool-bridge.md`](./ai/scoped-tool-bridge.md), [`analytics/metric-readers.md`](./analytics/metric-readers.md), [`mcp/response-fixtures.md`](./mcp/response-fixtures.md) |
| `mcp/server.ts` | [`api/mcp-http-transport.md`](./api/mcp-http-transport.md), [`mcp/response-fixtures.md`](./mcp/response-fixtures.md), [`mcp/stdio-server.md`](./mcp/stdio-server.md) |
| `mcp/tools.ts` | [`ai/scoped-tool-bridge.md`](./ai/scoped-tool-bridge.md), [`api/mcp-http-transport.md`](./api/mcp-http-transport.md), [`mcp/response-fixtures.md`](./mcp/response-fixtures.md), [`mcp/stdio-server.md`](./mcp/stdio-server.md), [`mcp/tool-surface.md`](./mcp/tool-surface.md) |
| `mcp/validate.ts` | [`ai/scoped-tool-bridge.md`](./ai/scoped-tool-bridge.md), [`mcp/argument-validation.md`](./mcp/argument-validation.md), [`mcp/stdio-server.md`](./mcp/stdio-server.md), [`mcp/tool-surface.md`](./mcp/tool-surface.md) |
| `middleware.ts` | [`api/event-ingest.md`](./api/event-ingest.md), [`api/mcp-http-transport.md`](./api/mcp-http-transport.md), [`auth/host-surface-routing.md`](./auth/host-surface-routing.md), [`auth/login-page.md`](./auth/login-page.md), [`dashboard/dashboard-shell.md`](./dashboard/dashboard-shell.md), [`kid-app/communication-board.md`](./kid-app/communication-board.md) |
| `next.config.ts` | [`auth/host-surface-routing.md`](./auth/host-surface-routing.md), [`dashboard/insight-cards.md`](./dashboard/insight-cards.md), [`deploy/next-build-config.md`](./deploy/next-build-config.md), [`deploy/production-web-service.md`](./deploy/production-web-service.md) |
| `package.json` | [`deploy/next-build-config.md`](./deploy/next-build-config.md), [`deploy/npm-scripts.md`](./deploy/npm-scripts.md), [`deploy/production-web-service.md`](./deploy/production-web-service.md), [`deploy/typescript-and-css-toolchain.md`](./deploy/typescript-and-css-toolchain.md) |
| `postcss.config.mjs` | [`dashboard/dashboard-shell.md`](./dashboard/dashboard-shell.md), [`deploy/next-build-config.md`](./deploy/next-build-config.md), [`deploy/typescript-and-css-toolchain.md`](./deploy/typescript-and-css-toolchain.md), [`kid-app/communication-board.md`](./kid-app/communication-board.md), [`mcp/stdio-server.md`](./mcp/stdio-server.md) |
| `public/*` | [`dashboard/attention-queue.md`](./dashboard/attention-queue.md), [`kid-app/communication-board.md`](./kid-app/communication-board.md), [`kid-app/event-logging.md`](./kid-app/event-logging.md), [`kid-app/offline-pwa.md`](./kid-app/offline-pwa.md) |
| `tools/build.sh` | [`mcp/stdio-server.md`](./mcp/stdio-server.md), [`pipeline/build-pipeline.md`](./pipeline/build-pipeline.md), [`pipeline/test-harnesses.md`](./pipeline/test-harnesses.md) |
| `tools/concurrency_test.py` | [`pipeline/build-pipeline.md`](./pipeline/build-pipeline.md), [`pipeline/test-harnesses.md`](./pipeline/test-harnesses.md) |
| `tools/csv_docs.py` | [`pipeline/csv-export.md`](./pipeline/csv-export.md) |
| `tools/export_csv.py` | [`pipeline/csv-export.md`](./pipeline/csv-export.md) |
| `tools/gen_fixtures.py` | [`analytics/data-dictionary.md`](./analytics/data-dictionary.md), [`analytics/metric-readers.md`](./analytics/metric-readers.md), [`pipeline/csv-export.md`](./pipeline/csv-export.md), [`pipeline/generated-artefacts.md`](./pipeline/generated-artefacts.md) |
| `tools/gen_metric_index.py` | [`analytics/data-dictionary.md`](./analytics/data-dictionary.md), [`analytics/metric-readers.md`](./analytics/metric-readers.md), [`pipeline/csv-export.md`](./pipeline/csv-export.md), [`pipeline/generated-artefacts.md`](./pipeline/generated-artefacts.md) |
| `tools/rollup.py` | [`analytics/metric-readers.md`](./analytics/metric-readers.md), [`mcp/stdio-server.md`](./mcp/stdio-server.md), [`pipeline/csv-export.md`](./pipeline/csv-export.md), [`pipeline/l2-rollup.md`](./pipeline/l2-rollup.md), [`pipeline/rule-materialisation.md`](./pipeline/rule-materialisation.md), [`pipeline/test-harnesses.md`](./pipeline/test-harnesses.md), [`pipeline/verification-gate.md`](./pipeline/verification-gate.md) |
| `tools/run_rules.py` | [`analytics/fired-rules-and-evidence.md`](./analytics/fired-rules-and-evidence.md), [`dashboard/attention-queue.md`](./dashboard/attention-queue.md), [`mcp/stdio-server.md`](./mcp/stdio-server.md), [`pipeline/csv-export.md`](./pipeline/csv-export.md), [`pipeline/rule-materialisation.md`](./pipeline/rule-materialisation.md), [`pipeline/test-harnesses.md`](./pipeline/test-harnesses.md), [`pipeline/verification-gate.md`](./pipeline/verification-gate.md) |
| `tools/seed/*` | [`pipeline/csv-export.md`](./pipeline/csv-export.md), [`pipeline/generated-artefacts.md`](./pipeline/generated-artefacts.md), [`pipeline/l2-rollup.md`](./pipeline/l2-rollup.md), [`pipeline/rule-materialisation.md`](./pipeline/rule-materialisation.md), [`pipeline/seed-generation.md`](./pipeline/seed-generation.md), [`pipeline/test-harnesses.md`](./pipeline/test-harnesses.md), [`pipeline/verification-gate.md`](./pipeline/verification-gate.md) |
| `tools/test-api.sh` | [`pipeline/build-pipeline.md`](./pipeline/build-pipeline.md), [`pipeline/test-harnesses.md`](./pipeline/test-harnesses.md) |
| `tools/verify.py` | [`pipeline/build-pipeline.md`](./pipeline/build-pipeline.md), [`pipeline/verification-gate.md`](./pipeline/verification-gate.md) |
| `tsconfig.json` | [`dashboard/dashboard-shell.md`](./dashboard/dashboard-shell.md), [`deploy/next-build-config.md`](./deploy/next-build-config.md), [`deploy/typescript-and-css-toolchain.md`](./deploy/typescript-and-css-toolchain.md), [`kid-app/communication-board.md`](./kid-app/communication-board.md), [`mcp/stdio-server.md`](./mcp/stdio-server.md) |

## Maintaining these docs

| Situation | Command |
|---|---|
| You changed code and want the docs to match | `/update-feature-docs` |
| Docs have drifted over many commits | `/align-existing-feature-docs` |
| The manifest is missing or corrupt | `/align-existing-feature-docs --rebuild-manifest` |
| Full regeneration from scratch | `/extract-features` |
