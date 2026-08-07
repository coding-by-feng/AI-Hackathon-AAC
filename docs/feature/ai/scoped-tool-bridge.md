# Scoped Tool Bridge (in-process MCP)

## Function
Exposes the MCP tools from `mcp/tools.ts` to the chat agent **in-process**, rewriting each tool's schema so the model can never name a child it was not given, and injecting `child_id` / `class_id` / `adult_id` from the session's viewer server-side.

## Purpose
Two problems solved in one file.

**Latency.** Importing `mcp/tools.ts` directly rather than spawning `mcp/server.ts` is measured at 4.4 ms per call in-process against ~70 ms of process startup plus JSON-RPC framing. An agentic turn makes 3–6 calls, so the subprocess route would cost roughly 350 ms of pure overhead per question. The stdio server stays exactly as it is for external clients (Claude Code, Codex, the Gemma device).

**Scope.** As the header comment puts it: *scope injection is the point of this file*. A model that cannot name a child it was not given cannot read that child's communication history, whatever it is asked to do.

## Source Files
| File | Role |
|------|------|
| `lib/chat/tools.ts` | `toolsForScope()`, `invokeTool()`, `ChatScope`, `ToolInvocation`, `readCatalogueSummary()`, the cached `Db` handle |

## Implementation

### Constants
| Name | Value |
|------|-------|
| `SCOPED_PARAMS` | `['child_id', 'class_id', 'adult_id']` |
| `EXCLUDED_FROM_CHAT` | `new Set(['query'])` |

`query` (free-form SQL) is excluded because it "is a fine escape hatch for a trusted operator at a terminal. It is not one for a chat box: `SELECT * FROM utterances` would cross every roster boundary this file exists to enforce." It is filtered in **both** `toolsForScope()` and `invokeTool()`.

### Database handle
```ts
const path = process.env.AAC_DB ?? `${process.cwd()}/aac.db`
globalThis.__aacChatDb = new Db(path)
```
Stored on `globalThis.__aacChatDb` because "Next reloads modules on every edit in dev; without the global, each reload leaks a SQLite handle until the WAL reader count blocks the writer." The module-level `let cached: Db | undefined` is assigned in `db()` but never read anywhere — dead state.

### `ChatScope`
```ts
type ChatScope = {
  viewer: Viewer
  children: ChildSummary[]
  focusChildId?: string   // set when the panel is pinned to one child (the per-student Ask)
  classId?: string
}
```

### `ToolInvocation`
`{ name, args, ok, ms, resultJson, guidance: { level, code, detail }[], forbiddenActions: string[], rowCount }`

### `toolsForScope(scope)` — called once per turn, because the roster can change between turns
1. `ids` = `[focusChildId]` if set, otherwise every `children[].child_id`; `single = ids.length === 1`.
2. For each `[name, tool]` in `mcpTools`, skipping `EXCLUDED_FROM_CHAT`:
   - Deep-clone the schema (`JSON.parse(JSON.stringify(tool.schema))`).
   - For each of `SCOPED_PARAMS` present in `properties`:
     - `child_id` **and not single** (teacher) → replaced with `{ type: 'string', enum: ids, description: 'Which child. Only these ids exist for you; any other value is rejected.' }`
     - otherwise → `delete props[param]`
   - `required` is filtered to remove `class_id`, `adult_id`, and `child_id` when `single`.
3. Returns `ToolDef[]` (`name`, `description`, `parameters`).

Net effect, as documented in the header:

| Viewer | `child_id` in the schema the model sees |
|---|---|
| parent | removed entirely; the one rostered child is injected |
| teacher | an **enum** of that adult's roster ids, so a hallucinated or injected id fails validation before any query |

### `invokeTool(scope, name, modelArgs)` — never throws for a bad model argument
Errors are returned as the tool *result* so the model can correct itself on the next iteration; throwing would end the turn and lose the conversation. `fail(msg)` returns `{ ok: false, resultJson: JSON.stringify({ error: msg }), guidance: [], forbiddenActions: [], rowCount: 0 }`.

Order of operations:
1. Unknown name or `EXCLUDED_FROM_CHAT` → `fail("No tool named '<name>'.")`
2. Recompute `ids` from `focusChildId` / `children`.
3. Copy `modelArgs` (spread, no mutation) and inject against `tool.schema.properties`:
   - `child_id` present → `chosen = ids.length === 1 ? ids[0] : requested`. No `chosen` → `fail("This tool needs a child. Available: <ids>.")`. `chosen` not in `ids` → `fail("'<chosen>' is not one of your children. Available: <ids>.")` — described in-code as *belt and braces*: the enum already rejects this, but a schema change should not be able to open a hole.
   - `class_id` present → `scope.classId ?? children.find(c => c.class_id)?.class_id`; none → `fail('No class is associated with your account.')`
   - `adult_id` present → `scope.viewer.adult_id`
4. `validateArgs(tool.schema, args)` against the **full** schema, including the constraints Gemini never saw. Failure → `fail("Invalid arguments: <path>: <message>; …")`.
5. `tool.run(db(), validated.value)` → envelope. Success maps `envelope.guidance` to `{ level, code, detail }`, `envelope.forbidden_actions ?? []`, and `rowCount = Number(envelope.meta?.row_count ?? 0)`; `resultJson = JSON.stringify(envelope)`.
6. A thrown error from `tool.run` becomes `fail(err.message)` — still `ok: false`, still a normal tool result.

`ms` is `performance.now()` deltas, unrounded here (the agent rounds before emitting `tool_result`).

### `readCatalogueSummary()`
```sql
SELECT metric_id, name, unit, polarity, min_n, caveat
FROM metrics_catalog WHERE status = 'shown' ORDER BY group_code, metric_id
```
Formats each row as `` `${metric_id} (${unit}, ${polarity}, min_n=${min_n}): ${name}` ``. The doc comment says it is "used to seed the system prompt", but **nothing imports it** — `lib/chat/agent.ts` builds its prompt without it. Currently dead export.

## Dependencies & Connections

### Depends On
- [../mcp/tool-surface.md](../mcp/tool-surface.md) — `mcp/tools.ts` supplies every tool's `description`, `schema` and `run`, and the envelope (`guidance`, `forbidden_actions`, `meta.row_count`)
- [../mcp/argument-validation.md](../mcp/argument-validation.md) — `mcp/validate.ts` `validateArgs`, the single validation contract shared with the stdio server
- [../database/schema.md](../database/schema.md) — `mcp/db.ts` `Db`, the analytics DB at `AAC_DB` (default `<cwd>/aac.db`), and `metrics_catalog`
- [../auth/role-consent-scoping.md](../auth/role-consent-scoping.md) — `Viewer` and `ChildSummary` from `lib/access`

### Depended On By
- [ask-agent](ask-agent.md) — calls `toolsForScope()` once per turn and `invokeTool()` per model tool call
- [../api/ask-chat-endpoint.md](../api/ask-chat-endpoint.md) — `GET /api/chat` calls `toolsForScope()` with no model call and returns each tool's `properties.child_id`, so the scope boundary is inspectable rather than merely asserted

### Shared Resources
- `globalThis.__aacChatDb` — a process-wide `Db` handle over the analytics SQLite file
- `mcp/tools.ts` — the same tool registry the stdio MCP server serves to external clients
- `AAC_DB` env var — shared with the MCP server and the analytics readers

## Change Risks
- **Adding a tool to `mcp/tools.ts` with a new scoping parameter** (e.g. `school_id`) that is not in `SCOPED_PARAMS` leaves it model-controlled — a cross-roster read. Every new scoping key must be added here.
- **Adding a tool with unbounded read power** (another `query`-like escape hatch) must be added to `EXCLUDED_FROM_CHAT`, or the chat box gains SQL.
- **Removing the `ids.includes(chosen)` check** relies solely on the enum; a schema refactor that drops the enum would then open cross-child reads. The comment marks this as intentional redundancy.
- **Making `invokeTool` throw instead of returning `fail()`** ends the agent turn and loses the conversation — the model's self-correction loop depends on errors arriving as tool results.
- **Removing the `globalThis` cache** leaks a SQLite handle per dev hot-reload until the WAL reader count blocks the writer.
- **Changing `meta.row_count`** in the MCP envelope silently zeroes the `rowCount` shown next to every tool chip in the Ask panel.
- **Deleting `readCatalogueSummary()`** breaks nothing today, but it is the only place that reads `metrics_catalog` from the chat path.
