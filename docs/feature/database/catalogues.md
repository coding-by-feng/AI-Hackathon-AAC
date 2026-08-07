# Metric and Insight Catalogues

## Function
Seeds `metrics_catalog` with 41 metric definitions (33 `shown`, 4 `logged`, 4 `cut`) and `insights_catalog` with the 8 diagnostic rules I1–I8, then marks the 13-metric report set with its rank, chart type and plain-language name.

## Purpose
This file is **the LLM's data dictionary**, served as MCP resources `schema://dictionary` and `schema://insights`, and every metric value the MCP server returns is accompanied by its row from here. The header states the reasoning directly:

> *"A number without its unit, polarity, minimum sample size and caveat is how a language model becomes confidently wrong. Every field below exists to prevent a specific misreading. Do not trim this file for brevity."*

It is also where the clinical copy rules are **enforced rather than requested**. [aac-clinical-constraints.md](../../aac-clinical-constraints.md) lists five rules and states they "are stored as fields on `insights_catalog`, not left to whoever writes the UI string":

| Rule | Field that enforces it |
|---|---|
| Never recommend reducing repetition | `forbidden_actions` contains `reduce_repetition` (I1, I5) |
| Never recommend relocating a learned card | `forbidden_actions` contains `move_card` / `resize_grid` (I1, I2, I3) |
| Never frame a preference as a training gap | I4 has `action_kind = 'informational'` |
| Never frame a metric as a target the child must hit | `target_audience = 'adult'` on I1–I7, `'system'` on I8 |
| Never present repetition, stimming or refusal as a problem | `polarity = 'neutral'` blocks red/warning styling in the UI |

`lib/catalog.ts` restates the same argument for the dashboard: *"`polarity: 'neutral'` is load-bearing, not cosmetic… the only thing that stops the UI doing it is this field."*

## Source Files
| File | Role |
|------|------|
| `db/seed_catalogues.sql` | All `metrics_catalog` and `insights_catalog` rows, the three report-set columns, and the report-set / plain-name UPDATE passes |

## Implementation

### Applying
```bash
sqlite3 aac.db < db/seed_catalogues.sql        # after db/schema.sql
```
`tools/build.sh` runs it as step **2/7 "metric + insight catalogues"** and echoes the row counts.

### Execution order (this matters)
1. `DELETE FROM metrics_catalog;`
2. Nine `INSERT INTO metrics_catalog VALUES (...)` blocks with **no column list** — 38 rows, positional against the 14 columns `db/schema.sql` defines.
3. Three `ALTER TABLE metrics_catalog ADD COLUMN` statements: `report_set INTEGER NOT NULL DEFAULT 0`, `chart TEXT`, `report_rank INTEGER`.
4. One `INSERT` **with** an explicit column list adding `feeling_words`, `sentence_shapes`, `answers_vs_starts` (3 rows, `report_set = 1` at insert time).
5. `UPDATE metrics_catalog SET report_set = 0, report_rank = NULL, chart = NULL;` — resets **everything**, including the three rows just inserted with `report_set = 1`.
6. Thirteen `UPDATE`s that set `report_set = 1`, `report_rank = 1..13`, `chart`, and a plain-language `name`.
7. Nine further `UPDATE`s giving plain-language `name`s to the rest of the student page.
8. `DELETE FROM insights_catalog;` then one `INSERT` of 8 rows (I1–I8).

**Step 3 must stay after step 2.** The positional INSERTs assume exactly 14 columns. Confirmed empirically: re-running this file against an already-seeded database fails with `Parse error near line 24: table metrics_catalog has 17 columns but 14 values were supplied`. The file is **not idempotent** — it is only re-runnable against a database freshly created from `db/schema.sql`, which is exactly how `tools/build.sh` uses it (`rm -f "$DB"` first).

**Step 5 is why the report set is 13 and not 16.** `feeling_words`, `sentence_shapes` and `answers_vs_starts` are inserted with `report_set = 1`, `report_rank` 5/6/7 and charts `donut`/`scatter`/`split_bar`, and are then zeroed by the blanket reset and never re-flagged. The comment above the reset explains the intent: the 13-metric set from `docs/AAC_Filtered_Metric_Index.md` *"REPLACES the earlier eight-metric set from proposed_metrics.docx. The metrics that set introduced (feeling_words, sentence_shapes, answers_vs_starts) keep computing and stay visible elsewhere — they are simply not part of the report."*

### Header comment vs. actual content
The file header says **"38 metrics: 30 shown · 4 logged-only · 4 cut"**. Counted from the statements, and verified against the built database:

| | Header claims | Actually seeded |
|---|---|---|
| Total metrics | 38 | **41** |
| `shown` | 30 | **33** |
| `logged` | 4 | 4 |
| `cut` | 4 | 4 |
| Insights | 8 | 8 |
| In `report_set` | — | **13** |

The extra three are the AI metrics added in step 4. `docs/analytics-metrics.md` §1 already says "Shown on the dashboard — 33", so 33 is the current truth and the header comment is stale.

### Metric groups seeded
| Group | Meaning | Metrics |
|---|---|---|
| A | Effort & speed | `taps_per_utterance`, `composition_time`, `time_to_first_tap`, `words_per_minute` (logged), `inter_tap_interval` (logged) |
| B | Errors & motor | `mistap_rate`, `correction_adjacent_rate`, `abandonment_rate`, `cell_heat`, `post_delete_entropy` (cut) |
| C | Volume & vocabulary | `silence_streak`, `utterances_per_day` (logged), `card_frequency`, `new_words`, `zero_activation_days`, `ndw`, `mlu`, `ttr` (logged), `word_pairs`, `core_fringe_ratio`, `sentence_shapes` |
| D | Layout & context | `nav_depth_by_card`, `scene_distribution`, `layout_stability`, `position_consistency`, `time_of_day_chart` (cut), `peer_baseline` (cut) |
| E | Whose voice | `independence_rate`, `pragmatic_function_mix`, `teacher_modeling`, `answers_vs_starts` |
| F | AI value | `suggestion_acceptance`, `taps_saved`, `vocabulary_gaps`, `visual_source_split`, `generated_keep_rate` (cut) |
| G | Communication partner | `partner_wait_time`, `partner_interruption_rate` |
| H | Communication style | `repeat_tap_rate`, `keyboard_use`, `feeling_words` |

Group B carries the note **"repetition is NOT in this group. See group H and clinical constraint C1."** Group H's header repeats it: "Deliberately NOT filed under errors."

### Load-bearing metric rows

`repeat_tap_rate` — `polarity = 'neutral'`, `tier = 'P0'`, `min_n = 10`, `feeds_insights = ["I4"]`. Its caveat is the longest in the file and begins **"THIS IS NOT AN ERROR AND MUST NEVER BE STYLED AS ONE."** It lists the four normal causes (communication, learning where a button is, language development including gestalt processing, stimming for self-regulation), states "Trying to reduce repetition reduces overall communication", and routes high repetition in a thin-vocabulary scene to a **vocabulary gap** signal.

`mistap_rate` — `polarity = 'lower_better'`, `min_n = 30`, `feeds_insights = ["I1","I8"]`. Formula: `count(delete_last where ms_delta < mistap_threshold_ms) / count(card_tap), per day`. Caveat: **"REQUIRES A DELETE."** "The 1500ms threshold is a starting default: for athetoid cerebral palsy 2500ms is often more accurate."

`correction_adjacent_rate` — `polarity = 'neutral'`, `min_n = 10`. "A classifier, not a score… HIGH means the finger slipped (motor). LOW means the child changed their mind (semantic)."

`position_consistency` — `polarity = 'higher_better'`, `min_n = 5`. "Target is exactly 1.0… Anything below 1.0 means our own AI is teaching a second, conflicting motor plan. **This is a product defect metric, not a child metric.**"

`layout_stability` — `polarity = 'higher_better'`, `min_n = 1`, `feeds_insights = ["I8"]`. "This metric holds the SYSTEM accountable: if the dashboard recommends a layout change, this measures the damage that advice caused." Note that the view backing it returns a **count of disruptive changes**, so the value rises as stability falls — see [metric-views.md](metric-views.md).

`silence_streak` — `min_n = 1`, `polarity = 'lower_better'`. "The most urgent number in the system and the main driver of the attention queue."

`independence_rate` — `min_n = 10`. "The guardrail against the AI quietly becoming the speaker… Read the two together, never separately" (with `suggestion_acceptance`, which is `neutral`, not higher-better, for exactly this reason).

`feeling_words` — `min_n = 5`, `polarity = 'neutral'`. "COUNTS WORDS USED — it does not measure how the child feels. An AAC user can only express feelings their board contains… Always show how many feeling words were available alongside the mix."

`answers_vs_starts` — `min_n = 20`. "NEITHER END IS BETTER, which is why this is a split and not a score… Never render this as a gauge."

`words_per_minute` — `status = 'logged'`, `cut_reason` "Recognisable but not actionable. Shown as small caption text under taps_per_utterance, never as a KPI tile." Caveat: "AAC rates sit around 2-15 wpm against 150-170 for speech. NEVER compare to typing or talking, and never across children."

The four `cut` rows are kept **so the decision is not re-litigated**: `time_of_day_chart` ("Chart cut for surface area. tsLocal remains in every event"), `generated_keep_rate`, `peer_baseline` ("Statistical noise at our cohort size; presenting it would imply rigour we do not have. Insights compare against the child's own 4-week rolling average instead."), `post_delete_entropy` ("correction_adjacent_rate already separates motor from semantic reliably").

### The report set — 13 metrics
Source: `docs/AAC_Filtered_Metric_Index.md`.

| rank | metric_id | chart | name |
|---|---|---|---|
| 1 | `taps_per_utterance` | `line` | Buttons to say one thing |
| 2 | `correction_adjacent_rate` | `split_bar` | Where corrections land |
| 3 | `cell_heat` | `grid` | Which buttons get reached |
| 4 | `silence_streak` | `calendar` | Days since she last spoke |
| 5 | `card_frequency` | `ranked_bar` | Her go-to words |
| 6 | `new_words` | `line` | New words |
| 7 | `word_pairs` | `table` | Words not yet paired |
| 8 | `core_fringe_ratio` | `donut` | Flexible words vs naming |
| 9 | `nav_depth_by_card` | `scatter` | How deep words are buried |
| 10 | `teacher_modeling` | `bar` | Adult demonstrating |
| 11 | `partner_wait_time` | `line` | How long the adult waits |
| 12 | `repeat_tap_rate` | `line` | Repeated pressing |
| 13 | `keyboard_use` | `none` | Spelling and the alphabet |

A trailing comment records that `new_words` **reverts to a COUNT** — "The filtered index defines it as 'cards used for the very first time during this window', not the proportion the earlier docx asked for. The proportion is still shown as the sub-line." Note that `v_m_new_words` computes the **proportion**, with `v_new_words_count` supplying the count.

Plain-language `name` overrides applied outside the report set: `mistap_rate` → "Presses she did not mean", `abandonment_rate` → "Built but not spoken", `time_to_first_tap` → "Time to start answering", `independence_rate` → "Her own words". The comment explains why: "The catalogue already carried `name`; several were still engineer's names."

### The eight insights

| id | Name | `default_thresholds` | `target_audience` / `action_kind` |
|---|---|---|---|
| I1 | Unintended presses: physical or conceptual? | `{"mistap_rate_min":0.08,"min_sessions":5,"mistap_threshold_ms":1500,"adjacent_ratio_motor":0.6}` | adult / intervention |
| I2 | Slow to start, or not given time? | `{"sigma_multiplier":2,"fallback_ms":5000,"baseline_weeks":4}` | adult / intervention |
| I3 | A much-used word is buried | `{"frequency_percentile":95,"min_nav_depth":3}` | adult / intervention |
| I4 | Unused word: obsolete, or simply not wanted? | `{"obsolete_days":30,"min_scene_activity":10}` | adult / **informational** |
| I5 | Words known, not yet combined | `{"min_solo":20,"max_mlu":1.3}` | adult / intervention |
| I6 | Works in one place, not another | `{"weeks":2,"therapy_min_count":10}` | adult / intervention |
| I7 | The adult has stopped modelling | `{"weeks":2,"modeling_threshold":3}` | adult / intervention |
| I8 | Our own change broke something | `{"window_days":7,"variance_multiplier":1.0}` | **system** / **system_fix** |

`default_thresholds` carries the schema comment **"TUNE PER CHILD after 2 weeks"**.

`forbidden_actions` per insight:
- I1 — `resize_grid`, `move_card`, `reduce_repetition`, `retrain_without_access_check`
- I2 — `resize_grid`, `move_card`, `demand_faster_response`
- I3 — `move_card`, `resize_grid`, `remove_original`
- I4 — `retrain_preference`, `reintroduce_refused_item`, `treat_refusal_as_deficit`
- I5 — `demand_imitation`, `test_the_child`, `reduce_repetition`
- I6 — `test_generalisation`, `demand_transfer`, `drill_in_therapy`
- I7 — `blame_the_child`, `demand_output`, `test_the_child`
- I8 — `blame_the_child`, `frame_as_regression`, `recommend_further_layout_change`

Notable `safety_note` text:
- I1 — "With cerebral palsy, unintended presses are frequent and normal. **Default to the MOTOR reading when the split is ambiguous.** Never recommend shrinking the grid… Phrase as 'this looks like a reach problem - does that match what you see?'"
- I3 — "**Never relocate the original.** Moving a learned button destroys the motor plan; adding a second copy costs nothing… Duplicate cards are intended here, not a data-quality problem."
- I4 — "Case B must never route to retraining. Drilling a child to request something they have refused teaches them their 'no' does not count. **The refusal is successful communication.**"
- I6 — "The intervention targets the adults in the other setting, never the child."
- I7 — "The only insight aimed squarely at a grown-up, and the one most likely to be resisted. Present evidence, never a verdict."
- I8 — "This insight points at us, not at the child. Without it, every layout recommendation the dashboard makes is unfalsifiable."

### Where the catalogue rules and the SQL views disagree
The `trigger_rule` text is human-readable prose; `db/views_insights.sql` is the executable version, and it is narrower in four places (documented in [insight-views.md](insight-views.md)):
- I1's `min_sessions: 5` is implemented as `COUNT(DISTINCT day_local) >= 5` — **days**, not sessions.
- I2's "own 4-week baseline + 2 standard deviations" is not implemented; only the `fallback_ms = 5000` branch fires. `baseline_ms` is computed and exposed but unused.
- I6's "sustained 2 consecutive weeks" is not implemented — the view has no time window.
- I7's "child score falling 2 consecutive weeks" is not implemented; the view triggers on modelling volume alone. I8's `position_consistency < 1.0` alternative trigger is likewise absent.

## Dependencies & Connections

### Depends On
- [Analytics Schema and Indices](schema.md) — `metrics_catalog` and `insights_catalog` must exist with exactly 14 and 11 columns respectively before this runs (verify with `PRAGMA table_info`). Only `metrics_catalog`'s 14 is load-bearing for the positional INSERTs: the file itself widens that table to 17 columns with the three ALTERs, which is exactly why a re-run fails. `insights_catalog` is inserted positionally against its full 11 and never altered.

### Depended On By
- [../analytics/data-dictionary.md](../analytics/data-dictionary.md) — `lib/catalog.ts` types `MetricMeta`/`InsightMeta` directly off these columns; "Nothing in the UI hardcodes a metric's name, unit, polarity or caveat"
- [../analytics/metric-readers.md](../analytics/metric-readers.md) — `lib/metrics.ts` reads `min_n` to decide `suppressed: 'small_sample'`
- [Metric Views](metric-views.md) — every `v_m_*` view is the executable form of a `formula` string here
- [Insight Rule Views](insight-views.md) — every `v_i*` view is the executable form of a `trigger_rule` string here
- [../pipeline/l2-rollup.md](../pipeline/l2-rollup.md) — applies `min_n` when writing `agg_daily_metric.value`
- [../pipeline/rule-materialisation.md](../pipeline/rule-materialisation.md) — copies `default_thresholds` into `fired_rules.thresholds_used`
- [../mcp/stdio-server.md](../mcp/stdio-server.md) — served as `schema://dictionary` and `schema://insights`
- [../dashboard/student-overview.md](../dashboard/student-overview.md) — `report_set`, `report_rank` and `chart` drive which tiles appear and in what order
- [../mcp/tool-surface.md](../mcp/tool-surface.md) — `forbidden_actions` is checked before an `insights` row is stored

### Shared Resources
- Tables `metrics_catalog` (17 columns after the ALTERs) and `insights_catalog`
- MCP resource URIs `schema://dictionary`, `schema://insights`
- The `feeds_insights` JSON array links a metric row to the insight ids it feeds

## Change Risks

- **Re-running this file on a live database fails.** The three `ALTER TABLE ADD COLUMN` statements make the positional INSERTs invalid on the second pass. Any workflow that is not "rebuild from `db/schema.sql`" will break. Adding a column to `metrics_catalog` in `db/schema.sql` breaks it the same way.
- **Adding a metric to the top blocks without updating the column count** silently misaligns every field — `polarity` could land in `tier`. Prefer the explicit-column INSERT form used for the three AI metrics.
- **Moving the blanket `UPDATE … SET report_set = 0` above the 13 UPDATEs** would leave 16 metrics in the report set and break the report generator's "may cite only these" check against `reports.metrics_used`.
- **Changing `polarity` from `neutral` to a directional value** on `repeat_tap_rate`, `feeling_words`, `answers_vs_starts`, `correction_adjacent_rate`, `zero_activation_days` or `suggestion_acceptance` directly violates a clinical constraint — the UI colours from this field and nothing else.
- **Editing `forbidden_actions`** changes what a model is allowed to say to a teacher. Removing `move_card` from I3 would let the system recommend the exact action C3 forbids.
- **Lowering `min_n`** makes `agg_daily_metric.value` non-NULL on thinner samples; `lib/metrics.ts` will then report a value where it previously reported `suppressed: 'small_sample'`.
- **Renaming a `metric_id`** orphans rows in `agg_daily_metric` (FK to `metrics_catalog`), breaks the literal strings in `v_daily_metrics_all`, and breaks every `feeds_insights` array that names it.
- **The stale "38 metrics / 30 shown" header** will keep drifting; any consumer that trusts the comment rather than `SELECT COUNT(*)` is already wrong by three.
