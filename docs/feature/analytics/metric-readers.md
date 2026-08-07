# Metric Readers

## Function
The read layer the dashboard renders from: scalar metrics rolled up out of `agg_daily_metric` over a `Window`, plus the dimensional reads (top cards, new words, cell heat, abandonment trend) and the Group F "AI value" reads that go straight to the event log.

## Purpose
From the file header: *"Scalar metrics come from `agg_daily_metric`, which `tools/rollup.py` materialises from `v_daily_metrics_all`. Dimensional metrics (per card, per cell, per pair, per scene) come from their views directly — they have no scalar form and never appear in `agg_daily_metric`."*

And the rule that shapes the return type: *"Every returned value carries `n`. A rate computed from four sentences is not the same claim as one computed from forty-seven, and the UI is required to say so."* This is `docs/mcp-api.md` §1 principle 1 ("a bare number is a trap") applied to the web dashboard.

The module also enforces the three-state distinction that `docs/analytics-metrics.md` demands and that `eventTypeCollected()` documents in-file: *the client does not emit this yet* → **not collected**; *it emits and the count is zero* → **a real zero**; *the sample is too small to report* → **suppressed**. Conflating the first two is called out in the source as "the classic analytics lie".

## Source Files
| File | Role |
|------|------|
| `lib/metrics.ts` | All metric read functions, the rollup mode table, suppression logic, and the dimensional/Group-F queries |

## Implementation

### `MetricValue` — the shape every scalar read returns
```ts
type MetricValue = {
  metric_id: string
  meta: MetricMeta | undefined     // from lib/catalog.ts
  value: number | null
  n: number
  comparison: number | null        // same metric, previous window
  delta: number | null             // value - comparison
  daysWithData: number
  suppressed: 'small_sample' | 'not_collected' | null
}
```

### Rollup modes — `ROLLUP`
`type Rollup = 'sum' | 'weighted_mean' | 'last'`. The header explains why the catalogue's `unit` cannot answer this: *"`taps_per_utterance` and `new_words` are both `count`, but the first is a per-sentence median that must be averaged and the second is a daily tally that must be summed. Summing seven daily medians reports a child pressing 21 buttons per sentence."*

| Mode | Metric ids |
|---|---|
| `sum` (genuine daily tallies) | `new_words`, `teacher_modeling`, `taps_saved`, `vocabulary_gaps`, `layout_stability`, `cell_heat`, `card_frequency`, `word_pairs`, `scene_distribution`, `keyboard_use` |
| `last` (point-in-time; newest value is the only meaningful one) | `silence_streak`, `zero_activation_days`, `position_consistency` |
| `weighted_mean` | **default** for every other metric id (`rollupFor()` = `ROLLUP[metricId] ?? 'weighted_mean'`) |

SQL per mode, in `aggregate(metricId, childId, w)`:

- `sum` → `SELECT SUM(value) AS value, SUM(n) AS n, COUNT(value) AS days FROM agg_daily_metric WHERE child_id = ? AND metric_id = ? AND day_local BETWEEN ? AND ?`
- `weighted_mean` → same query with `SUM(value * n) / NULLIF(SUM(n), 0)` as the value expression, "so a day with three sentences does not carry the same weight as a day with forty"
- `last` → `SELECT value, n, 1 AS days ... AND value IS NOT NULL ORDER BY day_local DESC LIMIT 1`

### `readMetric(metricId, childId, w)` — step by step
1. `meta = metric(metricId)` from the [data dictionary](data-dictionary.md).
2. `cur = aggregate(metricId, childId, w)`.
3. `prev = aggregate(metricId, childId, previousWindow(w))` — `previousWindow()` from `lib/db.ts` returns the immediately preceding block of the same length.
4. `everRecorded` = `cur.days > 0 || prev.days > 0 ||` a fallback `SELECT COUNT(*) c FROM agg_daily_metric WHERE metric_id = ? LIMIT 1` — note this fallback is **not scoped to `child_id`**, deliberately: it answers "does the pipeline produce this metric at all", not "does this child have it".
5. Suppression, in this order:
   - `!everRecorded` → `value = null`, `suppressed = 'not_collected'`
   - `meta && cur.n < meta.min_n` → `value = null`, `suppressed = 'small_sample'`
   - a metric with no catalogue row is **never** suppressed for small sample (the `meta &&` guard).
6. `comparison = prev.value` — **the previous window is not min_n-suppressed**; a comparison can come from a sample smaller than `meta.min_n`.
7. `delta = value !== null && comparison !== null ? value - comparison : null`.

`readMetrics(ids, childId, w)` maps `readMetric` over an array. **No caller imports it today.**

### `silenceStreak(childId)` — point-in-time, not windowed
```sql
SELECT CAST(julianday((SELECT MAX(day_local) FROM events))
          - julianday(MAX(day_local)) AS REAL) AS v
FROM utterances
WHERE child_id = ? AND actor = 'child' AND spoken = 1
```
Returns `Math.max(0, Math.round(Number(row?.v ?? 999)))`. "Today" is the **latest `day_local` in the whole `events` table**, not wall-clock now and not the child's own latest day — the same convention as `latestDay()` in `lib/db.ts`. A child with no spoken utterances yields `999`.

### Dimensional reads — from views/tables, never `agg_daily_metric`

**`topCards(childId, w, limit = 8): CardStat[]`** — `events JOIN cards` on `actor = 'child' AND type = 'card_tap'`, grouped by `(card_id, label)`, ordered `taps DESC`. Returns `taps`, `active_days` (`COUNT(DISTINCT day_local)`), `scene_count` (`COUNT(DISTINCT scene)`), `avg_nav_depth` (`AVG(COALESCE(nav_depth, 0))`), `last_day` (`MAX(day_local)`), plus `is_core` / `is_essential` from `cards`.
**Stub:** `days_since_last` is selected as the literal `0 AS days_since_last`. The field exists on the `CardStat` type and is always zero — nothing computes it.

**`newWords(childId, w, limit = 8): NewWord[]`** — a `firsts` CTE takes `MIN(day_local)` per `label` over **all history** (no window filter inside the CTE), then filters `first_day BETWEEN start AND end`, ordered `first_day DESC`. This is a first-*ever* use, not a first-use-in-window.

**`cellHeat(childId, w): HeatGrid | null`** — keyed on the child's **robust board**:
```sql
SELECT board_id, name, grid_rows, grid_cols FROM boards
WHERE child_id = ? AND kind = 'robust' ORDER BY created_at LIMIT 1
```
Returns `null` when the child has no robust board. The header states why this board and not the active mode: *"A mode holds no coordinates of its own (clinical constraint C4) — it is a filtered view of the robust board — so heat belongs to the robust layout and merging grid sizes would make the coordinates mean two different things."*

Cells come from `board_cells LEFT JOIN cards` (so every cell of the layout appears, including empty ones) `LEFT JOIN` a grouped subquery over `agg_cell_heat` with `COALESCE(h.taps, 0)` / `COALESCE(h.mistaps, 0)`. The heat subquery filters `window_start >= ? AND window_end <= ?` — it only picks up materialised heat windows **fully contained** in the requested window; a rollup window that straddles either edge contributes nothing.

`resizedInWindow` is `true` when `SELECT COUNT(*) FROM board_revisions WHERE board_id = ? AND change_kind = 'resize' AND day_local BETWEEN ? AND ?` is non-zero — the flag the UI needs because, per constraint C2, coordinates are not comparable across a resize. This mirrors the MCP contract's `LAYOUT_CHANGED_MID_WINDOW` guidance code.

**`abandonmentTrend(childId, w): AbandonPoint[]`** — raw per-day rows straight out of `agg_daily_metric` for `metric_id = 'abandonment_rate'`, ordered `day_local`. No `min_n` suppression is applied here; the pipeline already nulls `value` when `n < min_n`, so a point's `rate` can be null despite the `number` type on `AbandonPoint`.

### Group F — AI value, read from the event log
The section comment is explicit: *"These read the event log directly rather than `agg_daily_metric`, because the suggestion and gap events they depend on are not yet emitted by any client. Returning zeroes would be a lie; the callers render an explicit 'not collected yet' state instead."*

| Function | Source | Notes |
|---|---|---|
| `suggestionFunnel(childId, w)` | `events` (`suggestion_shown`, `suggestion_tap`) + `utterances` (`used_suggestion = 1 AND spoken = 1`) | `acceptance = shown > 0 ? tapped / shown : null`; `collected = shown > 0` |
| `tapsSaved(childId, w)` | `utterances` where `actor = 'child' AND spoken = 1` | `saved = (withoutAi - withAi) * uses`; also returns `nWithout` / `nWith` |
| `vocabularyGaps(childId, w)` | `events` where `type = 'gap_detected'` and `json_extract(payload,'$.resolvedBy') = 'generated'`, grouped by `json_extract(payload,'$.normalizedConcept')` | returns `asked`, `GROUP_CONCAT(DISTINCT scene)`, `GROUP_CONCAT(DISTINCT day_local)` |
| `visualSourceSplit(childId, w)` | `events` where `type = 'gap_detected'`, grouped by `$.resolvedBy` | ordered `count DESC` |
| `eventTypeCollected(type)` | `SELECT COUNT(*) c FROM (SELECT 1 FROM events WHERE type = ? LIMIT 1)` | global across all children, not per child |

**`tapsSaved` discrepancy worth knowing:** its header says *"Both arms are restricted to spoken utterances so the two medians describe the same population"*, and `docs/analytics-metrics.md` F2 specifies medians — but the SQL uses `AVG(CASE WHEN used_suggestion = 0 THEN tap_count END)` and `AVG(CASE WHEN used_suggestion = 1 THEN tap_count END)`. The implementation computes **means**, not medians. The population fix the comment describes (both arms restricted to `spoken = 1`) *is* implemented: *"An earlier version compared a mean including abandoned attempts against a mean that excluded them, which flattered the result."*

### Storage keys
Tables read: `agg_daily_metric`, `agg_cell_heat`, `events`, `utterances`, `cards`, `boards`, `board_cells`, `board_revisions`. All reads go through `all()` / `one()` in `lib/db.ts`, which opens `aac.db` with `{ readOnly: true }`. This module performs **no writes**.

## Dependencies & Connections

### Depends On
- [Data Dictionary](data-dictionary.md) — `metric()` supplies `meta` and the `min_n` used for `small_sample` suppression.
- `lib/db.ts` — `all`, `one`, `type Window`, `previousWindow`, and the `latestDay()` convention that anchors `silenceStreak`.
- [Rollup pipeline](../pipeline/l2-rollup.md) — `tools/rollup.py` materialises `agg_daily_metric` from `v_daily_metrics_all` and `agg_cell_heat`; if it has not run, every scalar metric reports `not_collected`.
- [Database schema](../database/schema.md) — `agg_daily_metric.value` is already NULL when `n < min_n` at write time; this module applies the same rule again at read time over the rolled-up window.

### Depended On By
- [Student overview](../dashboard/student-overview.md) — `readMetric('taps_per_utterance' | 'independence_rate' | 'words_per_minute' | 'repeat_tap_rate')`, `silenceStreak`, `topCards`, `newWords(windowOf(14))`, `abandonmentTrend(windowOf(14))`.
- [Access view](../dashboard/reach-and-errors.md) — `readMetric('mistap_rate' | 'correction_adjacent_rate' | 'composition_time' | 'time_to_first_tap')` and `cellHeat`.
- [AI impact view](../dashboard/student-overview.md) — `tapsSaved`, `suggestionFunnel`, `vocabularyGaps`, `visualSourceSplit`, and `eventTypeCollected('suggestion_shown')` / `eventTypeCollected('gap_detected')` to choose between a real zero and a "not recorded" panel.
- [Attention Queue](../dashboard/attention-queue.md) (`lib/queue.ts`) — `silenceStreak` plus `readMetric` for `abandonment_rate`, `mistap_rate`, `taps_per_utterance`, `independence_rate`.
- `components/kpi-tile.tsx` — consumes `MetricValue` directly: renders `—` when `suppressed`, the caption `not recorded yet` for `not_collected`, `too few to report (needs {min_n})` for `small_sample`, and always prints `n = {n}` when `n > 0`.
- `components/heat-grid.tsx` — consumes the `HeatGrid` type.

### Shared Resources
- `agg_daily_metric` — written by the rollup pipeline, read here and by the MCP server.
- `events` / `utterances` — owned by the ingest pipeline; read-only here.
- The cached read-only `aac.db` handle (`connect('aac:read', …)` in `lib/sqlite.ts`), shared with every other `lib/` reader.

## Change Risks
- **Adding a new daily-tally metric without adding it to `ROLLUP`** makes it default to `weighted_mean`. A weekly total then renders as a per-day average — the exact failure the header warns about in reverse.
- **Moving a metric between `sum` and `weighted_mean`** changes the number on the tile *and* the number `delta` is computed from, so the previous-window comparison silently shifts meaning too.
- **Changing `min_n` in `metrics_catalog`** immediately changes which tiles read `—` / `too few to report`. Lowering it below the sample the rules were tuned on re-exposes numbers `docs/analytics-metrics.md` deliberately withholds.
- **Making the `everRecorded` fallback query child-scoped** would flip every metric a given child lacks from `small_sample`/real-zero to `not_collected`, which the UI renders as "the client does not emit this" — a false statement about the product, not just about the child.
- **Suppressing the previous window by `min_n` too** would remove most deltas on low-volume children; conversely, leaving it as-is means a `delta` can be computed against an under-powered comparison. Either choice needs a matching change in `components/kpi-tile.tsx`, which already hides deltas during the [baseline window](baseline-gating.md).
- **Changing `cellHeat`'s board selection** (for example to the active mode) breaks constraint **C4**: a mode holds no coordinates of its own, so heat would be attributed to positions that do not exist, and grids of different sizes would be merged — the thing `agg_cell_heat`'s primary key was designed to prevent.
- **Relaxing the `window_start >= ? AND window_end <= ?` containment filter** in `cellHeat` would double-count overlapping materialised windows.
- **Emitting `suggestion_shown` / `suggestion_tap` / `gap_detected` from a client** flips `eventTypeCollected()` to true and switches the AI impact view from "not recorded" panels to live numbers with no code change — which is the intent, but means the first real event silently changes the page.
- **Fixing `tapsSaved` to use a true median** will change the headline product number on the demo surface; the spec (F2) asks for a median, the code computes a mean.
- **Anything relying on `CardStat.days_since_last`** gets `0` for every card. It is a stub, not a computed value.
