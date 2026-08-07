# AAC Analytics — MCP Server Contract

**Status:** build spec
**Consumer:** **Gemma 3 4B** on a separate analysis device, connecting outbound as an MCP client (see `TECH_STACK.md`). Claude Desktop over stdio for development.
**Backing store:** `aac.db` (SQLite, WAL, shared Drizzle client, `query_only = ON` + deny-`ATTACH` authorizer — *not* `mode=ro`, which cannot open a WAL database; see §10)
**Never opened:** `aac_text.db` — enforced by OS permissions on the MCP process user, not by policy

---

## 1. Design principles

The model can only reason as well as this surface lets it. Five rules follow from that.

| # | Principle | Consequence |
|---|---|---|
| 1 | **A bare number is a trap.** | Every metric value ships with its unit, polarity, sample size, and caveat — pulled from `metrics_catalog`, not hardcoded. |
| 2 | **Aggregation happens in SQL.** | Raw events are ~90 k tokens per child-week. No tool returns them. The largest raw-ish tool caps at 200 utterance rows. |
| 3 | **Warnings are computed, not documented.** | If the sample is too small, or the layout changed mid-window, the response *says so in that response*. The model should not have to remember to check. |
| 4 | **Some advice is forbidden.** | `forbidden_actions` travels with every insight payload. The model is told what it must not recommend, in-band. |
| 5 | **Text is unreachable, not merely unauthorised.** | Three independent layers, because any one of them can be bypassed. See §10 — this is harder than "open it read-only". |

---

## 2. Universal response envelope

**Every** tool returns this shape. Nothing returns a bare array.

```jsonc
{
  "data":   { /* tool-specific */ },

  "meta": {
    "child_id":      "maya_t",
    "window":        { "start": "2026-08-03", "end": "2026-08-09", "days": 7 },
    "row_count":     24,
    "truncated":     false,          // true ⇒ a LIMIT was hit; narrow the window
    "generated_at":  1754524800000,
    "data_freshness": {
      "rollup_through": "2026-08-06", // agg_* materialised to here
      "live_from":      "2026-08-07", // today computed live from L1
      "is_partial_day": true          // today is still in progress
    }
  },

  "dictionary": {
    // one entry per metric_id appearing in `data`. Verbatim from metrics_catalog.
    "mistap_rate": {
      "name": "Unintended activation rate",
      "group": "B",
      "plain_explanation": "How often a button was pressed and then deleted almost immediately…",
      "formula": "count(delete_last where ms_delta < mistap_threshold_ms) / count(card_tap), per day",
      "unit": "ratio",
      "polarity": "lower_better",
      "min_n": 30,
      "caveat": "REQUIRES A DELETE. Repeated pressing WITHOUT a delete is never counted here…"
    }
  },

  "guidance": [
    // Computed for THIS result. See §6 for the full trigger list.
    { "level": "warning", "code": "SMALL_SAMPLE",
      "detail": "mistap_rate has n=18, below its min_n of 30. Value returned as null.",
      "affects": ["mistap_rate"] },
    { "level": "critical", "code": "LAYOUT_CHANGED_MID_WINDOW",
      "detail": "Board 'robust_maya' had a 'move' revision on 2026-08-05. cell_heat and mistap_rate span both layouts and are not comparable across that date.",
      "affects": ["cell_heat", "mistap_rate", "correction_adjacent_rate"] }
  ],

  "forbidden_actions": ["resize_grid", "move_card", "reduce_repetition"],

  "next_calls": [
    // Optional. What a competent analyst would look at next, given this result.
    { "tool": "get_cell_heat", "args": { "child_id": "maya_t" },
      "because": "mistap_rate is elevated and correction_adjacent_rate is 0.81 — check where on the grid" }
  ]
}
```

`guidance` is the single most important field in this contract. It is what stops the model concluding that a child regressed when in fact an adult moved a button.

---

## 3. Tools

Nineteen tools implemented in `mcp/tools.ts`, four tiers. Names align with `docs/TECH_STACK.md`. The tool definitions themselves cost **1,149 tokens** of context on every request (measured) — budgeted deliberately, because the alternative is the model writing SQL for everything.

### Tier 1 — Orientation

---

#### `list_children`

Who this adult may see. Always the first call.

| Param | Type | Required | Notes |
|---|---|---|---|
| `adult_id` | string | yes | access is scoped through `roster`; expired rows are excluded |
| `class_id` | string | no | filter to one class |

**Returns** `data.children[]`:

| Field | Type | Unit | Null when |
|---|---|---|---|
| `child_id` | string | — | never |
| `display_name` | string | — | never |
| `year_group` | string | — | not recorded |
| `profile_note` | string | — | not recorded — e.g. `"CP / dysarthria"` |
| `relation` | enum | `teacher\|parent\|slt` | never |
| `consent_tiers` | string[] | — | never — what this adult may see for this child |
| `active_days_last_14` | integer | count | never |
| `silence_streak_days` | integer | days | never |
| `open_insight_count` | integer | count | never — fired and not dismissed |

**~400 tokens for 5 children** (measured).

---

#### `get_child_profile`

Everything needed to interpret that child's numbers correctly.

| Param | Type | Required |
|---|---|---|
| `child_id` | string | yes |

**Returns** `data`:

| Field | Type | Notes |
|---|---|---|
| `child_id`, `display_name`, `year_group`, `profile_note` | | |
| `robust_board` | object | `{board_id, grid_rows, grid_cols, total_cells, masked_cells, cards_placed}` |
| `active_modes` | object[] | `{board_id, name, card_count, position_consistency}` |
| `baseline` | object | per-metric 4-week rolling mean + stdev — **the comparison basis for every insight** |
| `first_event_day` / `last_event_day` | string | `YYYY-MM-DD` |
| `total_days_active` | integer | affects whether baselines are trustworthy |
| `consent_tiers` | string[] | |
| `modeling_mode_used_days` | integer | if 0, `teacher_modeling` zeros are uninterpretable |

**~780 tokens** (measured). Call this before drawing any conclusion — `baseline` is what "elevated" means for this child.

---

### Tier 2 — Metrics

---

#### `get_metrics`

The workhorse. All shown metrics for a window, with deltas.

| Param | Type | Required | Default | Range |
|---|---|---|---|---|
| `child_id` | string | yes | | |
| `window` | enum | no | `last_7d` | `today · last_7d · last_14d · last_28d · term · custom` |
| `start` / `end` | string | if `custom` | | `YYYY-MM-DD`, ≤ 120 days apart |
| `metric_ids` | string[] | no | all `status='shown'` | max 40 |
| `groups` | string[] | no | all | `A`–`H` (see §4) |
| `compare_to` | enum | no | `previous_window` | `previous_window · baseline_4w · none` |

**Returns** `data.metrics[]`:

| Field | Type | Unit | Semantics |
|---|---|---|---|
| `metric_id` | string | — | |
| `value` | number \| **null** | per `dictionary[].unit` | **null means the sample was too small (`n < min_n`), NOT zero.** Never read null as "did not happen". |
| `n` | integer | count | sample size behind `value`. Always present, even when `value` is null. |
| `comparison_value` | number \| null | same | previous window or baseline |
| `delta` | number \| null | same | `value − comparison_value` |
| `delta_pct` | number \| null | ratio | null if `comparison_value` is 0 |
| `direction` | enum | — | `improved · worsened · unchanged · not_applicable` — resolved through `polarity`, so `neutral` metrics always return `not_applicable` |
| `days_with_data` | integer | days | out of `window.days` |
| `suppressed_reason` | enum \| null | — | `small_sample · no_consent · not_collected · metric_cut` |

**~5,050 tokens for 30 metrics with the dictionary, ~2,150 without** (measured). Pass `include_dictionary: false` on repeat calls.

> **Reading `direction`:** it already accounts for polarity. `mistap_rate` falling returns `improved`; `repeat_tap_rate` changing in any direction returns `not_applicable`, because repetition is neutral. Do not compute direction yourself.

---

#### `get_metric_timeseries`

One metric over time.

| Param | Type | Required | Default |
|---|---|---|---|
| `child_id` | string | yes | |
| `metric_id` | string | yes | |
| `from` / `to` | string | yes | `YYYY-MM-DD` |
| `granularity` | enum | no | `day` — `day · week` |
| `include_annotations` | boolean | no | `true` |

**Returns** `data.points[]` = `{period, value, n}` plus `data.annotations[]`:

| Field | Type | Notes |
|---|---|---|
| `date` | string | |
| `kind` | enum | `layout_change · mode_created · card_added · absence · consent_change` |
| `detail` | string | |

**Annotations are why this tool exists.** A mis-tap spike on 2026-08-05 means one thing on its own and another entirely when a `layout_change` annotation sits on the same date. ~600 tokens for 28 days (measured).

---

#### `compare_windows`

Explicit A/B for "is this week worse than last?".

| Param | Type | Required |
|---|---|---|
| `child_id` | string | yes |
| `window_a` / `window_b` | object | yes — `{start, end}` |
| `metric_ids` | string[] | no |

Returns paired values with `n` for both arms, plus a `comparable` boolean per metric — **false** when a layout change, grid resize, or consent change falls between the windows. ~350 tokens.

---

### Tier 3 — Evidence

---

#### `get_card_stats`

| Param | Type | Required | Default | Range |
|---|---|---|---|---|
| `child_id` | string | yes | | |
| `window` | enum/object | no | `last_7d` | |
| `order_by` | enum | no | `taps_desc` | `taps_desc · taps_asc · mistaps_desc · zero_days_desc · repeat_runs_desc` |
| `limit` | integer | no | 25 | 1–100 |
| `filter` | enum | no | `all` | `all · core_only · fringe_only · essential_only · unused` |

**Returns** `data.cards[]`:

| Field | Type | Unit | Notes |
|---|---|---|---|
| `card_id`, `label` | string | | |
| `is_core` / `is_essential` | boolean | | `is_core` resolved against `core_word_list` |
| `default_function` | enum \| null | | one of the eight functions (§4) |
| `taps` | integer | count | child actor only |
| `mistaps` | integer | count | deletes within threshold |
| `adjacent_corrections` | integer | count | subset of `mistaps` |
| `repeat_runs` | integer | count | **runs of ≥3 consecutive taps with no delete. Not an error.** |
| `zero_days` | integer | days | consecutive days unused |
| `last_used_day` | string \| null | | null = never used |
| `scenes_used` | enum[] | | which of the six scenes |
| `nav_depth` | integer | count | current position depth |
| `canonical_position` | object \| null | | `{row, col}` on the robust board |
| `duplicate_positions` | object[] | | additional copies — **expected, per I3** |

~3,100 tokens for 25 cards (measured). Drop `limit` to 10 for ~1,300.

---

#### `get_cell_heat`

| Param | Type | Required | Default |
|---|---|---|---|
| `child_id` | string | yes | |
| `board_id` | string | no | the child's robust board |
| `window` | enum/object | no | `last_14d` |

**Returns** `data`: `{grid_rows, grid_cols, cells[]}` where each cell is `{row, col, card_id, label, masked, taps, mistaps, mistap_ratio, reachability_rank}`.

Plus `data.dead_zones[]` — contiguous regions with `taps = 0` and elevated surrounding `mistaps`, precomputed because the model reasons about spatial adjacency poorly from a flat list.

~1,700 tokens for a 4×4 grid (measured).

> **Never compare cells across different `grid_rows`/`grid_cols`.** The coordinates mean different things. If the grid was resized inside the window, the response splits into `segments[]` and sets `guidance: GRID_RESIZED_MID_WINDOW`.

---

#### `get_word_pairs`

| Param | Type | Required | Default | Range |
|---|---|---|---|---|
| `child_id` | string | yes | | |
| `window` | enum/object | no | `last_28d` | |
| `min_solo` | integer | no | 15 | 5–100 |
| `only_missing` | boolean | no | `true` | `true` ⇒ only pairs with `together = 0` |
| `limit` | integer | no | 20 | 1–50 |

**Returns** `data.pairs[]` = `{word_a, word_b, solo_a, solo_b, together, both_core, expected_together}`, where `weaker_solo` ranks the pairs: the highest is the most promising thing to model. ~1,100 tokens (measured).

---

#### `get_scene_breakdown`

| Param | Type | Required | Default |
|---|---|---|---|
| `child_id` | string | yes | |
| `by` | enum | no | `function` — `function · label · metric` |
| `window` | enum/object | no | `last_28d` |
| `labels` | string[] | no | restrict to specific cards |

**Returns** a scene × dimension matrix plus `data.scene_bound_items[]` — items appearing in exactly one scene, which is the I6 signal. ~350 tokens.

> `scene = 'unknown'` is common and is **not** a data error. Treat unknown-scene rows as unclassified, never as a distinct setting.

---

#### `get_utterances`

The most granular tool. **Labels only — utterance text is not in this database.**

| Param | Type | Required | Default | Range |
|---|---|---|---|---|
| `child_id` | string | yes | | |
| `window` | enum/object | no | `last_7d` | |
| `limit` | integer | no | 50 | 1–200 |
| `filter` | enum | no | `all` | `all · abandoned · used_suggestion · multi_symbol · by_function · by_scene` |
| `function` / `scene` | enum | no | | required by the matching filter |

**Returns** `data.utterances[]` = `{utterance_id, ts_local, scene, labels[], symbol_count, word_count, tap_count, delete_count, ms_compose, ms_to_first_tap, used_suggestion, spoken, abandon_reason, function, function_source}`.

**~28 tokens per row; 50 rows ≈ 1.4 k tokens.** Use only when aggregates are insufficient. Never request 200 rows for more than one child.

---

#### `get_partner_metrics`

The adult's numbers. Deliberately separate so they are never mistaken for the child's.

| Param | Type | Required | Default |
|---|---|---|---|
| `child_id` | string | yes | |
| `window` | enum/object | no | `last_14d` |

**Returns** `data`: `{partner_turns, median_wait_ms, p25_wait_ms, interruptions, interruption_rate, turns_with_no_child_response, median_child_latency_ms, modeling_taps, modeling_days, modeling_mode_active_days}`.

~900 tokens (measured).

> **`median_wait_ms` under 2000 is the headline.** AAC output runs around 15 words per minute. If the adult waited under two seconds, a high `time_to_first_tap` is the partner's doing, and any recommendation must be addressed to them.

---

#### `get_board_layout`

`get_board_layout(child_id, board_id?)` → `{kind, grid_rows, grid_cols, cells[], masked_count, mode_overlay?}`. For a mode, `mode_overlay` gives `{highlighted[], dimmed[], masked[], position_consistency}`.

---

#### `get_board_revisions`

`get_board_revisions(child_id, from, to)` → `revisions[]` = `{revision_id, changed_at, change_kind, card_id, label, from_position, to_position, actor_role, reason, suggested_by_insight, mistap_rate_before_7d, mistap_rate_after_7d, delta}`.

**The last three fields are the I8 evidence.** ~600 tokens (measured).

---

### Tier 4 — Insights and class view

---

#### `get_fired_rules`

Runs the `v_i1…v_i8` views and returns evidence — **not verdicts**.

| Param | Type | Required | Default |
|---|---|---|---|
| `child_id` | string | yes | |
| `insight_ids` | string[] | no | all eight |
| `window` | enum/object | no | `last_14d` |
| `include_below_threshold` | boolean | no | `false` |

**Returns** `data.candidates[]`:

| Field | Type | Notes |
|---|---|---|
| `insight_id` | string | `I1`–`I8` |
| `name`, `plain_statement` | string | from `insights_catalog` |
| `triggered` | boolean | whether the rule's thresholds were met |
| `evidence` | object[] | **the raw component values, one row per contributing item** |
| `thresholds_applied` | object | the numbers used — **exposed, not baked in, so you can disagree** |
| `classification` | object \| null | for I1 only: `{motor_share, semantic_share, ambiguous}` |
| `recommended_actions` | string[] | |
| `forbidden_actions` | string[] | **must not be recommended, whatever the evidence suggests** |
| `safety_note` | string \| null | read this before writing any recommendation |
| `target_audience` | enum | `child · adult · system` — who the action is for |
| `action_kind` | enum | `intervention · informational · system_fix` |
| `previously_dismissed` | object \| null | `{dismissed_at, reason}` if raised and rejected before |

~2,000 tokens when one rule fired, ~5,300 when four did (measured). Rules that did NOT fire are returned as a one-line stub, not with full metadata — carrying all eight in full cost 7,700 tokens for no benefit.

> **The thresholds are given to you rather than applied for you.** Where the evidence and the threshold disagree, say so — a rule that fires at 8.1% against a threshold of 8% deserves hedging, not a confident diagnosis.

---

#### `get_insight_history`

| Param | Type | Required | Default |
|---|---|---|---|
| `child_id` | string | yes | |
| `include_dismissed` | boolean | no | `true` |
| `limit` | integer | no | 30 |

Returns past firings with dismissal reasons. **Call this before raising an insight.** Re-raising something an adult already rejected as `not_accurate` erodes trust in the whole system. ~250 tokens.

(Also surfaced inline: every `get_fired_rules` candidate carries `previously_dismissed`.)

---

#### `write_insight`

Writes to `insights` and nothing else. Cannot touch child data, cards, boards, or events.

**Requires a `fired_rule_id`.** No model prose reaches a teacher without a deterministic SQL rule behind it — that is the whole point of splitting `fired_rules` from `insights`.

| Param | Type | Required | Notes |
|---|---|---|---|
| `fired_rule_id` | string | **yes** | from `get_fired_rules`. Rejected if unknown, dismissed, or superseded. |
| `narration` | string | yes | ≤ 500 chars, shown to the adult |
| `confidence` | number | yes | 0–1 |
| `actions_suggested` | string[] | no | each checked against the rule's `forbidden_actions` |
| `model` | string | yes | e.g. `gemma-3-4b` — recorded so a bad narration is traceable |

Returns `{insight_event_id}`. Rejects: an unknown `fired_rule_id`; any `actions_suggested` entry in that rule's `forbidden_actions`; any `narration` containing a forbidden term.

You cannot invent a finding. If no rule fired, there is nothing to narrate — say so and stop.

---

#### `propose_board_change`

Proposes a layout change for a human to approve. **Never applies one.**

| Param | Type | Required | Notes |
|---|---|---|---|
| `child_id` | string | yes | |
| `board_id` | string | yes | must be `kind = 'robust'` |
| `fired_rule_id` | string | no | links the proposal to its justification |
| `change_kind` | enum | yes | **`add · add_copy · mask · unmask` only** |
| `card_id` | string | yes | |
| `to_row` / `to_col` | integer | for `add`/`add_copy` | must be an empty or masked cell |
| `rationale` | string | yes | ≤ 300 chars |

`move`, `resize` and `remove` are **not accepted values** — the enum excludes them at the schema level. Relocating a learned button destroys the motor plan the child has built (constraints C2/C3). To surface a buried word, add a copy; to simplify a page, mask rather than remove.

Returns `{proposal_id, status: "pending"}`. A human approves in the dashboard, which then writes the `board_revisions` row so I8 can measure the effect.

---

#### `get_attention_queue`

Class-level triage — who needs a person today.

| Param | Type | Required | Default |
|---|---|---|---|
| `class_id` | string | yes | |
| `limit` | integer | no | 10 |

**Returns** `data.queue[]` = `{rank, child_id, display_name, score, reasons[]}` where each reason is `{code, detail, metric_id, value}`.

Scoring:

```
score = 3·(silence_streak >= 2 days)
      + 2·(abandonment_rate > 25%)
      + 2·(mistap_rate > 12%)
      + 1·(unreviewed vocabulary gaps >= 3)
      + 1·(open insight not yet dismissed)
```

~510 tokens for 10 children (measured).

---

### Escape hatch

#### `query`

For questions the eighteen tools do not cover.

| Param | Type | Required | Default |
|---|---|---|---|
| `sql` | string | yes | |
| `limit` | integer | no | 200 (max 500) |

**Guards, all enforced server-side:**

| Guard | Behaviour |
|---|---|
| `PRAGMA query_only = ON` | writes fail inside SQLite, not at a parser |
| Deny-`ATTACH` authorizer | **`query_only` does NOT block `ATTACH`** — verified. Without this, one `ATTACH` reaches `aac_text.db`. |
| `SELECT`/`WITH` only | anything else rejected before execution |
| `LIMIT` injected | if absent, appended |
| 2 s statement timeout | long scans abort |
| 32 KB response cap | truncates with `truncated: true` |
| OS user cannot read `aac_text.db` | the backstop if all of the above are bypassed |
| Every query logged | with the calling adult's id |

Errors return SQLite's message **verbatim** so you can self-correct. Expect 2–3 wasted calls on a novel question; that is cheaper than forty pre-built tools.

Read `schema://ddl` and `schema://dictionary` before writing SQL.

---

## 4. Enumerations

Closed sets. Any other value is a bug.

| Enum | Values |
|---|---|
| `scene` | `therapy · classroom · free_play · home · community · unknown` |
| `actor` | `child · adult` — adult means the grown-up was modelling |
| `function` | `request · protest · comment · direct · ask_question · give_opinion · share_news · start_conversation` |
| `source` | `board · suggestion · essential · recent · search · keyboard` |
| `resolved_by` | `icon_pack · card_library · hash_cache · semantic · generated · failed` |
| `change_kind` | `add · add_copy · remove · move · mask · unmask · resize · reorder` |
| `abandon_reason` | `cleared · timeout · navigated_away · session_end` |
| `polarity` | `higher_better · lower_better · neutral` |
| `metric group` | `A` effort · `B` errors · `C` vocabulary · `D` layout · `E` voice · `F` ai value · `G` partner · `H` communication style |
| `dismiss_reason` | `not_accurate · already_known · not_actionable · disagree_with_advice · other` |

> **Group `H` is not group `B`.** Repeated pressing lives in `H` (communication style) and is neutral. It is never an error, and must never be reported as one.

---

## 5. Resources

Static context, fetched once per session rather than repeated per tool.

| URI | Contents | ~tokens |
|---|---|---|
| `schema://ddl` | `db/schema.sql` verbatim, comments included | 3,200 |
| `schema://dictionary` | all 38 rows of `metrics_catalog` | 4,800 |
| `schema://insights` | all 8 rows of `insights_catalog` | 3,100 |
| `schema://interpretation-guide` | `docs/aac-clinical-constraints.md` | 3,600 |
| `schema://sample-questions` | 20 worked question→tool-sequence examples | 1,400 |

**Load `schema://interpretation-guide` before writing any recommendation.** It contains the eight clinical constraints — including the ones that make otherwise sensible advice harmful.

---

## 6. Computed guidance codes

The server emits these based on the actual result. This is the mechanism that keeps the model honest without relying on it remembering to check.

| Code | Level | Trigger | Why it matters |
|---|---|---|---|
| `SMALL_SAMPLE` | warning | `n < min_n` | value returned as null; do not read null as zero |
| `PARTIAL_WINDOW` | info | window includes today | today is incomplete |
| `LAYOUT_CHANGED_MID_WINDOW` | critical | a `move`/`resize`/`remove` revision inside the window | spatial and error metrics span two layouts |
| `GRID_RESIZED_MID_WINDOW` | critical | `resize` inside the window | cell coordinates are not comparable at all |
| `MODE_POSITION_DRIFT` | critical | `position_consistency < 1.0` | our own AI is teaching a conflicting motor plan |
| `MODELING_MODE_UNUSED` | warning | `teacher_modeling = 0` and `modeling_mode_active_days = 0` | a zero may mean "not recorded", not "did not happen" |
| `HIGH_REPETITION_NEUTRAL` | info | `repeat_tap_rate` elevated | repetition is normal; consider a vocabulary gap, never an error |
| `PARTNER_WAIT_SHORT` | warning | `median_wait_ms < 2000` | child-latency findings are confounded by the adult |
| `ABSENCE_IN_WINDOW` | info | ≥2 consecutive days with no session | rates are computed over active days only |
| `BASELINE_THIN` | warning | `total_days_active < 14` | "elevated vs baseline" is not yet meaningful |
| `CONSENT_LIMITED` | info | a tier is unavailable | some fields suppressed, not empty |
| `SCENE_MOSTLY_UNKNOWN` | warning | >40% of events have `scene='unknown'` | scene comparisons unreliable |
| `PREVIOUSLY_DISMISSED` | warning | this insight was rejected before | check the reason before re-raising |
| `GESTALT_FLAG` | info | `mlu < 1.3` and profile notes gestalt processing | low MLU may not be a deficit |

---

## 7. Worked example

> *"Why is Maya struggling this week?"*

**The MCP client drives this sequence, not the model.** A 4B model cannot reliably chain tool calls, so the client executes a fixed script and hands Gemma one narrow question at a time — "given this evidence block, is this motor or semantic?" rather than "investigate Maya." The `next_calls` field in the envelope is therefore an instruction to the *client*, not a suggestion to the model.

A larger model over stdio (Claude Desktop, development) may drive the sequence itself. The tools are identical either way; only who chooses the order changes.

Measured against the seeded database, not estimated:

| # | Call | tokens | What it actually yields |
|---|---|---|---|
| 1 | `get_child_profile("maya_t")` | 780 | 4×4 robust board · 4-week baselines · 42 modelling days |
| 2 | `get_metrics("maya_t", "last_7d")` | 5,051 | `mistap_rate` **0.141** (`worsened`, n=790) · `taps_per_utterance` 2.93 (+0.36) · `repeat_tap_rate` 0.245 (`not_applicable`) |
| | | | guidance: `HIGH_REPETITION_NEUTRAL` — repetition is elevated and is **not** an error |
| | | | `next_calls` → get_fired_rules, get_cell_heat, get_board_revisions |
| 3 | `get_fired_rules("maya_t")` | 5,258 | **I1** triggered → `motor_share` 0.918 · **I8** triggered · I3 · I4 |
| 4 | `get_cell_heat("maya_t")` | 1,724 | `reach_gradient`: rows 0→3 error share 0.088 / 0.103 / 0.144 / **0.183**, far row takes 53% as many taps |
| 5 | `get_board_revisions("maya_t")` | 596 | `move` on 2026-07-30, `suggested_by_insight: I3`, mis-tap **0.058 → 0.143** |
| 6 | `get_partner_metrics("maya_t")` | 898 | `median_wait_ms` 4535 — the adult *is* waiting; not a partner problem |
| 7 | `write_insight(...)` | ~50 | logs the conclusion against `fired_rule_id` |
| | **total** | **~14,400** | plus 1,149 for tool definitions |

Roughly 6× my original estimate. The dictionary and the rule metadata are most of it, and both earn their place — they are what stop the model inventing a threshold or misreading a null. Pass `include_dictionary: false` on repeat calls within a session to drop ~2,900.

The answer the model should reach, from the real numbers above: *Maya is not regressing. On 30 July two cards were swapped on our own I3 recommendation, and unintended presses rose from 5.8% to 14.3% in the following week. 92% of her corrections land on a neighbouring button, and the error rate climbs steadily down the board while row 3 takes half as many taps — that is reach, not comprehension. The adult is giving her 4.5 seconds, so this is not a partner problem. Revert the swap and add a duplicate instead. The original I3 recommendation was wrong to move anything.*

Reaching that answer requires: annotations on the timeseries, `suggested_by_insight` on the revision, `forbidden_actions` blocking a "move it back somewhere else" suggestion, and the `LAYOUT_CHANGED_MID_WINDOW` warning arriving unprompted at step 2. Remove any one of those and the model concludes the child got worse.

---

## 8. Errors

```jsonc
{
  "error": {
    "code": "WINDOW_TOO_LARGE",
    "message": "Requested window is 210 days; maximum is 120.",
    "retryable": true,
    "suggestion": "Split into two calls, or use granularity='week'."
  }
}
```

| Code | Retryable | Meaning |
|---|---|---|
| `CHILD_NOT_FOUND` | no | |
| `NOT_AUTHORISED` | no | this adult has no active roster row |
| `CONSENT_REQUIRED` | no | the tier is not granted; **do not work around this** |
| `WINDOW_TOO_LARGE` | yes | > 120 days |
| `LIMIT_EXCEEDED` | yes | above the tool's cap |
| `SQL_REJECTED` | yes | non-SELECT, or a parse failure — message included verbatim |
| `SQL_TIMEOUT` | yes | > 2 s |
| `NO_DATA_IN_WINDOW` | yes | valid request, empty result — **not an error condition to work around** |

---

## 9. What this server will not do

Stated so the model does not waste calls attempting them.

- **Return utterance text.** Not a permission setting — the file is never opened.
- **Return raw events.** Aggregate or use `get_utterances`.
- **Compare children to each other.** No cohort tool exists; `peer_baseline` was cut as statistically meaningless at this scale. Compare a child to their own past.
- **Write anything except `insight_events`.** No card creation, no layout changes, no dismissals. A human performs those in the dashboard.
- **Recommend a `forbidden_action`.** `write_insight` rejects reasoning text containing one.

---

## 10. Read-only is harder than it looks

Two findings from actually building this, both of which invalidate the obvious implementation.

### `mode=ro` cannot open a WAL database

```python
sqlite3.connect("file:aac.db?mode=ro", uri=True)
# -> OperationalError: unable to open database file
```

Not a permissions problem. A WAL reader must create or map the `-shm` shared-memory file, which a read-only handle cannot do. Since WAL is mandatory (the API server writes while the MCP server reads), `mode=ro` is not available to us.

**What to use instead:**

```python
conn = sqlite3.connect("aac.db")          # normal handle
conn.execute("PRAGMA query_only = ON")    # writes now fail inside SQLite
conn.set_authorizer(deny_attach)          # see below
```

`better-sqlite3` equivalent: `new Database(path)` then `db.pragma('query_only = ON')`. Do **not** pass `{ readonly: true }` — same WAL failure.

### `query_only` does not block `ATTACH`

Verified against SQLite 3.50.6:

| Statement | `query_only = ON` |
|---|---|
| `INSERT` | blocked — *attempt to write a readonly database* |
| `DELETE` | blocked |
| `DROP TABLE` | blocked |
| `ATTACH DATABASE '…' AS other` | **allowed** |

So a single `ATTACH '/data/aac_text.db' AS t; SELECT * FROM t.utterance_text` through the `query` escape hatch would read every utterance a child has ever produced. `query_only` alone does not close it.

### The three layers, in order of reliability

| # | Layer | Blocks | Fails if |
|---|---|---|---|
| 1 | SQL parse guard: `SELECT`/`WITH` only | `ATTACH` textually | a parser bypass — comments, nested CTEs, unusual whitespace |
| 2 | Deny-`ATTACH` authorizer (`SQLITE_ATTACH` → `SQLITE_DENY`) | `ATTACH` at the VDBE, whatever the SQL looked like | the authorizer is not installed on that connection |
| 3 | **OS permissions: the MCP process user cannot read `aac_text.db`** | everything, including a full compromise of layers 1 and 2 | someone runs the MCP server as root |

**Layer 3 is the one that makes the claim true.** Run the MCP server as a dedicated unprivileged user with no read bit on `aac_text.db`. Then "utterance text is unreachable" is a statement about the filesystem rather than about our code, and it survives a bug in the other two layers.

Deployment check, and it belongs in CI:

```bash
sudo -u mcp-reader sqlite3 /data/aac.db \
  "ATTACH DATABASE '/data/aac_text.db' AS t; SELECT count(*) FROM t.utterance_text;"
# must fail: unable to open database: /data/aac_text.db
```
