# Chat Provider Split (OpenAI / Gemini)

## Function
A two-provider abstraction for the Ask agent: one `ChatProvider` interface, one shared SSE reader, and two implementations — OpenAI Chat Completions and Google Gemini `streamGenerateContent` — plus a JSON-Schema adapter that translates tool schemas into each provider's dialect.

## Purpose
Deliberately no vendor SDK. Both providers are a single POST with a JSON body; the header comment states the reasoning — an SDK would add a dependency, a version to track, and its own opinion about streaming, in exchange for saving about forty lines. The split exists so the agent loop never learns which vendor answered, and so keys stay server-side only: a key in a `NEXT_PUBLIC_` var is readable from devtools in seconds.

## Source Files
| File | Role |
|------|------|
| `lib/chat/provider.ts` | `ChatProvider` interface, `ChatMessage`/`ToolCall`/`ProviderChunk` types, `ProviderError`, `resolveProvider()`, `requireKey()`, `sseLines()` |
| `lib/chat/openai.ts` | `OpenAIProvider` — streaming Chat Completions with tool calling |
| `lib/chat/gemini.ts` | `GeminiProvider` — streaming `generateContent` with function calling |
| `lib/chat/schema-adapter.ts` | `toOpenAITools()`, `toGeminiTools()`, JSON-Schema → Gemini subset; re-exports `validateArgs` |

## Implementation

### Environment variables
| Var | Default | Effect |
|-----|---------|--------|
| `CHAT_PROVIDER` | `'openai'` | `openai` \| `gemini`; anything else throws `ProviderError(…, 500)` |
| `CHAT_MODEL` | `'gpt-5.1'` (OpenAI) / `'gemini-2.5-pro'` (Gemini) | Model id, per provider constructor default |
| `OPENAI_API_KEY` | — | Required by `OpenAIProvider` via `requireKey()` |
| `GEMINI_API_KEY` | — | Required by `GeminiProvider` via `requireKey()` |

### Endpoints called
- OpenAI: `POST https://api.openai.com/v1/chat/completions` (`ENDPOINT`), header `authorization: Bearer <OPENAI_API_KEY>`
- Gemini: `POST https://generativelanguage.googleapis.com/v1beta/models/<model>:streamGenerateContent?alt=sse&key=<GEMINI_API_KEY>` (`BASE`)

### Core types
```ts
type ProviderId = 'openai' | 'gemini'
type ToolDef    = { name: string; description: string; parameters: Record<string, unknown> } // JSON Schema
type ChatMessage =
  | { role: 'system';    content: string }
  | { role: 'user';      content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  | { role: 'tool';      toolCallId: string; name: string; content: string }
type ToolCall      = { id: string; name: string; args: Record<string, unknown> }
type ProviderChunk =
  | { type: 'text'; delta: string }
  | { type: 'tool_calls'; calls: ToolCall[] }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
```
`ProviderError extends Error` carries `status: number` and `retryable: boolean` (default `false`).

### `resolveProvider()`
Resolved **once per request**, not at module load, "so changing the env var in development does not require a restart". Uses dynamic `import()` so only the selected provider module is loaded.

### `requireKey(name)`
Throws `ProviderError` with status `500` and the message `"<NAME> is not set. The chat panel needs a key on the server; never put one in a NEXT_PUBLIC_ variable."`

### `sseLines(res)` — shared reader
Reads `res.body.getReader()`, decodes with `{ stream: true }`, splits on `'\n'` and **keeps the trailing partial line in the buffer** — the comment records why: splitting and parsing every piece drops the tail of any chunk that lands mid-line. Only lines starting `data:` are considered; payload `[DONE]` returns; `JSON.parse` failures are swallowed as keep-alive or partial frames.

### OpenAI specifics
Request body: `{ model, messages: messages.map(toOpenAIMessage), tools: tools.length ? toOpenAITools(tools) : undefined, tool_choice: tools.length ? 'auto' : undefined, stream: true, stream_options: { include_usage: true } }`.

Non-OK response throws `ProviderError("OpenAI <status>: <body.slice(0,300)>", status, retryable = status === 429 || status >= 500)`.

Tool-call arguments arrive as **string fragments spread across many deltas**, so they are accumulated in a `Map<number, { id, name, args }>` keyed by `tc.index` and parsed only after the stream finishes — parsing early gets you a `SyntaxError` on `{"child_i`. On `JSON.parse` failure the call is **not dropped**; args become `{ __parse_error: slot.args.slice(0, 200) }`, because the agent validates args and hands the error back so the model retries. Missing ids fall back to `` `call_${slot.name}` ``. Calls are emitted sorted by index.

Usage comes from `evt.usage.prompt_tokens` / `evt.usage.completion_tokens` (each `?? 0`).

`toOpenAIMessage()` maps `tool` → `{ role: 'tool', tool_call_id, content }` and `assistant` → `{ role, content, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }`.

### Gemini specifics
Three documented differences the abstraction absorbs:
1. **No system role.** System messages are filtered out, joined with `'\n\n'`, and sent as `systemInstruction: { parts: [{ text }] }`; sending it as a turn makes the model answer it.
2. **Roles are `user` and `model`.** A tool *result* is a `user` turn containing a `functionResponse` part, not a distinct role.
3. **Function-call arguments arrive as a whole object in one part**, not as fragments — which is why there is no accumulator.

Non-OK throws `ProviderError("Gemini <status>: <body.slice(0,300)>", status, retryable = status === 429 || status >= 500)`.

Gemini assigns no call id, so one is synthesised as `` `gem_${seq++}_${part.functionCall.name}` `` — the agent needs an id to pair the result back. Usage comes from `evt.usageMetadata.promptTokenCount` / `candidatesTokenCount`.

`safeParse()` guarantees `functionResponse.response` is an object: a parsed non-object or array becomes `{ result: v }`, a parse failure becomes `{ result: text }`.

### Schema adapter
Our tool schemas in `mcp/tools.ts` use keywords Gemini rejects outright, so a pass-through adapter fails on the first call. The table from the header comment:

| keyword | OpenAI | Gemini |
|---|---|---|
| `enum` (string) | ok | ok |
| `minimum`/`maximum` | ok | rejected |
| `maxItems`/`minItems` | ok | rejected |
| `additionalProperties` | ok | rejected |
| missing `type` | tolerated | rejected |

- `GEMINI_ALLOWED = { 'type', 'description', 'properties', 'required', 'items', 'enum', 'nullable', 'format' }` — everything else is dropped from what the model sees.
- `GEMINI_TYPES = { 'string', 'number', 'integer', 'boolean', 'array', 'object' }`.
- `geminiSchema()` recurses through `properties` and `items`; a node with no `type` is defaulted to `'object'` if it has `properties`, else `'string'`; an unrecognised `type` is coerced to `'string'`. The comment: ours all have a type, but a future tool author will forget, and a 400 from the API is a much worse place to discover it.
- `toOpenAITools()` passes `parameters` through unchanged.
- **Stripping a constraint does not mean abandoning it** — `validateArgs` re-checks every one of them server-side before a tool runs. Neither provider guarantees schema compliance anyway; Gemini just makes that check load-bearing.
- The file re-exports `validateArgs` and `ValidationError` from `../../mcp/validate.ts` so the stdio server and the chat path enforce one contract: "a tool that is strict in one entry point and lax in the other is worse than a tool with no validation at all."

## Dependencies & Connections

### Depends On
- [../mcp/argument-validation.md](../mcp/argument-validation.md) — `mcp/validate.ts` provides `validateArgs`, re-exported here
- [../mcp/tool-surface.md](../mcp/tool-surface.md) — the JSON Schemas being translated originate in `mcp/tools.ts`

### Depended On By
- [ask-agent](ask-agent.md) — calls `resolveProvider()` and iterates `provider.send()`
- [scoped-tool-bridge](scoped-tool-bridge.md) — emits `ToolDef[]` in this file's shape
- [image-providers](image-providers.md) — `lib/visuals/openai.ts` imports `requireKey` from `lib/chat/provider.ts`
- [../api/ask-chat-endpoint.md](../api/ask-chat-endpoint.md) — `GET /api/chat` reports `process.env.CHAT_PROVIDER ?? 'openai'` as `provider`

### Shared Resources
- `OPENAI_API_KEY` — shared with `lib/visuals/openai.ts` for image generation and embeddings
- `sseLines()` — used by both chat providers; the visuals providers are non-streaming and do not use it

## Change Risks
- **Adding a JSON-Schema keyword to `mcp/tools.ts`** that is not in `GEMINI_ALLOWED` silently disappears from what Gemini sees. It is still enforced by `validateArgs`, so the failure mode is a model that keeps sending invalid args and burning steps, not a security hole.
- **Removing the OpenAI fragment accumulator** (or parsing per-delta) reintroduces `SyntaxError` on truncated argument JSON, which the code specifically guards against.
- **Dropping the `__parse_error` fallback** would drop the tool call entirely, ending the step with no result message and desynchronising OpenAI's required `tool_call_id` pairing.
- **Changing `sseLines()` buffering** breaks both providers at once — it is the only stream reader.
- **Switching `CHAT_PROVIDER` to `gemini`** changes tool-call ids from OpenAI-issued to synthesised `gem_*`, and routes every tool schema through `geminiSchema()`; any tool relying on `minimum`/`maxItems` for model guidance loses that hint.
- **Adding a third provider** requires implementing `ChatProvider`, a branch in `resolveProvider()`, and a dialect in `schema-adapter.ts`; the agent loop itself needs no change.
