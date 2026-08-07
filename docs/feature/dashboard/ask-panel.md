# Ask Panel

## Function
The streaming chat surface: a client component that POSTs to `/api/chat` and renders the answer as markdown alongside the tools it called, the guidance notices the data raised, any rewritten answer, and any forbidden actions — mounted at `/dashboard/ask` (class scope), `/dashboard/student/[id]/ask` (per-child scope), inside a stored report, and docked in the student page's `#ask` section.

## Purpose
From the component header: **the tool strip and the evidence are not debug output — they are the product.** A speech therapist will not act on an unattributed claim about a child, and a parent should be able to see exactly which numbers produced the sentence they are reading. Both are visible by default; only the raw payload is collapsed.

This is the dashboard-side expression of `mcp-api.md`'s design principles — every answer travels with its provenance, its `guidance` codes, and its `forbidden_actions`. The panel renders `critical` notices **above** the answer and everything else below, so a `LAYOUT_CHANGED_MID_WINDOW` warning cannot be read after the conclusion it invalidates.

**Scope is resolved twice, deliberately.** `app/dashboard/student/[id]/ask/page.tsx` states it: *"Scope is resolved server-side here and again in `/api/chat` — this call decides what the page may render, that one decides what the model may read. Neither trusts the other."*

The class-level page passes no `childId`, so the model receives `child_id` as an enum of this adult's roster: it can choose between the children they already support and cannot name one they do not. A parent lands there with exactly one child, so the panel focuses automatically and behaves identically to the per-child page.

## Source Files
| File | Role |
|------|------|
| `components/chat/ask-panel.tsx` | `AskPanel`, `AssistantTurn`, `NoticeRow`; the SSE reader and render loop |
| `components/chat/markdown.tsx` | `Markdown` — dependency-free GFM-subset renderer that builds React elements only |
| `app/dashboard/ask/page.tsx` | Class-level Ask — solo detection, roster shortcuts, role-aware copy |
| `app/dashboard/student/[id]/ask/page.tsx` | Per-child Ask — `requireChild` scope, role-aware suggestions |

## Implementation

### Component contract
```ts
<AskPanel childId?: string  childName?: string  suggestions: string[] />
```
`childId` absent ⇒ class scope. Four surfaces mount it: both Ask pages, `/dashboard/reports/[id]`, and the student page's `#ask` section (`/dashboard/student/[id]`).

### Turn model
```ts
type Turn = {
  role: 'user' | 'assistant'
  content: string
  tools?:   { name: string; ok: boolean; ms: number; rowCount: number }[]
  notices?: { level: string; code: string; detail: string }[]
  forbidden?: string | null
  regenerated?: string | null
  stats?: { ms: number; steps: number; inputTokens: number; outputTokens: number }
  error?: { message: string; retryable: boolean } | null
}
```

### Request
```
POST /api/chat
content-type: application/json
{ message: string, childId?: string, history: { role, content }[] }
```
`history` is built from prior turns with **errored turns filtered out** — a failed exchange never becomes context. The request carries an `AbortController` signal; the **Stop** button aborts it. A non-`ok` response or a missing body is read as JSON and surfaced as `err.error ?? 'Request failed.'` with `retryable: false`.

### Stream handling
The response body is read with a `TextDecoder` and split on `\n`; only lines beginning `data:` are parsed, the payload `[DONE]` is skipped, and JSON parse failures are silently ignored (`catch { continue }`).

| `ev.type` | Effect |
|---|---|
| `text` | appends `ev.delta` to a buffer, flushed on the next `requestAnimationFrame` |
| `tool_call` | pushes `{ name, ok: true, ms: 0, rowCount: 0 }` — `ms === 0` is the "in flight" marker |
| `tool_result` | walks the tool list **backwards** for the last entry with the same `name` and `ms === 0`, and replaces it with `{ ok, ms, rowCount }` |
| `notice` | appends the notice object verbatim |
| `forbidden` | sets `forbidden = ev.label` |
| `regenerated` | **clears the buffer and `content`**, sets `regenerated = ev.reason` — the rewrite replaces the answer, so what was streamed is discarded |
| `error` | sets `{ message, retryable }` |
| `done` | flushes and stores `ev` as `stats` |

Text is buffered and flushed on an animation frame because mutating the last turn per token would re-render the whole transcript per character. `finally` cancels any pending frame, flushes once more, clears `busy` and drops the abort controller. An `AbortError` is swallowed; any other thrown error becomes a `retryable: true` turn error.

### Rendering (`AssistantTurn`)
1. **Tool strip** — `looked at` followed by the tools in call order, separated by `→`. In-flight tools (`ms === 0`) render `animate-pulse` in faint ink; failed tools (`ok === false`) render `--color-alert` with `line-through`. Names are mapped through `TOOL_LABELS`:

| tool | label | | tool | label |
|---|---|---|---|---|
| `list_children` | children | | `get_scene_breakdown` | by setting |
| `get_child_profile` | profile | | `get_utterances` | sentences |
| `get_metrics` | metrics | | `get_partner_metrics` | partner |
| `get_metric_timeseries` | trend | | `get_board_revisions` | layout changes |
| `get_card_stats` | cards | | `get_fired_rules` | findings |
| `get_cell_heat` | grid heat | | `get_attention_queue` | attention queue |
| `get_word_pairs` | word pairs | | | |

Unmapped tool names fall through to the raw name. The 13 mapped names are a subset of the **20 tools `mcp/tools.ts` defines** — seven have no friendly label: `get_report_set`, `get_insight_history`, `compare_windows`, `get_board_layout`, `write_insight`, `propose_board_change` and `query`.

2. **Stats line** — `{n} call(s) · {(ms/1000).toFixed(1)}s · {(inputTokens + outputTokens).toLocaleString()} tokens`, rendered only when `stats` has arrived.
3. **Critical notices** (`level === 'critical'`) as `NoticeRow tone="alert"`, **above** the answer.
4. **`regenerated`** as `NoticeRow tone="warn"` with code `REWRITTEN` and detail `` `${reason} It was rewritten to stay within AAC practice.` ``
5. **Answer text** — `<Markdown text={turn.content} />`. The accumulated text is re-parsed on every animation-frame flush, so structure appears as it completes — a GFM table renders as plain lines until its separator row arrives, then snaps into shape.
6. **`Reading the data…`** placeholder while `busy` and no content has arrived.
7. **Non-critical notices** below the answer.
8. **Forbidden block** — the label in bold followed by the fixed copy: *"These are ruled out by AAC practice for this finding, not by preference. Moving a learned button undoes the motor pattern a child has built."*
9. **Error block** in `--color-alert`.

`NoticeRow` prints the raw `code` in a monospace uppercase micro-label above the detail, so `SMALL_SAMPLE` or `PARTNER_WAIT_SHORT` is visible verbatim (`mcp-api.md` §6).

### `components/chat/markdown.tsx`
The model's output is untrusted input, and the renderer's safety is structural: it builds **React elements only** — no `dangerouslySetInnerHTML`, no HTML pass-through — so a prompt-injected `<script>` renders as the literal text `<script>`. Coverage is the subset a data chatbot actually emits: GFM tables (each wrapped in an `overflow-x-auto` div), bold/italic, inline and fenced code, ordered/unordered lists, headings (rendered as styled `<p>`), blockquotes, horizontal rules, and http(s)-only links (`target="_blank"`, `rel="noopener noreferrer"`). Everything else stays literal text. An unclosed fence mid-stream runs to the end of the text — "which is what a fence looks like mid-stream" — and re-parsing per frame is fine at chat sizes (both from the file header).

### Composer
- Empty-state card: *"Ask about {childName ?? 'the children you support'}"* + *"Answers come from the same data as the rest of the dashboard, and every answer shows which numbers it used."*
- Suggestion chips render **only while `turns.length === 0`**; clicking one calls `ask(s)` directly.
- Text input: `maxLength = 2000`, disabled while `busy`, placeholder `Ask about {childName}…` or `Ask a question…`.
- Right-hand button is **Send** (disabled on empty input) when idle, **Stop** (calls `abortRef.current?.abort()`) while busy.
- `endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })` runs on every `turns` change.
- `ask()` early-returns on empty input or while `busy`, so concurrent requests are impossible.

### Suggestion sets
**`/dashboard/ask`, multiple children:**
`Who needs attention today, and why?` · `Has anyone gone quiet this week?` · `Which children have open findings?` · `Where are we spending on generated images?`

**`/dashboard/ask`, exactly one child (`solo`):**
`How has {firstName} been this month?` · `What has changed recently?` · `Is there anything I should know?`

**`/dashboard/student/[id]/ask`, `role === 'parent'`:**
`How has {first} been this month?` · `What new words has she used?` · `What is she saying most often?` · `Is there anything I should know?`

**`/dashboard/student/[id]/ask`, teacher/SLT:**
`What changed for {first} this month?` · `Are there any open findings, and what caused them?` · `Which words does she reach for that are hard to get to?` · `Has this happened before?`

**`/dashboard/student/[id]` (the docked `#ask` section), `role === 'parent'`:**
`How has {first} been this fortnight?` · `What new words has she used?` · `Is there anything I should know?`

**`/dashboard/student/[id]`, teacher/SLT:**
`Why are corrections landing next door?` · `What changed for {first} this fortnight?` · `Which words does she reach for that are hard to get to?`

The student-page sets say "fortnight" because they track that page's 14-day default window; the Ask sub-tab's sets say "month".

**`/dashboard/reports/[id]`:** `What should I try next?` · `Which of these matters most?` · `What does the pairs number mean?`

### Page shells
Both Ask pages are `dynamic = 'force-dynamic'` and `max-w-4xl px-6 py-6`.

- **Class page** — `visibleChildren(viewer)`; `EmptyState "No children shared with you"` when empty; `solo = children.length === 1 ? children[0] : undefined`. Panel title is the solo child's name or **"Your class"**; subtitle switches on `role === 'parent'` between *"Answered from the same data the school sees."* and *"Every answer shows which numbers produced it."* When not solo, a row of direct links to `/dashboard/student/{id}/ask` follows. Closing note: *"The assistant can only see the children on your roster, and cannot read what any child actually said — utterance text is a separate consent tier."*
- **Per-child page** — `requireChild(viewer, id)`, `StudentTabs active="ask"`, subtitle role-switched, and the same utterance-text disclaimer naming the child.

Both disclaimers reflect `mcp-api.md` §9: utterance text is not a permission setting — `aac_text.db` is never opened.

The fourth mount — the student page's `#ask` section — is docked at the bottom of `/dashboard/student/[id]` under the same cannot-read-utterances note; see [student-overview.md](student-overview.md).

## Dependencies & Connections

### Depends On
- [Chat endpoint](../api/ask-chat-endpoint.md) — `POST /api/chat`; the panel is a pure consumer of its `data:` event stream and re-resolves nothing
- [Access control](../auth/role-consent-scoping.md) — `currentViewer`, `visibleChildren`, `requireChild`, `viewer.role`
- [MCP tool surface](../mcp/tool-surface.md) — `TOOL_LABELS` names the tools; notice codes come from `mcp-api.md` §6
- [Dashboard shell](dashboard-shell.md) — `Panel`, `EmptyState`, `StudentTabs`

### Depended On By
- [Progress reports](progress-reports.md) — embeds `AskPanel` under a stored report so the conversation is about the frozen numbers
- [Student overview](student-overview.md) — docks `AskPanel` in the student page's `#ask` section
- [Dashboard shell](dashboard-shell.md) — no rail item links to `/dashboard/ask`; the rail's **Class** item lights while it is open (its `active()` predicate matches `/dashboard/ask*`), but the class-level page is reachable only by typed URL

### Shared Resources
- The `/api/chat` event vocabulary: `text · tool_call · tool_result · notice · forbidden · regenerated · error · done`, plus the `[DONE]` sentinel. Adding a type server-side without adding a `case` here means the event is silently dropped.
- `TOOL_LABELS` must track the MCP tool names; a renamed tool degrades to its raw slug in the strip.

### Change Risks
- **Adding an SSE event type server-side** is a silent no-op here — the `switch` has no default branch. New provenance would simply never render.
- **Moving `critical` notices below the answer** lets a teacher read a conclusion before the warning that invalidates it; `LAYOUT_CHANGED_MID_WINDOW` exists precisely to arrive first.
- **Dropping the `regenerated` handler's buffer clear** would leave the rejected draft concatenated with its rewrite — the user would read text the safety layer removed.
- **The `tool_result` pairing walks backwards for `ms === 0`.** If the server ever emits two concurrent calls to the *same* tool, results can attach to the wrong entry; the timings shown would be swapped.
- **Removing `childId` from the request body** while leaving the per-child page intact would silently widen the model's scope to the whole roster — the server re-scopes, but the panel is what states the intent.
- **Raising `maxLength` above 2000** shifts cost and prompt-injection surface onto `/api/chat`; the limit is the only client-side bound.
- **Rendering suggestion chips after the first turn** (removing the `turns.length === 0` guard) would push the transcript around mid-conversation and re-offer questions already answered.
- **Removing the tool strip or the notice rows** turns this from an auditable answer into an unattributed claim about a child — the failure the component header exists to prevent.
- **Replacing `markdown.tsx` with an HTML-pass-through renderer** (or adding `dangerouslySetInnerHTML` to it) re-opens prompt-injected markup: the model's output is untrusted input, and the no-HTML property is structural — React elements only — not a sanitiser to keep patched.
