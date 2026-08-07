# AI-Hackathon-AAC

An AAC (augmentative and alternative communication) system for children with cerebral
palsy, in three surfaces served by **one Next.js process** over **SQLite in WAL mode**:

| Surface | Hostname | What it is |
|---|---|---|
| Communication board | `aac.kason.app` | The child-facing symbol board: sentence bar, speech output, categories, offline-capable PWA. Deliberately unauthenticated. |
| Analytics dashboard | `aac-dashboard.kason.app` | Teacher / SLT / parent surface: attention queue, per-student metrics, insight cards, reports, Ask panel. Adult login (username + password). |
| MCP analytics server | `aac-mcp.kason.app` | 20 read-mostly MCP tools over the analytics database, for any model that asks about the data. Bearer token. |

All three hostnames resolve to the same `localhost:3000` origin through a Cloudflare
Tunnel; `middleware.ts` reads the `Host` header and 404s routes that do not belong to
that hostname. One process is a constraint, not a shortcut: a SQLite WAL writer and its
readers must share a filesystem, so the surfaces cannot be split across machines without
first replacing SQLite.

Two databases: `aac.db` (analytics — events, utterances, metrics, insights; rebuilt
deterministically by the pipeline) and `aac_app.db` (application state — adult accounts,
card overrides, categories, generated pictures).

## Running it

```bash
./tools/build.sh aac.db     # build + seed the analytics database (Python, deterministic)
npm install
npm run dev                 # board at /, dashboard at /dashboard, MCP at POST /api/mcp
```

Secrets and configuration live in `.env.local` only (see `docs/deploy.md` for the full
variable table). Production runs as a macOS launchd job behind `cloudflared` — the
runbook is [`docs/deploy.md`](docs/deploy.md) and the service definitions are in
[`deploy/`](deploy/).

## Directory map

```
app/            the ONE Next.js process (WAL SQLite forces a shared filesystem,
  page.tsx        so kid + dashboard + APIs stay in one deploy)
  who/            kid sign-in
  dashboard/      teacher/SLT surface (own hostname via middleware)
  api/            events · cards · categories · session · auth · visuals · mcp · chat
components/
  kid/            board surface only
  *.tsx           dashboard surface only
lib/
  kid/            speech · sentence · voice · logging (browser-side concerns)
  visuals/        provider chain: vertex | gemini | openai + ladder + cache
  categories/     folder store (aac_app.db)
  chat/           LLM providers (analytics session)
  *.ts            shared: db, sqlite, access, auth, session, metrics, report
db/  tools/  mcp/  analytics pipeline — other session's territory
deploy/           launchd + cloudflared + runbook
public/icons/ai/  generated vocabulary icons
docs/feature/     one md per feature
```

## Where to read next

- [`docs/feature/README.md`](docs/feature/README.md) — the feature index: one doc per
  feature, with source files, dependency edges and an impact matrix. Start here before
  changing code.
- [`docs/team-plan.md`](docs/team-plan.md) — the current build wave and the file-ownership
  contract between parallel agents.
- [`docs/aac-clinical-constraints.md`](docs/aac-clinical-constraints.md) — the clinical
  rules enforced in code (cards never move or resize; neutral metrics never styled good
  or bad; every number carries its `n`; a metric with no source renders "not recorded").
- [`docs/analytics-metrics.md`](docs/analytics-metrics.md) and
  [`docs/mcp-api.md`](docs/mcp-api.md) — the metric and MCP tool specifications.
- [`docs/deploy.md`](docs/deploy.md) — the deployment runbook.
