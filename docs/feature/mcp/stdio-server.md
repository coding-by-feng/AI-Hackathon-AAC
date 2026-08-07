# MCP stdio Server

## Function
A zero-dependency JSON-RPC 2.0 server over stdin/stdout that exposes the AAC analytics tool surface and four static `schema://` resources to any MCP client. Registered for Claude Code by `.mcp.json`.

## Purpose
This is the transport half of "the single seam between the analytics data and every model that reads it" (`docs/TECH_STACK.md`). The file header states the two design facts that shape it:

- **Zero dependencies.** `node:sqlite` is built in and Node strips the TypeScript types at load, so `node mcp/server.ts` runs with nothing installed and nothing built. There is no `@modelcontextprotocol/sdk` here despite `TECH_STACK.md` naming it.
- **The client drives, not the model.** The intended consumer is Gemma 3 4B on a separate analysis device, plus Claude Desktop / Claude Code over stdio for development. A 4B model cannot reliably chain tool calls, so the *client* executes a fixed sequence and asks one narrow question at a time. `next_calls` in each envelope is therefore an instruction to the client, not a hint to the model.

The `initialize` response carries the clinical framing in-band, so a model that reads nothing else still gets the four rules that stop it doing harm.

## Source Files
| File | Role |
|------|------|
| `mcp/server.ts` | JSON-RPC 2.0 dispatch, `RESOURCES` catalogue, CLI argument parsing, readline stdio transport, error framing |
| `.mcp.json` | Claude Code server registration — `node mcp/server.ts --db aac.db` |

## Implementation

### Startup and CLI

```
node mcp/server.ts --db aac.db            # package.json: "mcp" script
node mcp/server.ts --db aac.db --allow-writes
```

| Constant / flag | Value |
|---|---|
| `PROTOCOL_VERSION` | `'2025-06-18'` |
| `ROOT` | `resolve(import.meta.dirname, '..')` — the repo root |
| `--db <path>` | `argv[argv.indexOf('--db') + 1]`, falling back to `resolve(ROOT, 'aac.db')` |
| `--allow-writes` | `argv.includes('--allow-writes')` → passed to `new Db(dbPath, { allowWrites })` |
| serverInfo | `{ name: 'aac-analytics', version: '1.0.0' }` |

**Bug in `--db` parsing.** `argv.indexOf('--db')` returns `-1` when the flag is absent, so `argv[-1 + 1]` is `argv[0]`. Running `node mcp/server.ts --allow-writes` opens a database file literally named `--allow-writes`. The fallback to `<repo>/aac.db` only fires when `argv` is empty.

**No `AAC_DB` support.** `docs/mcp-clients.md` §3 says "set `AAC_DB` in the environment and pass only the script path — the server falls back to `<repo>/aac.db`". The stdio server reads no environment variable at all; only `app/api/mcp/route.ts` and `lib/chat/tools.ts` honour `AAC_DB`.

### Resources

`RESOURCES` is an array of four entries, each `{ uri, name, mimeType, description, load }`. `load()` runs at read time, so DDL and the constraints document are always current on disk. JSON resources are serialised with `JSON.stringify(…, null, 1)` (indent 1).

| URI | Name | mimeType | `load()` |
|---|---|---|---|
| `schema://ddl` | Database DDL | `text/plain` | `readFileSync(resolve(ROOT, 'db/schema.sql'), 'utf8')` |
| `schema://dictionary` | Metric dictionary | `application/json` | `SELECT * FROM metrics_catalog ORDER BY group_code, metric_id` |
| `schema://insights` | Insight rules | `application/json` | `SELECT * FROM insights_catalog` |
| `schema://interpretation-guide` | AAC clinical constraints | `text/markdown` | `readFileSync(resolve(ROOT, 'docs/aac-clinical-constraints.md'), 'utf8')` |

Descriptions verbatim: dictionary is *"All 41 metrics: formula, unit, polarity, min_n, caveat."* (matching the 41 rows the resource serves); insights is *"The 8 rules, their thresholds, and the actions each one forbids."*; the interpretation guide is *"READ BEFORE WRITING ANY RECOMMENDATION. Eight constraints from AAC practice."* The header comment states plainly that `interpretation-guide` "is not optional reading: it holds the clinical constraints that make otherwise sensible advice harmful."

`docs/mcp-api.md` §5 lists a fifth resource, `schema://sample-questions` (20 worked question→tool-sequence examples). **It is not implemented.**

### JSON-RPC methods

`handle(req)` is a switch on `req.method`:

| Method | Behaviour |
|---|---|
| `initialize` | Returns `protocolVersion`, `capabilities: { tools: {}, resources: {} }`, `serverInfo`, and an `instructions` string |
| `tools/list` | `Object.entries(tools).map(([name, t]) => ({ name, description: t.description, inputSchema: t.schema }))` — 20 tools |
| `tools/call` | Looks up `tools[req.params.name]`; unknown → `McpError('UNKNOWN_TOOL', 'No tool named <name>.')`. Then `validateArgs(tool.schema, req.params?.arguments ?? {})`; on failure → `McpError('INVALID_ARGUMENTS', errors.map(e => \`${e.path}: ${e.message}\`).join('; '), true)` (retryable). On success returns `{ content: [{ type: 'text', text: JSON.stringify(result, null, 1) }] }` |
| `resources/list` | The four `RESOURCES` minus their `load` functions |
| `resources/read` | `RESOURCES.find(r => r.uri === uri)`; unknown → `McpError('UNKNOWN_RESOURCE', 'No resource <uri>.')`. Returns `{ contents: [{ uri, mimeType, text: res.load() }] }` |
| `ping` | `{}` |
| anything else | `McpError('METHOD_NOT_FOUND', 'Unsupported method: <method>')` |

The `instructions` string sent on `initialize`, verbatim:

> Analytics for an AAC system used by children with cerebral palsy.
> Read schema://interpretation-guide before writing any recommendation.
> Every response carries `guidance` — read it before the numbers. A null metric value means the sample was too small, never that nothing happened. Repeated pressing is communication, not error. Never recommend moving or resizing a learned layout.

Validation runs **before** the tool does. The header comment records why: an argument the schema did not describe used to be silently dropped, so `group_by: "scene"` returned one blended number and the caller had no way to know it had been ignored.

### Transport

- `createInterface({ input: process.stdin, terminal: false })` — one JSON object per line.
- Blank lines are ignored (`if (!line.trim()) return`).
- `JSON.parse` failure → `{ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }`.
- `send(payload)` writes `JSON.stringify(payload) + '\n'` to `process.stdout`.
- **Notifications produce no output.** Both the success path (`if (req.id !== undefined)`) and the error path (`if (req.id === undefined) return`) drop responses for requests with no `id`.
- Thrown errors are framed as JSON-RPC code `-32000` with `data: { code: e.code ?? 'INTERNAL', retryable: e.retryable ?? false }` — structured "so the caller can decide whether a retry is worth it, rather than parsing prose".
- `rl.on('close')` → `db.close(); process.exit(0)`.

There is no request id de-duplication, no batching, and no concurrency: `handle()` is fully synchronous, so requests are processed strictly in line order.

### `.mcp.json`

```json
{
  "mcpServers": {
    "aac-analytics": {
      "command": "node",
      "args": ["mcp/server.ts", "--db", "aac.db"],
      "env": {}
    }
  }
}
```

Both paths are **relative**, so Claude Code must launch the server with the repo root as its working directory (it does). Writes are off by default — `--allow-writes` is absent, so `write_insight` and `propose_board_change` fail with `NOT_AUTHORISED: This server is read-only.` Codex CLI needs absolute paths in `~/.codex/config.toml` instead; see `docs/mcp-clients.md` §3.

### No authentication

There is no bearer token, no role, and no consent check in this server. `list_children` scopes through the `roster` table using an `adult_id` the **caller supplies as a tool argument**. `TECH_STACK.md` specifies token-derived role scoping resolved in the tool handler; that exists only in the in-process chat path (`lib/chat/tools.ts`), not here.

## Dependencies & Connections

### Depends On
- [Tool surface](tool-surface.md) — imports `tools` and calls `tool.run(db, validatedArgs)`; `tools/list` is generated from the same object.
- [Read-only database access](read-only-db-access.md) — constructs the single `Db` instance and imports `McpError` for every failure path.
- [Argument validation](argument-validation.md) — `validateArgs` gates every `tools/call`.
- [Database schema](../database/schema.md) — reads `db/schema.sql` for `schema://ddl`, and `metrics_catalog` / `insights_catalog` for the other two JSON resources.

### Depended On By
- [MCP over HTTP](../api/mcp-http-transport.md) — `app/api/mcp/route.ts` re-implements this exact dispatch over POST because a Cloudflare Tunnel forwards HTTP to a port and stdio has no port. It duplicates `PROTOCOL_VERSION` and the `RESOURCES` array rather than importing them.
- [Response fixtures](response-fixtures.md) — `tools/gen_fixtures.py` spawns this server and feeds it `tools/call` lines over stdin.
- Claude Code / Codex CLI / the Gemma analysis device — external MCP clients.

### Shared Resources
- `aac.db` (SQLite, WAL) — opened read-only; the Next.js app writes the same file concurrently.
- `db/schema.sql` and `docs/aac-clinical-constraints.md` — read from disk on every `resources/read`.
- `metrics_catalog`, `insights_catalog` — the catalogue tables both `lib/catalog.ts` and `mcp/tools.ts` read at runtime, so no threshold is hardcoded on either side.

## Change Risks
- **Renaming or removing a `schema://` URI** breaks `app/api/mcp/route.ts`, which hardcodes the same four URIs separately. They must be changed together or the two transports diverge.
- **Deleting `docs/aac-clinical-constraints.md` or `db/schema.sql`** makes `resources/read` throw a raw `ENOENT` that is framed as `-32000` with `code: 'INTERNAL'`. `resources/list` still advertises the resource, so a client sees a resource it cannot fetch.
- **Fixing the `--db` off-by-one** changes behaviour for any invocation that passes a positional argument first. `.mcp.json`, `package.json`, `tools/gen_fixtures.py` and `docs/mcp-clients.md` all pass `--db` explicitly, so they are unaffected.
- **Adding `--allow-writes` to `.mcp.json`** silently grants every Claude Code session the ability to insert into `insights` and `board_change_proposals`. `docs/mcp-clients.md` §2 deliberately leaves it off.
- **Making `handle()` async** would break the strict in-order stdio contract that `tools/gen_fixtures.py` relies on — it writes N request lines up front and matches responses back by array position.
- **Moving validation after `tool.run`** re-opens the exact failure `mcp/validate.ts` was written for: a silently dropped `group_by` returning one blended number that the caller believes is a breakdown.
- **Adding a streamable HTTP transport here** (the missing piece for the Gemma device, `docs/mcp-clients.md` §4) must reuse `handle()` and `RESOURCES` unchanged, or the two transports stop exposing the same surface.
