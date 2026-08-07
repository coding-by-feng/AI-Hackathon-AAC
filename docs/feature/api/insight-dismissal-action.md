# Insight Dismissal Action

## Function
`dismissAction(firedRuleId, reason)` is the root Server Action that marks a `fired_rules` row as
dismissed by the signed-in adult, with a reason, and revalidates the two dashboard paths that
render findings.

## Purpose
A finding is a hypothesis, and an adult who knows the child must be able to reject it. Recording
*why* matters as much as the dismissal itself: `docs/mcp-api.md` makes `previously_dismissed`
part of every `get_fired_rules` candidate and instructs the model to check it before re-raising,
because re-raising something an adult already rejected as `not_accurate` erodes trust in the
whole system.

The scoping rationale is stated in the file header: the check is here, in the action, **not in
the component that renders the button**, so a dismissal cannot be forged for a child the caller
has no roster row for. A Server Action is a public HTTP endpoint with a generated id — it is
reachable without the component that calls it.

## Source Files
| File | Role |
|------|------|
| `app/actions.ts` | The `'use server'` module: `dismissAction` — roster check, dismissal write, cache revalidation |

## Implementation

```ts
'use server'

export async function dismissAction(firedRuleId: string, reason: DismissReason): Promise<void>
```

Step by step, in execution order:

1. `const viewer = await currentViewer()` — resolves the signed `aac_adult` cookie to an
   `adults` row; throws `NOT_SIGNED_IN` when absent or invalid.
2. `one<{ child_id }>('SELECT child_id FROM fired_rules WHERE fired_rule_id = ?', [firedRuleId])`
   — no row → `throw new Error('Unknown finding')`.
3. `const child = requireChild(viewer, row.child_id)` — throws
   `NOT_AUTHORISED: <adult_id> has no active roster row for <child_id>` when the finding belongs
   to a child outside the viewer's roster.
4. `dismissInsight(firedRuleId, viewer.adult_id, reason)` — in `lib/insights.ts`:

   ```sql
   UPDATE fired_rules
   SET dismissed_at = CAST(strftime('%s','now') AS INTEGER) * 1000,
       dismissed_by = ?, dismiss_reason = ?
   WHERE fired_rule_id = ? AND dismissed_at IS NULL
   ```

   The `AND dismissed_at IS NULL` clause makes a second dismissal a no-op rather than an
   overwrite — the first dismisser and the first reason are kept.
5. `revalidatePath('/dashboard/student/' + child.child_id)` then `revalidatePath('/dashboard')`,
   in that order. The student page shows the finding; `/dashboard` shows the attention queue,
   whose score includes "open insight not yet dismissed".

The action returns `void` and does not redirect. Any thrown error surfaces to the calling client
component's error handling / the nearest error boundary.

### `DismissReason` (`lib/dismiss.ts`)

Kept in its own module free of any database import, because the insight card is a client
component and anything it imports gets bundled for the browser — re-exporting from
`lib/insights.ts` would drag `node:sqlite` into the client build.

| Value | `DISMISS_LABELS` string shown to the adult |
|---|---|
| `not_accurate` | That's not what's happening |
| `already_known` | I already knew this |
| `not_actionable` | Nothing I can do about it now |
| `disagree_with_advice` | I disagree with the advice |
| `other` | Another reason |

The same five values are the `dismiss_reason` enum in `docs/mcp-api.md` §4.

### Note on the sibling action

`app/dashboard/reports/actions.ts` is a second Server Action module with the identical scoping
pattern (`currentViewer` → `requireChild` → do the work → `revalidatePath`), documented under
[Reporting endpoints](print-and-generate.md). `app/actions.ts` is the only Server Action at
the app root, and the only one covering findings.

## Dependencies & Connections

### Depends On
- [Access scoping](../auth/role-consent-scoping.md) — `currentViewer` and `requireChild`; the whole
  authorisation of this action.
- [Insights](../analytics/fired-rules-and-evidence.md) — `dismissInsight` and the `fired_rules` lifecycle
  (`dismissed_at`, `dismissed_by`, `dismiss_reason`, `superseded_by`).
- [Dismissal vocabulary](../dashboard/insight-cards.md) — `DismissReason` and `DISMISS_LABELS`
  from `lib/dismiss.ts`.
- [Database schema](../database/schema.md) — the `fired_rules` table.

### Depended On By
- [Insight card](../dashboard/insight-cards.md) — the client component that offers the five
  reasons and calls this action.
- [Student overview](../dashboard/student-overview.md) and
  [attention queue](../dashboard/attention-queue.md) — both are revalidated by it, and both
  filter on `dismissed_at IS NULL`.
- [MCP tool surface](../mcp/tool-surface.md) — `get_fired_rules` reports
  `previously_dismissed` and `write_insight` rejects a dismissed `fired_rule_id`, so a dismissal
  written here immediately constrains what any model may narrate.

### Shared Resources
- `aac.db` `fired_rules` table — written here, read by the dashboard, the MCP tools and the Ask
  panel.
- The Next.js data cache for `/dashboard` and `/dashboard/student/[id]`.
- The `aac_adult` session cookie.

## Change Risks
- **Moving the `requireChild` check into the component** makes the action forgeable: a Server
  Action id is callable directly, so any signed-in adult could dismiss findings for children
  outside their roster.
- **Dropping `AND dismissed_at IS NULL`** lets a later dismissal overwrite the original
  `dismissed_by` and `dismiss_reason`, destroying the audit trail that
  `previously_dismissed` reports to models.
- **Adding a new `DismissReason` value** requires updating `lib/dismiss.ts`, the
  `dismiss_reason` `CHECK` constraint in `db/schema.sql`, and the enum in `docs/mcp-api.md` §4 —
  an unlisted value will be written by SQLite only if the constraint allows it.
- **Removing either `revalidatePath` call** leaves a dismissed finding visibly present on the
  page the adult is looking at, or leaves the attention queue score stale on `/dashboard`.
- **Importing `lib/insights.ts` into the insight card** to reach the labels pulls `node:sqlite`
  into the browser bundle and breaks the client build — the reason `lib/dismiss.ts` exists.
