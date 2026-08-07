# Metric Views

## Function
Defines 41 SQL views that compute every metric from `events`, `utterances` and `partner_turns`: 24 scalar `v_m_<slug>` views keyed on `(child_id, day_local)` returning `value, n`, 13 dimensional views (per card, per cell, per pair, per scene), 3 shared helpers (`v_tap_sequence`, `v_surviving_taps`, `v_first_uses`), and `v_daily_metrics_all`, the UNION that `tools/rollup.py` inserts straight into `agg_daily_metric`.

## Purpose
The header is unambiguous about authority:

> *"These views ARE the definition of each metric. `agg_daily_metric` is only a cache of `v_daily_metrics_all`; if the two ever disagree, the view is right."*

Keeping every definition in SQL rather than in TypeScript or Python means the MCP server, the dashboard and the nightly rollup all compute the same number, and a speech therapist can read the derivation. `metrics_catalog.formula` is the human-readable version of what is here; this file is the executable one.

Two clinical constraints are enforced structurally rather than by convention:
- **C1** — `v_mistaps` requires a `delete_last`. Repetition without a delete is never counted as an error anywhere. Group H's header repeats it: *"NOT errors. A run of >=3 taps on the same card with no delete is exploration, motor learning, gestalt processing, or stimming."*
- **C4** — `v_m_position_consistency` exists *"to PROVE that invariant holds rather than to assume it — if the schema is ever changed to let modes carry positions, this starts returning < 1.0."*

Views also filter to `actor = 'child'` throughout, "unless the metric is explicitly about the adult".

## Source Files
| File | Role |
|------|------|
| `db/views_metrics.sql` | All 41 views: 24 scalar metric views, 13 dimensional views, 3 shared helpers, and the `v_daily_metrics_all` union |

## Implementation

### Applying
```bash
sqlite3 aac.db < db/views_metrics.sql          # after db/schema.sql
```
`tools/build.sh` applies it in step **4/7 "views"**, together with `db/views_insights.sql`. Every view is preceded by `DROP VIEW IF EXISTS`, so the file is fully idempotent.

### Naming convention
- `v_m_<slug>` — scalar, one row per `(child_id, day_local)`, columns `child_id, day_local, value, n`
- `v_<name>` — dimensional (per card, per cell, per pair, per scene)

### Shared building blocks

**`v_tap_sequence`** — one window-function pass over `events` filtered to `actor = 'child' AND type IN ('card_tap','delete_last')`, partitioned by `utterance_id` ordered by `ts`. Exposes `LEAD(type) AS next_type`, `LEAD(grid_row) AS next_row`, `LEAD(grid_col) AS next_col`, and `LAG(card_id, 1..3) AS prev1, prev2, prev3`. The performance rationale stands: *"Correlated subqueries were 40x slower on 27k events."* Its actual readers are `v_m_mistap_rate`, `v_cell_heat`, `v_repeat_runs_by_card`, `v_i1_mistap_classification` (in `db/views_insights.sql`), and the sliced `mistap_rate` query in `mcp/tools.ts:257`. The file's own header comment at `views_metrics.sql:17` — *"used by the mis-tap, adjacency and repetition metrics"* — is stale the same way this doc once was: `v_mistaps` (adjacency) and `v_m_repeat_tap_rate` (repetition) no longer read it.

**`v_mistaps`** — the unintended-activation view: `WHERE d.actor = 'child' AND d.type = 'delete_last' AND d.ms_delta IS NOT NULL AND d.ms_delta < 1500` (the **1500 ms** threshold is hard-coded here and in three other places in this file: `v_m_mistap_rate`, `v_cell_heat`, `v_surviving_taps`). It builds a `taps` CTE of child `card_tap` events and finds each delete's *replacement* with a correlated `MIN(ts)` join — the next **TAP** in the same utterance, not the next event:

```sql
LEFT JOIN taps t
  ON t.utterance_id = d.utterance_id
 AND t.ts = (SELECT MIN(t2.ts) FROM taps t2
             WHERE t2.utterance_id = d.utterance_id AND t2.ts > d.ts)
```

The comment records why it does not reuse `v_tap_sequence`'s `LEAD`: *"LEAD sees the next EVENT, and when two deletes chain the 'replacement' it compared against was the other delete's coordinates — the catalogue defines adjacency against the button the child actually pressed next."* And why the correlated lookup is affordable here when the header banned it elsewhere: *"Deletes are ~5% of events and the lookup runs on the (utterance_id, ts) index, so the 40x-correlated-subquery caveat on v_tap_sequence does not bite here."*

`correction_adjacent` is:
```sql
CASE
  WHEN t.grid_row IS NULL OR d.grid_row IS NULL THEN NULL
  WHEN abs(t.grid_row - d.grid_row) <= 1 AND abs(t.grid_col - d.grid_col) <= 1 THEN 1
  ELSE 0
END
```
i.e. a 3×3 Chebyshev neighbourhood, NULL when either side lacks a grid position — no following tap to classify against, or an off-grid press.

**The median idiom.** SQLite has no `median()`. Four views use the two-middle-rows trick:
```sql
ROW_NUMBER() OVER (PARTITION BY child_id, day_local ORDER BY <col>) AS rn,
COUNT(*)     OVER (PARTITION BY child_id, day_local) AS cnt
...
SELECT AVG(<col>) AS value, MAX(cnt) AS n
FROM ranked WHERE rn IN ((cnt + 1) / 2, (cnt + 2) / 2)
```
"worth the verbosity: one 12-tap struggle wrecks an average." Used by `v_m_taps_per_utterance`, `v_m_composition_time`, `v_m_time_to_first_tap`, `v_m_partner_wait_time`.

**`v_surviving_taps`** — taps that were *not* deleted within 1500 ms, used by every scene and feeling-word view. Rationale: *"one accidental press of 'thank you' at home reads as generalisation."*

### Scalar views, group by group

**Group A — effort and speed**
| View | Source | Filter | value |
|---|---|---|---|
| `v_m_taps_per_utterance` | `utterances.tap_count` | `actor = 'child'` (spoken and abandoned) | median |
| `v_m_composition_time` | `utterances.ms_compose` | `actor='child' AND spoken=1 AND ms_compose IS NOT NULL` | median (ms) |
| `v_m_time_to_first_tap` | `utterances.ms_to_first_tap` | `actor='child' AND ms_to_first_tap IS NOT NULL` | median (ms) |
| `v_m_words_per_minute` | `utterances` | `spoken=1 AND ms_compose > 0` | `SUM(word_count) * 60000.0 / NULLIF(SUM(ms_compose), 0)` |

`v_m_words_per_minute` measures rate **while composing**, not per wall-clock minute: *"a child who says one thing an hour is not communicating at 0.1 wpm, they are composing at their normal rate and speaking less often. Volume is `utterances_per_day`; this is rate."*

**Group B — errors and motor**
- `v_m_mistap_rate` — `SUM(delete_last AND ms_delta < 1500) / NULLIF(SUM(card_tap), 0)`, `n` = card_tap count
- `v_m_correction_adjacent_rate` — `AVG(correction_adjacent)` over `v_mistaps WHERE correction_adjacent IS NOT NULL`; `n` = number of classifiable mis-taps
- `v_m_abandonment_rate` — `AVG(CASE WHEN spoken = 0 THEN 1.0 ELSE 0.0 END)` over all child utterances
- `v_cell_heat` (dimensional) — grouped by `(child_id, board_id, grid_rows, grid_cols, grid_row, grid_col, day_local)` with `taps` and `mistaps`. Grid dims are in the grouping key "so two different grid sizes are never silently merged"

**Group C — volume and vocabulary**
- `v_m_utterances_per_day` — `COUNT(*)` of spoken child utterances
- `v_m_silence_streak` — `julianday((SELECT MAX(day_local) FROM utterances)) - julianday(COALESCE(MAX(u.day_local), '1970-01-01'))`, `LEFT JOIN` from `children` so a child with zero utterances still gets a row. Note both the "today" anchor and the reported `day_local` are the **global** max over `utterances`, not a per-child or wall-clock date. A child who has never spoken scores a streak measured from 1970-01-01.
- `v_m_ndw` — `COUNT(DISTINCT label)` over `events` `card_tap` with `label IS NOT NULL`; `n` is the raw tap count, not the utterance count. Deleted taps are **not** excluded here.
- `v_m_mlu` — `AVG(symbol_count)` over spoken child utterances
- `v_m_core_fringe_ratio` — `events JOIN cards`, `AVG(CASE WHEN c.is_core = 1 THEN 1.0 ELSE 0.0 END)`
- `v_first_uses` — `(child_id, label, MIN(day_local) AS first_day)`
- `v_m_new_words` — a **proportion**: first uses on that day divided by the count of labels first used strictly before it, `NULLIF(..., 0)` so the very first day is NULL. The comment cites `proposed_metrics.docx`: "Five new words means one thing at a vocabulary of 20 and another at 200."
- `v_new_words_count` — the raw count, "still matters for the headline number on the card". This is the view `v_daily_metrics_all` feeds `new_words` from, matching the catalogue's `count` unit; the proportion in `v_m_new_words` is retained solely for rule I7, whose `growth` CTE in `v_i7_modeling_gap` sums it (the union's own comment says "kept for rule I6" — a mislabelled rule number; I7 is the only reader).
- `v_card_stats` — per `(child_id, card_id)`: `taps`, `active_days`, `scene_count`, `first_day`, `last_day`, `avg_nav_depth = AVG(COALESCE(nav_depth, 0))`, `days_since_last` computed against `(SELECT MAX(day_local) FROM events)`
- `v_unused_cards` — `child_vocabulary LEFT JOIN v_card_stats WHERE COALESCE(taps, 0) = 0`, `days_since_last` defaulting to **9999**. "a card with zero taps produces zero rows in `v_card_stats` and would otherwise be invisible to the very insight that looks for dead vocabulary"
- `v_word_pairs` — `solo` counts per label from `events`; `expanded` explodes `utterances.labels` via `json_each`; `pairs` self-joins on `a.utterance_id = b.utterance_id AND a.label < b.label` so ordering is canonical (`MIN`/`MAX` of the two labels). Final filter `sa.uses >= 10 AND sb.uses >= 10`. Pairs never seen together appear with `together = 0` via `COALESCE`.

**Group D — layout and context**
- `v_scene_matrix` — `v_surviving_taps JOIN cards`, grouped by `(child_id, scene, label)` with `taps` and `days`. `c.default_function` is selected but not grouped (a bare column; SQLite picks an arbitrary matching row).
- `v_m_layout_stability` — `SUM(CASE WHEN change_kind IN ('move','resize','remove') THEN 1 ELSE 0 END)` per `(child_id, day_local)`. **The value is a count of disruptive changes, so it rises as stability falls, while `metrics_catalog.polarity` for `layout_stability` is `higher_better`.** Any UI that colours from polarity will paint a disruptive day green.
- `v_m_position_consistency` — for every card in every `kind = 'mode'` board, `LEFT JOIN board_cells` at that child's robust board with `canonical = 1`; `value = AVG(matched)`. `day_local` is `(SELECT MAX(day_local) FROM events)`. The robust board is picked by a scalar subquery `(SELECT board_id FROM boards rb WHERE rb.child_id = b.child_id AND rb.kind = 'robust')`, which silently takes the first row if a child ever has more than one robust board. **Data-level caveat:** the current `aac.db` contains zero `kind = 'mode'` boards, so this view yields no rows at all — the mechanism is intact but exercised by nothing, `agg_daily_metric` gets no `position_consistency` rows, and `get_child_profile.active_modes` returns `[]`.

**Group E — whose voice**
- `v_m_independence_rate` — `AVG(used_suggestion = 0)` over spoken child utterances
- `v_m_teacher_modeling` — `COUNT(*)` of `events` with `actor = 'adult' AND type = 'card_tap'`; this is the one view that deliberately reads adult rows
- `v_function_mix` (dimensional) — `(child_id, scene, function, utterances)` over spoken child utterances with `function IS NOT NULL`

**Group F — AI value**
- `v_m_taps_saved` — per day, `AVG(tap_count)` for `used_suggestion = 0` (`without_ai`) and `= 1` (`with_ai`), `uses = SUM(used_suggestion)`; `value = (without_ai - with_ai) * uses`, emitted only when both arms are non-NULL. The catalogue formula specifies **medians**; the view uses **means**.

**Group G — communication partner**
- `v_m_partner_wait_time` — median `ms_to_next_partner_turn` where `child_responded = 0 AND ms_to_next_partner_turn IS NOT NULL`
- `v_m_partner_interruption_rate` — `AVG(interrupted_utterance_id IS NOT NULL)` over all `partner_turns`

**Group H — communication style**
- `v_m_repeat_tap_rate` — builds its own `seq` CTE over `events` (not `v_tap_sequence`) carrying **both type and card_id at each lag**: `LAG(type, k) AS t1..t3` alongside `LAG(card_id, k) AS c1..c3`. A run fires on `type = 'card_tap' AND t1 = 'card_tap' AND c1 = card_id AND t2 = 'card_tap' AND c2 = card_id AND (t3 IS NULL OR t3 <> 'card_tap' OR c3 <> card_id)` — exactly one row per run of length >= 3, counted at the third tap. The CTE comment explains why the chain must carry event type: *"with card_id alone, a delete of the same card both broke runs it sat inside AND extended runs backwards, undercounting (A, del A, A, A, A holds a legal 3-run that prev3=A hid)."* `value = run_count / COUNT(utterances)` per day, over all child utterances (spoken and abandoned), `COALESCE(run_count, 0)` so a day with no runs reports 0 rather than NULL.
- `v_repeat_runs_by_card` — still reads `v_tap_sequence` with the **old card_id-only predicate** (`card_id = prev1 AND card_id = prev2 AND (prev3 IS NULL OR prev3 <> card_id)`, no type check), so the two repetition views no longer agree: a `delete_last` of the same card can suppress or shift runs here that `v_m_repeat_tap_rate` counts. *"This is the join that turns 'she keeps pressing it' into 'she may lack the word'."*

**Feeling words**
- `v_feeling_words` — `v_surviving_taps JOIN emotion_lexicon ON el.word = s.label` (exact string match on the denormalised event label), grouped by `(child_id, day_local, category, label)`
- `v_feeling_words_available` — `child_vocabulary JOIN cards JOIN emotion_lexicon ON el.word = c.label`, per `(child_id, category)`. Not optional: *"without it, '60% positive' is unreadable, because a board holding two positive words and no negative one can only ever report positive."*
- `v_m_feeling_words` — share of feeling-word uses that were `category = 'positive'`; `n = SUM(uses)`

**Sentence shapes**
- `v_sentence_shapes` — `utterance_structures JOIN utterances JOIN syntax_patterns`, spoken child utterances only, exposing `pattern_id, name, example, stage, uses`
- `v_m_sentence_shapes` — `COUNT(DISTINCT pattern_id)` per day, `n = SUM(uses)`. *"There is deliberately no view of what is absent: a structure the board cannot express is not a fact about the child."*

**Answers and topic starts**
- `v_m_answers_vs_starts` — `AVG(EXISTS (SELECT 1 FROM partner_turns p WHERE p.child_id = u.child_id AND u.ts - (p.ts + p.ms_duration) BETWEEN 0 AND 30000))`. A **30,000 ms** window after the partner stops speaking marks the utterance as an answer. The correlated subquery matches on `child_id` and time only — not on `session_id` or `scene`.

**Sessions**
- `v_session_summary` — `SELECT s.*` from `sessions` plus `mistap_rate = mistaps / NULLIF(taps, 0)` and `abandon_rate = abandoned / NULLIF(utterances + abandoned, 0)`

### `v_daily_metrics_all`
A `UNION ALL` of 24 branches, each prefixed with its literal `metric_id`:

`taps_per_utterance`, `composition_time`, `time_to_first_tap`, `words_per_minute`, `mistap_rate`, `correction_adjacent_rate`, `abandonment_rate`, `utterances_per_day`, `silence_streak`, `ndw`, `mlu`, `core_fringe_ratio`, `new_words`, `layout_stability`, `position_consistency`, `independence_rate`, `teacher_modeling`, `taps_saved`, `partner_wait_time`, `partner_interruption_rate`, `repeat_tap_rate`, `feeling_words`, `sentence_shapes`, `answers_vs_starts`.

Twenty-three branches read a `v_m_*` view; the `new_words` branch instead reads `v_new_words_count` (`SELECT 'new_words', child_id, day_local, new_words * 1.0, new_words FROM v_new_words_count`), so the **count** — the catalogue's unit — is what reaches `agg_daily_metric`, and `v_m_new_words` is the one scalar view not unioned here. The in-file comment: *"The catalogue defines new_words as a COUNT ('labels whose earliest ever card_tap falls inside the window', unit 'count'), and every window reader SUMs daily rows. v_m_new_words is a proportion … — summing proportions produced a number that was neither. The count view feeds here."*

`tools/rollup.py` inserts `agg_daily_metric` straight from this view. Column order matters: every other branch is `SELECT '<metric_id>', *` from a view whose columns are `(child_id, day_local, value, n)` in that order.

### Metrics with `status = 'shown'` and no view here
`suggestion_acceptance`, `vocabulary_gaps`, `visual_source_split` and `keyboard_use` are seeded as `shown` in `metrics_catalog` but have **no view at all** in this file — their formulas reference `suggestion_shown` / `gap_detected` / `keyboard_input` events that are never aggregated. They will read as `not_collected` downstream.

The remaining shown metrics are served by dimensional views rather than scalars: `card_frequency` and `zero_activation_days` from `v_card_stats` / `v_unused_cards`, `cell_heat` from `v_cell_heat`, `word_pairs` from `v_word_pairs`, `nav_depth_by_card` from `v_card_stats.avg_nav_depth`, `scene_distribution` from `v_scene_matrix`, `pragmatic_function_mix` from `v_function_mix`.

### Bug: `v_surviving_taps` drops the last tap of every utterance
```sql
WHERE t.type = 'card_tap'
  AND NOT (t.next_type = 'delete_last' AND t.next_delta < 1500)
```
For the final event in an `utterance_id` partition, `next_type` and `next_delta` are NULL, so the predicate evaluates `NOT (NULL AND NULL)` → NULL, and the row is filtered out. Every utterance whose event stream ends in a `card_tap` therefore loses that tap.

Rather than freezing counts that go stale on every reseed, verify with:

```bash
sqlite3 aac.db "SELECT
  (SELECT COUNT(*) FROM events WHERE actor='child' AND type='card_tap')  AS child_taps,
  (SELECT COUNT(*) FROM v_mistaps)                                       AS mistapped,
  (SELECT COUNT(DISTINCT utterance_id) FROM events
    WHERE actor='child' AND type IN ('card_tap','delete_last'))          AS partitions,
  (SELECT COUNT(*) FROM v_surviving_taps)                                AS surviving;"
```

On the current build this reports 18,632 child taps, 808 mis-taps, 6,360 utterance partitions and 11,466 surviving rows — one dropped tap per mis-tap plus one per partition ending in a tap (6,358 of the 6,360; the two utterances that end in a slow, >= 1500 ms delete keep their last tap, which is why the naive `taps − mistaps − partitions` arithmetic can be off by a handful).

Everything downstream of `v_surviving_taps` undercounts by one tap per utterance: `v_scene_matrix` (and therefore `v_i4_unused_vocabulary` case B and `v_i6_scene_bound`), `v_feeling_words` and `v_m_feeling_words`. A card only ever tapped last in its utterances disappears from `v_scene_matrix` entirely.

The intent is expressed correctly in the sibling `v_tap_sequence`/`v_mistaps` pair, which never negate a NULL-producing comparison.

## Dependencies & Connections

### Depends On
- [Analytics Schema and Indices](schema.md) — reads `events`, `utterances`, `partner_turns`, `cards`, `boards`, `board_cells`, `board_revisions`, `child_vocabulary`, `mode_selection`, `children`, `emotion_lexicon`, `syntax_patterns`, `utterance_structures`, `sessions`; relies on `ix_events_child_type_day`, `ix_events_utterance`, `ix_events_heat` and `ix_utt_child_day` for the 50 ms budget
- [Metric and Insight Catalogues](catalogues.md) — every view is the executable form of a `metrics_catalog.formula`; `metric_id` literals in `v_daily_metrics_all` must match catalogue primary keys

### Depended On By
- [Insight Rule Views](insight-views.md) — I1 uses `v_tap_sequence`, `v_mistaps`, `v_m_time_to_first_tap`, `v_cell_heat`; I3 uses `v_card_stats`; I4 uses `v_unused_cards` and `v_scene_matrix`; I5 uses `v_word_pairs` and `v_m_mlu`; I6 uses `v_scene_matrix`; I7 uses `v_m_teacher_modeling` and `v_m_new_words`; I8 uses `v_m_mistap_rate`
- [../pipeline/l2-rollup.md](../pipeline/l2-rollup.md) — `tools/rollup.py` reads `v_daily_metrics_all`, `v_card_stats`, `v_cell_heat`, `v_scene_matrix`, `v_word_pairs`
- [../analytics/metric-readers.md](../analytics/metric-readers.md) — `lib/metrics.ts` reads `agg_daily_metric` for scalars and "Dimensional metrics… come from their views directly — they have no scalar form and never appear in `agg_daily_metric`"
- [../mcp/tool-surface.md](../mcp/tool-surface.md) — `mcp/tools.ts` queries `v_card_stats` and `v_scene_matrix`
- [../pipeline/verification-gate.md](../pipeline/verification-gate.md) — `tools/verify.py` gates the build on `v_scene_matrix` and others

### Shared Resources
- `v_tap_sequence` is the shared one-pass scan; `v_m_mistap_rate`, `v_cell_heat`, `v_repeat_runs_by_card`, `v_i1_mistap_classification` and `mcp/tools.ts:257` read it (`v_mistaps` and `v_m_repeat_tap_rate` no longer do)
- The literal **1500 ms** mis-tap threshold appears in `v_mistaps`, `v_m_mistap_rate`, `v_cell_heat`, `v_surviving_taps`, and twice in `v_i1_mistap_classification` (the `agg` CTE filter and the exposed `mistap_threshold_ms` constant)
- `v_daily_metrics_all` is the contract between this file and `agg_daily_metric`

## Change Risks

- **Changing the 1500 ms threshold requires six edits**: four places in this file (`v_mistaps`, `v_m_mistap_rate`, `v_cell_heat`, `v_surviving_taps`) plus two in `db/views_insights.sql` (`v_i1_mistap_classification`'s `agg` CTE filter and its exposed `mistap_threshold_ms` constant). The catalogue documents 2500 ms as often more accurate for athetoid cerebral palsy, and there is no per-child override anywhere — the constant is inline SQL.
- **Adding a scalar view without adding it to `v_daily_metrics_all`** means it never reaches `agg_daily_metric`, so the dashboard shows it as absent while the view computes fine.
- **Changing a view's column order** breaks `v_daily_metrics_all` silently — the union uses `SELECT '<id>', *`, so a reordered view writes `n` into `value`.
- **Counting repetition as error anywhere** (e.g. dropping the `delete_last` requirement from `v_mistaps`) violates C1 and would make `mistap_rate` pathologise stimming. The `metrics_catalog` caveat and the group-H header both exist to stop this.
- **Letting modes carry coordinates** turns `v_m_position_consistency` from a tautological 1.0 into a real measurement — which is the intended alarm, but every consumer that assumes 1.0 will start seeing drift.
- **Fixing `v_surviving_taps`** will raise `v_scene_matrix` tap counts by roughly one per utterance, which can newly trip `v_i6_scene_bound`'s `therapy_taps >= 10` and change `v_m_feeling_words` proportions. It is a correctness fix, but it moves numbers a teacher may already have seen.
- **`v_m_silence_streak` anchors on the global `MAX(day_local)` over `utterances`.** If one child keeps using the device and another stops, the streak is measured from the *fleet's* latest day — correct for a demo dataset, wrong the moment a child's data stops arriving while others' continue. It also emits the same `day_local` for every child.
- **`v_m_layout_stability` returning a disruption count while its catalogue polarity is `higher_better`** means fixing either side alone flips the colour of the tile. Change both together.
- **Both `new_words` views exist, and only the count reaches `agg_daily_metric`.** `v_daily_metrics_all` feeds from `v_new_words_count`; `v_m_new_words` (the proportion) is read solely by rule I7. Re-adding the proportion to the union, or pointing I7's `growth` CTE at the count, silently changes what the number means without breaking anything visibly.
