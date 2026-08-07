# Baseline Gating

## Function
Decides whether a child has accumulated enough of their own history for any threshold in the system to mean anything, and reports how far through that settling-in period they are. Also provides a rolling per-metric mean/stdev for "elevated against their own history" comparisons.

## Purpose
From the file header: *"Every threshold in the system — mis-tap rate, abandonment, the Attention Queue score, all eight insight rules — compares a child against their own history. Before that history exists, a threshold tuned to a different child is worse than no threshold at all. So: numbers are shown from day one, and nothing is flagged until the child has enough of their own data to be compared against."*

The gate counts **active days**, not calendar days, and the header records the case that forced it: *"a child who barely uses the app never accumulates a usable baseline, and a calendar gate would quietly start flagging them at day 14 on almost no data. This is the failure that made Jonah — 8 utterances then silence — the hardest case in the seed set."*

This is also the reason `peer_baseline` was cut in `docs/analytics-metrics.md` §7: *"Insights compare against the child's own 4-week rolling average instead."* `rollingBaseline()` is the TypeScript-side expression of that decision.

## Source Files
| File | Role |
|------|------|
| `lib/baseline.ts` | `BASELINE_ACTIVE_DAYS` / `BASELINE_MIN_UTTERANCES` constants, the `baseline()` readiness gate, and `rollingBaseline()` |

## Implementation

### Constants
```ts
export const BASELINE_ACTIVE_DAYS = 14
export const BASELINE_MIN_UTTERANCES = 40
```
The in-file comment ties these to the docs: *"`docs/aac-clinical-constraints.md` defers to the metrics spec here: 4 weeks of thresholds, 14 active days to arm them."*

### `baseline(childId): Baseline`
```ts
type Baseline = {
  ready: boolean
  activeDays: number
  utterances: number
  progress: number      // 0..1
  reason: string | null
}
```

Query:
```sql
SELECT COUNT(DISTINCT day_local) AS active_days,
       COUNT(*)                  AS utterances
FROM utterances
WHERE child_id = ? AND actor = 'child' AND spoken = 1
```
Both counts are **all-time** — there is no window parameter. Only spoken child utterances count; abandoned compositions and adult (Modeling Mode) rows do not.

Derivation, in order:
1. `dayProgress = Math.min(1, activeDays / 14)`
2. `uttProgress = Math.min(1, utterances / 40)`
3. `progress = Math.min(dayProgress, uttProgress)` — the *slower* of the two axes drives the bar
4. `ready = activeDays >= 14 && utterances >= 40` — both gates, AND
5. `reason` (null when ready): active days are reported first — `` `${activeDays} of 14 active days` `` if that gate is unmet, otherwise `` `${utterances} of 40 sentences` ``

### `rollingBaseline(childId, metricId, days = 28)`
Returns `{ mean, stdev, n } | null` — the child's own recent comparison basis, described in the header as *"the mean and spread of the child's own recent history, which is what 'elevated' has to mean."*

```sql
WITH recent AS (
  SELECT value FROM agg_daily_metric
  WHERE child_id = ? AND metric_id = ? AND value IS NOT NULL
  ORDER BY day_local DESC LIMIT ?
)
SELECT AVG(value) AS mean,
       -- population stdev; SQLite has no stdev()
       SQRT(AVG(value * value) - AVG(value) * AVG(value)) AS sd,
       COUNT(*) AS n
FROM recent
```
- `days` is a **row limit on non-null daily values**, not a date range: 28 rows going backwards, however far back they reach.
- Population (not sample) standard deviation, computed as `SQRT(E[x²] − E[x]²)` because SQLite ships no `stdev()`.
- `if (!row || !row.n) return null` — `n = 0` returns `null` rather than `{mean: 0, stdev: 0}`.
- **No caller in the repository imports `rollingBaseline` today.** The equivalent "own 4-week baseline + 2σ" comparison for I2 currently lives in the SQL rule views (`db/views_insights.sql`).

### How the gate is consumed
- **`lib/queue.ts` (Attention Queue).** `buildQueue()` calls `baseline(child.child_id)` and wraps *every* scoring branch in `if (base.ready) { … }`. A child inside baseline scores `0` with an empty `reasons` array but still returns real roster numbers (`silence`, `tapsPerUtterance`, `independence`, `newWords`) and carries `inBaseline: !base.ready` and `baselineProgress: base.progress`. The file states the addition explicitly: *"Scoring is `docs/analytics-metrics.md` §9, with one addition the spec does not have: a child still inside their baseline window cannot be scored at all."*
- **`app/dashboard/student/[id]/page.tsx`.** Imports `baseline` and `BASELINE_ACTIVE_DAYS`. Passes `inBaseline={!base.ready}` to each `KpiTile`; renders `BaselineBanner` while not ready; and replaces the insight list with an `EmptyState` titled **"No findings during the settling-in period"** whose body reads *"Rules stay off until {firstName} has {BASELINE_ACTIVE_DAYS} active days of her own history to compare against."*
- **`components/status.tsx` → `BaselineBanner`.** Heading **"Still learning what is normal for {name}"**, body *"The numbers below are real. Nothing will be flagged yet — thresholds tuned to a different child would be worse than no thresholds at all."*, a progress bar sized `${Math.round(progress * 100)}%`, and the `reason` string underneath (falling back to `` `${activeDays} of ${targetDays} active days` ``).
- **`components/kpi-tile.tsx`.** `inBaseline` forces `dir = 'flat'` (no green/red) and replaces the delta line with the caption **"still learning what is normal"** — *"'Down 4 points' against three days of history is noise dressed as a finding."*

### Storage keys
Tables read: `utterances` (`baseline`), `agg_daily_metric` (`rollingBaseline`). Read-only, via `one()` from `lib/db.ts`. No writes, no cache — `baseline()` re-queries on every call, once per child per queue build.

## Dependencies & Connections

### Depends On
- `lib/db.ts` (`one`) — read-only `aac.db` access.
- [Database schema](../database/schema.md) — `utterances.spoken`, `utterances.actor`, `utterances.day_local`; `agg_daily_metric(child_id, day_local, metric_id, value)`.
- [Rollup pipeline](../pipeline/l2-rollup.md) — `rollingBaseline` has nothing to read until `agg_daily_metric` is materialised.

### Depended On By
- [Attention Queue](../dashboard/attention-queue.md) — every `QueueReason` is gated on `base.ready`; `inBaseline` and `baselineProgress` are returned on each `QueueEntry`.
- [Student overview](../dashboard/student-overview.md) — banner, insight suppression, and per-tile delta suppression.
- `components/kpi-tile.tsx`, `components/status.tsx` — render the gated states.

### Shared Resources
- `utterances` table — the same rows [Metric Readers](metric-readers.md) uses for `silenceStreak` and `tapsSaved`, and the pipeline uses for the daily rollup.
- The `inBaseline` boolean, threaded from `baseline()` through `QueueEntry`/page props into `KpiTile` — a single flag with three different UI consequences (no colour, no delta, no insights).

## Change Risks
- **Lowering `BASELINE_ACTIVE_DAYS` or `BASELINE_MIN_UTTERANCES`** arms the Attention Queue and the insight list earlier for every child at once. For a low-volume child that is precisely the Jonah failure the header records — 8 utterances then silence, flagged against thresholds derived from nobody.
- **Raising them** silently empties the Attention Queue and the "Needs your attention" panel for children who were previously scored; the dashboard will look broken rather than cautious.
- **Switching `activeDays` to calendar days** breaks the stated design rationale and re-introduces the same failure; the `COUNT(DISTINCT day_local)` is the whole point.
- **Counting non-spoken or adult utterances** (dropping `spoken = 1` or `actor = 'child'`) inflates both counters, so Modeling Mode sessions by a teacher would arm a child's thresholds.
- **Changing `progress` from `Math.min` to an average** would show a child as most of the way through baseline while one gate is still far from met; the banner's progress bar is the only visible promise about when flagging starts.
- **Removing the `base.ready` guard in `lib/queue.ts`** re-enables scoring for children with no history — the single change that would most damage trust in the queue ordering, since the queue is the daily-use surface.
- **`rollingBaseline` is currently dead code.** If a future insight or the dashboard starts using it, note that `days` limits rows, not dates, and that the population stdev is `0` for a child whose metric has been perfectly flat — a `+2σ` comparison against it would fire on any change at all.
