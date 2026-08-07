# Insight Rule Views

## Function
Implements the eight diagnostic rules I1–I8 as 12 plain-SQL views. Each returns the evidence rows, the thresholds it used **as columns**, and a `triggered` flag; `v_insights_fired` rolls them up into one row per `(insight_id, child_id)` with an evidence-row count.

## Purpose
The header states the two design decisions that matter:

> *"Each view returns EVIDENCE plus a `triggered` flag and the thresholds it used, as columns. The thresholds are exposed rather than baked into a WHERE clause, so a model or a therapist can disagree with a rule that fired at 8.1% against a threshold of 8%."*
>
> *"These are plain SQL on purpose. The seven diagnostic rules must be deterministic and explainable to a speech therapist; a model narrates them afterwards but never decides them."*

That matches the pinned decision in [TECH_STACK.md](../../TECH_STACK.md) — "**Rules are SQL, not LLM.**" — and the schema's two-table split: `fired_rules` is written from these views by `tools/run_rules.py`, and an `insights` row (model prose) cannot exist without a `fired_rule_id`.

Individual rules carry the clinical constraints in their comments: I1 notes what it does **not** count ("repeated pressing with no delete… lives in `v_m_repeat_tap_rate`", C1); I3's action is "ADD A COPY, never move" (C3); I4 warns "Case B must never route to retraining. A refusal is successful communication"; I8 is "the only rule that points at us. Without it, every layout recommendation the dashboard makes is unfalsifiable."

## Source Files
| File | Role |
|------|------|
| `db/views_insights.sql` | `v_window`, the ten I1–I8 evidence views, and the `v_insights_fired` roll-up |

## Implementation

### Applying
```bash
sqlite3 aac.db < db/views_insights.sql        # after db/views_metrics.sql
```
Applied by `tools/build.sh` in step **4/7 "views"**. Every view is preceded by `DROP VIEW IF EXISTS`, so the file is idempotent.

### `v_window` — the shared clock
Every window is relative to the **latest day present in the event log**, not to wall-clock time:

| Column | Expression | Meaning |
|---|---|---|
| `w_end` | `(SELECT MAX(day_local) FROM events)` | "today" |
| `w_start` | `date(w_end, '-13 days')` | 14-day window start |
| `w_start_28` | `date(w_end, '-27 days')` | 28-day window start |
| `w_start_7` | `date(w_end, '-6 days')` | 7-day window start |
| `prev_end_7` | `date(w_end, '-13 days')` | identical to `w_start`; defined but not read by any view in this file |

`w_start_7` is also unused by any view here.

### I1 — `v_i1_mistap_classification`
Three CTEs over the 14-day window `w_start..w_end`:
- `agg` from `v_tap_sequence` — `taps`, `mistaps` (`type = 'delete_last' AND ms_delta < 1500`), `active_days = COUNT(DISTINCT day_local)`
- `adj` from `v_mistaps` — `n_adjacent = SUM(correction_adjacent)`, `n_classified = COUNT(correction_adjacent)`
- `lat` from `v_m_time_to_first_tap` — `AVG(value)` exposed as `median_latency_ms`

Exposed thresholds: `threshold_mistap_rate = 0.08`, `threshold_min_days = 5`, `threshold_adjacent_motor = 0.60`, `mistap_threshold_ms = 1500`.

```
triggered      = mistap_rate > 0.08 AND active_days >= 5
classification = adjacent_ratio >= 0.60 -> 'motor'
                 adjacent_ratio <= 0.35 -> 'semantic'
                 otherwise              -> 'ambiguous'
```
The **0.35** semantic cut-off appears only here; `insights_catalog.default_thresholds` for I1 names `adjacent_ratio_motor: 0.6` and no semantic bound. The catalogue's `min_sessions: 5` is implemented as **distinct days**, not `sessions` rows.

`v_i1_evidence_cells` — per grid cell over the same window, `taps`, `mistaps`, and `mistap_share = mistaps / NULLIF(taps + mistaps, 0)`. "Dead cells ringed by errors mean reach."

### I2 — `v_i2_scanning_load`
CTEs: `child` (mean `ms_to_first_tap`, `n_utterances`, `clean_share = AVG(delete_count = 0)` — *"'the tap was correct': no delete anywhere in the utterance"*), `baseline` (`AVG(v_m_time_to_first_tap.value)` for `day_local < w_start`), `partner` (`AVG(ms_to_next_partner_turn)`, `AVG(interrupted_utterance_id IS NOT NULL)`, `n_turns`), `grid` (`MAX(grid_rows * grid_cols)` over `kind = 'robust'` boards as `cells_on_page`).

Exposed thresholds: `threshold_latency_ms = 5000`, `threshold_clean_share = 0.80`, `partner_wait_concern_ms = 2000`.

```
triggered    = mean_latency_ms > 5000 AND clean_share >= 0.80
likely_cause = partner_wait_ms IS NOT NULL AND partner_wait_ms < 2000
               -> 'partner_may_not_be_waiting'
               otherwise -> 'child_scanning_load'
```
`likely_cause` is the C7 requirement made structural: *"a child cannot look fast when the adult refills the silence after 1.2 seconds."* The dashboard "must show both".

**`baseline_ms` is computed and exposed but never used in `triggered`.** The catalogue rule for I2 is "> own 4-week baseline + 2 standard deviations (fallback 5000ms)"; only the flat 5000 ms fallback is implemented. The catalogue's `sigma_multiplier: 2` and `baseline_weeks: 4` have no counterpart in SQL. `cells_on_page` and `n_turns` are likewise evidence-only.

### I3 — `v_i3_buried_words`
`PERCENT_RANK() OVER (PARTITION BY child_id ORDER BY taps)` over `v_card_stats`.

Exposed thresholds: `threshold_percentile = 0.95`, `threshold_nav_depth = 3`.
```
triggered = pct_rank >= 0.95 AND avg_nav_depth >= 3
```
The view's own `WHERE pct_rank >= 0.90` returns the near-miss band too, so a reader can see the top decile and not only what fired. `nav_depth` is `ROUND(avg_nav_depth, 1)`.

### I4 — `v_i4_unused_vocabulary`
A `UNION ALL` of two structurally different cases.

**CASE A — obsolete.** From `v_unused_cards JOIN cards`, `case_kind = 'obsolete'`, `threshold_days = 30`, `triggered = days_since_last >= 30`, `suggested_disposition = 'replace'`. Filter: `u.is_essential = 0 AND c.is_core = 0`, with the reasoning inline:

> *"Never propose removing an essential OR A CORE word. Core vocabulary is aspirational: an unused core word is a modelling target, not dead weight. Removing 'different' because a child has not used it yet takes away the very word that would let them refuse something."*

**CASE B — preference.** `children CROSS JOIN cards`, joined to a per-`(child_id, scene)` aggregate of `total_taps` and `protest_taps` (`cards.default_function = 'protest'`), `LEFT JOIN v_scene_matrix` on `(child_id, scene, label)` keeping only rows where `sm.taps IS NULL` (the card was never used in that scene). Restricted to `c.category IN ('food','drink') AND c.is_essential = 0`.
```
triggered = protest_taps >= 10 AND total_taps >= 50
suggested_disposition = 'no_action'
```
Case B sets `threshold_days = 10` — a column reused to carry the protest threshold, not a day count. The `total_taps >= 50` bound has no entry in `insights_catalog.default_thresholds` (which lists `min_scene_activity: 10`). Case B also depends on `v_scene_matrix`, which is affected by the `v_surviving_taps` last-tap bug described in [metric-views.md](metric-views.md).

### I5 — `v_i5_missing_combinations` and `v_i5_summary`
`mlu` CTE = `AVG(v_m_mlu.value)` over `w_start_28..w_end` (28 days). Joined to `v_word_pairs`, restricted to `WHERE p.together = 0`.

Exposed thresholds: `threshold_min_solo = 20`, `threshold_max_mlu = 1.30`.
```
triggered   = solo_a >= 20 AND solo_b >= 20 AND together = 0 AND mlu < 1.30
weaker_solo = MIN(solo_a, solo_b)
target_rank = ROW_NUMBER() OVER (PARTITION BY child_id ORDER BY weaker_solo DESC)
```
`v_i5_summary` collapses to one row per child with `mlu`, `missing_pairs`, and `target_1..target_3` formatted as `word_a || ' + ' || word_b`, `triggered` hard-coded to `1` (the view only reads rows already `triggered = 1`). Rationale: *"'Teach want + biscuit' is actionable; 94 pair rows are not."*

### I6 — `v_i6_scene_bound`
Four CTEs over `v_scene_matrix`: `totals` per `(child_id, label)`, `active_scenes` per child, `in_therapy` (`scene = 'therapy'`), `elsewhere` (`scene IN ('home','free_play','community')`).

Exposed threshold: `threshold_therapy_taps = 10`.
```
triggered = therapy_taps >= 10 AND other_taps = 0 AND child_active_scenes >= 3
```
The `child_active_scenes >= 3` guard has no entry in `insights_catalog.default_thresholds`. The catalogue's "sustained 2 consecutive weeks" (`weeks: 2`) is **not implemented** — `v_scene_matrix` spans all history and this view applies no window at all.

### I7 — `v_i7_modeling_gap`
CTEs: `recent` (`AVG(v_m_teacher_modeling.value)` over `w_start..w_end`), `prior` (same, `day_local < w_start`), `growth` (`v_m_new_words` split into `new_words_recent` / `new_words_prior`), `modeling_days` (`COUNT(DISTINCT day_local)` of `events WHERE actor = 'adult'`).

Exposed threshold: `threshold_modeling_per_day = 3`.
```
triggered                = modeling_per_day_recent < 3
modeling_mode_never_used = days_with_any_modeling = 0
```
Two gaps:
- The catalogue rule requires "child score in a vocabulary domain falling 2 consecutive weeks **AND** modelling ≈ zero". `new_words_recent`/`new_words_prior` are computed and exposed but do not participate in `triggered`, which fires on modelling volume alone.
- **`modeling_mode_never_used` can never be 1.** `modeling_days` only produces a row for a child who *has* adult events; a child with none gets NULL through the `LEFT JOIN`, and `CASE WHEN NULL = 0 THEN 1 ELSE 0 END` yields 0. The flag intended to distinguish "did not model" from "modelled without switching Modeling Mode on" is dead. Verified on the committed build: 5 rows, `SUM(modeling_mode_never_used) = 0`.

### I8 — `v_i8_layout_disruption`
`revs` = `board_revisions JOIN boards` filtered to `change_kind IN ('move','resize','remove')`. `before` = `AVG(v_m_mistap_rate.value)` over `[day - 7, day)`; `after` = same over `[day, day + 7)`.

Exposed threshold: `threshold_delta = 0.0`.
```
delta     = mistap_after - mistap_before          (ROUND(..., 4))
triggered = mistap_after > mistap_before AND days_before >= 3 AND days_after >= 3
```
The `days_before >= 3 / days_after >= 3` minimum-coverage guard is not in the catalogue thresholds. The catalogue's alternative trigger — `position_consistency < 1.0` for an active mode — is **not implemented here**; only `board_revisions` rows can fire I8. The catalogue's `variance_multiplier: 1.0` ("exceeds the child's own week-to-week variance") is implemented as a plain `>` comparison against `threshold_delta = 0.0`.

`suggested_by_insight` and `reason` are carried through so a fired I8 can name the earlier insight whose advice caused the change.

### `v_insights_fired`
`UNION ALL` of eight `SELECT '<id>', child_id, COUNT(*) AS evidence_rows … WHERE triggered = 1 GROUP BY child_id` over `v_i1_mistap_classification`, `v_i2_scanning_load`, `v_i3_buried_words`, `v_i4_unused_vocabulary`, `v_i5_summary` (not `v_i5_missing_combinations`), `v_i6_scene_bound`, `v_i7_modeling_gap`, `v_i8_layout_disruption`. `tools/verify.py` gates the build on it.

### Summary: rule text vs. SQL
| Insight | In `insights_catalog.trigger_rule` | Implemented in SQL |
|---|---|---|
| I1 | mistap_rate > 8% across 5+ **sessions** | 5+ distinct **days**; semantic cut-off 0.35 added |
| I2 | baseline + 2σ, fallback 5000 ms | flat 5000 ms only; `baseline_ms` unused |
| I3 | percentile ≥ 95, nav_depth ≥ 3 | matches (rows returned from ≥ 0.90) |
| I4 | 30 days / preference case | matches; case B adds `total_taps >= 50`, scoped to `category IN ('food','drink')` |
| I5 | solo ≥ 20 both, together = 0, mlu < 1.3 | matches, mlu over 28 days |
| I6 | high in therapy, 0 elsewhere, **2 consecutive weeks** | no time window; adds `n_scenes >= 3` |
| I7 | vocabulary score falling 2 weeks AND modelling ≈ 0 | modelling only; growth columns unused |
| I8 | revision **or** position_consistency < 1.0, delta > own variance | revisions only; delta > 0 with ≥3 days each side |

## Dependencies & Connections

### Depends On
- [Metric Views](metric-views.md) — `v_tap_sequence`, `v_mistaps`, `v_cell_heat`, `v_card_stats`, `v_unused_cards`, `v_scene_matrix`, `v_word_pairs`, `v_m_time_to_first_tap`, `v_m_mlu`, `v_m_mistap_rate`, `v_m_teacher_modeling`, `v_m_new_words`
- [Analytics Schema and Indices](schema.md) — reads `events`, `utterances`, `partner_turns`, `boards`, `board_cells`, `board_revisions`, `cards`, `children`; `ix_revisions_disruptive` and `ix_events_adult` exist for I8 and I7 respectively
- [Metric and Insight Catalogues](catalogues.md) — the `insight_id` literals `'I1'…'I8'` must match `insights_catalog` primary keys; `default_thresholds` is the documented counterpart to the threshold columns here

### Depended On By
- [../pipeline/rule-materialisation.md](../pipeline/rule-materialisation.md) — `tools/run_rules.py` reads all eight views and writes `fired_rules` rows with `evidence` and `thresholds_used` JSON
- [../pipeline/verification-gate.md](../pipeline/verification-gate.md) — `tools/verify.py` gates on `v_insights_fired`, `v_i4_unused_vocabulary` and `v_scene_matrix`
- [../mcp/tool-surface.md](../mcp/tool-surface.md) — `mcp/tools.ts` queries `v_insights_fired`, `v_i6_scene_bound`, `v_i8_layout_disruption`
- [../mcp/tool-surface.md](../mcp/tool-surface.md) — a model narrates a `fired_rule` produced from these views; it never evaluates the rule itself
- [../dashboard/insight-cards.md](../dashboard/insight-cards.md) — renders the fired rules and their evidence

### Shared Resources
- `v_window` is the single definition of "today" for every rule; changing `w_end` moves all eight windows at once
- The 1500 ms mis-tap threshold is duplicated from `db/views_metrics.sql` into `v_i1_mistap_classification`
- Threshold literals appear **twice** in the system: as JSON in `insights_catalog.default_thresholds` and as constant columns here. Nothing keeps them in sync

## Change Risks

- **The threshold columns and `insights_catalog.default_thresholds` are independent copies.** Changing 0.08 here without changing `mistap_rate_min` in the seed makes `fired_rules.thresholds_used` disagree with the number that actually fired — which defeats the stated purpose of storing it ("so a disagreement can be traced to a number").
- **Anything that widens `v_window`** changes every rule's evidence at once. `w_end` is the max `day_local` in `events`, so ingesting a single event with a future `day_local` shifts all eight windows forward and can silently empty them.
- **`v_i4_unused_vocabulary` case B is a `CROSS JOIN` of `children × cards`**, narrowed only afterwards by `category IN ('food','drink')`. Growing the card catalogue grows this quadratically; it is the most expensive view in the file and no index can help the cross product.
- **Fixing `v_surviving_taps`** (see [metric-views.md](metric-views.md)) changes `v_scene_matrix` tap counts, which can newly trigger I6 (`therapy_taps >= 10`) and change I4 case B membership.
- **Making I7's `modeling_mode_never_used` work** would require a `LEFT JOIN` from `children`, not from `recent` — and would then start flagging children the dashboard currently reports as simply low-modelling. That is the intended behaviour per the safety note ("Check whether Modeling Mode was simply left switched off"), but it changes what teachers see.
- **Implementing I2's baseline+2σ or I8's variance multiplier** will reduce firing rates; every downstream count (`v_insights_fired`, the dashboard attention queue, `tools/verify.py`'s acceptance gate) moves with it.
- **Renaming a `triggered` column or a view** breaks `tools/run_rules.py`, which selects them by name, and `v_insights_fired`, which hard-codes all eight view names.
- **Adding a ninth insight** requires four coordinated edits: a row in `insights_catalog`, a view here, a branch in `v_insights_fired`, and a handler in `tools/run_rules.py` — plus `insights_catalog.insight_id` is the FK target for `fired_rules`, so the catalogue row must exist first.
