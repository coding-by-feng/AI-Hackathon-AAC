# Tool Argument Validation

## Function
`validateArgs(schema, args)` checks a tool call's arguments against that tool's JSON Schema before the tool runs, rejecting unknown parameters with a near-miss suggestion, coercing types, clamping numbers into range, and returning a new object containing only known keys.

## Purpose
The file header names the exact failure this was written for:

> `get_metrics(group_by: "scene")` and `get_metric_timeseries(granularity: "week")` were both accepted and silently dropped. The caller asked for a breakdown, got one blended number, and had no way to know. **A model does not retry an answer it believes it got.**
>
> So: an argument the schema does not describe is an ERROR, never a shrug.

The second reason it is a separate module rather than inline in `mcp/server.ts`: it is shared by the stdio server and the in-process chat path, "so both enforce the same contract — a tool cannot be strict in one entry point and lax in the other."

The near-miss suggestion is not cosmetic either. The comment on the unknown-key loop: *"Naming the near-miss matters: a model that gets `unknown parameter 'groupby'` and a list of real ones self-corrects in one retry; `invalid arguments` makes it guess again."*

## Source Files
| File | Role |
|------|------|
| `mcp/validate.ts` | `validateArgs`, the `Schema` / `ValidationError` / `ValidationResult` types, and the private `nearest` / `distance` helpers |

## Implementation

### Types

```ts
export type Schema = Record<string, any>
export type ValidationError = { path: string; message: string }
export type ValidationResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; errors: ValidationError[] }
```

`validateArgs` reads `schema.properties` (default `{}`) and `schema.required` (default `[]`). Errors accumulate across all three passes; the function returns `{ ok: false, errors }` only at the end, so a caller sees every problem at once.

### Pass 1 — unknown keys

For every key in `args` not present in `properties`:

```
unknown parameter '<key>'. Did you mean '<hint>'?      // when nearest() returns a hint
unknown parameter '<key>'. Accepted: <known keys, comma-separated>   // otherwise
unknown parameter '<key>'. Accepted: none              // when the schema has no properties
```

### Pass 2 — required keys

For every entry in `schema.required`, `args[key] === undefined || args[key] === null` produces `missing required parameter '<key>'`. **A `null` counts as missing**, not as a supplied value.

### Pass 3 — per-property type handling

Iterates `Object.entries(properties)`. `undefined` and `null` values are skipped (not copied into the output). Behaviour by `spec.type`:

| `type` | Behaviour |
|---|---|
| `integer` / `number` | Strings are coerced with `Number(v)`. Non-number or `NaN` → `expected a number, got <json>`. For `integer`, a non-integer → `expected a whole number, got <n>`. Then **clamped**: `Math.max(v, spec.minimum)` and `Math.min(v, spec.maximum)` |
| `boolean` | A string is mapped `v === 'true'` (so `"false"`, `"1"`, `"yes"` all become `false`). A non-boolean afterwards → `expected true or false, got <json>` |
| `array` | Non-array → `expected an array, got <json>`. Over `spec.maxItems` → **truncated** with `slice(0, maxItems)`, no error. If `spec.items.enum` exists, disallowed entries → `<json array of bad values> not allowed. Allowed: <enum joined by ", ">` |
| `object` | Non-object or an array → `expected an object, got <json>`. When `spec.properties` exists it **recurses**, and nested errors are re-pathed as `<key>.<nested path>` |
| anything else (i.e. `string`) | Non-strings are coerced with `String(v)`. If `spec.enum` exists and the value is not in it → `'<v>' is not allowed. Allowed: <enum joined by ", ">` |

Two design choices are called out in comments:

- **Clamp rather than reject.** *"A caller asking for `limit=500` against a max of 100 means 'as much as you can'; failing that call helps nobody."* So `get_card_stats({ limit: 500 })` succeeds with `limit = 100`.
- **Objects recurse rather than stringify.** *"Nested objects (`compare_windows`' `window_a`/`window_b`) pass through and recurse. An earlier version fell into the string branch below and stringified them to `[object Object]`, which SQLite then refused to bind."*

The returned `value` is a **new object** built key-by-key from `properties` — coerced, clamped and truncated. Unknown keys never reach the tool even in the theoretical case where validation passes.

### `nearest(input, options)`

Lowercases both sides and strips `[_-]`, then takes the minimum Levenshtein distance across `options`. A hint is returned only when:

```ts
bestScore <= Math.max(2, Math.floor(a.length / 3))
```

*"Only suggest when it is plausibly a typo rather than a different word."* So `groupby` → `group_by` (distance 0 after stripping), but `scene` against `{child_id, window, …}` returns `null` and the caller gets the full accepted list instead.

`distance(a, b)` is an iterative single-row Levenshtein — no dependency, O(|a|·|b|) time and O(|b|) space.

### Where it runs

- `mcp/server.ts`, in the `tools/call` branch, **before** `tool.run`. Failure becomes `McpError('INVALID_ARGUMENTS', errors.map(e => \`${e.path}: ${e.message}\`).join('; '), true)` — retryable, so a client knows a corrected retry is worth attempting.
- `lib/chat/tools.ts` imports `validateArgs` directly; `lib/chat/schema-adapter.ts` re-exports it (`export { validateArgs, type ValidationError } from '../../mcp/validate.ts'`) with the comment *"Validation lives in `mcp/validate.ts` so the stdio server and the chat path enforce the same contract."*

In the chat path this is also a **security boundary**, not just a usability one: for a teacher viewer, `child_id` is rewritten into an enum of that adult's roster ids, so a hallucinated or injected child id fails validation before any query runs.

### Known consequence: dead parameters

Because unknown keys are a hard error, any parameter a tool's `run()` reads but its `schema` does not declare is unreachable. In `mcp/tools.ts`, `get_utterances` reads `a.window ?? 'last_7d'` while its schema declares only `child_id`, `limit` and `filter` — so `get_utterances({ window: 'last_28d' })` fails with `window: unknown parameter 'window'. Did you mean …?` and the window is always `last_7d`.

`app/api/mcp/route.ts` does **not** call `validateArgs` — the HTTP transport passes `params.arguments` straight to `tool.run`, so the two transports do not enforce the same contract despite sharing the tool implementations.

## Dependencies & Connections

### Depends On
- Nothing. No imports, no runtime dependencies. It reads plain JSON-Schema-shaped objects.

### Depended On By
- [MCP stdio server](stdio-server.md) — gates every `tools/call`.
- [Tool surface](tool-surface.md) — the `schema` field on each tool definition is the contract this enforces; the tools themselves assume their args are already coerced and clamped.
- [Dashboard chat tools](../ai/scoped-tool-bridge.md) — `lib/chat/tools.ts` and `lib/chat/schema-adapter.ts`, where it doubles as the roster-scoping enforcement point.

### Shared Resources
- The tool `schema` objects in `mcp/tools.ts` are the shared contract. `lib/chat/schema-adapter.ts` rewrites those same schemas for Gemini's stricter JSON-Schema subset before the model sees them, but validates against the original.

## Change Risks
- **Reverting to "drop unknown keys silently"** restores the original bug: a caller asks for `group_by: "scene"`, gets one blended number, and has no way to know its request was ignored.
- **Rejecting instead of clamping out-of-range numbers** turns every `limit: 500` into a failed call. `mcp/tools.ts` additionally re-clamps with `Math.min(a.limit ?? d, max)`, so the caps hold either way, but the error surface would change for existing clients.
- **Removing the `object` branch** sends `compare_windows`' `window_a`/`window_b` into the string branch and stringifies them to `"[object Object]"`, which SQLite refuses to bind — the exact regression the comment records.
- **Loosening the `nearest` threshold** starts suggesting unrelated parameter names, which sends a model down a wrong retry instead of showing it the accepted list.
- **Adding validation of `additionalProperties`, `oneOf`, `$ref` or nested array item objects** is not supported today; a schema using them would validate more loosely than it reads.
- **Adding a parameter to a tool's `run()` without adding it to that tool's `schema`** makes the parameter permanently unreachable over stdio while silently working over HTTP (which skips validation) — a divergence that is easy to miss.
- **Changing the error message format** breaks nothing programmatically but degrades the one-retry self-correction behaviour the module exists to produce.
