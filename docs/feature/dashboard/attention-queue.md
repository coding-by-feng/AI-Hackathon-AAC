# Attention Queue (Class View)

## Function
The dashboard landing page at `/dashboard`: a ranked "Needs a person today" list built from a five-term additive score, plus an "Everyone" roster table showing every child's real numbers whether or not they scored.

## Purpose
From the `lib/queue.ts` header: *"This is the surface a teacher with five AAC students actually uses. Charts are for when a question already exists; the queue is what raises one."*

The page header comment states the design claim directly: sorting five children by "most utterances" answers a question nobody asked. A child who has stopped talking is the one that matters, and totals-based views bury them because their historical average still looks healthy (`analytics-metrics.md` §5 C1).

Two additions the code makes over `analytics-metrics.md` §9:

1. **The score breakdown is returned, not just the total.** `QueueEntry.reasons` carries each contributing term with its point value, and the page renders them. A teacher who cannot see why a child is first will not trust the order, and the formula is simple enough to show.
2. **A child still inside their baseline window cannot be scored at all.** Thresholds tuned to another child would rank them for no reason. They still appear in the roster table with real numbers and a `settling in · N%` pill.

## Source Files
| File | Role |
|------|------|
| `app/dashboard/page.tsx` | The class page — ranked queue, empty state, roster table |
| `lib/queue.ts` | `buildQueue`, `analysisFreshness`, `rollupThrough`, `classesFor` |

## Implementation

### Scoring constants (`lib/queue.ts`)
```ts
const SCORE = { silence: 3, abandonment: 2, mistap: 2, gaps: 1, openInsight: 1 }
const THRESHOLD = { silenceDays: 2, abandonment: 0.25, mistap: 0.12, gaps: 3 }
```
This is `analytics-metrics.md` §9 and `mcp-api.md` `get_attention_queue` verbatim:

```
score = 3·(silence_streak >= 2 days)
      + 2·(abandonment_rate > 25%)
      + 2·(mistap_rate > 12%)
      + 1·(unreviewed vocabulary gaps >= 3)
      + 1·(open insight not yet dismissed)
```
Maximum possible score is **9**.

### `buildQueue(children: ChildSummary[], days = 7): QueueEntry[]`
Window is `windowOf(7)`, anchored on `latestDay()` = `MAX(day_local) FROM events` — not on wall-clock today.

Per child, in order:
1. `baseline(child_id)` — see [baseline gating](../analytics/baseline-gating.md)
2. `silenceStreak(child_id)` — point-in-time, not windowed
3. `readMetric('abandonment_rate' | 'mistap_rate' | 'taps_per_utterance' | 'independence_rate', …)`
4. `unreviewedGapCount(child_id, w)`
5. `openInsights(child_id)`
6. `newWordCount` — a CTE over `events`

```sql
-- unreviewedGapCount
SELECT COUNT(DISTINCT json_extract(payload,'$.normalizedConcept')) c
FROM events
WHERE child_id = ? AND type = 'gap_detected'
  AND json_extract(payload,'$.resolvedBy') = 'generated'
  AND day_local BETWEEN ? AND ?
```

```sql
-- newWordCount
WITH firsts AS (
  SELECT label, MIN(day_local) d FROM events
  WHERE child_id = ? AND actor='child' AND type='card_tap' AND label IS NOT NULL
  GROUP BY label)
SELECT COUNT(*) c FROM firsts WHERE d BETWEEN ? AND ?
```

**Every reason is gated behind `if (base.ready)`.** A child below baseline gets `reasons: []`, `score: 0`, `inBaseline: true`.

### Reason codes and their exact copy
| `code` | Condition | `points` | `metric_id` | `detail` |
|---|---|---|---|---|
| `SILENCE` | `silence >= 2` | 3 | `silence_streak` | `Has not spoken for {n} days` |
| `ABANDONMENT` | `value > 0.25` | 2 | `abandonment_rate` | `Gives up on {n}% of sentences` |
| `MISTAP` | `value > 0.12` | 2 | `mistap_rate` | `{n}% of presses are undone straight away` |
| `GAPS` | `gaps >= 3` | 1 | `vocabulary_gaps` | `{n} words she reached for that do not exist` |
| `INSIGHT` | `insights.length > 0` | 1 | `null` | `{n} open finding(s) ({I1, I3, …})` |

`abandonment` and `mistap` also require `value !== null`, so a metric suppressed for small sample (`n < min_n`) contributes nothing rather than a false zero.

**Sort:** `b.score - a.score || a.child.display_name.localeCompare(b.child.display_name)` — descending score, ties broken alphabetically so the order is stable between renders.

### `QueueEntry` shape
```ts
{ child, score, reasons, inBaseline, baselineProgress,
  silence, tapsPerUtterance, independence, newWords }
```
The last four are "roster-row metrics, shown whether or not the child scores".

### Other exports in `lib/queue.ts`
- **`analysisFreshness()`** → `{ lastRun, ageHours }` from `SELECT MAX(fired_at) FROM fired_rules`; `ageHours = (Date.now() - ts) / 3_600_000`. Returns `{ null, null }` when no rule has ever fired. Consumed by [the shell](dashboard-shell.md).
- **`rollupThrough()`** → `SELECT MAX(day_local) FROM agg_daily_metric`, or `null`.
- **`classesFor(children)`** → `SELECT DISTINCT name FROM classes WHERE class_id IN (…)`, joined with `, `, falling back to the literal string `'Class'`. Children with a `null` `class_id` are passed as `''`; an empty child list produces `IN ('')`.

### Page (`app/dashboard/page.tsx`)
`export const dynamic = 'force-dynamic'` — never statically cached.

```
needsAttention = queue.filter(q => q.score > 0)
settled        = queue.filter(q => q.score === 0)
```

**Panel 1 — "Needs a person today"**, subtitle *"Ranked by how much is going wrong, not by how much they talk"*.
- Empty case renders `<EmptyState tone="good">` titled **"Nothing needs you today"**, body *"Every child is inside their usual range, and no finding is waiting for a decision."* The inline comment is explicit: *this must be a real, good-looking state — a queue that always has five rows trains people to stop reading it.*
- Otherwise an `<ol>`; each row shows the 1-based rank, the child's name linked to `/dashboard/student/{id}`, `{year_group} · {profile_note}` (only when `profile_note` is set), an **Open** button linking to the same route, then the reason list with `+{points}` on the right and a bottom-bordered `priority` row carrying the total.
- Below the list, when `settled.length > 0`: `"{names} is/are within their usual range today."`

**Panel 2 — "Everyone"**, subtitle *"Last 7 days"*. Horizontally scrollable table, `min-w-[46rem]`.

| Column | Value |
|---|---|
| Child | link to `/dashboard/student/{id}` |
| Last spoke | `today` when `silence === 0`, else `{n} d ago` |
| Presses per sentence | `formatValue('taps_per_utterance', …)`, `—` when null |
| Own words | `formatValue('independence_rate', …)`, `—` when null |
| New words | raw count |
| Notes | `Pill tone="accent"` → `settling in · {round(progress*100)}%` when `inBaseline`; else lowercased reason codes joined by ` · `; else `—` |

Table footnote: *"A child marked 'settling in' is shown with real numbers but is never flagged — there is not yet enough of their own history for a threshold to mean anything."*

### Known quirks
- `unreviewedGapCount` is named "unreviewed" but there is **no review state in the query** — it counts every distinct `normalizedConcept` resolved by `generated` inside the window. Marking a gap reviewed on the [AI impact](student-overview.md) page would not change this number today (those buttons are inert stubs).
- `classesFor` runs one query per page load with a placeholder per child, including duplicates for children sharing a class.

## Dependencies & Connections

### Depends On
- [Access control](../auth/role-consent-scoping.md) — `currentViewer()`, `visibleChildren()`; the queue only ever contains roster children
- [Metric readers](../analytics/metric-readers.md) — `readMetric`, `silenceStreak`, `formatValue`
- [Baseline gating](../analytics/baseline-gating.md) — `baseline()`; `ready` gates all five score terms
- [Insight rules](../analytics/fired-rules-and-evidence.md) — `openInsights()` supplies the `INSIGHT` term
- [Dashboard shell](dashboard-shell.md) — `Panel`, `EmptyState`, `Pill`
- [Database schema](../database/schema.md) — `events`, `agg_daily_metric`, `fired_rules`, `classes`, `children`

### Depended On By
- [Dashboard shell](dashboard-shell.md) — imports `analysisFreshness` and `rollupThrough` from `lib/queue.ts`
- [Student overview & AI impact](student-overview.md) — every queue row links into it
- [Ask panel](ask-panel.md) — the class-level suggestion chip *"Who needs attention today, and why?"* expects the MCP `get_attention_queue` tool to produce the same ranking

### Shared Resources
- The scoring formula is duplicated in three places: `lib/queue.ts` `SCORE`/`THRESHOLD`, `docs/analytics-metrics.md` §9, and the MCP `get_attention_queue` tool. They must stay in step or the dashboard and the LLM will disagree about who needs help.
- `fired_rules` — read here for the `INSIGHT` term and for freshness; written by the nightly rules job and by [insight dismissal](insight-cards.md)

### Change Risks
- **Changing a `SCORE` weight or `THRESHOLD`** silently reorders every teacher's day. `mistap: 0.12` in particular must stay consistent with the `hard` highlight on the [Sessions](sittings.md) table (also `> 0.12`) or the two pages will disagree about what counts as a difficult day.
- **Removing the `if (base.ready)` gate** would flag every newly-onboarded child against thresholds derived from other children — the exact failure `lib/baseline.ts` was written to prevent.
- **Adding a sixth score term** requires updating the MCP `get_attention_queue` scoring block too; otherwise the Ask panel answers a different question than the page.
- **`readMetric` returning `0` instead of `null` for small samples** would turn every quiet child into a false `MISTAP`/`ABANDONMENT` hit, because the comparisons are `> threshold` on a value that is currently guaranteed non-null-checked first.
- **Renaming `fired_rules.fired_at`** breaks both the `INSIGHT` term and the freshness pill in the shell.
- **A child with `class_id = null`** contributes an empty-string placeholder to `classesFor`; if `classes` ever gains a row with an empty `class_id`, that row's name would appear in the page title.
