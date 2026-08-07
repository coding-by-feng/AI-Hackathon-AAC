# Next.js Build Configuration

## Function
`next.config.ts` sets exactly two things: it marks `node:sqlite` as a server-external package so
the data layer can never be pulled into a client bundle, and it caps Server Action request
bodies at `1mb`.

## Purpose
The whole dashboard reads a local SQLite file. That only works because every module that touches
the database stays on the server. `serverExternalPackages` turns "please keep this server-only"
from a convention into a build-time property: if a Client Component ever imports `lib/db.ts`, the
bundler surfaces it rather than silently shipping a database driver to a child's tablet.

The config is deliberately tiny. Host-based separation of the kid board, the dashboard and the
MCP surface is **not** done here with `headers`/`redirects` — it is done in `middleware.ts`,
server-side, before rendering. Keeping the two concerns apart means the routing rules live next
to their reasoning instead of in a config file.

## Source Files
| File | Role |
|------|------|
| `next.config.ts` | The entire Next.js build/runtime config, typed as `NextConfig` |

## Implementation

### Shape
```ts
import type { NextConfig } from 'next'

const config: NextConfig = {
  serverExternalPackages: ['node:sqlite'],
  experimental: {
    serverActions: { bodySizeLimit: '1mb' },
  },
}

export default config
```

### `serverExternalPackages: ['node:sqlite']`
Stated rationale from the file's own comment: *"node:sqlite is a builtin, but the dashboard's
data layer must never be pulled into a client bundle. Anything importing `lib/db.ts` is a Server
Component or a Route Handler."*

Eleven files import `node:sqlite` directly and all of them are server-side:

| File | Role |
|---|---|
| `lib/sqlite.ts` | Inode-checked connection cache (`connect()`) |
| `lib/db.ts` | Read-only `aac.db` access; `DB_PATH = process.env.AAC_DB ?? path.join(process.cwd(), 'aac.db')` |
| `lib/session.ts`, `lib/auth.ts` | Adult session / viewer resolution |
| `lib/ingest.ts` | `POST /api/events` write path |
| `lib/dismiss.ts` | Insight dismissal writes |
| `lib/overrides.ts`, `lib/visuals/store.ts` | Card customisation store (`aac_app.db`) |
| `mcp/db.ts`, `mcp/server.ts` | MCP read connection |
| `app/api/chat/route.ts` | Ask-panel provider route |

`lib/db.ts` opens the read handle with `{ readOnly: true, pragmas: ['PRAGMA busy_timeout = 5000'] }`,
and only two explicitly whitelisted tables are writable through `writeDb()`.

### `experimental.serverActions.bodySizeLimit: '1mb'`
Stated rationale from the file's own comment: *"Server Actions are used for insight dismissal and
board-change proposals."* Two `'use server'` modules exist:

| File | Action | Payload |
|---|---|---|
| `app/actions.ts` | `dismissAction(firedRuleId: string, reason: DismissReason)` | Two short strings; scoped via `currentViewer()` + `requireChild()`, then `revalidatePath('/dashboard/student/<child_id>')` and `revalidatePath('/dashboard')` |
| `app/dashboard/reports/actions.ts` | `generateReportAction(formData: FormData)` | `child_id` plus `days` (default `28`); scoped via `currentViewer()` + `requireChild()` |

Neither action approaches `1mb`; the limit is a ceiling, not a working size.

### What is deliberately absent
- **No `output: 'standalone'`.** `deploy/run-web.sh` runs the normal `next start` server out of the repo working tree, so the full `node_modules/` must remain on disk.
- **No `headers`, `redirects` or `rewrites`.** All three live in `middleware.ts` (host → surface mapping, the `/` → `/dashboard` rewrite, and the `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet` header on dashboard responses).
- **No `basePath`, no `images` config, no `env` block.** Runtime configuration arrives as process environment variables (`AAC_DB`, `AAC_VIEWER`, `AAC_MCP_TOKEN`, `CHAT_PROVIDER`, `CHAT_MODEL`, `OPENAI_API_KEY`, `GEMINI_API_KEY`) sourced by [Production Web Service](production-web-service.md).

## Dependencies & Connections

### Depends On
- [Package Manifest and npm Scripts](npm-scripts.md) — `next build` / `next start` are the consumers of this file.
- [Database Connections](../database/connection-layer.md) — the module boundary this config protects.

### Depended On By
- [Production Web Service](production-web-service.md) — `next start` will not run without the `.next/` output this config shapes.
- [Host Routing](../auth/host-surface-routing.md) — relies on `middleware.ts` rather than config-level headers/redirects, an explicit division of labour.
- [Dashboard Insights](../dashboard/insight-cards.md) — the dismissal Server Action runs under `bodySizeLimit: '1mb'`.

### Shared Resources
- `.next/` build output, including `.next/BUILD_ID`, which `deploy/run-web.sh` uses as its go/no-go check.
- The `node:sqlite` module boundary, shared with every file in the table above.

## Change Risks
- **Removing `node:sqlite` from `serverExternalPackages`.** The bundler will attempt to include the data layer in a client chunk. Best case the build fails; worst case a Client Component that transitively imports `lib/db.ts` ships database code to the browser — on the kid surface, which by design has no login (see `deploy/aac.yml`).
- **Marking a module `'use client'` anywhere up the import chain from `lib/db.ts`.** This config cannot rescue that; it only prevents the package itself from being bundled.
- **Raising `bodySizeLimit` well above `1mb`.** The kid surface's event ingest is a Route Handler, not a Server Action, so this limit does not gate it — raising it only widens the accepted payload for `dismissAction` and `generateReportAction`, which need kilobytes.
- **Lowering `bodySizeLimit` below the size of a `FormData` submission.** `generateReportAction` takes `FormData`; a hard-lowered limit makes report generation fail with an opaque Server Action error rather than a form validation message.
- **Adding `output: 'standalone'`.** `deploy/run-web.sh` execs `node node_modules/next/dist/bin/next start --port 3000`; standalone output expects `node .next/standalone/server.js` instead, and the launchd job would start, fail, and be restarted every `ThrottleInterval` of 10 seconds.
- **Moving host routing into `next.config.ts` `headers`/`redirects`.** Config-level redirects would leak route existence — `middleware.ts` returns a bare `404` specifically because *"a redirect confirms the route exists somewhere, which is a small thing to give away for nothing."*
