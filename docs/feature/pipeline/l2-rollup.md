# L2 Rollup

> **Calculation-correctness pass (2026-08-08).** `rollup_daily_metrics` no longer NULLs values below min_n at write time — that destroyed window aggregates for sparse metrics (correction_adjacent_rate read 0.15 from 53 samples when 170 said 0.51). The store keeps value+n for every day; each reader suppresses at its own grain, and `verify.py` now gates on 'every stored value carries the n a reader gates on'. Full audit trail:
> [`docs/feature-verification.md`](../../feature-verification.md) §"Metric-calculation pass".


## Function
`tools/rollup.py` materialises the four L2 aggregate tables — `agg_daily_metric`, `agg_card_stats`, `agg_cell_heat`, `agg_word_pairs` — from the metric views, applying `min_n` suppression at write time, then runs `ANALYZE`.

## Purpose
From the file header: *"The views are the definition; these tables are only a cache. Anything the dashboard asks for over a range longer than a week reads from here, because scanning 180k events per question does not survive a term of real data."*

The `min_n` behaviour is the clinical part, and the docstring on `rollup_daily_metrics` states why: *"A value below its minimum sample size is stored as NULL, never as the misleading number. `n` is always stored, so a reader can tell 'too little data' from 'nothing happened' — those are different, and a dashboard that conflates them tells a teacher a child went quiet when they did not."*

## Source Files
| File | Role |
|------|------|
| `tools/rollup.py` | All four rollups, CLI, suppression counting, `ANALYZE` |

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
SELECT v.child_id, v.day_local, v.metric_id,
       CASE WHEN v.n >= mc.min_n THEN v.value ELSE NULL END,
       v.n
FROM v_daily_metrics_all v
JOIN metrics_catalog mc ON mc.metric_id = v.metric_id
WHERE v.day_local IS NOT NULL;
```

- Suppression is **write-time**, keyed on `metrics_catalog.min_n` per metric.
- `n` is written unconditionally, which is what lets a reader distinguish `value IS NULL AND n > 0` ("measured, too thin to publish") from `value IS NULL AND n = 0` ("never observed").
- The `JOIN` means a metric produced by a view but absent from `metrics_catalog` is silently dropped — `verify.py` separately asserts there are no orphan rows in the other direction.
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

After committing the four rollups it counts suppressed rows:

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
  suppressed (n<min_n)     123
```

Row counts come from `cur.rowcount` on each `INSERT … SELECT`. Return code is always `0` — this script has no failure mode of its own; the gate is [Clinical Safety Verification Gate](verification-gate.md).

## Dependencies & Connections

### Depends On
- [Seed Cohort Generation](seed-generation.md) — the `events`, `utterances` and `partner_turns` rows the views scan
- [Analytics Schema and Indices](../database/schema.md) — the `agg_*` table definitions, `metrics_catalog.min_n`, and every `v_*` view in `db/views_metrics.sql`
- [Deterministic Build Pipeline](build-pipeline.md) — stage 5/7

### Depended On By
- [Nightly Rule Materialisation](rule-materialisation.md) — runs after this in the build; `verify.py`'s C4 check reads `agg_daily_metric` for `position_consistency`
- [Clinical Safety Verification Gate](verification-gate.md) — the `no value published below its min_n`, `no duplicate metric rows`, orphan and `DIMENSIONAL` checks all read these tables
- [Metric Readers](../analytics/metric-readers.md) — the dashboard's metric reads
- [MCP stdio Server](../mcp/stdio-server.md) — `get_metrics`, `get_card_stats`, `get_cell_heat`, `get_word_pairs` serve from these tables, which is what keeps reader p99 in single-digit milliseconds (see [Pre-Demo Test Harnesses](test-harnesses.md))
- [CSV Export](csv-export.md) — `metrics_daily_long.csv`, `metrics_daily_wide.csv`, `card_stats.csv`, `cell_heat.csv`, `word_pairs.csv`

### Shared Resources
- Tables `agg_daily_metric`, `agg_card_stats`, `agg_cell_heat`, `agg_word_pairs` — fully rewritten on every run
- `metrics_catalog.min_n` is the single source of the suppression threshold
- SQLite `sqlite_stat1` (written by `ANALYZE`)

## Change Risks
- **Moving suppression out of the rollup and into the reader** means every consumer must reimplement it. `export_csv.py` derives its `status` column from `value IS NULL` + `n`, the MCP envelope derives `suppressed_reason` the same way, and `verify.py` asserts `value IS NOT NULL AND n < min_n` never happens. All three break together.
- **Writing `0` instead of `NULL` for a suppressed value** is the specific failure the docstring warns about: a dashboard would show a child had gone quiet when they had not, and Excel would sum the zeros.
- **Dropping the `n` column write** removes the only way to distinguish "too thin" from "never happened".
- **Changing `--window-days`** only changes `agg_cell_heat`'s content; for `agg_card_stats` and `agg_word_pairs` it changes the *labels* on rows whose content is unchanged, which is a silent inconsistency if someone starts trusting those columns as filters.
- **`DELETE` + `INSERT` with no transaction boundary of its own**: the four rollups share one `conn` and one `commit()` at the end, so a crash mid-run leaves the aggregates empty rather than stale-but-consistent. Any reader hitting the database during a rollup can see a partially rebuilt cache.
- **Adding a metric to a view without adding it to `metrics_catalog`** makes it vanish at the `JOIN`; adding it to the catalogue with `status='shown'` but producing no rows makes `verify.py` fail with *"no unexplained empty metric"* unless it is registered in `DIMENSIONAL` or `NOT_YET_GENERATED`.
- **Removing `ANALYZE`** removes the query-planner statistics the concurrency test's p99 budget depends on.
