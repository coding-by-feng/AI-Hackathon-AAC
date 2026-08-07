# Read-Only Database Access and the SQL Guard

## Function
A zero-dependency `Db` wrapper over `node:sqlite` that gives every MCP tool a read-only handle, an optional narrowly-scoped write handle, and a parse guard for the free-form `query` escape hatch — plus the `McpError` class that carries a structured code and a retryable flag out to the JSON-RPC layer.

## Purpose
`aac_text.db` holds the actual words children have said. This server must never open it. The file header states the problem exactly:

> **READ-ONLY IS HARDER THAN IT LOOKS** — see `docs/mcp-api.md` §10.
> - `node:sqlite`'s `{ readOnly: true }` DOES open a WAL database (Python's `mode=ro` URI does not — it cannot create the `-shm` file).
> - ATTACH is still permitted on a read-only handle, and `node:sqlite` exposes no authorizer callback. So the only things standing between this process and `aac_text.db` are the SQL parse guard below and OS file permissions.
> - Run this server as a user with no read bit on `aac_text.db`. That is the guarantee; everything else is defence in depth.

The second bullet is the load-bearing one. `docs/mcp-api.md` §10 specifies three layers — a parse guard, a deny-`ATTACH` authorizer, and OS permissions. **Layer 2 does not exist in this implementation**, because `node:sqlite` has no `set_authorizer` equivalent. That makes the parse guard here and the deployment-time file permissions the only two layers that actually run.

Zero dependencies is also deliberate: `node:sqlite` is built in and Node strips the TypeScript types at load, so `node mcp/server.ts` just runs — no `better-sqlite3`, no build step.

## Source Files
| File | Role |
|------|------|
| `mcp/db.ts` | `Db` class (`all`/`one`/`scalar`/`freeQuery`/`exec`/`close`), the `SELECT_ONLY` and `BANNED` regexes, the `Row` type, and the `McpError` class |

## Implementation

### Connections

```ts
constructor(path: string, opts: { allowWrites?: boolean } = {})
```

| Handle | Opened when | Pragmas |
|---|---|---|
| `read` | always — `new DatabaseSync(path, { readOnly: true })` | `PRAGMA busy_timeout = 5000` |
| `write` | only when `opts.allowWrites` — `new DatabaseSync(path)` | `PRAGMA busy_timeout = 5000`, `PRAGMA foreign_keys = ON` |

`readonly path: string` is exposed on the instance. `close()` closes `read` and, if present, `write`.

Note the divergence from `docs/mcp-api.md`, which specifies `PRAGMA query_only = ON` on a normal handle plus a deny-`ATTACH` authorizer, and warns that `{ readonly: true }` fails on WAL for `better-sqlite3`. This code uses `node:sqlite`'s `{ readOnly: true }` instead, which the header records as working against a WAL database.

### Read helpers

| Method | Behaviour |
|---|---|
| `all(sql, params = [])` | `read.prepare(sql).all(...params)` → `Row[]` |
| `one(sql, params = [])` | `read.prepare(sql).get(...params)` → `Row \| undefined` |
| `scalar<T>(sql, params = [])` | `one()` then `Object.values(row)[0]` — the **first column of the first row**, or `undefined` when there is no row |

`type Row = Record<string, unknown>`. All three are synchronous; there is no connection pool and no async surface anywhere in the MCP domain.

### `freeQuery(sql, limit = 200)`

The escape hatch behind the `query` tool: everything a caller can reach that is not a typed tool. The header comment records why it rejects before execution rather than trusting the handle: **a read-only handle still permits `ATTACH`.**

```ts
const SELECT_ONLY = /^\s*(with|select)\b/i
// Deliberately blunt. A false positive costs one retry; a false negative costs
// a child's entire communication history.
const BANNED = /\b(attach|detach|pragma|insert|update|delete|drop|alter|create|replace|vacuum|reindex|begin|commit|rollback|savepoint)\b/i
```

Steps, in order:

1. `trimmed = sql.trim().replace(/;\s*$/, '')` — one trailing semicolon is tolerated.
2. `SELECT_ONLY` must match → else `McpError('SQL_REJECTED', 'Only SELECT and WITH statements are permitted.')`.
3. `trimmed.includes(';')` → `McpError('SQL_REJECTED', 'Multiple statements are not permitted.')`.
4. **Comments are stripped before the keyword scan** — `replace(/--[^\n]*/g, ' ')` and `replace(/\/\*[\s\S]*?\*\//g, ' ')` — "or `-- attach` style tricks slip through". The `BANNED` scan runs on this stripped copy.
5. `BANNED` match → `McpError('SQL_REJECTED', 'Statement contains a forbidden keyword: <match>')`.
6. If `/\blimit\b/i` is absent from the stripped copy, `LIMIT ${limit + 1}` is appended to the **original** trimmed statement. The `+1` is what detects truncation.
7. `read.prepare(capped).all()` — no bound parameters; the statement runs literally.
8. A SQLite error is re-thrown as `McpError('SQL_REJECTED', err.message)` — **verbatim**, "so the model can self-correct rather than guess again".
9. Returns `{ rows: truncated ? rows.slice(0, limit) : rows, truncated, applied: capped }`.

Consequences of the bluntness, all real:
- `PRAGMA table_info(events)` is rejected — schema introspection has to go through the `schema://ddl` resource instead.
- A perfectly valid `SELECT REPLACE(label, '_', ' ') FROM cards` is rejected because `replace` is in `BANNED`. So is any query mentioning a column or alias containing `create`, `update`, `begin`, etc.
- A query that already contains its own `LIMIT` is never capped, so `SELECT … LIMIT 100000` runs unbounded by this guard.
- `docs/mcp-api.md` §4 lists a **2 s statement timeout** and a **32 KB response cap** as enforced guards. Neither is implemented; only `busy_timeout = 5000` (lock contention, not statement duration) exists.
- `docs/mcp-api.md` also says "every query logged with the calling adult's id". There is no logging here.

### `exec(sql, params = [])`

```ts
if (!this.write) throw new McpError('NOT_AUTHORISED', 'This server is read-only.')
if (!/^\s*insert\s+into\s+(insights|board_change_proposals)\b/i.test(sql)) {
  throw new McpError('NOT_AUTHORISED', 'Writes are limited to insights and board_change_proposals.')
}
this.write.prepare(sql).run(...params)
```

Writes are confined to two tables and to `INSERT INTO` only — no `UPDATE`, no `DELETE`, no dismissals. A human performs those in the dashboard. Without `--allow-writes` on the command line, `write` is `null` and both write tools fail at the first line.

### `McpError`

```ts
export class McpError extends Error {
  code: string
  retryable: boolean
  constructor(code: string, message: string, retryable = false) { … }
}
```

The fields are written out longhand because **Node's strip-only TypeScript mode does not support parameter properties**, and this file must run under `node mcp/server.ts` with no build step. `mcp/server.ts` maps these onto JSON-RPC `-32000` with `data: { code, retryable }`.

Codes actually thrown across the MCP domain: `NOT_AUTHORISED`, `SQL_REJECTED`, `WINDOW_TOO_LARGE` (retryable), `CHILD_NOT_FOUND`, `METRIC_NOT_SLICEABLE`, `UNKNOWN_TOOL`, `UNKNOWN_RESOURCE`, `INVALID_ARGUMENTS` (retryable), `METHOD_NOT_FOUND`. `docs/mcp-api.md` §8 additionally lists `CONSENT_REQUIRED`, `LIMIT_EXCEEDED`, `SQL_TIMEOUT` and `NO_DATA_IN_WINDOW`, none of which are ever thrown.

## Dependencies & Connections

### Depends On
- `node:sqlite` (`DatabaseSync`) — Node ≥ 22.5 builtin. `lib/db.ts` uses the same module for the same reason.
- [Database schema](../database/schema.md) — the WAL-mode `aac.db` file this opens, and the `insights` / `board_change_proposals` tables `exec` allows.
- **OS file permissions** — not code. `docs/mcp-api.md` §10 calls this "the one that makes the claim true": run the MCP server as a dedicated unprivileged user with no read bit on `aac_text.db`, and "utterance text is unreachable" becomes a statement about the filesystem rather than about our code.

### Depended On By
- [MCP stdio server](stdio-server.md) — constructs the single `Db` and imports `McpError` for every failure path.
- [Tool surface](tool-surface.md) — all 20 tools take a `Db`; `query` is a thin wrapper over `freeQuery`; `write_insight` and `propose_board_change` are the only callers of `exec`.
- [MCP over HTTP](../api/mcp-http-transport.md) — `app/api/mcp/route.ts` constructs a `Db` with no `allowWrites`, cached on `globalThis.__mcpDb`.
- [Dashboard chat tools](../ai/scoped-tool-bridge.md) — `lib/chat/tools.ts` constructs a `Db` cached on `globalThis.__aacChatDb`; the comment there notes that without the global, each Next dev-mode reload leaks a SQLite handle "until the WAL reader count blocks the writer".

### Shared Resources
- `aac.db` in WAL mode — read here while the Next.js app writes. `busy_timeout = 5000` is the only contention handling.
- `aac_text.db` — the database this code exists to never open.
- Process-global `Db` singletons in the HTTP route and the chat path (`__mcpDb`, `__aacChatDb`).

## Change Risks
- **Removing a keyword from `BANNED`** — particularly `attach` — re-opens the path `docs/mcp-api.md` §10 verified: `ATTACH '/data/aac_text.db' AS t; SELECT * FROM t.utterance_text` reads every utterance a child has ever produced. The multi-statement check and the `attach` keyword are the *only* code-level defences, because the authorizer layer does not exist here.
- **Dropping the comment-stripping step** before the `BANNED` scan lets `SELECT 1 /* attach */ ; ATTACH …`-style probing past the guard. It was added for exactly that reason.
- **Adding a table to the `exec` allowlist regex** widens what any model with `--allow-writes` can mutate. Today the blast radius is two append-only tables.
- **Switching to `better-sqlite3`** would reintroduce the WAL problem `docs/mcp-api.md` §10 documents — `new Database(path, { readonly: true })` cannot map the `-shm` file — and would add a native dependency and a build step to a server that currently has neither.
- **Adding parameter properties or any non-strippable TypeScript** to this file breaks `node mcp/server.ts`, which runs with no transpiler. `tsconfig.json` deliberately excludes `mcp/`.
- **Loosening `freeQuery` to accept bound parameters or multiple statements** changes the guarantee the `query` tool advertises to every model that reaches it.
- **Making `BANNED` cleverer (e.g. a real SQL parser)** trades a known false-positive cost — one retry — for an unknown false-negative cost. The header comment names that trade explicitly and picks bluntness.
- **Relying on `{ readOnly: true }` alone** and dropping `freeQuery`'s guard would leave `ATTACH` fully open, since the read-only flag does not block it.
