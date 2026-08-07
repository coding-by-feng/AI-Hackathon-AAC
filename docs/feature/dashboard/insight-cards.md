# Insight Cards (Findings & Dismissal)

## Function
The client-side card that renders one fired rule as a hypothesis with its evidence, its thresholds, what usually helps, what must **not** be done, and a one-tap dismissal with a recorded reason — plus the list wrapper and the dismissal vocabulary shared with the server action.

## Purpose
`analytics-metrics.md` §0.3: *"The insights are hypotheses with evidence attached, never diagnoses. Every one surfaces as 'this looks like X — does that match what you see?' with a one-tap dismiss, and every dismissal is logged."* This component is where that promise is kept.

The `insight-card.tsx` header lists four constraints that live in code rather than in copy:

- **`action_kind === 'informational'` renders no action list.** I4 case B is a child refusing something; offering an intervention there teaches them that their "no" does not count.
- **`forbidden_actions` is displayed, not merely respected.** A teacher reading "never move the card" understands the recommendation better than one who simply is not offered the option.
- **`target_audience === 'adult'` is stated plainly**, because I2, I6, I7 and I8 are about the grown-up or about our own software, and reading them as findings about the child is exactly the failure mode.
- **The heading is a question. The system proposes; the human decides.**

Dismissal exists because it is the only feedback the system gets on whether its rules are any good (`lib/insights.ts`): after a term of dismissals, a rule nobody ever accepts can be retired — impossible if the reason was never recorded.

`lib/dismiss.ts` is a separate module for a build reason, stated in its header: the insight card is a client component, and anything it imports is bundled for the browser. Re-exporting the labels from `lib/insights.ts` would drag `node:sqlite` into the client build.

## Source Files
| File | Role |
|------|------|
| `components/insight-card.tsx` | The card: evidence disclosure, actions, forbidden list, dismissal flow, `InsightCardData` type |
| `components/insight-list.tsx` | List wrapper; binds `dismissAction`; renders the empty state |
| `lib/dismiss.ts` | `DismissReason` union and `DISMISS_LABELS`, free of any database import |

## Implementation

### `DismissReason` and `DISMISS_LABELS`
Five values, matching `mcp-api.md` §4's `dismiss_reason` enum exactly:

| value | button label |
|---|---|
| `not_accurate` | That's not what's happening |
| `already_known` | I already knew this |
| `not_actionable` | Nothing I can do about it now |
| `disagree_with_advice` | I disagree with the advice |
| `other` | Another reason |

### `InsightCardData`
```ts
{
  fired_rule_id: string
  insight_id: string                 // 'I1'…'I8'
  name: string
  plain_statement: string
  narration: string | null           // model prose, when a model has written one
  narrationModel: string | null      // e.g. 'gemma-3-4b'
  firedAt: number
  window: string                     // '{window_start} → {window_end}'
  evidence: { values: [string, string][]; thresholds: [string, string][] }
  classification: Record<string, unknown> | null   // I1's motor/semantic split
  recommended_actions: string[]
  forbidden_actions: string[]
  action_kind: 'intervention' | 'informational' | 'system_fix'
  target_audience: 'child' | 'adult' | 'system'
  safety_note: string | null
}
```
Built by [the student overview](student-overview.md) from `openInsights()` + `splitEvidence()`. Note `classification` is carried on the type but **is not rendered anywhere in the card today**.

### Card state (client component)
```ts
const [open, setOpen]         = useState(false)   // evidence disclosure
const [choosing, setChoosing] = useState(false)   // dismissal reason picker
const [done, setDone]         = useState(false)   // dismissed in this session
const [pending, start]        = useTransition()
if (done) return null                             // the card removes itself
```

### Render order
1. **Header** — `name`, then pills on the right: `about our software` (`tone="warn"`) when `target_audience === 'system'`; `for the adult` (`tone="accent"`) when `'adult'`; always the `insight_id` pill.
2. **Body** — `narration ?? plain_statement`. Model prose is preferred, the catalogue's deterministic statement is the fallback.
3. **`safety_note`** — warn-bordered block when present. (`insights_catalog.safety_note`; e.g. I1's "with cerebral palsy, mis-taps are frequent and normal".)
4. **Disclosure toggle** — `What number caused this?` / `Hide the numbers`, with `aria-expanded={open}`.
5. **Evidence panel** (when `open`):
   - `evidence.values` as a two-column `<dl>`
   - `evidence.thresholds` under the heading **compared against**, followed by the fixed caveat *"These are starting values, not clinical cut-offs. If a number sits just over its threshold, treat the finding as a question rather than a conclusion."* — the UI expression of `mcp-api.md`'s "the thresholds are given to you rather than applied for you"
   - Provenance line: `rule {fired_rule_id} · window {window} · narrated by {narrationModel}` or `· no narration written`
6. **"what usually helps"** — rendered **only when `action_kind !== 'informational'`** and `recommended_actions.length > 0`.
7. **"do not"** — `forbidden_actions` mapped through `readableForbidden()` and joined with ` · `, in `--color-alert`.
8. **Footer** — the decision row.

### `readableForbidden()` map
| `forbidden_actions` value | rendered text |
|---|---|
| `resize_grid` | change the grid size |
| `move_card` | move a card she already knows |
| `remove_original` | remove the original card |
| `reduce_repetition` | try to stop repeated pressing |
| `retrain_preference` | retrain a preference |
| `reintroduce_refused_item` | reintroduce something she refused |
| `treat_refusal_as_deficit` | treat a refusal as a problem |
| `demand_faster_response` | ask her to answer faster |
| `demand_imitation` | ask her to copy you |
| `test_the_child` | test her |
| `retrain_without_access_check` | reteach before checking she can physically reach it |

Anything unmapped falls back to `action.replace(/_/g, ' ')`. These are the copy rules from `aac-clinical-constraints.md` ("Copy rules, enforced in the insight catalogue") surfacing to the reader.

### Dismissal flow
Footer, `choosing === false`:
- Prompt: **"Does that match what you see?"**
- **"No, that's not it"** → `setChoosing(true)`
- **"Yes — show me the detail"** → `setOpen(true)`. This records nothing; it only expands the evidence. There is no "accept" write path.

Footer, `choosing === true`: **"Why not? This is how the rules get better."** followed by one button per `DISMISS_LABELS` entry plus a `cancel` link. Choosing a reason runs inside `useTransition`:

```ts
start(async () => { await onDismiss(data.fired_rule_id, reason); setDone(true) })
```

`InsightList` binds `onDismiss` to the `dismissAction` server action in `app/actions.ts`, which:
1. `currentViewer()`
2. `SELECT child_id FROM fired_rules WHERE fired_rule_id = ?` — throws `Unknown finding` if absent
3. `requireChild(viewer, row.child_id)` — the authorisation check lives in the action, not in the component that renders the button, so a dismissal cannot be forged for a child the caller has no roster row for
4. `dismissInsight(firedRuleId, viewer.adult_id, reason)` → `UPDATE fired_rules SET dismissed_at = strftime('%s','now')*1000, dismissed_by = ?, dismiss_reason = ? WHERE fired_rule_id = ? AND dismissed_at IS NULL`
5. `revalidatePath('/dashboard/student/{child_id}')` and `revalidatePath('/dashboard')`

The `AND dismissed_at IS NULL` clause makes the write idempotent: a double-click cannot overwrite the original dismisser or timestamp.

### `InsightList`
Renders `EmptyState tone="good"` titled **"Nothing needs your attention here"** with body *"No rule has fired for this child in the current window."* when `items` is empty; otherwise one `InsightCard` per item, keyed on `fired_rule_id`.

## Dependencies & Connections

### Depends On
- [Insight rules](../analytics/fired-rules-and-evidence.md) — `fired_rules` rows, `insights_catalog` metadata, `dismissInsight`, `splitEvidence`
- [Access control](../auth/role-consent-scoping.md) — `dismissAction` scopes through `requireChild`
- [Dashboard shell](dashboard-shell.md) — `Pill`, `EmptyState`
- [Database schema](../database/schema.md) — `fired_rules` (`dismissed_at`, `dismissed_by`, `dismiss_reason`, `superseded_by`), `insights` (narration), `insights_catalog` (`forbidden_actions`, `target_audience`, `action_kind`, `safety_note`)

### Depended On By
- [Student overview & AI impact](student-overview.md) — the student page's "Findings" section
  (`app/dashboard/student/[id]/page.tsx`) is the only mount point, via
  `openInsights(id).map(toCardData)` (`lib/insights.ts`). **History worth keeping:** from the
  initial commit until 2026-08-08, `InsightList` was imported by *no page at all* — the two
  clinical invariants this card enforces (informational ⇒ no action button; forbidden actions
  displayed) existed only in unreachable code. The 2026-08-08 verification pass caught it and
  wired the section; if a redesign ever drops the mount again, that is a clinical regression,
  not a styling choice.
- [Attention queue](attention-queue.md) — the `INSIGHT` score term counts exactly the rows this card can dismiss, so a dismissal drops a child's priority by 1
- [MCP tool surface](../mcp/tool-surface.md) — `get_fired_rules` returns `previously_dismissed` built from the same columns; `get_insight_history` reads the reasons written here

### Shared Resources
- `fired_rules.dismissed_at / dismissed_by / dismiss_reason` — the feedback loop, written only here
- `DismissReason` — must stay identical to `mcp-api.md` §4's `dismiss_reason` enum and to the DB CHECK constraint
- `lib/dismiss.ts` is deliberately the *only* module both the client card and the server action share

### Change Risks
- **Importing anything from `lib/insights.ts` into `insight-card.tsx`** pulls `node:sqlite` into the client bundle and breaks the build — this is precisely why `lib/dismiss.ts` exists as a separate file.
- **Rendering `recommended_actions` unconditionally** would put an intervention on I4 case B, teaching a child that their refusal does not count. The `action_kind !== 'informational'` guard is a clinical control, not a layout preference.
- **Dropping the `forbidden_actions` block** removes the reader's only view of the bans that `insights_catalog.forbidden_actions` encodes; the MCP `write_insight` tool would still reject them, but the human would no longer learn why.
- **Adding a `DismissReason` value** requires updating `DISMISS_LABELS`, the DB CHECK constraint, and `mcp-api.md` §4 together; the card iterates `Object.keys(DISMISS_LABELS)`, so a value present in the DB but missing here becomes unselectable.
- **`if (done) return null`** removes the card optimistically. If `dismissAction` throws after the write, or the `revalidatePath` fails, the card disappears while the row may or may not be updated — a refresh is the only way to find out.
- **Removing `AND dismissed_at IS NULL`** from `dismissInsight` would let a second click overwrite the original `dismissed_by`, corrupting the only audit trail of who rejected a finding.
- **Rendering `classification`** (currently carried but unused) would expose I1's `motor_share` / `semantic_share`; per constraint C1's safety note, ambiguous splits must default to the MOTOR reading, so any such UI needs the same defaulting the [Reach & errors](reach-and-errors.md) page already applies.

> **2026-08-08:** "Yes — show me the detail" sets a `confirmed` state: opens the
> evidence, scrolls it into view (reduced-motion aware), swaps the footer text, and
> removes itself. It was previously `setOpen(true)` only — a no-op when the numbers
> were already open (user-reported).
