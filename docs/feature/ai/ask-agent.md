# Ask Agent Loop

## Function
`runAgent()` drives the question → model → tool calls → results → answer loop for the Ask panel, bounded at `MAX_STEPS = 8`, streaming typed `AgentEvent`s as it goes. It also builds the system prompt, including the condensed clinical rules that must be in context on every turn.

## Purpose
A teacher will not act on an unattributed claim about a child, and should not be asked to. Instead of a spinner, the loop emits an event for every tool call, every tool result, every piece of server-computed `guidance`, and every regeneration — so the adult sees which numbers were retrieved and from where. The clinical rules are inlined rather than fetched as an MCP resource because they must be in context for *every single turn*, and the header comment states the trade plainly: 3,600 tokens per question to say the same eight things is not a good trade.

## Source Files
| File | Role |
|------|------|
| `lib/chat/agent.ts` | The agent loop, `AgentEvent` union, `CLINICAL_RULES`, `systemPrompt()` |
| `lib/chat/settings.ts` | `chatConfig()` — picks the provider and model the loop runs on (via `resolveProvider()`) |

## Implementation

### Constants
| Name | Value | Meaning |
|------|-------|---------|
| `MAX_STEPS` | `8` | Maximum model turns in one question — matches what an MCP-connected desktop agent gets in practice: enough iterations to explore, compare windows, and self-correct a rejected argument without hitting the ceiling on honest multi-part questions |

### `AgentEvent` union (yielded, one per SSE frame by `/api/chat`)
| Event | Fields |
|-------|--------|
| `tool_call` | `name`, `args: Record<string, unknown>` |
| `tool_result` | `name`, `ok: boolean`, `ms` (rounded), `rowCount` |
| `notice` | `level`, `code`, `detail` — one per unique server `guidance` entry |
| `text` | `delta` |
| `forbidden` | `label` — the `Cannot recommend: …` string |
| `regenerated` | `reason` |
| `done` | `ms`, `steps`, `inputTokens`, `outputTokens` |
| `error` | `message`, `retryable` |

### `CLINICAL_RULES`
An eight-point block condensed from [`docs/aac-clinical-constraints.md`](../../aac-clinical-constraints.md), inlined as a template literal and `.trim()`ed. Verbatim headings, in order:

1. `REPETITION IS COMMUNICATION, NOT ERROR` (four normal causes; high repetition where vocabulary is thin is a MISSING WORD) — C1
2. `NEVER MOVE OR RESIZE` (to surface a buried word, ADD A COPY; to simplify a page, MASK neighbours) — C2/C3
3. `A REFUSAL IS SUCCESSFUL COMMUNICATION`
4. `CORE WORDS ARE NEVER DEAD WEIGHT` (only fringe vocabulary is ever a replacement candidate) — C5
5. `SLOW MAY BE THE ADULT` (AAC output runs about 15 words per minute; check partner wait time) — C7
6. `MODEL WITHOUT EXPECTATION`
7. `MOST FINDINGS POINT AT AN ADULT` (I8 points at us)
8. `NEVER SAY A CHILD REGRESSED` when a layout change or an absence explains the numbers

Followed by a `READING THE DATA` block, which encodes the envelope contract:
- null with `n>0` means below `min_n` — measured, too few to report, **not zero**
- null with `n=0` means never measured
- `direction "not_applicable"` means neutral — never good or bad
- read the `guidance` array in every tool result **before** the numbers
- thresholds are given, not applied; a rule that fired just over its line deserves hedging

### `systemPrompt(scope: ChatScope)`
Assembled in this order: role statement → `TODAY` block → register block → `SCOPE.` line → `CLINICAL_RULES` → `HOW TO ANSWER`.

The **`TODAY`** block states `TODAY is <date>` using `new Date().toLocaleDateString('en-CA')` — the local date, not `toISOString()`, because the rollups bucket by server-local day and UTC is yesterday for half of every day in this timezone (NZ, UTC+12). It tells the model that recorded data ends at or near today and begins a few weeks earlier — never query years in the past — and to prefer the tools' named windows (`last_7d`, `last_14d`, `last_28d`) over guessed custom dates, anchoring any unavoidable custom range to today.

The **register** branches on `scope.viewer.role === 'parent'`:

| Parent register | Teacher/SLT register |
|---|---|
| Plain language; `"presses she did not mean"` not `"unintended activations"`; `"how many buttons it takes to say something"` not `"taps per utterance"` | Clinical terms are fine |
| Growth framing — lead with what is working | Be direct about what the evidence supports and where it is thin |
| Never imply the child is behind; compare only to their own past | Actions are for the adult, not for the child to perform |
| "The same numbers and the same caveats as anyone else gets. Warmth is in the wording, never in withholding or softening a fact." | — |

The `SCOPE.` line lists `display_name (child_id)` for every child in `scope.children`, appends `This conversation is about <focus.display_name>.` when `scope.focusChildId` resolves, and always ends with `You cannot see any other child, and you must not speculate about one.`

`HOW TO ANSWER` requires: call tools before answering, never state an unretrieved number, cite dates and values inline (`"5.8% before 30 July, 14.3% after"` beats `"worse lately"`), say so when nothing fired, retry a corrected call on a tool error, keep it to three or four sentences plus evidence.

### Flow, in execution order
1. `started = performance.now()`; counters `inputTokens`, `outputTokens`, `steps = 0`; sets `forbiddenSeen`, `noticesSeen`.
2. `resolveProvider()` (see [chat-providers](chat-providers.md)) and `toolsForScope(scope)` (see [scoped-tool-bridge](scoped-tool-bridge.md)).
3. `messages` seeded with the system message plus the caller's `history` mapped straight to `ChatMessage`.
4. `for (steps = 1; steps <= MAX_STEPS; steps++)`:
   - stream `provider.send(messages, tools, signal)`; accumulate `text`, capture `calls`, add `usage` into the token counters, and yield each `text` delta immediately.
   - if `calls` is empty → `answer = text`, `break`.
   - otherwise push `{ role: 'assistant', content: text || null, toolCalls: calls }`, then for each call: yield `tool_call`, run `invokeTool(scope, call.name, call.args)`, yield `tool_result`, yield each unseen `guidance` entry as a `notice` (dedup key = `` `${g.code}:${g.detail.slice(0, 40)}` ``), add every `result.forbiddenActions` entry to `forbiddenSeen`, and push a `tool` message carrying `result.resultJson`.
   - when `steps === MAX_STEPS` and tools were still being called, push a synthetic user turn — *"You have used all available tool calls. Answer now from what you have, and say plainly which part of the question you could not check."* — and stream one more `provider.send(messages, [], signal)` with **no tools**, appending into `answer`.
5. Guard pass: `checkForbidden(answer, [...forbiddenSeen])`. On hits, yield `regenerated` with `The first answer recommended <actions>.`, push the assistant answer and `correctionPrompt(hits)`, then stream a toolless rewrite. If `checkForbidden(rewritten, forbidden)` still hits, yield `error` with the withheld-answer message and `retryable: true`. See [forbidden-action-guard](forbidden-action-guard.md).
6. `explainForbidden(forbidden)` — if non-null, yield `forbidden` with the label **even when nothing was violated**, so the boundary is visible.
7. Yield `done` with `ms`, `steps`, `inputTokens`, `outputTokens`.
8. Any thrown error is caught and yielded as `error` with `e.message ?? 'The assistant failed.'` and `e.retryable ?? false` (`ProviderError` carries both).

### Behaviours worth knowing
- **`steps` in `done` can be `9`.** `steps` is declared outside the `for` header; when the loop runs to exhaustion the post-increment leaves it at `MAX_STEPS + 1`. A `break` reports the true step count.
- **The guard only inspects `answer`.** Text streamed in a turn that *also* returned tool calls is yielded to the UI but never assigned to `answer`, so it is never scanned by `checkForbidden`.
- **Both the original and the rewrite are streamed as `text`.** The server does not retract the first answer; `components/chat/ask-panel.tsx` clears its buffer on `regenerated` (`buffered = ''`, `content: ''`).
- The MAX_STEPS summary turn and both guard turns are sent with `tools = []`, so no further tool calls are possible after step 8 (the `MAX_STEPS` turn).

## Dependencies & Connections

### Depends On
- [chat-providers](chat-providers.md) — `resolveProvider()`, `ChatMessage`, `ToolCall`, `ProviderError`
- [scoped-tool-bridge](scoped-tool-bridge.md) — `toolsForScope()`, `invokeTool()`, `ChatScope`, `ToolInvocation`
- [forbidden-action-guard](forbidden-action-guard.md) — `checkForbidden()`, `correctionPrompt()`, `explainForbidden()`
- [../mcp/tool-surface.md](../mcp/tool-surface.md) — the envelope contract (`guidance`, `forbidden_actions`, `meta.row_count`) that the prompt's `READING THE DATA` block describes

### Depended On By
- [../api/ask-chat-endpoint.md](../api/ask-chat-endpoint.md) — `app/api/chat/route.ts` wraps each `AgentEvent` as an SSE `data:` frame and terminates with `data: [DONE]`
- [../dashboard/ask-panel.md](../dashboard/ask-panel.md) — `components/chat/ask-panel.tsx` switches on `ev.type` for `text`, `tool_call`, `tool_result`, `notice`, `forbidden`, `regenerated`, `error`, `done`

### Shared Resources
- `ChatScope` (viewer, children, `focusChildId`, `classId`) built server-side in `app/api/chat/route.ts` from the session, never from the request body
- The clinical constraints text, duplicated by design between `CLINICAL_RULES` here and `docs/aac-clinical-constraints.md`

## Change Risks
- **Editing `CLINICAL_RULES` without editing `docs/aac-clinical-constraints.md`** silently forks the binding constraints. C1–C8 are the reason several metrics exist at all; the inline copy is what actually reaches the model.
- **Raising `MAX_STEPS`** raises per-question token cost linearly and delays the MAX_STEPS summary turn; lowering it makes the "could not check" summary the normal outcome for multi-metric questions.
- **Adding an `AgentEvent` variant** requires a matching `case` in `components/chat/ask-panel.tsx`; unhandled events are silently dropped by its `switch`.
- **Assigning `answer` from intermediate turns** would extend guard coverage but also re-scan text the model already superseded — currently the guard is deliberately narrow and the gap is real.
- **Removing the `explainForbidden` yield** would hide the boundary from teachers in the (common) case where the model behaved, defeating layer 2 of the guard described in `lib/chat/guard.ts`.
- **Changing the register split** touches parent-facing wording that C7 and the copy rules in the constraints doc govern; softening a fact to sound warmer is explicitly forbidden by the prompt itself.
