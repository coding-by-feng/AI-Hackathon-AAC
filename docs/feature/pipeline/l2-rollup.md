# L2 Rollup

## Function
`tools/rollup.py` materialises the four L2 aggregate tables — `agg_daily_metric`, `agg_card_stats`, `agg_cell_heat`, `agg_word_pairs` — from the metric views, storing the **true** daily value with `n` always alongside, then runs `ANALYZE`. `min_n` suppression is a read-time concern: each reader gates at its own grain.

## Purpose
From the file header: *"The views are the definition; these tables are only a cache. Anything the dashboard asks for over a range longer than a week reads from here, because scanning 180k events per question does not survive a term of real data."*

The `min_n` behaviour is the clinical part, and the docstring on `rollup_daily_metrics` states the current contract: *"min_n suppression is enforced at READ time, at the reader's own grain — never at write time. Writing NULL for a below-min_n day looked safe but destroyed every window aggregate built on top: correction_adjacent_rate runs ~6 corrections/day against min_n=10, so almost every daily row was NULL and a 28-day window with 170 real samples reported from the 53 that happened to cluster (measured: 0.15 shown vs 0.51 true). A day-grain reader (timeseries, charts) masks days below min_n; a window-grain reader (dashboard cards, MCP get_metrics) sums n across the window and suppresses on the WINDOW total. `n` stored per day is what makes both possible, and still distinguishes 'too little data' from 'nothing happened'."*

The store moved to true-value-plus-`n` on 2026-08-08; the full audit trail is in [`docs/feature-verification.md`](../../feature-verification.md) §"Metric-calculation pass".

## Source Files
| File | Role |
|------|------|
| `tools/rollup.py` | All four rollups, CLI, value-less-row count, `ANALYZE` |

## Implementation

### CLI

```bash
python3 tools/rollup.py --db aac.db [--window-days 14]
```

| Flag | Type | Default |
|---|---|---|
| `--db` | str | `<repo root>/aac.db` |
| `--window-days` | int | `28` |

The header's usage example shows `--window-days 14`; the actual default in `argparse` is **28**. `PRAGMA foreign_keys = ON` is set on connect. Every rollup function is idempotent — *"deletes and rewrites the rows it owns"* — so re-running is safe.

### The window expression

Three of the four rollups compute the same pair of date bounds inline via f-string interpolation:

```sql
window_start = date((SELECT MAX(day_local) FROM events), '-{window_days - 1} days')
window_end   = (SELECT MAX(day_local) FROM events)
```

The window is anchored to the **latest day in `events`**, not to wall-clock today.

### `rollup_daily_metrics(conn)` → `agg_daily_metric`

```sql
DELETE FROM agg_daily_metric;
INSERT INTO agg_daily_metric (child_id, day_local, metric_id, value, n)
SELECT v.child_id, v.day_local, v.metric_id, v.value, v.n
FROM v_daily_metrics_all v
WHERE v.day_local IS NOT NULL;
```

- The view's value is stored **verbatim** — no `CASE`, no `min_n` anywhere in the write. Suppression happens in the readers, at two grains: a **day-grain** reader (timeseries, charts) masks individual days below `min_n`; a **window-grain** reader (dashboard cards, MCP `get_metrics`) sums `n` across the window and suppresses on the window total.
- `n` is written unconditionally, which is what makes both reader grains possible and lets a reader distinguish `value IS NULL AND n > 0` ("measured") from `value IS NULL AND n = 0` ("never observed").
- There is no catalogue `JOIN`: a metric produced by a view but absent from `metrics_catalog` is stored anyway — and then caught by `verify.py`'s orphan check (`every stored metric exists in the catalogue`), which fails the build.
- No window filter: **every** day present in the view is stored.

### `rollup_card_stats(conn, window_days)` → `agg_card_stats`

Columns written: `child_id, card_id, window_start, window_end, taps, mistaps, adjacent_corrections, repeat_runs, zero_days, last_used_day, scenes_used`.

Source is `v_card_stats s`, with three `LEFT JOIN`s:
- `v_mistaps` aggregated to `COUNT(*) AS mistaps, SUM(correction_adjacent) AS adjacent` per `(child_id, card_id)`;
- `v_repeat_runs_by_card` on `(child_id, card_id)` → `repeat_runs`;
- `v_scene_matrix` aggregated to `json_group_array(DISTINCT scene)` per `(child_id, label)` → `scenes_used`, defaulting to `'[]'`.

`zero_days` is `s.days_since_last` and `last_used_day` is `s.last_day`. Missing joins are `COALESCE`d to `0`.

Two details worth knowing:
- The `scenes_used` join keys on **`label`**, not `card_id` — cards sharing a label share a scene list.
- `window_start` / `window_end` are *stamped* from `--window-days` but the `SELECT` is **not filtered** by them: `v_card_stats` contributes its full range. The window columns on this table are a label, not a filter.

### `rollup_cell_heat(conn, window_days)` → `agg_cell_heat`

The only rollup that genuinely filters by the window:

```sql
FROM v_cell_heat
WHERE day_local >= date((SELECT MAX(day_local) FROM events), '-{window_days - 1} days')
GROUP BY child_id, board_id, grid_rows, grid_cols, grid_row, grid_col
```

`SUM(taps)`, `SUM(mistaps)`. `grid_rows` and `grid_cols` are part of the grouping key because a coordinate means nothing without the grid size it was recorded on — the same reason `csv_docs.py` warns *"NEVER compare cells across different grid sizes."*

### `rollup_word_pairs(conn, window_days)` → `agg_word_pairs`

Straight copy of `v_word_pairs` (`child_id, word_a, word_b, solo_a, solo_b, together`) with the window bounds stamped on. Like `agg_card_stats`, the window columns do not filter the select.

### `main()` output

After committing the four rollups it counts value-less rows:

```sql
SELECT COUNT(*) FROM agg_daily_metric WHERE value IS NULL
```

then runs `ANALYZE` and commits again. Printed report:

```
rollup complete in 0.42s
  agg_daily_metric      12,345
  agg_card_stats           678
  agg_cell_heat            901
  agg_word_pairs         2,345
  no value from view       123
```

The last line counts rows where `v_daily_metrics_all` itself produced a NULL `value` — nothing to do with `min_n`, which plays no part in the write. (The label used to read `suppressed (n<min_n)`, a leftover from the write-time scheme; it now names what it counts.) Row counts come from `cur.rowcount` on each `INSERT … SELECT`. Return code is always `0` — this script has no failure mode of its own; the gate is [Clinical Safety Verification Gate](verification-gate.md).

## Dependencies & Connections

### Depends On
- [Seed Cohort Generation](seed-generation.md) — the `events`, `utterances` and `partner_turns` rows the views scan
- [Analytics Schema and Indices](../database/schema.md) — the `agg_*` table definitions, `metrics_catalog.min_n`, and every `v_*` view in `db/views_metrics.sql`
- [Deterministic Build Pipeline](build-pipeline.md) — stage 5/7

### Depended On By
- [Nightly Rule Materialisation](rule-materialisation.md) — runs after this in the build; `verify.py`'s C4 check reads `agg_daily_metric` for `position_consistency`
- [Clinical Safety Verification Gate](verification-gate.md) — the `every stored value carries the n a reader gates on`, `no duplicate metric rows`, orphan and `DIMENSIONAL` checks all read these tables
- [Metric Readers](../analytics/metric-readers.md) — the dashboard's metric reads
- [MCP stdio Server](../mcp/stdio-server.md) — `get_metrics`, `get_card_stats`, `get_cell_heat`, `get_word_pairs` serve from these tables, which is what keeps reader p99 in single-digit milliseconds (see [Pre-Demo Test Harnesses](test-harnesses.md))
- [CSV Export](csv-export.md) — `metrics_daily_long.csv`, `metrics_daily_wide.csv`, `card_stats.csv`, `cell_heat.csv`, `word_pairs.csv`

### Shared Resources
- Tables `agg_daily_metric`, `agg_card_stats`, `agg_cell_heat`, `agg_word_pairs` — fully rewritten on every run
- `metrics_catalog.min_n` — still the single source of the suppression threshold, but consumed by the **readers** (`lib/metrics.ts`, `lib/report.ts`, `lib/baseline.ts`, `mcp/tools.ts`), not by this script; the rollup neither reads nor applies it
- SQLite `sqlite_stat1` (written by `ANALYZE`)

## Change Risks
- **Suppression lives in the readers now, so every consumer must gate — and a new reader that forgets publishes under-powered numbers with no check catching it.** The readers that gate today: `lib/metrics.ts` (window-grain for dashboard cards; day-grain masking in the timeseries read), `lib/report.ts` (trend buckets mask days below `min_n`), `lib/baseline.ts` (day-grain `a.n >= mc.min_n`), and MCP `get_metrics` / `get_metric_timeseries` in `mcp/tools.ts` (window-grain and day-grain respectively). `export_csv.py` deliberately does **not** gate — it ships `value`, `n` and `min_n` and leaves gating to whoever opens the file, though its `status` column still derives from `value IS NULL` and is stale (see [CSV Export](csv-export.md)). `verify.py` only asserts that `n` rides with every value; it cannot catch a reader that ignores it.
- **Re-introducing write-time suppression — `NULL` or `0` below `min_n` —** re-creates the corruption the docstring measures: a 28-day window with 170 real samples reporting 0.15 from the 53 that cleared the daily bar, against a true 0.51. Window aggregates are only right because every day's true value is stored.
- **Dropping the `n` column write** removes the only way to distinguish "too thin" from "never happened" — and now also fails the build: `verify.py` asserts every stored value carries an `n`.
- **Changing `--window-days`** only changes `agg_cell_heat`'s content; for `agg_card_stats` and `agg_word_pairs` it changes the *labels* on rows whose content is unchanged, which is a silent inconsistency if someone starts trusting those columns as filters.
- **`DELETE` + `INSERT` with no transaction boundary of its own**: the four rollups share one `conn` and one `commit()` at the end, so a crash mid-run leaves the aggregates empty rather than stale-but-consistent. Any reader hitting the database during a rollup can see a partially rebuilt cache.
- **Adding a metric to a view without adding it to `metrics_catalog`** no longer makes it vanish — there is no catalogue `JOIN`, so its rows are stored and `verify.py`'s orphan check fails the build loudly. Adding it to the catalogue with `status='shown'` but producing no rows fails *"no unexplained empty metric"* unless it is registered in `DIMENSIONAL` or `NOT_YET_GENERATED`.
- **Removing `ANALYZE`** removes the query-planner statistics the concurrency test's p99 budget depends on.
