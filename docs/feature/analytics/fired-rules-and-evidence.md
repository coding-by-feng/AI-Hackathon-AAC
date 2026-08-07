# Fired Rules & Evidence

## Function
Reads `fired_rules` (deterministic SQL rule firings) joined to `insights` (model narration), hydrates each one with its catalogue metadata, and provides the evidence-formatting helpers the insight card renders. Also owns the single write this domain performs: recording a dismissal.

## Purpose
From the file header: *"Two tables, deliberately: `fired_rules` is produced by plain SQL and is deterministic and explainable; `insights` is model narration that cannot exist without a `fired_rule_id`. The dashboard shows the rule first and the narration second, so a teacher can always ask 'what number caused this?'"*

And on why the catalogue fields travel with every insight: *"The catalogue's `forbidden_actions`, `target_audience` and `action_kind` travel with every insight to the UI. They are not advisory: an insight whose `action_kind` is `'informational'` renders no action button at all, which is what stops **I4 case B** — a child refusing something — turning into a training task."* That rule is stated in `docs/aac-clinical-constraints.md`: *"Case B must never route to retraining. Drilling a child to request something they have refused teaches them that their 'no' does not count."*

Dismissal exists for the same reason `docs/analytics-metrics.md` §8 gives: *"Log every dismissal — it is the only feedback available on whether the rules work."* The file restates it: *"After a term of dismissals, a rule nobody ever accepts can be retired — which is impossible if the reason is not recorded."*

## Source Files
| File | Role |
|------|------|
| `lib/insights.ts` | Fired-rule reads, hydration, dismissal write, and the evidence split/format helpers |

## Implementation

### `FiredRule` — the hydrated shape
```ts
type EvidenceRow = Record<string, unknown>

type FiredRule = {
  fired_rule_id: string
  child_id: string
  insight_id: string
  fired_at: number                                  // epoch ms
  window_start: string                              // 'YYYY-MM-DD'
  window_end: string
  evidence: EvidenceRow[]                           // parsed from fired_rules.evidence
  thresholds: Record<string, unknown>               // parsed from fired_rules.thresholds_used
  classification: Record<string, unknown> | null    // I1 only: motor/semantic split
  dismissed_at: number | null
  dismiss_reason: string | null
  meta: InsightMeta | undefined                     // insightMeta(insight_id)
  narration: string | null                          // insights.narration
  narrationModel: string | null                     // insights.model
}
```

`hydrate()` maps the raw row. JSON columns go through `parse<T>(raw, fallback)`, which returns the fallback for a non-string input **and** swallows any `JSON.parse` error — malformed evidence renders as an empty list rather than throwing. `classification` stays `null` when the column is falsy; every other rule leaves it NULL by schema design.

`meta` comes from `insightMeta()` in the [data dictionary](data-dictionary.md), called **once per row** — rendering N insights costs N `insights_catalog` queries.

### Reads

**`openInsights(childId): FiredRule[]`**
```sql
SELECT f.*, i.narration, i.model
FROM fired_rules f
LEFT JOIN insights i ON i.fired_rule_id = f.fired_rule_id
WHERE f.child_id = ? AND f.dismissed_at IS NULL AND f.superseded_by IS NULL
ORDER BY f.fired_at DESC, f.insight_id
```
Both `dismissed_at IS NULL` and `superseded_by IS NULL` are required — *"a later run replacing an earlier one should not show both."* The join is a `LEFT JOIN`, so a rule that fired but has not been narrated by the model yet still appears, with `narration = null`.

**`insightHistory(childId, limit = 30): FiredRule[]`** — the same join with no filters, `ORDER BY f.fired_at DESC LIMIT ?`. Includes dismissed and superseded firings. **No caller imports it today.**

**`openInsightCount(childId): number`** — `openInsights(childId).length`; runs the full query and hydration to return a count. **No caller imports it today** (the Attention Queue uses `openInsights(...).length` inline instead).

### Write — `dismissInsight(firedRuleId, adultId, reason)`
```sql
UPDATE fired_rules
SET dismissed_at = CAST(strftime('%s','now') AS INTEGER) * 1000,
    dismissed_by = ?, dismiss_reason = ?
WHERE fired_rule_id = ? AND dismissed_at IS NULL
```
- The timestamp is SQLite's `strftime('%s','now')` (UTC seconds) × 1000, not the Node clock.
- `AND dismissed_at IS NULL` makes a second dismissal a no-op rather than overwriting the original reason and adult.
- Routed through `write()` in `lib/db.ts`, whose `WRITABLE` allow-list regex permits exactly `update fired_rules`, `insert into board_change_proposals`, `update board_change_proposals`, `insert into reports` — anything else throws. This is the only insight-domain statement that passes it.
- Called from `app/actions.ts` with `viewer.adult_id`.

`DismissReason` is re-exported here but **defined in `lib/dismiss.ts`**, deliberately kept free of any database import: *"The insight card is a client component: it needs these labels, and anything it imports gets bundled for the browser. Re-exporting them from `lib/insights` would drag `node:sqlite` into the client build."* The five values and their labels:

| `DismissReason` | `DISMISS_LABELS` |
|---|---|
| `not_accurate` | "That's not what's happening" |
| `already_known` | "I already knew this" |
| `not_actionable` | "Nothing I can do about it now" |
| `disagree_with_advice` | "I disagree with the advice" |
| `other` | "Another reason" |

These match the `CHECK` constraint on `fired_rules.dismiss_reason` in `db/schema.sql`.

### Evidence presentation

**`splitEvidence(row)` → `{ values, thresholds }`** (both `[string, unknown][]`).
Rationale from the file: *"Showing both is the difference between 'the system says she is struggling' and '11.8% against a threshold of 8%, over 14 active days' — the second can be argued with, which is the point."*

- Skipped keys: `child_id`, `window_start`, `window_end`, `triggered`.
- Any key whose value is `null` is dropped.
- A key goes to `thresholds` when it `startsWith('threshold_')` **or** `endsWith('_threshold_ms')`; everything else goes to `values`.

**`humanKey(key)`** — chained string replacements, in this order:
1. strip a leading `threshold_`
2. `_` → space (all)
3. `\bms\b` → `(ms)` (first match only — no `g` flag)
4. `mistap` → `mis-tap` (all)
5. leading `n ` → `count of `

So `mistap_rate` → `mis-tap rate`, `threshold_mistap_rate` → `mis-tap rate`, `n_sessions` → `count of sessions`.

**`humanEvidenceValue(key, value)`** — dispatches on the *key name*, not on any catalogue unit:
- non-number → `String(value)`
- key contains `rate`, `ratio` or `share` → `${(value * 100).toFixed(1)}%` (one decimal, e.g. `11.8%`)
- key ends with `_ms` → `${(value / 1000).toFixed(1)} s`
- integer → `String(value)`; otherwise `value.toFixed(2)`

Note this ordering: a key like `mistap_rate_ms` would take the rate branch first. Also note the divergence from `formatValue()` in the [data dictionary](data-dictionary.md), which rounds ratios to a whole percent — evidence keeps one decimal so the number can be checked against the threshold it fired on.

### `toCardData(fr)` — shaping a firing for the card

Exported at `lib/insights.ts:164`, `toCardData` turns a hydrated `FiredRule` into the `InsightCardData` shape, whose type is imported (type-only, so no component code enters this module) from `@/components/insight-card`. It runs `splitEvidence(fr.evidence[0] ?? {})` — the **first evidence row only** — and formats both halves through `[humanKey(k), humanEvidenceValue(k, v)]`.

Catalogue fields come from `fr.meta` with fallbacks chosen deliberately, per the function comment: *"The fallbacks are chosen for safety, not convenience: a firing whose catalogue row is missing renders as `informational` — no action button — rather than inviting an intervention nobody specified."* Concretely: `action_kind: fr.meta?.action_kind ?? 'informational'` and `target_audience: fr.meta?.target_audience ?? 'adult'`, alongside `recommended_actions ?? []`, `forbidden_actions ?? []`, `safety_note ?? null`, `name ?? insight_id` and `plain_statement ?? ''`.

### Consumption
`app/dashboard/student/[id]/page.tsx` builds the card list as `openInsights(id).map(toCardData)`. Because `toCardData` splits only `fr.evidence[0]`, a multi-row firing shows one row's numbers on the card. The list is only rendered when `baseline(id).ready` — see [Baseline Gating](baseline-gating.md).

### Storage keys
Tables: `fired_rules` (read + the one UPDATE), `insights` (read), `insights_catalog` (read, via `insightMeta`). `lib/queue.ts` additionally reads `MAX(fired_at) FROM fired_rules` for its `analysisFreshness()` staleness caption.

## Dependencies & Connections

### Depends On
- [Data Dictionary](data-dictionary.md) — `insightMeta()` supplies `forbidden_actions`, `target_audience`, `action_kind`, `safety_note` and `recommended_actions` for every card.
- `lib/db.ts` — `all()` for reads and the allow-listed `write()` for the dismissal.
- `lib/dismiss.ts` — the `DismissReason` union and `DISMISS_LABELS`, kept database-free for the client bundle.
- [Insight rules pipeline](../pipeline/rule-materialisation.md) — `fired_rules` rows come from the nightly SQL rules in `db/views_insights.sql`; nothing here evaluates a rule.
- [AI narration](../mcp/tool-surface.md) — `insights.narration` / `insights.model` are written by the model through the MCP `write_insight` tool, which requires a `fired_rule_id`.

### Depended On By
- [Student overview](../dashboard/student-overview.md) — renders the insight cards, evidence table and thresholds.
- [Attention Queue](../dashboard/attention-queue.md) (`lib/queue.ts`) — `openInsights(child.child_id)` contributes the `INSIGHT` reason worth `1` point, with the detail string `"{n} open finding(s) ({insight_ids})"`.
- `app/actions.ts` — the server action wrapping `dismissInsight(firedRuleId, viewer.adult_id, reason)`.
- `components/insight-card.tsx` / `components/insight-list.tsx` — consume the `InsightCardData` derived from `FiredRule`.

### Shared Resources
- `fired_rules` — written by the pipeline (firing, superseding) and by this module (dismissal only). Two writers, disjoint columns.
- `insights` — written only by the MCP `write_insight` path, read only here.
- The dismissal feedback loop itself: `dismiss_reason` is the sole signal available to retire a noisy rule.

## Change Risks
- **Dropping `superseded_by IS NULL` from `openInsights`** shows a teacher the same finding twice from two consecutive nightly runs, and doubles the Attention Queue's `INSIGHT` detail count.
- **Turning the `LEFT JOIN insights` into an inner join** hides every rule that fired but has not been narrated yet — the deterministic half of the design would become invisible whenever the model is down, which is the opposite of the two-table intent.
- **A `fired_rule_id` with more than one `insights` row** duplicates the fired rule in the result set; nothing de-duplicates the join. The schema does not make `insights.fired_rule_id` unique.
- **A missing `insights_catalog` row no longer renders an intervention affordance** — `toCardData`'s `action_kind ?? 'informational'` fallback fails safe (no action button). What a missing row *does* still cost: the card loses its `forbidden_actions` display, `safety_note` and `plain_statement`, so the clinical framing goes blank even though no unsafe button appears. Weakening those fallbacks (e.g. defaulting `action_kind` to `'intervention'`) would recreate the original I4 case B harm.
- **A rule that fires with multiple evidence rows renders only `evidence[0]` on the card.** `run_rules.py` caps evidence at 15 rows for I4 and 10 for I3/I6/I8, and I4 routinely fires with 4–15 rows (one per unused card) on the current build — a teacher reading the card sees a single row's numbers standing in for all of them. `evidence_rows` in `get_insight_history` still reports the true count.
- **Widening the `WRITABLE` regex in `lib/db.ts`** to let this module touch anything beyond `fired_rules` breaks the invariant that the dashboard never writes events, utterances or cards.
- **Changing `DismissReason` values** requires the `CHECK` constraint on `fired_rules.dismiss_reason` to change in the same migration, or every dismissal throws at write time.
- **Editing `splitEvidence`'s classifier** (the `threshold_` prefix / `_threshold_ms` suffix convention) silently moves fields between the "measured" and "compared against" columns of the card. The rule SQL in `db/views_insights.sql` names its columns to match this convention — the two must be changed together.
- **`humanEvidenceValue` keys on substrings, not on the catalogue.** A new evidence column named e.g. `separate_rate_count` would be multiplied by 100 and suffixed with `%`. Adding evidence columns is a UI-affecting change even though no UI file is touched.
