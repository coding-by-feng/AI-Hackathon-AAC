# Chat Provider Split (Vertex / Gemini / OpenAI / Anthropic / Local)

## Function
Five provider implementations behind one `ChatProvider` interface for the Ask agent — Vertex AI Gemini (ADC), Google AI Studio Gemini, OpenAI Chat Completions, Anthropic Messages, and a local OpenAI-compatible server (Gemma via Ollama, LM Studio, llama.cpp, vLLM, LiteLLM) — plus one shared SSE reader (`sseLines`), one shared Chat-Completions streaming loop (`openAIStyleStream`), and a JSON-Schema adapter that translates tool schemas into each provider's dialect.

## Purpose
Deliberately no vendor SDK. Every provider is a single POST with a JSON body; the header comment states the reasoning — an SDK would add a dependency, a version to track, and its own opinion about streaming, in exchange for saving about forty lines. The split exists so the agent loop never learns which vendor answered, and so keys stay server-side only: a key in a `NEXT_PUBLIC_` var is readable from devtools in seconds. Every provider runs inside the same scoped tool bridge and forbidden-action guard — switching models changes the writing, never the boundaries.

The `local` provider exists so a school can run Gemma on its own machine or network: no cloud, no key, no child's data leaving the building. It is not a fifth dialect — Ollama, LM Studio, llama.cpp's server, vLLM and LiteLLM all serve the OpenAI Chat-Completions wire format, so it is a base URL plus the shared streaming loop, not a second copy of `openai.ts`.

## Source Files
| File | Role |
|------|------|
| `lib/chat/provider.ts` | `ChatProvider` interface, `ChatMessage`/`ToolCall`/`ProviderChunk` types, `ProviderError`, `resolveProvider()`, `sseLines()`. `requireKey()` is retained for `lib/visuals/openai.ts` only — chat providers receive a resolved key from `chatConfig()` instead |
| `lib/chat/settings.ts` | `PROVIDERS` registry, `chatConfig()` (settings row → env → default resolution), `settingsStatus()`, `saveSettings()`, the `ai_settings` table in `aac_app.db` |
| `lib/chat/openai.ts` | `OpenAIProvider`, and the exported `openAIStyleStream()` — the shared streaming loop for any OpenAI-shaped endpoint |
| `lib/chat/gemini.ts` | `GeminiProvider` (AI Studio key), and the exported `toGeminiContents()` message mapper shared with `vertex.ts` |
| `lib/chat/vertex.ts` | `VertexChatProvider` — Gemini on Vertex via ADC bearer token; model-based endpoint routing and one-shot 404 fallback |
| `lib/chat/anthropic.ts` | `AnthropicProvider` — streaming Messages API with tool use |
| `lib/chat/local.ts` | `LocalProvider` + `completionsUrl()` — an OpenAI-compatible server at a configured base URL |
| `lib/chat/schema-adapter.ts` | `toOpenAITools()`, `toGeminiTools()`, JSON-Schema → Gemini subset; re-exports `validateArgs` |

## Implementation

### Provider registry (`PROVIDERS` in `lib/chat/settings.ts`)
| Id | Label (settings UI) | Auth | Key setting → env | Models offered | Default model |
|---|---|---|---|---|---|
| `vertex` | Google Vertex AI (gcloud ADC — no key needed) | `adc` | — | `gemini-3-flash-preview`, `gemini-3-pro-preview`, `gemini-2.5-flash` | `gemini-3-flash-preview` |
| `gemini` | Google AI Studio (API key) | `api_key` | `gemini_api_key` → `GEMINI_API_KEY` | same three Gemini models | `gemini-3-flash-preview` |
| `openai` | OpenAI (API key) | `api_key` | `openai_api_key` → `OPENAI_API_KEY` | `gpt-5.1`, `gpt-5.1-mini`, `gpt-4.1` | `gpt-5.1` |
| `anthropic` | Anthropic Claude (API key) | `api_key` | `anthropic_api_key` → `ANTHROPIC_API_KEY` | `claude-sonnet-5`, `claude-opus-5`, `claude-haiku-4-5-20251001` | `claude-sonnet-5` |
| `local` | Local model — Gemma on your own machine or network (no cloud) | `base_url` | `local_api_key` → `AAC_LOCAL_API_KEY` (optional) | `gemma3:4b`, `gemma3:12b`, `gemma3:27b`, `qwen3:8b`, `llama3.1:8b` | `gemma3:4b` |

`auth: 'base_url'` means a local server: an address instead of a cloud key. The key is optional there (most local servers want none; vLLM behind a proxy may want one).

### Environment variables
| Var | Effect |
|-----|--------|
| `CHAT_PROVIDER` | Consulted **only when there is no `chat_provider` settings row**. Allowed: `vertex` \| `gemini` \| `openai` \| `anthropic` \| `local`; an unknown value falls back **silently** to `vertex` (no error is thrown) |
| `CHAT_MODEL` | Applies only when the env-selected provider is the one actually running (and no settings row exists) — `"gpt-5.1"` must never be sent to Vertex |
| `OPENAI_API_KEY` / `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` / `AAC_LOCAL_API_KEY` | Fallback keys; a stored settings key wins over env per `chatConfig()` |
| `AAC_LOCAL_BASE_URL` | Fallback address for the local provider; the `local_base_url` settings row wins |
| `VERTEX_PROJECT` / `GOOGLE_CLOUD_PROJECT` | GCP project for the Vertex chat provider; missing → `ProviderError('GOOGLE_CLOUD_PROJECT is not set', 500)` |
| `VERTEX_LOCATION` / `GOOGLE_CLOUD_LOCATION` | Vertex region for non-`gemini-3*` models (default `us-central1`); ignored for `gemini-3*`, which always routes to `global` |
| `AAC_APP_DB` | Path to `aac_app.db`, where the `ai_settings` rows live (default `<cwd>/aac_app.db`) |

A cloud provider constructed without a key throws `ProviderError(…, 500)` with an actionable message, e.g. `"No OpenAI API key. Add one in Dashboard → Settings, or set OPENAI_API_KEY on the server."` — the Anthropic and Gemini variants name their own key, and the local variant asks for an address (`AAC_LOCAL_BASE_URL` / Dashboard → Settings) rather than a key.

### Endpoints called
- OpenAI: `POST https://api.openai.com/v1/chat/completions` (`ENDPOINT`), header `authorization: Bearer <key>`
- Gemini (AI Studio): `POST https://generativelanguage.googleapis.com/v1beta/models/<model>:streamGenerateContent?alt=sse&key=<key>` (`BASE`)
- Vertex: `POST https://<host>/v1/projects/<project>/locations/<loc>/publishers/google/models/<model>:streamGenerateContent?alt=sse`, header `authorization: Bearer <ADC token>`. For `gemini-3*` models `<loc>` is `global` and the host is `aiplatform.googleapis.com`; otherwise `<loc>-aiplatform.googleapis.com`
- Anthropic: `POST https://api.anthropic.com/v1/messages`, headers `x-api-key: <key>` and `anthropic-version: 2023-06-01`
- Local: `POST <completionsUrl(baseUrl)>` — the configured address normalised to its `/v1/chat/completions` endpoint

### Core types
```ts
type ProviderId = 'openai' | 'gemini' | 'vertex' | 'anthropic' | 'local'
type ToolDef    = { name: string; description: string; parameters: Record<string, unknown> } // JSON Schema
type ChatMessage =
  | { role: 'system';    content: string }
  | { role: 'user';      content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  | { role: 'tool';      toolCallId: string; name: string; content: string }
type ToolCall      = { id: string; name: string; args: Record<string, unknown>; thoughtSignature?: string }
type ProviderChunk =
  | { type: 'text'; delta: string }
  | { type: 'tool_calls'; calls: ToolCall[] }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
```
`ToolCall.thoughtSignature` exists because Gemini 3 attaches an opaque signature to each function call that **must** be echoed back with the call on the next turn, or the model loses its reasoning chain. Other providers leave it undefined.

`ProviderError extends Error` carries `status: number` and `retryable: boolean` (default `false`).

### `resolveProvider()`
Resolved **once per request**, not at module load — the settings page can switch provider, model, or key between questions with no restart. It calls `chatConfig()` (resolution order: `ai_settings` row in `aac_app.db` → env → default `vertex`), then dynamically `import()`s only the selected provider module and constructs it with `(cfg.model, cfg.apiKey)` — plus `cfg.baseUrl` for `local`; Vertex takes only the model, since ADC needs no key.

### Provider resolution & settings
`lib/chat/settings.ts` owns the `ai_settings` key/value table (`STRICT`, WAL, `busy_timeout = 5000`) behind its own `globalThis.__aacAiSettings` handle. Resolution order for every field is settings row → environment → default, so `.env.local` keeps working untouched and the settings page is an override, not a migration.

- **`chatConfig(): { provider, model, apiKey, baseUrl }`** — what the chat actually runs with. The settings form always writes provider and model together, so a stored model belongs to the stored provider; env `CHAT_MODEL` only applies when the env provider is the one running. `apiKey` is null for ADC and resolved settings-first for everything else (a local server may also carry a key); `baseUrl` is non-null only for `local`.
- **`settingsStatus()`** — for the settings page. **Keys are write-only**: it returns `{ configured, source: 'settings' | 'env' | null, last4 }` per key, never the key itself — there is no read path that returns a full key to a browser. `localBaseUrl` is returned in clear with its source, because an address is not a secret: showing it back lets a typo be seen and fixed.
- **`saveSettings(input, by)`** — partial updates from the form; an empty-string key deletes the stored row (falling back to env). Unknown providers are rejected loudly with the allowed list. The model is free text up to 100 chars *on purpose*: a newer model than this file knows about must be selectable without a code change — the provider 404s loudly if it is wrong. Keys are capped at 300 chars. `local_base_url` is validated on save (parseable URL, `http:`/`https:` only, ≤300 chars) rather than at question time — a teacher fixing a typo should be told now, not by a failed question three screens later.

The UI is `app/dashboard/settings/page.tsx` + `settings-form.tsx` over `GET`/`POST /api/dashboard/settings` (`app/api/dashboard/settings/route.ts`), gated to teacher/SLT/admin — a parent's account configures nothing shared.

### `requireKey(name)`
Throws `ProviderError` with status `500` and the message `"<NAME> is not set. The chat panel needs a key on the server; never put one in a NEXT_PUBLIC_ variable."` No chat provider calls it any more — they get their key from `chatConfig()` — but `lib/visuals/openai.ts` still imports it for image generation and embeddings.

### `sseLines(res)` — shared reader
Reads `res.body.getReader()`, decodes with `{ stream: true }`, splits on `'\n'` and **keeps the trailing partial line in the buffer** — the comment records why: splitting and parsing every piece drops the tail of any chunk that lands mid-line. Only lines starting `data:` are considered; payload `[DONE]` returns; `JSON.parse` failures are swallowed as keep-alive or partial frames. Used by all four cloud providers (`local` reaches it through `openAIStyleStream`).

### `openAIStyleStream(opts)` — shared Chat-Completions loop
Exported from `lib/chat/openai.ts` because it is not OpenAI-specific: one streaming turn against any OpenAI-shaped endpoint. Options: `{ endpoint, apiKey, model, messages, tools, signal, label, usageInStream }`.

- The `authorization: Bearer` header is included only when `apiKey` is non-null — local servers usually want no Authorization.
- `stream_options: { include_usage: true }` is sent only when `usageInStream` is true; only OpenAI honours it, and some local servers 400 on unknown fields.
- A `fetch` rejection (machine off, asleep, wrong network — the normal failure for a local model) becomes `ProviderError("<label> unreachable at <endpoint>: <message>", 503, retryable = true)` rather than a bare "fetch failed". `AbortError` is re-thrown untouched.
- Non-OK responses throw `ProviderError("<label> <status>: <body.slice(0,300)>", status, retryable = status === 429 || status >= 500)`.
- Tool-call fragments accumulate in a `Map<number, { id, name, args }>` keyed by `tc.index`; **a delta without an `index` falls back to slot 0** — some local servers omit it.

`OpenAIProvider.send()` is this loop with `endpoint = ENDPOINT`, `label = 'OpenAI'`, `usageInStream = true`.

### OpenAI specifics
Request body: `{ model, messages: messages.map(toOpenAIMessage), tools: tools.length ? toOpenAITools(tools) : undefined, tool_choice: tools.length ? 'auto' : undefined, stream: true }` plus `stream_options` when usage-in-stream is on.

Tool-call arguments arrive as **string fragments spread across many deltas**, so they are parsed only after the stream finishes — parsing early gets you a `SyntaxError` on `{"child_i`. On `JSON.parse` failure the call is **not dropped**; args become `{ __parse_error: slot.args.slice(0, 200) }`, because the agent validates args and hands the error back so the model retries. Missing ids fall back to `` `call_${slot.name}` ``. Calls are emitted sorted by index.

Usage comes from `evt.usage.prompt_tokens` / `evt.usage.completion_tokens` (each `?? 0`).

`toOpenAIMessage()` maps `tool` → `{ role: 'tool', tool_call_id, content }` and `assistant` → `{ role, content, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }`.

### Gemini specifics
Four documented differences the abstraction absorbs:
1. **No system role.** System messages are filtered out, joined with `'\n\n'`, and sent as `systemInstruction: { parts: [{ text }] }`; sending it as a turn makes the model answer it.
2. **Roles are `user` and `model`.** A tool *result* is a `user` turn containing a `functionResponse` part, not a distinct role.
3. **Function-call arguments arrive as a whole object in one part**, not as fragments — which is why there is no accumulator.
4. **`toGeminiContents()` echoes `thoughtSignature` per `functionCall` part and merges consecutive tool results into ONE user turn.** When the model made several calls in one turn, all their responses must share a single user turn — Gemini 400s if the `functionResponse` part count does not equal the `functionCall` part count of the preceding turn.

`toGeminiContents()` is exported and shared with `vertex.ts` — both speak the same content dialect. `gemini.ts`'s own `send()` never *captures* signatures (only Gemini 3 on Vertex emits them in this codebase); it only echoes back whatever a `ToolCall` already carries.

Non-OK throws `ProviderError("Gemini <status>: <body.slice(0,300)>", status, retryable = status === 429 || status >= 500)`.

Gemini assigns no call id, so one is synthesised as `` `gem_${seq++}_${part.functionCall.name}` `` — the agent needs an id to pair the result back. Usage comes from `evt.usageMetadata.promptTokenCount` / `candidatesTokenCount`.

`safeParse()` guarantees `functionResponse.response` is an object: a parsed non-object or array becomes `{ result: v }`, a parse failure becomes `{ result: text }`.

### Vertex specifics
The same wire dialect as `gemini.ts` (it imports `toGeminiContents` and `toGeminiTools`) with two differences: the endpoint lives under `aiplatform.googleapis.com`, and auth is an ADC bearer token instead of an API key. Its `id` is `'vertex'`, not `'gemini'` — presenting it as `gemini` downstream would lie about provenance in the agent's usage records.

- **Model routing.** `gemini-3*` models serve only from the **global** endpoint (regional endpoints 404); anything else uses `VERTEX_LOCATION`/`GOOGLE_CLOUD_LOCATION` (default `us-central1`).
- **ADC token.** `gcloud auth print-access-token` via `execFile` (15 s timeout), cached in a module variable for **45 minutes** — tokens last about an hour, and the margin exists so a long stream cannot start on a token that expires mid-flight.
- **One 404 retry.** A preview model that 404s is retried once against `gemini-2.5-flash` (`FALLBACK_MODEL`) — a model rollout change must degrade the Ask panel, never take it down. Only 404, and only when the model is not already the fallback; anything else is a real error (`Vertex <status>: <body.slice(0,300)>`).
- **Thought parts are skipped.** Gemini 3 streams reasoning summaries as `part.thought === true`; they are not answer text, and leaking them reads like the model talking to itself.
- **Ids and signatures.** Call ids are synthesised as `` `vtx_${seq++}_${name}` ``, and `part.thoughtSignature` is captured onto the `ToolCall` so `toGeminiContents` can echo it on the next turn.

### Anthropic specifics
- The system prompt is a top-level `system` field; `max_tokens: 2048` is set because the API requires it.
- **Consecutive user content merges into one turn.** The Messages API rejects two user messages in a row, and the agent produces exactly that at the step limit — tool results followed by an "answer now" nudge. `toAnthropicMessages()` therefore appends any user-role block (text or `tool_result`) to the previous message when that message is also `user`.
- Tool results are `{ type: 'tool_result', tool_use_id, content }` blocks inside a user message; assistant tool calls are `{ type: 'tool_use', id, name, input }` blocks. Ids are Anthropic's own `tool_use` ids, passed through unchanged.
- Tool-call arguments stream as `input_json_delta` fragments per content block, accumulated by `evt.index` and parsed at stream end with the same `{ __parse_error: … }` fallback as OpenAI.
- Usage arrives split: input tokens in `message_start`, output tokens in `message_delta` — two `usage` chunks per turn.
- Tools are sent as `{ name, description, input_schema: parameters }` — the JSON Schema passes through unchanged, no adapter dialect.

### Local specifics
Gemma (or any model) on this machine or another device on the internal network — no cloud, no key, no child's data leaving the building. Not a fifth dialect: the wire format is OpenAI's, so `LocalProvider.send()` is `openAIStyleStream` with `label: 'Local model'` and `usageInStream: false`.

- **`completionsUrl()`** accepts a host root (`http://192.168.1.42:11434`), a `/v1` root, or a full `/v1/chat/completions` URL — all three work, because every one of them is what somebody will actually paste. Non-http(s) or unparseable input throws `ProviderError(…, 400)`.
- The `Authorization` header is omitted unless a key is configured (Ollama rejects nothing; vLLM behind a proxy may want one).
- `stream_options` is not sent — several local servers 400 on the unknown field — so token counts simply read 0 rather than breaking the turn.
- `tool_calls` deltas without an `index` fall back to slot 0.
- A connection failure becomes `Local model unreachable at <endpoint>: <message>` (503, retryable) rather than a bare "fetch failed".
- Config: `local_base_url` settings row → `AAC_LOCAL_BASE_URL`; optional key `local_api_key` → `AAC_LOCAL_API_KEY`; default model `gemma3:4b`. The address is validated (http/https, parseable) on save, not at question time; a missing address throws at construction with the Dashboard → Settings pointer.
- **Tool calling is the requirement**, not chat — a model or server without function-calling support streams prose and cites no numbers. Gemma 3 and Qwen 3 served by a recent Ollama handle it; older builds do not.

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
- `toOpenAITools()` passes `parameters` through unchanged — used by both the OpenAI and local paths; Anthropic sends `parameters` directly as `input_schema`; `toGeminiTools()` serves both `gemini` and `vertex`.
- **Stripping a constraint does not mean abandoning it** — `validateArgs` re-checks every one of them server-side before a tool runs. No provider guarantees schema compliance anyway; Gemini just makes that check load-bearing.
- The file re-exports `validateArgs` and `ValidationError` from `../../mcp/validate.ts` so the stdio server and the chat path enforce one contract: "a tool that is strict in one entry point and lax in the other is worse than a tool with no validation at all."

## Dependencies & Connections

### Depends On
- [../mcp/argument-validation.md](../mcp/argument-validation.md) — `mcp/validate.ts` provides `validateArgs`, re-exported here
- [../mcp/tool-surface.md](../mcp/tool-surface.md) — the JSON Schemas being translated originate in `mcp/tools.ts`
- `gcloud` CLI on `PATH` — the Vertex chat provider shells out to `gcloud auth print-access-token`

### Depended On By
- [ask-agent](ask-agent.md) — calls `resolveProvider()` and iterates `provider.send()`
- [scoped-tool-bridge](scoped-tool-bridge.md) — emits `ToolDef[]` in this file's shape
- [image-providers](image-providers.md) — `lib/visuals/openai.ts` imports `requireKey` from `lib/chat/provider.ts`
- [../api/ask-chat-endpoint.md](../api/ask-chat-endpoint.md) — `GET /api/chat` reports `chatConfig().provider` and `model`, so the introspection endpoint cannot disagree with the provider that actually answers
- `app/dashboard/settings/` + `app/api/dashboard/settings/route.ts` — the settings surface over `settingsStatus()` / `saveSettings()`

### Shared Resources
- `OPENAI_API_KEY` — shared with `lib/visuals/openai.ts` for image generation and embeddings
- `sseLines()` — used by the four cloud chat providers; the visuals providers are non-streaming and do not use it
- `aac_app.db` — `ai_settings` lives beside the generated-visuals cache (see [visual-cache](visual-cache.md)), behind its own `globalThis.__aacAiSettings` handle
- ADC via `gcloud` — the chat Vertex client and `lib/visuals/vertex.ts` each keep their **own independent** `accessToken()` cache; two shell-outs, no sharing

## Change Risks
- **Adding a JSON-Schema keyword to `mcp/tools.ts`** that is not in `GEMINI_ALLOWED` silently disappears from what Gemini and Vertex see. It is still enforced by `validateArgs`, so the failure mode is a model that keeps sending invalid args and burning steps, not a security hole.
- **Removing the fragment accumulator in `openAIStyleStream`** (or parsing per-delta) reintroduces `SyntaxError` on truncated argument JSON, which the code specifically guards against — and now breaks OpenAI and local at once. The Anthropic accumulator is a separate copy in `anthropic.ts`.
- **Dropping the `__parse_error` fallback** would drop the tool call entirely, ending the step with no result message and desynchronising the provider's required call/result pairing.
- **Changing `sseLines()` buffering** breaks every streaming provider at once — it is the only stream reader.
- **Switching provider (settings row or `CHAT_PROVIDER`)** changes tool-call id shapes — OpenAI-issued ids, synthesised `gem_*` / `vtx_*`, Anthropic `tool_use` ids, or the `call_<name>` fallback when a local server sends none — and the Gemini-dialect providers route every tool schema through `geminiSchema()`, so any tool relying on `minimum`/`maxItems` for model guidance loses that hint there.
- **Dropping a `thoughtSignature`** (e.g. by rebuilding `ToolCall`s in the agent) breaks Gemini 3 on Vertex mid-conversation — the model loses its reasoning chain on the turn after a tool call.
- **Adding a sixth provider** requires a `PROVIDERS` registry entry, a `KEY_SETTINGS` entry if it has a key, a branch in `resolveProvider()`, and possibly a dialect in `schema-adapter.ts`; the agent loop itself needs no change.
