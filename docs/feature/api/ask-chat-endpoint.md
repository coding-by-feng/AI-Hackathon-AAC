# Ask Chat Endpoint

## Function
`POST /api/chat` streams the Ask panel's answer as Server-Sent Events while the agent calls MCP
tools; `GET /api/chat` returns, without calling any model, exactly what the assistant can see
for the current viewer.

## Purpose
This route is the scope boundary for the dashboard's natural-language panel. Scope is resolved
**here, from the session — never from the request body**. The client may name a child to focus
on, but that name is checked against the roster before it becomes scope: a body is user input,
and this one decides whose communication history gets read.

`GET` exists so that boundary is *inspectable* rather than merely asserted. You can see for
yourself that `child_id` is absent from every tool when the panel is focused on one child, and
constrained to an enum of the roster when it is not.

Node runtime, not Edge, because `node:sqlite` needs a filesystem — the same constraint
`TECH_STACK.md` pins for the whole dashboard backend.

## Source Files
| File | Role |
|------|------|
| `app/api/chat/route.ts` | Body validation, scope resolution from the session, the SSE stream, and the read-only scope-introspection GET |

## Implementation

### Route configuration

```ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_MESSAGE = 2000   // characters
const MAX_HISTORY = 12     // turns, taken from the END of the array (.slice(-12))
```

### `POST /api/chat`

Body: `{ message?: unknown, childId?: unknown, history?: unknown }` — every field is typed
`unknown` and narrowed by hand.

| Condition | Status | Response |
|---|---|---|
| body is not JSON | 400 | `{ "error": "Body must be JSON." }` |
| `message` not a non-empty string after `.trim()` | 400 | `{ "error": "A question is required." }` |
| `message.length > 2000` | 400 | `{ "error": "Questions are limited to 2000 characters." }` |
| `visibleChildren(viewer)` is empty | 403 | `{ "error": "No children are shared with your account." }` |
| an error whose message starts with `NOT_AUTHORISED` | 403 | `{ "error": "<message>" }` |
| any other error during scope resolution | 500 | `{ "error": "<message>" }` |
| ok | 200 | `text/event-stream` |

Errors are plain JSON with `content-type: application/json`; only the success path streams.

### Scope resolution, in order

1. `viewer = await currentViewer()` — from the signed `aac_adult` cookie.
2. `children = visibleChildren(viewer)` — active roster rows only.
3. Focus:
   - if `body.childId` is a non-empty string → `requireChild(viewer, body.childId).child_id`,
     which **throws** `NOT_AUTHORISED: …` when the child is not on the roster;
   - else if `children.length === 1` → that child (a parent has exactly one child, so the panel
     is always focused whether or not the client said so);
   - else `undefined` (a teacher browsing the whole class).
4. `classId = children.find((c) => c.class_id)?.class_id ?? undefined`.

The resulting `ChatScope` (`{ viewer, children, focusChildId, classId }`) is what
`toolsForScope()` turns into a tool list: when a single child is in scope the `child_id`,
`class_id` and `adult_id` parameters are **deleted from the schema**; otherwise `child_id`
becomes an `enum` of the roster ids. The `query` escape hatch is in `EXCLUDED_FROM_CHAT` and is
never offered here.

### History filter

```ts
Array.isArray(body.history)
  ? body.history.filter(h => h && typeof h === 'object'
        && (h.role === 'user' || h.role === 'assistant')
        && typeof h.content === 'string').slice(-12)
  : []
```

Anything else — a `system` role, a non-string content, a non-array — is dropped silently. The
user's current message is appended after the filtered history.

### The SSE stream

A `ReadableStream<Uint8Array>` writes one line per event:

```
data: {"type":"tool_call","name":"get_metrics","args":{…}}\n\n
…
data: [DONE]\n\n
```

Response headers:

| Header | Value | Why |
|---|---|---|
| `content-type` | `text/event-stream; charset=utf-8` | |
| `cache-control` | `no-cache, no-transform` | |
| `connection` | `keep-alive` | |
| `x-accel-buffering` | `no` | Nginx buffers SSE by default and the panel appears frozen until the whole answer lands |

`req.signal` is forwarded to `runAgent`, so closing the panel aborts the model call. Any error
thrown by the agent is emitted as a final `{ type: 'error', message, retryable: false }` event
rather than a status code — the response has already started. `data: [DONE]` is written in a
`finally`, so it arrives on both the success and the error path.

### `AgentEvent` types on the wire (from `lib/chat/agent.ts`)

| `type` | Payload |
|---|---|
| `tool_call` | `{ name, args }` |
| `tool_result` | `{ name, ok, ms, rowCount }` |
| `notice` | `{ level, code, detail }` — the computed guidance codes from the MCP envelope |
| `text` | `{ delta }` |
| `forbidden` | `{ label }` — a recommendation blocked by `forbidden_actions` |
| `regenerated` | `{ reason }` |
| `done` | `{ ms, steps, inputTokens, outputTokens }` |
| `error` | `{ message, retryable }` |

`components/chat/ask-panel.tsx` reads the stream with `res.body.getReader()`, splits on `\n`,
ignores anything not starting with `data:`, skips `[DONE]`, and buffers `text` deltas into a
`requestAnimationFrame` flush.

### `GET /api/chat` — scope introspection

No model call, no arguments. 200:

```jsonc
{
  "viewer":   { "adult_id": "...", "display_name": "...", "role": "teacher|parent|slt|admin" },
  "provider": process.env.CHAT_PROVIDER ?? "openai",
  "children": [ { "child_id": "...", "display_name": "..." } ],
  "focused":  "<child_id>" | null,
  "tools":    [ { "name": "get_metrics", "child_id": <the scoped schema fragment> | null } ]
}
```

`focused` here is computed only from `children.length === 1` — the GET takes no `childId`
parameter, so the per-student pinned case is not reflected. Any thrown error returns **500**,
including `NOT_SIGNED_IN` (the POST maps `NOT_AUTHORISED` to 403; the GET does not).

### Routing

`/api/chat` is in `DASH_PREFIXES` in `middleware.ts` and **not** in `PUBLIC_DASH`, so on the
`aac-dashboard.*` hostname it requires the `aac_adult` cookie to be present; the signature is
verified inside `currentViewer()`.

## Dependencies & Connections

### Depends On
- [Access scoping](../auth/role-consent-scoping.md) — `currentViewer`, `visibleChildren`,
  `requireChild`; the `NOT_AUTHORISED:` prefix this route pattern-matches on comes from there.
- [Chat agent](../ai/ask-agent.md) — `runAgent`, `MAX_STEPS = 6`, the inlined clinical rules and
  the `AgentEvent` stream.
- [Chat tool scoping](../ai/scoped-tool-bridge.md) — `toolsForScope`, `SCOPED_PARAMS`
  (`child_id`, `class_id`, `adult_id`), `EXCLUDED_FROM_CHAT` (`query`).
- [MCP tool surface](../mcp/tool-surface.md) — the chat tools are the MCP tools with their
  scoped parameters rewritten.
- [Host routing middleware](../auth/host-surface-routing.md) — hostname and session gating.

### Depended On By
- [Ask panel](../dashboard/ask-panel.md) — `components/chat/ask-panel.tsx` is the only client.
- [Per-student Ask page](../dashboard/ask-panel.md) — `app/dashboard/student/[id]/ask/page.tsx`
  resolves scope server-side and passes `childId`, which this route re-checks.

### Shared Resources
- The `aac_adult` cookie and the `roster` / `consent` tables behind `visibleChildren`.
- The cached read-only `Db` handle (`globalThis.__aacChatDb`) over `aac.db`.
- Environment: `CHAT_PROVIDER` (reported by GET, defaulting to `openai`), `AAC_DB`.

## Change Risks
- **Taking `childId` as scope without `requireChild`** is the single failure this route is
  designed against: it would let any signed-in adult read any child's communication history.
  The check must stay in the route, not in the page that renders the panel.
- **Adding `query` back to the chat tool list** re-opens free-form SQL from a chat box, which
  crosses every roster boundary `lib/chat/tools.ts` exists to enforce.
- **Dropping `x-accel-buffering: no`** makes the panel appear frozen behind Nginx or the
  Cloudflare tunnel until the whole answer lands — the stream still works, so the regression
  looks like a slow model rather than a header problem.
- **Changing the `data: [DONE]` sentinel or the `data: ` prefix** breaks `ask-panel.tsx`'s
  parser, which hardcodes both.
- **Raising `MAX_HISTORY` or `MAX_MESSAGE`** grows the per-turn context; `TECH_STACK.md` budgets
  the tool definitions alone at 1,149 tokens per request.
- **Returning a non-200 after the stream has begun** is impossible — anything failing inside
  `runAgent` must surface as an `error` event, or the panel silently ends the turn.
