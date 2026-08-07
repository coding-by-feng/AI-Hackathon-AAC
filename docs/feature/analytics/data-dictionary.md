# Data Dictionary (metrics_catalog / insights_catalog reader)

## Function
Reads `metrics_catalog` and `insights_catalog` out of `aac.db` and exposes every metric's name, unit, polarity, tier, `min_n` and caveat — plus every insight's `forbidden_actions`, `target_audience` and `action_kind` — as typed objects. It also owns the two display helpers (`direction()`, `formatValue()`) that turn a raw number into something safe to render.

## Purpose
From the file header: *"Nothing in the UI hardcodes a metric's name, unit, polarity or caveat. A number rendered without those is how a dashboard becomes confidently wrong, which is the same argument `docs/mcp-api.md` §1 makes for the LLM surface."*

`polarity: 'neutral'` is explicitly load-bearing rather than cosmetic. Clinical constraint **C1** (repetition is communication, not error) forbids styling repetition or stimming as a problem, and the only thing that stops the UI doing it is this field — `direction()` returns `'flat'` for a neutral metric regardless of the delta, which is what keeps `repeat_tap_rate` from ever being painted red. `docs/aac-clinical-constraints.md` records this as an enforcement-in-data rule: *"`metrics_catalog.polarity = 'neutral'` blocks red/warning styling."*

## Source Files
| File | Role |
|------|------|
| `lib/catalog.ts` | Loads and caches `metrics_catalog`, reads `insights_catalog` per-id, and provides `direction()` / `formatValue()` |

## Implementation

### Types
```ts
type Polarity     = 'higher_better' | 'lower_better' | 'neutral'
type Tier         = 'P0' | 'P1' | 'P2'
type MetricStatus = 'shown' | 'logged' | 'cut'
```

`MetricMeta` fields: `metric_id`, `name`, `group_code`, `plain_explanation`, `formula`, `unit`, `polarity`, `tier`, `audience`, `min_n`, `feeds_insights: string[]`, `caveat: string | null`, `status`.

`InsightMeta` fields: `insight_id`, `name`, `plain_statement`, `trigger_rule`, `input_metrics: string[]`, `default_thresholds: Record<string, unknown>`, `recommended_actions: string[]`, `forbidden_actions: string[]`, `target_audience: 'child' | 'adult' | 'system'`, `action_kind: 'intervention' | 'informational' | 'system_fix'`, `safety_note: string | null`.

### Metric catalogue — cached for the process lifetime
`metricCatalog()` holds a module-level `let metricCache: Map<string, MetricMeta> | null = null`. On first call it runs:

```sql
SELECT metric_id, name, group_code, plain_explanation, formula, unit,
       polarity, tier, audience, min_n, feeds_insights, caveat, status
FROM metrics_catalog
```

and builds a `Map` keyed on `metric_id`. **The cache is never invalidated** — there is no TTL and no inode re-check, unlike the connection cache in `lib/sqlite.ts`. A rebuild of `aac.db` by `tools/build.sh` mid-process leaves the old catalogue in memory.

- `min_n` is coerced with `Number(r.min_n ?? 1)` — the fallback when the column is null is **1**.
- `feeds_insights` is parsed with `parseJson<string[]>(..., [])`; malformed JSON silently yields `[]`.
- `metric(id)` → `metricCatalog().get(id)`, returns `undefined` for an unknown slug.
- `shownMetrics()` → all entries with `status === 'shown'`. **No caller in the repository imports this function today.**

### Insight catalogue — uncached, one query per call
`insightMeta(id)` runs `SELECT * FROM insights_catalog WHERE insight_id = ?` on every invocation and returns `undefined` when the row is missing. `input_metrics`, `default_thresholds`, `recommended_actions` and `forbidden_actions` are JSON-parsed with `{}`/`[]` fallbacks. Because `lib/insights.ts:hydrate()` calls it once per fired rule, rendering N insights costs N `insights_catalog` queries.

### `direction(metricId, delta)` → `'better' | 'worse' | 'flat'`
Order of checks, exactly as coded:
1. `delta === null || delta === 0` → `'flat'`
2. metric unknown, or `polarity === 'neutral'` → `'flat'`
3. `polarity === 'higher_better'` → `delta > 0 ? 'better' : 'worse'`
4. `polarity === 'lower_better'` → `delta < 0 ? 'better' : 'worse'`

### `formatValue(metricId, value)` → string
`value === null || Number.isNaN(value)` → `'—'`. Otherwise switched on `metric(metricId)?.unit ?? 'count'`:

| `unit` | Output | Example |
|---|---|---|
| `ratio` | `${Math.round(value * 100)}%` | `0.118` → `12%` |
| `ms` | `${(value / 1000).toFixed(1)} s` | `5200` → `5.2 s` |
| `days` | `1 day` when `value === 1`, else `${Math.round(value)} days` | `3.4` → `3 days` |
| `wpm` | `${value.toFixed(1)} wpm` | `4.25` → `4.3 wpm` |
| anything else (incl. `count`, `index`, unknown metric) | `Math.abs(value) >= 10 ? Math.round(value) : value.toFixed(1)` | `3.42` → `3.4`; `21.6` → `22` |

Note the `ratio` branch rounds to a whole percent, while `humanEvidenceValue()` in [Fired Rules & Evidence](fired-rules-and-evidence.md) formats rates to one decimal place (`11.8%`). The two formatters are deliberately separate — evidence keeps the precision the rule compared on, tiles do not.

### Storage keys
Tables read: `metrics_catalog`, `insights_catalog` (both in `aac.db`, via the read-only handle from `lib/db.ts`). Column semantics are pinned in `db/schema.sql`, including the comment that `agg_daily_metric.value` is NULL when `n < metrics_catalog.min_n`.

## Dependencies & Connections

### Depends On
- [Database schema](../database/schema.md) — `metrics_catalog` and `insights_catalog` rows are seeded by the pipeline; every field here is a straight column read.
- `lib/db.ts` (`all`, `one`) — read-only `aac.db` access with the inode-checked handle cache.

### Depended On By
- [Metric Readers](metric-readers.md) — `readMetric()` attaches `MetricMeta` to every `MetricValue` and uses `meta.min_n` as the small-sample cut-off.
- [Fired Rules & Evidence](fired-rules-and-evidence.md) — `hydrate()` attaches `InsightMeta` so `forbidden_actions` / `action_kind` travel with every insight to the UI.
- [Student overview](../dashboard/student-overview.md), [Access view](../dashboard/reach-and-errors.md), [Class view / Attention Queue](../dashboard/attention-queue.md) — all call `formatValue()` for every rendered number.
- `components/kpi-tile.tsx` — calls `direction()` for the delta tone and reads `m.meta.polarity` to decide whether a delta is shown at all (`neutral` renders the literal caption `not a target`), plus `m.meta.plain_explanation` as the tile footnote and `m.meta.min_n` in the `too few to report (needs N)` caption.
- [MCP tool surface](../mcp/tool-surface.md) — serves the same catalogue fields in its `dictionary` envelope (`docs/mcp-api.md` §2), through its own reader in `mcp/`.

### Shared Resources
- `metrics_catalog`, `insights_catalog` tables — shared read-only with the pipeline (writer) and the MCP server (independent reader).
- The process-lifetime `metricCache` `Map` — shared by every server component render in the same Node process.

## Change Risks
- **Adding a metric to `metrics_catalog` without restarting the app shows nothing.** `metricCache` is populated once per process. A metric inserted after first read returns `undefined` from `metric()`, which makes `formatValue()` fall through to the `count` branch and makes `readMetric()` skip the `min_n` suppression entirely (the check is `meta && cur.n < meta.min_n`) — an under-powered value renders as if it were trustworthy.
- **Changing a metric's `polarity` to a non-neutral value re-enables red/green styling for it.** For `repeat_tap_rate`, `cell_heat`, `scene_distribution`, `card_frequency` or any other C1/C6-sensitive signal this directly violates `docs/aac-clinical-constraints.md` ("Never present repetition, stimming, or refusal as a problem"). Nothing in the code guards against it — the constraint lives in the data.
- **Renaming or removing a `unit` value** silently degrades to the default numeric branch: a `ratio` typo would render `0.118` as `0.1` instead of `12%`.
- **Dropping `forbidden_actions` or `action_kind` from `insights_catalog`** breaks the UI rule that an `action_kind: 'informational'` insight renders no action button — the mechanism that stops I4 case B (a child refusing something) turning into a training task.
- **Caching `insightMeta()`** would fix the N+1 query in `openInsights()` but would inherit the same staleness problem as `metricCache`; both need the same invalidation strategy if either gets one.
