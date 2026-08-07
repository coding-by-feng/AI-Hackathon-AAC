# Captured Response Fixtures

## Function
Two committed JSON files holding real MCP responses for `maya_t` and `sofia_r` over a `last_14d` window — 14 tool calls each, request and response verbatim — captured by driving the actual stdio server rather than hand-written.

## Purpose
The `_about.description` field states it directly:

> Real MCP responses captured from the seeded database. Not hand-written — regenerate with `tools/gen_fixtures.py` so this can never drift from the server.

`tools/gen_fixtures.py` names two audiences: whoever builds the dashboard, who needs response shapes to code against before the backend is deployed; and whoever writes the MCP client for the analysis model, who needs to see the envelope fields that carry the interpretation rules. The two children are chosen to contrast — Maya has a mid-window layout change and four fired rules, Sofia has neither.

The `_about` block is itself the teaching material: it restates the envelope, the null semantics, and the two documents that must be read first. A client author who only ever opens one of these files still learns that a null value with `n > 0` is not zero.

## Source Files
| File | Role |
|------|------|
| `mcp/fixtures/maya_t-last_14d.json` | 122,646 bytes — `maya_t`, the child with a `move` revision inside the window and a `LAYOUT_CHANGED_MID_WINDOW` critical guidance |
| `mcp/fixtures/sofia_r-last_14d.json` | 104,373 bytes — `sofia_r`, the contrast case: no board revisions, no layout guidance |

## Implementation

### Regenerating

```bash
python3 tools/gen_fixtures.py --db aac.db --child sofia_r --window last_14d
```

`gen_fixtures.py` spawns `node mcp/server.ts --db <db>` as a subprocess, writes one `tools/call` JSON-RPC line per call to stdin with `id` equal to the call's array index, and matches responses back by position. A non-zero exit prints the server's stderr and aborts.

Filename convention: `<child_id>-<window>.json`.

### File shape

```jsonc
{
  "_about": {
    "description": "Real MCP responses captured from the seeded database. …",
    "child_id": "maya_t",
    "window": "last_14d",
    "generated_from": "aac.db",
    "envelope": {
      "data":  "tool-specific payload",
      "meta":  "window, row_count, truncated, data_freshness",
      "dictionary": "one metrics_catalog entry per metric present — unit, polarity, min_n, caveat",
      "guidance": "warnings computed for THIS result. Read before the numbers.",
      "forbidden_actions": "recommendations that must never be made, whatever the evidence suggests",
      "next_calls": "what the MCP CLIENT should fetch next. Not a hint to the model."
    },
    "null_semantics": {
      "value null + n > 0": "measured, but below min_n. NOT zero.",
      "value null + n = 0": "never observed. The feature is not in use for this child.",
      "direction not_applicable": "the metric's polarity is neutral — it is neither good nor bad."
    },
    "read_first": [
      "docs/aac-clinical-constraints.md — the eight clinical constraints",
      "docs/mcp-api.md — the full contract"
    ]
  },
  "tools": {
    "<tool_name>": { "request": { … }, "response": { … } }
  }
}
```

### Captured calls

Fourteen, in this order, with `adult_id = "adult_patel"` and `class_id = "class_y3"`:

| # | Tool | Request arguments |
|---|---|---|
| 1 | `list_children` | `{ adult_id }` |
| 2 | `get_child_profile` | `{ child_id }` |
| 3 | `get_metrics` | `{ child_id, window: "last_14d" }` |
| 4 | `get_metric_timeseries` | `{ child_id, metric_id: "mistap_rate" }` |
| 5 | `get_card_stats` | `{ child_id, limit: 12, order_by: "taps_desc" }` |
| 6 | `get_cell_heat` | `{ child_id }` |
| 7 | `get_word_pairs` | `{ child_id, limit: 8 }` |
| 8 | `get_scene_breakdown` | `{ child_id, by: "function" }` |
| 9 | `get_utterances` | `{ child_id, limit: 5 }` |
| 10 | `get_partner_metrics` | `{ child_id }` |
| 11 | `get_board_revisions` | `{ child_id }` |
| 12 | `get_fired_rules` | `{ child_id }` |
| 13 | `get_attention_queue` | `{ class_id: "class_y3" }` |
| 14 | `query` | `SELECT scene, COUNT(*) AS utterances FROM utterances WHERE child_id = '<child>' AND spoken = 1 GROUP BY scene ORDER BY utterances DESC` |

Six of the twenty tools are **not** captured: `get_report_set`, `get_insight_history`, `compare_windows`, `get_board_layout`, `write_insight`, `propose_board_change`. The two write tools cannot be captured because `gen_fixtures.py` launches the server without `--allow-writes`.

### What the captured data actually shows

Both files were generated against a database whose newest `day_local` is **2026-08-07**, so every window ends there and `data_freshness.is_partial_day` is `true`.

**`maya_t`** — `get_metrics` returns guidance codes in this order: `SMALL_SAMPLE` (1 metric, `partner_wait_time`), `NOT_COLLECTED` (11 metrics: `cell_heat`, `card_frequency`, `word_pairs`, `zero_activation_days`, `nav_depth_by_card`, `scene_distribution`, `pragmatic_function_mix`, `suggestion_acceptance`, `visual_source_split`, `vocabulary_gaps`, `keyboard_use`), `PARTIAL_WINDOW`, `LAYOUT_CHANGED_MID_WINDOW` (critical — *"1 disruptive layout change(s) inside this window (move on 2026-07-30)"*), `HIGH_REPETITION_NEUTRAL`. Three `next_calls` are attached: `get_fired_rules({ insight_ids: ["I1","I8"] })`, `get_cell_heat`, `get_board_revisions`.

`get_board_revisions` returns one row: `rev_42c28992219c`, `changed_on: "2026-07-30"`, `change_kind: "move"`, `card_id: "water"`, `suggested_by_insight: "I3"`, reason *"Moved 'water' into easier reach and swapped 'more' down"*, `mistap_rate_before_7d: 0.0648`, `mistap_rate_after_7d: 0.1393`, `delta: 0.0745`, `triggered: 1`. This is the I8 evidence — the system measuring the harm caused by its own I3 recommendation.

`get_fired_rules` → `triggered_count: 4` (`I1`, `I3`, `I4`, `I8`), with `I2`, `I5`, `I6`, `I7` returned as one-line stubs. The envelope's `forbidden_actions` is the union of all four rules': `resize_grid`, `move_card`, `reduce_repetition`, `retrain_without_access_check`, `remove_original`, `retrain_preference`, `reintroduce_refused_item`, `treat_refusal_as_deficit`, `blame_the_child`, `frame_as_regression`, `recommend_further_layout_change`.

`get_cell_heat` returns 15 cells, `board_mean_error_share: 0.12`, `dead_zones: []`, one `problem_rows` entry (`row 2`, `kind: "error_prone"`, `taps: 583`, `mistaps: 124`, `error_share: 0.175`, *"unintended presses here are 1.5x the board average"*), and **`reach_gradient: null`**.

> The `reach_gradient` null is worth flagging. Both the comment in `mcp/tools.ts` and the worked example in `docs/mcp-api.md` §7 describe Maya's rows as `0.088 / 0.103 / 0.144 / 0.183` with a detected gradient. The committed fixture's rows are `0.075 / 0.089 / 0.175 / 0.159` — row 3 is *lower* than row 2, so the monotonicity test fails and no gradient is reported. The seed data has moved; the prose has not.

`get_partner_metrics` → `partner_turns: 410`, `median_wait_ms: 4508`, `interruptions: 6`, `interruption_rate: 0.015`, `turns_with_no_child_response: 87`, `modeling_taps: 101`, `modeling_days: 14`. The adult *is* waiting, so a "the child is slow" reading is ruled out (C7).

**`sofia_r`** — `get_metrics` guidance is only `SMALL_SAMPLE`, `NOT_COLLECTED`, `PARTIAL_WINDOW`: no layout change, no elevated repetition, and no `next_calls`. `get_board_revisions` returns zero rows. `get_fired_rules` fires `I4`, `I6`, `I7`. `get_partner_metrics` → `partner_turns: 254`, `median_wait_ms: 4285`, `modeling_taps: 6`, `modeling_days: 6`.

**`get_attention_queue`** is class-scoped and therefore identical in both files: `Jonah K.` score 4 (`SILENCE`, `OPEN_INSIGHT`), `Maya T.` score 3 (`MISTAPS`, `OPEN_INSIGHT`), `Liam W.` score 1 (`OPEN_INSIGHT`), `Sofia R.` score 1 (`OPEN_INSIGHT`).

**`query`** shows the LIMIT injection: the request has no `LIMIT`, and `data.sql_executed` comes back with `LIMIT 201` appended (`limit` default 200, `+1` for truncation detection). `meta.window` is `2026-07-11 → 2026-08-07`, 28 days, and `meta.child_id` is `null` because `query` passes no child to `base()`.

### Envelope fields observed per tool

`get_metrics` responses carry `data`, `meta`, `dictionary`, `guidance`, `next_calls`. `get_fired_rules` carries `data`, `meta`, `dictionary`, `guidance`, `forbidden_actions`. `meta` keys are exactly `child_id`, `window`, `row_count`, `truncated`, `data_freshness` — confirming that the `generated_at` field in `docs/mcp-api.md` §2 is not emitted.

## Dependencies & Connections

### Depends On
- [MCP stdio server](stdio-server.md) — `gen_fixtures.py` drives it over stdio; the fixture is whatever that server returned.
- [Tool surface](tool-surface.md) — the response shapes, guidance codes and `forbidden_actions` here are produced by `mcp/tools.ts`. Any change there invalidates these files.
- The seeded `aac.db` built by `./tools/build.sh aac.db`, including a `tools/run_rules.py` pass — without it `get_fired_rules` and `get_attention_queue` return nothing.

### Depended On By
- Dashboard authors coding against response shapes before the backend is deployed — see [dashboard data reads](../analytics/metric-readers.md).
- Whoever writes the MCP client for the Gemma analysis device, who needs the envelope fields that carry the interpretation rules.
- `docs/mcp-api.md` §7's worked example, whose numbers are supposed to match these files.

### Shared Resources
- `aac.db` — the seeded database both fixtures were generated from (`_about.generated_from`).
- `docs/aac-clinical-constraints.md` and `docs/mcp-api.md` — named in `_about.read_first` as prerequisites.

## Change Risks
- **These files are generated, not authored.** Hand-editing a value makes the fixture a lie about what the server returns, which is precisely what generating them was meant to prevent. Regenerate instead.
- **Any change to `mcp/tools.ts` silently stales both files.** There is no CI check comparing them to a live run, so drift is invisible until someone diffs by hand — the `reach_gradient` divergence above is a live example.
- **Reseeding `aac.db`** changes every number here, including the ones quoted in `docs/mcp-api.md` §7 and in the `mcp/tools.ts` comments about Maya's rows. Those three places have to move together.
- **Adding a tool** does not add it to the fixtures; `build_calls()` in `tools/gen_fixtures.py` is a hardcoded list of 14 calls that must be edited alongside.
- **Changing a guidance code name or level** breaks any dashboard or client code written against these captured strings.
- **These fixtures contain child display names, profile notes and per-child metric values from the seeded demo database.** They are committed to the repo; if the seed is ever replaced with real data, regenerating would commit real children's analytics.
