# MCP Tool Surface and Guidance Envelope

## Function
Twenty typed tools that read the AAC analytics database and return the universal envelope from `docs/mcp-api.md` §2 — `data`, `meta`, `dictionary`, `guidance`, `forbidden_actions`, `next_calls` — with the interpretation warnings computed server-side from the actual result rather than left to the model to remember.

## Purpose
The file header states the whole point:

> The `guidance` array is the point of this file. A model that has to REMEMBER to check whether the layout changed mid-window will eventually forget, and then it tells a teacher a child regressed when an adult moved a button. So the server computes the warnings and attaches them to the result that needs them.

Everything else follows from that. A bare number is a trap, so every value ships with its unit, polarity, sample size and caveat pulled from `metrics_catalog` — never hardcoded. `direction` is resolved through polarity once, here, so the model never has to decide whether "up" is good. `forbidden_actions` travels in-band with the payload, so the clinical constraints C1–C8 (`docs/aac-clinical-constraints.md`) reach the model as data rather than as prompt text it might ignore.

Several tools exist only because of a constraint: `get_partner_metrics` is separate from the child's numbers because of C7 (slow output may be the partner's fault); `get_board_revisions` and I8 exist because of C2/C4 (a system that recommends layout changes must measure the harm they cause); `propose_board_change` excludes `move`/`resize`/`remove` at the schema level because of C2/C3.

## Source Files
| File | Role |
|------|------|
| `mcp/tools.ts` | The `tools` export (20 tool definitions), the `Envelope`/`Guidance` types, `resolveWindow`, `computeGuidance`, `base`, `dictionaryFor`, `sliceMetrics`/`bucketExpr`, and the `SLICEABLE_IDS` / `WINDOWS` / `SUM_METRICS` / `LAST_METRICS` / `DIMENSIONAL` / `SPATIAL` tables |

## Implementation

### The envelope

```ts
interface Envelope {
  data: Record<string, unknown>
  meta: Record<string, unknown>
  dictionary?: Record<string, Row>
  guidance?: Guidance[]
  forbidden_actions?: string[]
  next_calls?: { tool: string; args: Record<string, unknown>; because: string }[]
}

interface Guidance {
  level: 'info' | 'warning' | 'critical'
  code: string
  detail: string
  affects?: string[]
}
```

`base(db, childId, w, rowCount, truncated = false)` builds `meta`:

```
{ child_id, window: { start, end, days }, row_count, truncated,
  data_freshness: { rollup_through: MAX(day_local) FROM agg_daily_metric,
                    live_from:      MAX(day_local) FROM events,
                    is_partial_day: w.end === live_from } }
```

`docs/mcp-api.md` §2 also documents a `meta.generated_at` epoch field. **It is not emitted.**

`dictionaryFor(db, metricIds)` returns `{ [metric_id]: row }` selecting `metric_id, name, group_code, plain_explanation, formula, unit, polarity, tier, min_n, caveat` from `metrics_catalog`. It returns `{}` for an empty id list.

### Windows

```ts
const WINDOWS = { today: 1, last_7d: 7, last_14d: 14, last_28d: 28, term: 90 }
```

`resolveWindow(db, window = 'last_7d', start?, end?)`:

1. `maxDay = SELECT MAX(day_local) FROM events` — **every window is anchored to the newest event day, not to wall-clock today.** A stale database yields a stale but self-consistent window.
2. `window === 'custom'` → requires both `start` and `end`, else `McpError('SQL_REJECTED', 'custom window needs start and end')`. `days = round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1`. More than **120** days → `McpError('WINDOW_TOO_LARGE', '<days> days requested; maximum is 120.', retryable = true)`.
3. Otherwise `days = WINDOWS[window]`; an unknown token **throws** `McpError('SQL_REJECTED', "'<window>' is not a window. Allowed: today, last_7d, last_14d, last_28d, term, custom.")`. The in-code comment: *"Loud rejection, not a silent 7-day fallback: a model that asked for '28d' and silently received 7 days of numbers would caption them as a month — the wrong window is worse than no answer."* A known token resolves to `start = date(maxDay, '-<days-1> days')`, `end = maxDay`.

The rejection is two-layered. Over stdio, `validateArgs` rejects a bad token first on the two tools whose schema declares the window enum (`get_metrics`, `get_report_set`); over HTTP, `app/api/mcp/route.ts` skips `validateArgs` entirely, so `resolveWindow`'s own throw is what the caller sees. `tools/test-api.sh` L5 pins the HTTP path: `get_metrics` with `window: "28d"` must come back "rejected" (message contains "not a window"), never a silent 7-day answer.

### `computeGuidance(db, childId, w, metrics = [])`

Order matters: `critical` items invalidate comparisons outright and are meant to be read before any number. Every check below runs on every call that passes a `childId`.

| Code | Level | Trigger (exact) | `affects` |
|---|---|---|---|
| `SMALL_SAMPLE` | warning | metrics with `value === null && n > 0` | those metric ids |
| `NOT_COLLECTED` | info | metrics with `value === null && n === 0` | those metric ids |
| `PARTIAL_WINDOW` | info | `w.end === MAX(day_local) FROM events` | — |
| `LAYOUT_CHANGED_MID_WINDOW` | **critical** | any `board_revisions` row for the child with `change_kind IN ('move','resize','remove')` and `day_local BETWEEN start AND end` | `cell_heat`, `mistap_rate`, `correction_adjacent_rate`, `taps_per_utterance` |
| `GRID_RESIZED_MID_WINDOW` | **critical** | same query, when any of those rows is a `resize` (replaces the code above) | same four |
| `BASELINE_THIN` | warning | `COUNT(DISTINCT day_local) FROM events` for the child `< 14` | — |
| `ABSENCE_IN_WINDOW` | info | `julianday(w.end) - julianday(MAX(day_local))` over `utterances WHERE spoken = 1` `>= 2` | — |
| `SCENE_MOSTLY_UNKNOWN` | warning | `AVG(scene = 'unknown')` over events in window `> 0.4` | — |
| `MODELING_MODE_UNUSED` | warning | `COUNT(DISTINCT day_local) FROM events WHERE actor = 'adult'` `=== 0` | `teacher_modeling` |
| `HIGH_REPETITION_NEUTRAL` | info | `AVG(value)` of `repeat_tap_rate` in `agg_daily_metric` over the window `> 0.15` | `repeat_tap_rate` |
| `PARTNER_WAIT_SHORT` | warning | `AVG(ms_to_next_partner_turn)` over `partner_turns WHERE child_responded = 0` `< 2000` | `time_to_first_tap`, `abandonment_rate` |

Three distinct reasons a value can be null are kept apart deliberately — the comment says conflating them "is how a model concludes a child stopped doing something they were never measured on". `SMALL_SAMPLE` text: *"measured, but too few observations to report. NOT zero, and NOT 'did not happen'."* `NOT_COLLECTED` text: *"the feature that produces them is not in use for this child. Draw no conclusion from their absence."*

`HIGH_REPETITION_NEUTRAL` carries constraint C1 verbatim: *"This is NOT an error: it is exploration, motor learning, gestalt processing or stimming. If vocabulary coverage is thin here, treat it as a possible vocabulary gap — never as a mistake to correct."*

`PARTNER_WAIT_SHORT` carries C7: *"AAC output runs around 15 words per minute; any finding about the child being slow is confounded by this."* Its detail reads *"The adult waits about X ms on average before speaking again"* — an `AVG(ms_to_next_partner_turn)` labelled as an average. (The mean-under-a-median's-name problem survives only in `get_partner_metrics`' `median_wait_ms` field, below.)

Three codes documented in `docs/mcp-api.md` §6 are **not implemented**: `MODE_POSITION_DRIFT`, `CONSENT_LIMITED`, `GESTALT_FLAG`. Three more are emitted only by individual tools: `SLICED_RECOMPUTED`, `AGGREGATED_PERIOD`, `PREVIOUSLY_DISMISSED`.

### Dimensional slicing

`agg_daily_metric` has exactly one dimension — the day. Anything sliced by scene, hour or weekday has to be recomputed from L0/L1, so only nine metrics are sliceable:

```ts
const SLICEABLE_IDS = [
  'mistap_rate', 'taps_per_utterance', 'abandonment_rate', 'independence_rate',
  'mlu', 'composition_time', 'time_to_first_tap', 'ndw', 'core_fringe_ratio',
]
```

`type Dimension = 'scene' | 'hour' | 'day_of_week'`. `bucketExpr(dim, tzParam, tsCol, dayCol)` returns:

- `scene` → the `scene` column
- `hour` → `CAST(strftime('%H', (ts + <tz> * 60000) / 1000, 'unixepoch') AS INTEGER)` — `ts` is epoch ms UTC; the child's own offset makes it a local hour
- `day_of_week` → `CAST(strftime('%w', day_local) AS INTEGER)`, then mapped through `['Sun','Mon','Tue','Wed','Thu','Fri','Sat']`

The timezone comes from `SELECT COALESCE(MAX(tz_offset_min), 0) FROM events WHERE child_id = ?`.

Each sliced row is `{ metric_id, bucket, value, n, suppressed_reason }`. `value` is `Math.round(v * 10000) / 10000` only when `n >= min_n` (read per-metric from `metrics_catalog`, defaulting to `1`) and the raw value is non-null; otherwise `null`. `suppressed_reason` is `'not_collected'` when the raw value was null, `'small_sample'` when `n < min_n`, else `null`.

Asking for an unsliceable metric is an **error, never a silently blended number** — see `get_metrics` below.

### The 20 tools

| Tool | Required args | Default window | Writes |
|---|---|---|---|
| `list_children` | `adult_id` | last_14d | no |
| `get_child_profile` | `child_id` | last_28d | no |
| `get_metrics` | `child_id` | last_7d | no |
| `get_metric_timeseries` | `child_id`, `metric_id` | last_28d (or custom via `from`) | no |
| `get_card_stats` | `child_id` | last_28d | no |
| `get_cell_heat` | `child_id` | last_28d | no |
| `get_word_pairs` | `child_id` | last_28d | no |
| `get_scene_breakdown` | `child_id` | last_28d | no |
| `get_utterances` | `child_id` | last_7d | no |
| `get_partner_metrics` | `child_id` | last_14d | no |
| `get_board_revisions` | `child_id` | last_28d | no |
| `get_fired_rules` | `child_id` | last_14d | no |
| `get_attention_queue` | `class_id` | last_7d | no |
| `get_report_set` | `child_id` | last_28d | no |
| `get_insight_history` | `child_id` | last_28d | no |
| `compare_windows` | `child_id`, `window_a`, `window_b` | explicit | no |
| `get_board_layout` | `child_id` | last_28d | no |
| `write_insight` | `fired_rule_id`, `narration`, `confidence`, `model` | last_7d | **yes** |
| `propose_board_change` | `child_id`, `change_kind`, `card_id`, `rationale` | last_7d | **yes** |
| `query` | `sql` | last_28d | no |

`docs/mcp-api.md` §3 says "Nineteen tools"; `docs/mcp-clients.md` §5 says "Fourteen tools and four resources". The implementation exports **twenty**.

---

#### `list_children`
*"Children this adult may see, with the triage numbers. Always the first call."*

Joins `children` to `roster` on `adult_id`, excluding expired grants (`r.expires_at IS NULL OR r.expires_at > strftime('%s','now') * 1000`). Optional `class_id` filter. Per child it computes `active_days_last_14` (distinct event days since `date(MAX(day_local), '-13 days')`), `silence_streak_days` (days since the last `spoken = 1` utterance), and `open_insight_count` (rows in `v_insights_fired`). Ordered `silence_streak_days DESC, display_name`. Empty result → `McpError('NOT_AUTHORISED', 'No children are rostered to <adult_id>.')`.

Note: `consent_tiers` is documented in `docs/mcp-api.md` for this tool but is **not** returned here — only `get_child_profile` returns it.

#### `get_child_profile`
Returns the child row plus:
- `robust_board` — from `boards WHERE kind = 'robust'`: `grid_rows`, `grid_cols`, `total_cells` (`grid_rows * grid_cols`), `masked_cells`, `cards_placed`, `vocabulary_size`.
- `active_modes` — `boards WHERE kind = 'mode'` with `card_count` from `mode_selection` and the latest `position_consistency` value from `agg_daily_metric`.
- `baseline_4w` — `{ [metric_id]: { mean, days } }` from `agg_daily_metric` where `day_local >= date(MAX(day_local), '-27 days')` and `value IS NOT NULL`.
- `first_day`, `last_day`, `active_days` from `events`.
- `consent_tiers` — `SELECT tier FROM consent WHERE revoked_at IS NULL`.
- `modeling_mode_used_days` — distinct days with `actor = 'adult'` events.

Missing child → `McpError('CHILD_NOT_FOUND', 'No child <id>.')`.

#### `get_metrics`
The workhorse. Schema: `child_id` (required), `window` enum `today·last_7d·last_14d·last_28d·term·custom`, `start`/`end`, `metric_ids` (array, `maxItems: 40`), `groups` (array, enum `A`–`H`), `compare_to` enum `previous_window·baseline_4w·none`, `include_dictionary` boolean, `group_by` enum `scene·hour·day_of_week`.

**Sliced path** (`group_by` present). Metrics default to `SLICEABLE_IDS` when `metric_ids` is empty. If the caller named unsliceable ids explicitly → `McpError('METRIC_NOT_SLICEABLE', 'Cannot group <ids> by <dim>. These have no per-<dim> form. Sliceable metrics: <SLICEABLE_IDS>.')`. If the caller took the default set, unsupported ids are quietly dropped. A `SLICED_RECOMPUTED` info guidance is appended: values are recomputed from the event log, so *"they will not sum to the blended figure exactly. Each row carries its own n."*

**Blended path.** Previous window is `prevEnd = date(w.start, '-1 day')`, `prevStart = date(prevEnd, '-<days-1> days')`. Three CTEs read `agg_daily_metric` over `value IS NOT NULL` rows: `cur` (this window's `sum_value` and `wmean_value = SUM(value * n) / NULLIF(SUM(n), 0)`, plus `n = SUM(n)` and `days_with_data`), `prev` (the same two aggregates for the previous window), and `latest` (the newest non-null value via `ROW_NUMBER()`). All three left-join onto `metrics_catalog` filtered by `m.status = 'shown'` plus optional `metric_id IN (…)` and `group_code IN (…)`.

Sum and weighted mean are computed side by side and the pick happens per metric in JS, mirroring `lib/metrics.ts` `ROLLUP`: `SUM_METRICS` (`new_words`, `teacher_modeling`, `taps_saved`, `vocabulary_gaps`, `layout_stability`, `keyboard_use`) take the sum, `LAST_METRICS` (`silence_streak`, `zero_activation_days`, `position_consistency`) take the newest value (and get a `null` comparison), and everything else takes the weighted mean so a 3-utterance day cannot outvote a 60-utterance day. The comment records the failure this replaced: a plain AVG of daily rows reported `teacher_modeling` (catalogue unit: count) as a per-day figure — *"348 modelled presses read back as '12.4'"*.

Two JS passes follow the pick. A tally (`SUM_METRICS`) with no in-window rows is **zero-filled** when the metric has ever been produced for this child (`everIds`) and the child was present in the window (`activeInWindow` — any child event between start and end): *"the catalogue's own new_words example: 0 after a batch of card additions means the additions missed, and that must be reportable."* Then window-grain `min_n` suppression: a non-null value with `n < min_n` is withheld (`value = null`) while `n` is kept — matching the dashboard. Values are rounded to 4 dp.

`direction` is derived from `polarity`, once:
- `delta === null` or `polarity === 'neutral'` → `'not_applicable'`
- `Math.abs(delta) < 1e-9` → `'unchanged'`
- `polarity === 'higher_better'` → `delta > 0 ? 'improved' : 'worsened'`
- otherwise (`lower_better`) → `delta < 0 ? 'improved' : 'worsened'`

`suppressed_reason` is **three-valued**: `'small_sample'` when `value === null && Number(n) > 0`, `'no_data_in_window'` when `value === null` but the metric is `ever_recorded` (produced before, nothing this window), `'not_collected'` when it has never been produced, else `null`. The comment gives the "absent child" rationale: *"Three distinct absences: too few samples ≠ the pipeline never produced this metric ≠ produced before but nothing this window (an absent child). Conflating them told a teacher a feature was broken when the child was simply away."* Each returned row also carries `days_with_data` (`ever_recorded` stays on the intermediate row that feeds the ternary). The `Number(…)` rather than `?? 0` is deliberate — a comment records that `r.n ?? 0` widens to `{}` and fails Next's stricter typecheck.

The `compare_to` parameter is accepted by the schema but **never read** — the previous window is always the comparison basis.

`next_calls` thresholds (instructions to the MCP client, not hints to the model):

| Condition | Emitted calls |
|---|---|
| `mistap_rate > 0.08` | `get_fired_rules({ insight_ids: ['I1','I8'] })` — *"classify motor vs semantic before concluding anything"*; `get_cell_heat` — *"find out WHERE on the grid the errors are"*; `get_board_revisions` — *"a layout change is the most common cause of a sudden rise, and it may be one we recommended"* |
| `time_to_first_tap > 5000` | `get_partner_metrics` — *"a slow response may be the adult not waiting, not the child being slow"* |
| `abandonment_rate > 0.25` | `get_partner_metrics` — *"high abandonment often pairs with an adult interrupting mid-sentence"* |

`dictionary` is omitted entirely when `include_dictionary === false` (the schema description says this saves ~2.5k tokens), and otherwise covers only metrics whose `value !== null`.

#### `get_metric_timeseries`
`granularity` enum `day·week·month`, default `day`. Period expression: `day_local`, `strftime('%Y-W%W', day_local)`, or `strftime('%Y-%m', day_local)`. Points are `{ period, value (ROUND avg, 4), n (SUM), days (COUNT), period_start (MIN day), period_end (MAX day) }`.

**Annotations are why this tool exists.** `data.annotations[]` comes from `board_revisions` joined to `boards`, formatted as `<change_kind> <card_id>` plus `" (suggested by <insight>)"` when `suggested_by_insight` is set, with `kind: 'layout_change'`. A spike means one thing alone and another entirely when a layout change sits on the same date.

For `week`/`month` an `AGGREGATED_PERIOD` info guidance is appended: points are means of daily values, not recomputed from raw events — *"A quiet day weighs the same as a busy one."*

Window: `resolveWindow(db, a.from ? 'custom' : 'last_28d', a.from, a.to)`. Passing `from` without `to` throws `SQL_REJECTED`.

#### `get_card_stats`
`limit` default 25, capped at `Math.min(a.limit ?? 25, 100)`. `order_by` maps to SQL: `taps_desc → s.taps DESC`, `taps_asc`, `mistaps_desc → s.mistaps DESC`, `zero_days_desc`, `repeat_runs_desc`; unknown falls back to `s.taps DESC`. `filter` maps to a SQL fragment: `core_only → AND c.is_core = 1`, `fringe_only → AND c.is_core = 0`, `essential_only → AND c.is_essential = 1`, `unused → AND s.taps = 0`, `all → ''`.

Reads `agg_card_stats` joined to `cards`, left-joined to `child_vocabulary` for `nav_depth`. Fetches `limit + 1` rows to set `meta.truncated`. Dictionary is fixed: `card_frequency`, `repeat_tap_rate`, `zero_activation_days`.

`repeat_runs` is a Group H (communication style) signal, never an error — see C1.

#### `get_cell_heat`
Board defaults to the child's `kind = 'robust'` board. Cells come from `agg_cell_heat` left-joined to `board_cells` and `cards`, with `mistap_share = ROUND(mistaps / NULLIF(taps + mistaps, 0), 3)`.

Spatial reasoning is done here rather than left to the model. Rows are aggregated into `byRow`, then:

- `meanErrShare = totalMistaps / max(totalTaps + totalMistaps, 1)` → returned as `board_mean_error_share` (3 dp).
- **`problem_rows`** — two different problems that need different words to a teacher:
  - `kind: 'unreached'` when `row taps / totalTaps < 0.05` and `mistaps > 0` — *"near-zero successful taps with errors present — a reach problem, not a vocabulary gap"*
  - `kind: 'error_prone'` when `errShare > meanErrShare * 1.35` and `mistaps >= 5` — note reports the multiple, e.g. *"unintended presses here are 1.5x the board average — the child reaches this row and misses"*
- **`dead_zones`** = the `unreached` subset only. A comment records that an earlier version reported "no dead zones" and hid Maya's `error_prone` row entirely.
- **`reach_gradient`** — needs `>= 3` rows, error share monotonically non-decreasing by row within a `0.01` tolerance, and `last / first >= 1.5`. Returns `{ detected: true, direction: 'increasing_by_row', ratio, tap_ratio_last_vs_first, per_row[], note }`; otherwise `null`. The note ends: *"Mask the neighbours of the hardest targets or change the physical setup — do NOT move the cards or shrink the grid."* (C2.)

The comment explains the design: a reach problem shows up as a **gradient** across the board, not as one hot cell, and looking only for outliers missed Maya entirely.

`forbidden_actions: ['resize_grid', 'move_card']`.

#### `get_word_pairs`
`min_solo` default 15 (schema range 5–100), `limit` default 20 capped at 50. Reads `agg_word_pairs WHERE together = 0 AND solo_a >= min_solo AND solo_b >= min_solo`, ordered by `weaker_solo = MIN(solo_a, solo_b) DESC`. Note: *"Target a named pair. 'Make longer sentences' is not teachable; 'want + biscuit' is."*

`forbidden_actions: ['demand_imitation', 'test_the_child']`.

#### `get_scene_breakdown`
`by` is `'label'` only when explicitly requested; anything else is `'function'`. `label` reads `v_scene_matrix` (`scene, label, taps, days`, `LIMIT 100`); `function` reads `v_function_mix` (`scene, function, utterances`). Always also returns `scene_bound_items` from `v_i6_scene_bound WHERE triggered = 1` — the I6 generalisation signal.

#### `get_utterances`
**LABELS ONLY — utterance text is not in this database.** Selects `utterance_id, day_local, scene, labels, symbol_count, word_count, tap_count, delete_count, ms_compose, ms_to_first_tap, used_suggestion, spoken, abandon_reason, function` from `utterances WHERE actor = 'child'`, ordered `ts DESC`, `limit` default 50 capped at 200, fetching `limit + 1` for truncation.

`filter` maps: `abandoned → AND spoken = 0`, `used_suggestion → AND used_suggestion = 1`, `multi_symbol → AND symbol_count > 1`.

**Dead over stdio — this tool alone:** `run()` reads `a.window ?? 'last_7d'`, but `window` is not in this tool's schema, so `validateArgs` rejects it with `unknown parameter 'window'` on the stdio and chat paths and the window there is always `last_7d`. Only the HTTP transport, which skips `validateArgs`, lets a supplied token through to `resolveWindow`. `get_card_stats`, `get_cell_heat`, `get_word_pairs` and `get_scene_breakdown` are different: their `run()` never reads a window argument at all — each calls `resolveWindow(db, 'last_28d')` hardcoded — even though `docs/mcp-api.md` still documents a `window` parameter on them.

#### `get_partner_metrics`
Fixed `last_14d` window. From `partner_turns`: `partner_turns` (count), `median_wait_ms` (**actually `ROUND(AVG(ms_to_next_partner_turn))`** — a mean under a median's name), `interruptions`, `interruption_rate` (3 dp), `turns_with_no_child_response`. From `events WHERE actor = 'adult'`: `modeling_taps`, `modeling_days`.

Carries C7 as an inline note: *"AAC output runs around 15 words per minute. A median wait under 2000 ms means any 'the child is slow' finding is confounded by the adult."*

#### `get_board_revisions`
Reads the `v_i8_layout_disruption` view: `revision_id, changed_on, change_kind, card_id, suggested_by_insight, reason, mistap_rate_before_7d, mistap_rate_after_7d, delta, triggered`, ordered `changed_on DESC`. The last three fields are the I8 evidence — the insight that points at us.

`forbidden_actions: ['blame_the_child', 'frame_as_regression', 'recommend_further_layout_change']`.

#### `get_fired_rules`
`insight_ids` defaults to all eight (`I1`–`I8`). For each, reads `insights_catalog` and the **materialised `fired_rules` table** — never the live views. The comment records why: *"The insight views scan the event log with window functions; under concurrent write load they hit 5s at p99 and the dashboard stalls. tools/run_rules.py evaluates them once, nightly."*

Selection: `WHERE child_id = ? AND insight_id = ? AND dismissed_at IS NULL AND superseded_by IS NULL ORDER BY fired_at DESC LIMIT 1`. `triggered = Boolean(fr)`.

Each fired candidate carries `fired_rule_id`, `fired_at`, `classification` (JSON), `name`, `plain_statement`, `evidence` (JSON), `thresholds_applied` (from `default_thresholds`), `recommended_actions`, `forbidden_actions`, `safety_note`, `target_audience`, `action_kind`, `input_metrics`, and `previously_dismissed` (the most recent dismissed row for that rule, or `null`).

Rules that did **not** fire are returned as one-line stubs `{ insight_id, name, triggered: false }`. A comment gives the reason: returning all eight with full catalogue metadata cost **7.7k tokens** when four had fired.

`data.note` is one of two strings: *"No rule fired. There is nothing to narrate — say so rather than looking for something to report."* or *"Thresholds are given to you, not applied for you. A rule that fired just over its threshold deserves hedging, not a confident diagnosis."*

Envelope `forbidden_actions` is the de-duplicated union of every fired rule's own `forbidden_actions`. The dictionary covers the union of fired rules' `input_metrics`.

#### `get_attention_queue`
`class_id` required, `limit` default 10 capped at 30, `last_7d` window. For every child in the class:

```
score += 3  if silence_streak >= 2 days        → reason SILENCE
score += 2  if AVG(abandonment_rate) > 0.25    → reason ABANDONMENT
score += 2  if AVG(mistap_rate)      > 0.12    → reason MISTAPS
score += 1  if any open v_insights_fired row whose insights_catalog.action_kind = 'intervention'
                                               → reason OPEN_INSIGHT
```

Children with `score === 0` are dropped; the rest sort by `score DESC` and are sliced to `limit`. Each entry is `{ child_id, display_name, score, reasons[], open_rules[] }` where a reason is `{ code, detail, metric_id, value }`. Note: *"Ranked by who needs a human today, not by who has the worst numbers."*

`docs/mcp-api.md` §4 also lists `+1·(unreviewed vocabulary gaps >= 3)`. **Not implemented.** There is also no `rank` field on the queue rows despite the doc listing one.

#### `get_report_set`
Which metrics are in the report is a **database fact, not a constant** — `SELECT … FROM metrics_catalog WHERE report_set = 1 ORDER BY report_rank`. The comment records why: the set already changed once, from eight in `proposed_metrics.docx` to thirteen in `AAC_Filtered_Metric_Index.md`, and anything hardcoding it would now report on the wrong metrics.

Four metrics are **dimensional** — they live in their own tables, and reading them from `agg_daily_metric` reported them as "not collected" while the same tool told the model not to treat a missing value as zero:

| metric_id | Source | unit |
|---|---|---|
| `cell_heat` | `SELECT COUNT(*) AS n, SUM(taps) AS v FROM agg_cell_heat WHERE child_id = ?` | cells |
| `card_frequency` | `… FROM agg_card_stats WHERE child_id = ? AND taps > 0` | cards |
| `word_pairs` | `… FROM agg_word_pairs WHERE child_id = ? AND together = 0 AND solo_a >= 10 AND solo_b >= 10` | pairs |
| `nav_depth_by_card` | `SELECT COUNT(*) AS n, ROUND(AVG(avg_nav_depth), 2) AS v FROM v_card_stats WHERE child_id = ? AND avg_nav_depth > 0` | screens |

Each row carries `shape: 'dimensional' | 'daily_scalar'` and `status: 'ok' | 'not_collected' (n === 0) | 'below_min_n'`. A `NOT_COLLECTED` guidance naming the affected metrics is appended when any status is `not_collected`.

`data.note`: *"These are the ONLY metrics a report may cite. Do not expand beyond them, and do not compute new figures from them."* `forbidden_actions: ['resize_grid', 'move_card', 'reduce_repetition']`.

#### `get_insight_history`
`limit` default 30 capped at 100 (fetches `limit + 1`). `include_dismissed` defaults true; setting it `false` adds `f.dismissed_at IS NULL`. Rows carry a derived `state`: `'dismissed'` when `dismissed_at IS NOT NULL`, `'resolved'` when `superseded_by IS NOT NULL`, else `'open'`, plus `evidence_rows` (`json_array_length`) and `narrations` (count of `insights` rows referencing that `fired_rule_id`).

`data.summary` is one row per rule: `{ insight_id, times_fired, times_dismissed, dismiss_reasons[], last_fired_at }` — *"fired 3 times, dismissed twice as not_accurate is the thing worth knowing before raising it again."*

When any summary's `dismiss_reasons` includes `'not_accurate'`, a `PREVIOUSLY_DISMISSED` warning is appended: *"Re-raising a rejected finding without new evidence erodes trust in every other finding."*

#### `compare_windows`
Takes two explicit `{start, end}` objects. Each side averages `agg_daily_metric` per metric. Rows are `{ metric_id, a, b, n_a, n_b, delta (b − a, 4 dp), comparable, not_comparable_because }`.

```ts
const SPATIAL = new Set(['mistap_rate','correction_adjacent_rate','cell_heat','taps_per_utterance'])
```

The disruption check spans `min(window_a.start, window_b.start)` to `max(window_a.end, window_b.end)` — **not just the gap between the windows.** A comment records the bug this fixed: an earlier version only checked the gap and reported Maya's 30 July swap as comparable because it landed *inside* `window_b`. A change inside either window splits that window across two layouts, which is just as invalidating.

`meta.window.days` is hardcoded to `0` for this tool.

#### `get_board_layout`
Robust board only (`AND kind = 'robust'`); no robust board → `McpError('CHILD_NOT_FOUND', 'No robust board for <id>.')`. Returns `cells[]` with `canonical`, `masked`, `nav_depth`; `buried_cards[]` (`child_vocabulary WHERE nav_depth > 0`); `modes[]` with `card_count` and `cards_not_on_robust_board`; and `duplicate_cards[]` — any `card_id` occupying more than one cell.

Note, verbatim: *"Duplicates are intentional. Constraint C3: to surface a buried word, add a copy — never move the original."* `forbidden_actions: ['move_card', 'resize_grid', 'remove_original']`.

#### `write_insight` (requires `--allow-writes`)
Schema: `fired_rule_id`, `narration`, `confidence` (0–1), `model` required; `actions_suggested` array `maxItems: 6`.

Rejection ladder, all `McpError('SQL_REJECTED', …)`:
1. Unknown `fired_rule_id` → *"You cannot invent a finding — if no rule fired, there is nothing to narrate."*
2. `dismissed_at` set → *"That finding was dismissed by an adult."*
3. `superseded_by` set → *"That finding has been superseded by a later run."*
4. Any `actions_suggested` entry present in the rule's `forbidden_actions` → *"These are ruled out by AAC practice, not by preference."*
5. Any forbidden action appearing **in the narration prose**, matched by lowercasing the narration and replacing `_` with ` ` in each forbidden term (so `move_card` catches "move card").
6. `narration.length > 500` → *"Narration is limited to 500 characters."*

On success: `INSERT INTO insights (insight_event_id, fired_rule_id, child_id, written_at, model, narration, confidence, actions_suggested)` with `insight_event_id = 'ie_' + randomUUID().slice(0, 16)`, `written_at = Date.now()`, and `actions_suggested` JSON-stringified.

#### `propose_board_change` (requires `--allow-writes`)
`change_kind` enum is **`add · add_copy · mask · unmask` only**. The schema description states why: *"move, resize and remove are NOT available. Motor plans depend on positions staying put."* (C2/C3 — the constraint is enforced at the schema level, not by prompt.)

Checks: robust board must exist; `card_id` must exist in `cards`; `rationale.length <= 300`. For `add`/`add_copy`, `to_row` and `to_col` are required, must be inside the `grid_rows × grid_cols` bounds, and must not land on an unmasked occupied cell — *"Placing a card there would displace a button the child has learned. Choose an empty or masked cell."*

Writes `INSERT INTO board_change_proposals (…, status) VALUES (…, 'pending')` with `proposal_id = 'bcp_' + randomUUID().slice(0, 16)`, `proposed_by = 'mcp'`. Note: *"Proposed only. A human approves it in the dashboard, which writes the board_revisions row so I8 can measure whether the change helped."*

#### `query`
The escape hatch. `sql` required, `limit` default 200 capped at 500. Delegates entirely to `Db.freeQuery` — see [read-only database access](read-only-db-access.md). Returns `{ rows, sql_executed }` where `sql_executed` is the LIMIT-injected statement actually run.

## Dependencies & Connections

### Depends On
- [Read-only database access](read-only-db-access.md) — every tool takes a `Db`; `query` relies on `freeQuery`'s parse guard and the two write tools on `exec`'s `insights` / `board_change_proposals` allowlist.
- [Database schema](../database/schema.md) — reads `events`, `utterances`, `partner_turns`, `boards`, `board_cells`, `board_revisions`, `cards`, `child_vocabulary`, `children`, `roster`, `consent`, `mode_selection`, `fired_rules`, `insights`, `board_change_proposals`, the `agg_*` rollups and the `v_*` views.
- [Metrics catalogue](../analytics/data-dictionary.md) — `metrics_catalog` supplies `min_n`, `polarity`, `unit`, `caveat`, `report_set`, `report_rank` and `status`. Nothing is hardcoded here.
- [Insight rules](../analytics/fired-rules-and-evidence.md) — `insights_catalog` supplies thresholds, `forbidden_actions`, `safety_note`, `target_audience` and `action_kind`.
- [Rule runner](../pipeline/rule-materialisation.md) — `get_fired_rules`, `get_insight_history`, `get_attention_queue` and `list_children` read the materialised `fired_rules` table and `v_insights_fired`, both populated by `tools/run_rules.py`. Against a database that has never been through it, these tools return empty.

### Depended On By
- [MCP stdio server](stdio-server.md) — imports `tools` for `tools/list` and `tools/call`.
- [MCP over HTTP](../api/mcp-http-transport.md) — `app/api/mcp/route.ts` imports the same `tools` object unchanged, so both transports expose exactly the same surface.
- [Dashboard chat tools](../ai/scoped-tool-bridge.md) — `lib/chat/tools.ts` imports `tools as mcpTools` in-process (4.4 ms per call versus ~70 ms of process startup) and strips `child_id` / `class_id` / `adult_id` from the schemas before the model sees them, injecting them from the session viewer. It also excludes `query` from the chat surface entirely.
- [Response fixtures](response-fixtures.md) — 14 of these 20 tools have captured responses.

### Shared Resources
- `aac.db` — read concurrently with the Next.js app's writes.
- `metrics_catalog` / `insights_catalog` — the single source of truth shared with `lib/catalog.ts`. Changing a `min_n` in the database changes both sides on the next query, with no code change and no possibility of disagreement.
- The `Envelope` type is re-used by the HTTP route and the chat path.

## Change Risks
- **Removing or weakening a `computeGuidance` check** is the highest-consequence change in this domain. `docs/mcp-api.md` §7 walks through Maya's case and concludes: remove any one of the annotations, `suggested_by_insight`, `forbidden_actions`, or the unprompted `LAYOUT_CHANGED_MID_WINDOW` warning, and the model concludes the child got worse when in fact our own I3 recommendation moved a button.
- **Hardcoding a threshold that currently comes from a catalogue table** breaks the invariant `docs/mcp-clients.md` §1 relies on — that `lib/catalog.ts` and `mcp/tools.ts` cannot disagree.
- **Adding a `move`, `resize` or `remove` value to `propose_board_change.change_kind`** violates C2/C3 directly and removes the schema-level guarantee that no model can propose relocating a learned button.
- **Loosening `write_insight`'s `fired_rule_id` requirement** lets model prose reach a teacher with no deterministic SQL rule behind it — the stated reason `fired_rules` and `insights` are separate tables.
- **Renaming a metric id** silently changes behaviour in several places at once: `SLICEABLE_IDS`, the `SPATIAL` set in `compare_windows`, the `DIMENSIONAL` map in `get_report_set`, the `affects` arrays in `computeGuidance`, and the `next_calls` thresholds in `get_metrics` all match on string ids that no type checks.
- **Changing a tool's schema** propagates to three consumers: `tools/list`, `app/api/mcp/route.ts`, and `lib/chat/schema-adapter.ts` which rewrites schemas for Gemini's stricter JSON-Schema subset. Adding a keyword Gemini rejects breaks the chat path only.
- **Adding `window` to `get_utterances`' schema** activates its currently stdio-dead `a.window` read and changes results for every existing caller that has been getting `last_7d`. `get_card_stats`, `get_cell_heat`, `get_word_pairs` and `get_scene_breakdown` would need a code change too — they hardcode `resolveWindow(db, 'last_28d')` and read no argument.
- **Switching `get_fired_rules` back to the live `v_i1…v_i8` views** reintroduces the 5s p99 under concurrent write load that made the dashboard stall.
- **Changing `resolveWindow`'s anchor from `MAX(day_local)` to wall-clock now** makes every window empty on a seeded demo database whose newest event is in the past.
- **Fixing `median_wait_ms` to a real median** changes the number the I2 dashboard card quotes; the 2000 ms threshold — used both in its inline note and in `PARTNER_WAIT_SHORT`'s own `AVG` check — would need re-checking against the new statistic.
