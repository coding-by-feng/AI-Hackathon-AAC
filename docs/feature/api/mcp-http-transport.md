# MCP HTTP Transport

## Function
`POST /api/mcp` speaks JSON-RPC 2.0 MCP over HTTP — `initialize`, `tools/list`, `tools/call`,
`resources/list`, `resources/read`, `ping` — behind a fixed bearer token; `GET /api/mcp` is a
liveness probe.

## Purpose
`mcp/server.ts` speaks JSON-RPC over **stdio**, which Claude Desktop uses and which a Cloudflare
Tunnel cannot carry: a tunnel forwards HTTP to a port, and stdio has no port. This route is the
same protocol over POST, so the analysis device (Gemma 3 4B on separate hardware, per
`docs/TECH_STACK.md`) can reach the tools remotely with no inbound ports of its own.

The tool implementations are imported **unchanged** from `mcp/tools.ts`. Both transports
therefore expose exactly the same surface, and the stdio server keeps working for local
development. That is the point of the split: one seam between the data and every model that
reads it.

## Source Files
| File | Role |
|------|------|
| `app/api/mcp/route.ts` | JSON-RPC dispatch, the four resources, the shared-secret auth, and the read-only database handle |

## Implementation

### Constants

```ts
export const dynamic = 'force-dynamic'

const ROOT = process.cwd()
const PROTOCOL_VERSION = '2025-06-18'
const DB_PATH = process.env.AAC_DB ?? path.join(ROOT, 'aac.db')
```

### Database handle

```ts
if (!globalThis.__mcpDb) globalThis.__mcpDb = new Db(DB_PATH)
```

Cached on `globalThis` so Next's dev-mode module reloading does not leak SQLite handles.
Constructed **without** `{ allowWrites: true }` — "Read-only. Writes go through the dashboard,
where a human approves them." A consequence worth stating plainly: `write_insight` and
`propose_board_change` are advertised in `tools/list` but fail at call time with
`NOT_AUTHORISED — This server is read-only.` over this transport. They only work through
`mcp/server.ts --allow-writes`.

### Authentication

```ts
function authorised(req) {
  const expected = process.env.AAC_MCP_TOKEN
  if (!expected) return false                       // fails closed
  const presented = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (presented.length !== expected.length) return false
  // XOR accumulate over every char, compare diff === 0
}
```

A fixed bearer token compared in constant time, so a wrong guess cannot be narrowed by timing.
Length is compared first and leaks the token length. This is a demo-grade control: a single
token that never rotates and is the same for every caller. Cloudflare Access service tokens are
the documented upgrade path (`docs/deploy.md`). With `AAC_MCP_TOKEN` unset the route refuses
everything rather than running open.

Unauthorised → HTTP **401** with
`{ "jsonrpc": "2.0", "id": null, "error": { "code": -32001, "message": "Unauthorised" } }`.

### Method dispatch (`handle(req)`)

| Method | Result |
|---|---|
| `initialize` | `{ protocolVersion: '2025-06-18', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'aac-analytics', version: '1.0.0' }, instructions: INSTRUCTIONS }` |
| `tools/list` | `{ tools: [{ name, description, inputSchema }] }` — every entry of `mcp/tools.ts` (20 tools, including `query`) |
| `tools/call` | `tools[params.name].run(db(), params.arguments ?? {})`, wrapped as `{ content: [{ type: 'text', text: JSON.stringify(result, null, 1) }] }`; unknown name → `McpError('UNKNOWN_TOOL', 'No tool named <n>.')` |
| `resources/list` | the four resources below, without their `load` functions |
| `resources/read` | `{ contents: [{ uri, mimeType, text: res.load() }] }`; unknown uri → `McpError('UNKNOWN_RESOURCE', 'No resource <uri>.')` |
| `ping` | `{}` |
| anything else | `McpError('METHOD_NOT_FOUND', 'Unsupported method: <m>')` |

Note the route implements no `notifications/*`, no `prompts/*`, and no session negotiation
beyond `initialize`.

### Resources

| URI | Name | mimeType | Loaded from |
|---|---|---|---|
| `schema://ddl` | Database DDL | `text/plain` | `readFileSync(db/schema.sql)` |
| `schema://dictionary` | Metric dictionary | `application/json` | `SELECT * FROM metrics_catalog ORDER BY group_code, metric_id` |
| `schema://insights` | Insight rules | `application/json` | `SELECT * FROM insights_catalog` |
| `schema://interpretation-guide` | AAC clinical constraints | `text/markdown` | `readFileSync(docs/aac-clinical-constraints.md)` |

`docs/mcp-api.md` §5 also lists `schema://sample-questions`; it is **not implemented** in this
route. The three JSON/text loads happen on every `resources/read` — nothing is cached beyond the
database handle.

Descriptions are load-bearing prompt text, e.g. the interpretation guide's is
`READ BEFORE WRITING ANY RECOMMENDATION. Eight constraints from AAC practice.`

### `INSTRUCTIONS`

Returned by `initialize`, verbatim:

> Analytics for an AAC system used by children with cerebral palsy.
> Read schema://interpretation-guide before writing any recommendation.
> Every response carries `guidance` — read it before the numbers. A null metric value means the
> sample was too small, never that nothing happened. Repeated pressing is communication, not
> error. Never recommend moving or resizing a learned layout.

That last sentence encodes constraints C1, C2 and C3 into the transport's own handshake, so a
client that reads nothing else still gets them.

### Response and error envelopes

| Case | HTTP | Body |
|---|---|---|
| unauthorised | 401 | error `-32001` `Unauthorised` |
| body is not JSON | **200** | `{ jsonrpc, id: null, error: { code: -32700, message: 'Parse error' } }` |
| notification (`id` is `undefined` or `null`) | 204 | empty — a notification expects no reply |
| success | 200 | `{ jsonrpc: '2.0', id, result }` |
| any thrown error | **200** | `{ jsonrpc: '2.0', id: req.id ?? null, error: { code: -32000, message: e.message, data: { code: e.code ?? 'INTERNAL' } } }` |

Errors after authentication are carried at the JSON-RPC layer with HTTP 200, which is correct
for JSON-RPC and means a monitoring check on status code alone will not see tool failures.
`data.code` carries the `McpError` code (`CHILD_NOT_FOUND`, `NOT_AUTHORISED`, `SQL_REJECTED`,
`WINDOW_TOO_LARGE`, …) from `docs/mcp-api.md` §8.

### `GET /api/mcp`

`{ "status": "ok", "transport": "http", "protocol": "2025-06-18" }` — liveness only,
deliberately revealing nothing about the data. Unauthenticated.

### Routing

`middleware.ts` maps a host beginning `aac-mcp.` to `surface = 'mcp'`, which allows **only**
paths starting `/api/mcp` — not even the shared assets: both the exact-path `SHARED` list and
the `SHARED_PREFIXES = ['/icons/']` static-image directories are excluded from the mcp
surface, the latter pinned by `tools/test-api.sh` K3 (`/icons/ai/want.png` → 404 on the MCP
host). On the kid and dashboard hostnames `/api/mcp` returns 404. On localhost
(`surface = 'any'`) everything is reachable, which is why `docs/deploy.md` insists the
hostname matrix be smoke-tested against the deployed URL.

`tools/test-api.sh` covers this route: no token → 401, wrong token → 401, `tools/list` →
at least 14 tools, `tools/call list_children` → 5 children, and `get_metrics` with an
out-of-set window token → a loud rejection, never a silent 7d fallback.

## Dependencies & Connections

### Depends On
- [MCP tool surface](../mcp/tool-surface.md) — `tools` from `mcp/tools.ts` is imported unchanged;
  this route adds no tool of its own.
- [MCP database wrapper](../mcp/read-only-db-access.md) — `Db`, `McpError`, the read-only handle, the
  `SELECT`/`WITH`-only parse guard and the banned-keyword regex behind `query`.
- [Database schema](../database/schema.md) — `db/schema.sql` is served verbatim as
  `schema://ddl`; `metrics_catalog` and `insights_catalog` back two more resources.
- `docs/aac-clinical-constraints.md` — read from disk at request time, so the deployed working
  directory must contain it.
- [Host routing middleware](../auth/host-surface-routing.md) — the `aac-mcp.*` surface.

### Depended On By
- [MCP clients](../mcp/stdio-server.md) — the analysis device and Claude Desktop over
  `mcp-remote`/HTTP; `mcp/server.ts` remains the stdio path for local development.
- `tools/test-api.sh` — the L1–L5 assertions.

### Shared Resources
- `aac.db`, opened read-only and cached on `globalThis.__mcpDb`.
- Files on disk: `db/schema.sql`, `docs/aac-clinical-constraints.md`.
- Environment: `AAC_MCP_TOKEN` (required, fails closed), `AAC_DB`.

## Change Risks
- **Adding a tool to `mcp/tools.ts`** exposes it over HTTP immediately — there is no allow-list
  here, unlike `lib/chat/tools.ts` which excludes `query`. Anything added is reachable by any
  holder of the single bearer token.
- **Passing `{ allowWrites: true }` to `Db`** would make `write_insight` and
  `propose_board_change` succeed over the network with only a shared secret in front of them,
  removing the human approval step that `docs/mcp-api.md` describes as the point of splitting
  `fired_rules` from `insights`.
- **Leaving `AAC_MCP_TOKEN` unset in production** takes the whole MCP surface offline (401 on
  everything) rather than opening it — the intended failure direction, but it looks like a
  network fault.
- **Renaming or moving `db/schema.sql` or `docs/aac-clinical-constraints.md`** turns
  `resources/read` into a thrown `ENOENT` surfaced as a `-32000` error, and silently removes the
  clinical constraints from every model that reads them.
- **Changing `PROTOCOL_VERSION`** must be matched against what the connecting client negotiates;
  the route echoes its constant and performs no negotiation.
- **Returning HTTP error codes instead of JSON-RPC errors** would break clients that only parse
  the body; today only the 401 and the 204 notification path deviate from 200.
