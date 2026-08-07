# Package Manifest and npm Scripts

## Function
`package.json` declares the project's three runtime dependencies, six dev dependencies, the
Node engine floor (`>=24`), and the eight npm scripts that build the analytics database, build
and run the Next.js web app, start the MCP server, and typecheck the repo.

## Purpose
One manifest covers a repo that is really four things at once — the SQLite analytics database
and its Python pipeline, the kid PWA, the teacher/SLT dashboard, and the MCP server — as the
`description` field says: *"AAC analytics database, rule engine, MCP server, dashboard and kids
PWA"*. The script names encode which half of the repo you are operating on, and the split is
deliberately asymmetric: **`build` rebuilds the database, `build:web` builds the web app.**
Getting that backwards destroys `aac.db`.

The dependency list is also a statement of intent. `docs/TECH_STACK.md` describes Drizzle ORM,
`better-sqlite3`, Zustand, Dexie, Recharts, Zod and `@modelcontextprotocol/sdk`; **none of them
are installed.** The shipped app uses the `node:sqlite` builtin, plain React state, and a
hand-written MCP route. That is why `engines.node` is `>=24` — no native module, no bundler, and
Node executes the `.ts` MCP server directly.

## Source Files
| File | Role |
|------|------|
| `package.json` | Manifest: name, scripts, dependencies, `engines` floor |

## Implementation

### Manifest fields
| Field | Value |
|---|---|
| `name` | `aac-analytics` |
| `private` | `true` |
| `type` | `module` (every `.js`/`.ts` in the repo is ESM) |
| `description` | `AAC analytics database, rule engine, MCP server, dashboard and kids PWA` |
| `engines.node` | `>=24` |

Installed Node in this workspace is **v26.5.0**; installed Next is **15.5.23** (satisfying
`^15.5.4`).

### Scripts
| Script | Command | What it actually does |
|---|---|---|
| `build` | `./tools/build.sh aac.db` | **Rebuilds the analytics database from nothing.** `tools/build.sh` starts with `rm -f "$DB" "$DB-wal" "$DB-shm"`, then runs 7 stages: schema+indices → catalogues → seed → views → rollup (L2) → evaluate rules → verify, then regenerates docs and fixtures. Does **not** touch `.next/`. |
| `build:web` | `next build` | Builds the Next.js production bundle into `.next/`, producing `.next/BUILD_ID`. |
| `dev` | `next dev` | Development server. Not used in the deployed setup — see [Production Web Service](production-web-service.md). |
| `start` | `next start` | Serves an existing `.next/` build. The launchd job deliberately does **not** call this via npm. |
| `mcp` | `node mcp/server.ts --db aac.db` | Runs the MCP stdio server. Note: a **`.ts` file passed straight to `node`** — no compile step, no ts-node. Mirrored in `.mcp.json`. |
| `verify` | `python3 tools/verify.py --db aac.db` | Database invariant checks (also stage 7/7 inside `build`). |
| `concurrency` | `python3 tools/concurrency_test.py --db aac.db` | WAL concurrent reader/writer check. |
| `typecheck` | `tsc --noEmit` | Uses `tsconfig.json` — see [TypeScript and CSS Toolchain](typescript-and-css-toolchain.md). |

Both `build` and the Python scripts hardcode the database filename `aac.db`; `tools/build.sh`
accepts an optional positional `[db_path]` that defaults to `aac.db`, so `npm run build` passes
the default explicitly.

### Dependencies (exact ranges)
Runtime:
| Package | Range |
|---|---|
| `next` | `^15.5.4` |
| `react` | `^19.1.1` |
| `react-dom` | `^19.1.1` |

Dev:
| Package | Range |
|---|---|
| `@tailwindcss/postcss` | `^4.1.13` |
| `tailwindcss` | `^4.1.13` |
| `typescript` | `^5.9.2` |
| `@types/node` | `^24.5.2` |
| `@types/react` | `^19.1.13` |
| `@types/react-dom` | `^19.1.9` |

There is **no SQLite package**. Database access goes through the `node:sqlite` builtin, imported
by 13 files (`lib/db.ts`, `lib/sqlite.ts`, `lib/session.ts`, `lib/auth.ts`, `lib/ingest.ts`,
`lib/dismiss.ts`, `lib/overrides.ts`, `lib/visuals/store.ts`, `lib/chat/settings.ts`,
`mcp/db.ts`, `mcp/server.ts`, `app/api/chat/route.ts`,
`app/api/dashboard/settings/route.ts`), which is why `next.config.ts` lists it in
`serverExternalPackages` — see [Next.js Build Configuration](next-build-config.md).

There is also **no `@modelcontextprotocol/sdk`** and **no OpenAI/Gemini SDK**; the MCP surface
and the chat providers are hand-written against `fetch`.

### The `build` vs `build:web` hazard
`deploy/run-web.sh` refuses to start without a build and prints:

```
[run-web] No production build. Run: npx next build
```

It says `npx next build`, **not** `npm run build` — because `npm run build` would delete and
regenerate `aac.db` instead of producing the `.next/` output the message is asking for.

## Dependencies & Connections

### Depends On
- [Build Pipeline](../pipeline/build-pipeline.md) — `npm run build` is a thin alias for `tools/build.sh`, which owns the 7-stage database build.
- [Database Schema](../database/schema.md) — the artefact `npm run build` produces is `aac.db`.
- [MCP Server](../mcp/stdio-server.md) — `npm run mcp` is its stdio entry point.

### Depended On By
- [Production Web Service](production-web-service.md) — resolves `node_modules/next/dist/bin/next` installed by this manifest, and its `engines` floor is what makes `node:sqlite` available.
- [Next.js Build Configuration](next-build-config.md) — `next build` / `next start` read `next.config.ts`.
- [TypeScript and CSS Toolchain](typescript-and-css-toolchain.md) — `npm run typecheck` and the PostCSS/Tailwind pipeline are driven from here.

### Shared Resources
- `aac.db` at the repo root — written by `build`, read by `mcp`, `verify`, `concurrency`, and by the web app at runtime through `lib/db.ts`.
- `node_modules/` — `deploy/run-web.sh` executes `node_modules/next/dist/bin/next` by path, bypassing npm entirely.
- `.mcp.json` — repeats `node mcp/server.ts --db aac.db` for Claude Code's MCP client.

## Change Risks
- **Renaming or reordering `build`.** Anything (CI, a habit, another script) that runs `npm run build` expecting a web build will instead `rm -f aac.db aac.db-wal aac.db-shm` and reseed. Every dismissal, board override and ingested event stored in `aac.db` is lost, and the dashboard's insight history goes with it.
- **Lowering `engines.node` below 24.** `node:sqlite` needs Node ≥ 22.5 (see the header comment in `lib/db.ts`) and running `mcp/server.ts` as a `.ts` file needs Node's built-in type stripping. Drop below either and both the MCP server and every dashboard page that touches `lib/db.ts` fail at import time.
- **Adding a dependency that reads the filesystem or opens a database.** It must be added to `serverExternalPackages` in `next.config.ts`, or the client bundle will try to bundle it and the build breaks.
- **Adding `better-sqlite3` (or any native module) to match `docs/TECH_STACK.md`.** That introduces a compile step, which the deployment story in `deploy/run-web.sh` — a bare `node` invocation under launchd with a minimal `PATH` — does not have. Prefer keeping the zero-native-module property.
- **Bumping `next` across a major.** `next.config.ts` uses `serverExternalPackages` (stable) and `experimental.serverActions.bodySizeLimit` (experimental, and the most likely thing to be renamed or promoted).
