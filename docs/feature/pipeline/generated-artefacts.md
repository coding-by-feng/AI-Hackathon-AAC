# Generated Artefacts — Metric Index and MCP Fixtures

## Function
Two generators that replace hand-maintained files with regenerated ones: `tools/gen_metric_index.py` rewrites the metric index inside `docs/analytics-metrics.md` from `metrics_catalog`, and `tools/gen_fixtures.py` drives the real MCP server over stdio and records its responses to `mcp/fixtures/<child>-<window>.json`.

## Purpose
Both exist for the same reason — a hand-written artefact drifts from the thing it describes, silently.

`gen_metric_index.py`: *"The index used to be hand-maintained and drifted from the catalogue twice. Now it is generated, so the database is the only place a metric is defined."*

`gen_fixtures.py`: *"Drives the actual server over stdio and records what comes back, so the fixture can never drift from the implementation the way a hand-written example does."* Its two named audiences: *"whoever builds the dashboard, who needs response shapes to code against before the backend is deployed"* and *"whoever writes the MCP client for the analysis model, who needs to see the envelope fields that carry the interpretation rules."*

Both are run by the trailing `docs + fixtures` stage of [`tools/build.sh`](build-pipeline.md).

## Source Files
| File | Role |
|------|------|
| `tools/gen_metric_index.py` | Reads `metrics_catalog`, renders the markdown index, rewrites the marked block in `docs/analytics-metrics.md` |
| `tools/gen_fixtures.py` | Spawns `node mcp/server.ts` over stdio, issues 14 `tools/call` requests, writes the annotated fixture JSON |

## Implementation

### `gen_metric_index.py`

```bash
python3 tools/gen_metric_index.py [--db aac.db]
```

`--db` defaults to the string `"aac.db"` (relative to cwd, unlike the other tools which resolve against the repo root). A missing file prints `error: database not found: <path>` to stderr and returns `1`.

**Read-only access, the same way the MCP server does it.** From the inline comment: *"NOT `mode=ro`: SQLite cannot open a WAL database read-only, because it needs to create the `-shm` file. Use `query_only` + a deny-ATTACH authorizer, which is also what the MCP server must do. See `docs/mcp-api.md` §10."*

```python
conn.execute("PRAGMA query_only = ON")
conn.set_authorizer(_deny_attach)   # SQLITE_ATTACH / SQLITE_DETACH -> SQLITE_DENY
```

`_deny_attach`'s docstring states the threat: *"`query_only` alone does not block them, which would let a caller reach `aac_text.db` and read utterance text."*

**Target and markers.** `DOC = <repo root>/docs/analytics-metrics.md`; the block between `<!-- METRIC-INDEX:START -->` and `<!-- METRIC-INDEX:END -->` is replaced by `head + block + tail` via two `str.partition` calls. If either marker is missing, it prints an error telling the caller to add them and returns `1`. Idempotent.

**Rendering constants.**

| Name | Value |
|---|---|
| `GROUP_NAMES` | `A` Effort & speed · `B` Errors & motor · `C` Volume & vocabulary · `D` Layout & context · `E` Whose voice · `F` AI value · `G` Communication partner · `H` Communication style |
| `STARRED` | `taps_per_utterance`, `taps_saved`, `vocabulary_gaps`, `silence_streak`, `mistap_rate`, `independence_rate` |
| `AUDIENCE_SHORT` | `teacher→T`, `parent→P`, `slt→S`; `short_audience()` returns `ALL` when all three are present |
| `polarity_glyph` | `higher_better→↑`, `lower_better→↓`, `neutral→=` |

`STARRED` is deliberately not in the database: *"The six that carry the product story. Kept here rather than in the DB because it is an editorial choice about the pitch, not a property of the metric."*

**Structure produced.** Rows are read `ORDER BY group_code, rowid` and split by `status` into `shown` / `logged` / `cut`. Reference codes (`A1`, `A2`, `B1`, …) are assigned by position within group, **shown metrics only**. Sections, in order:

1. A summary line: *"The whole measurement surface in one table — **N metrics: X shown, Y logged only, Z cut**."*
2. A legend explaining `Tier`, `Who`, `Feeds`, `Pol` (*"**=** neutral, and a neutral metric must never be styled as good or bad"*) and `★`.
3. `### Shown on the dashboard — N`, one table per group with header `| Ref | Metric · \`id\` | What it tells you | Pol | Tier · Who | min n | Feeds |`. `Feeds` is `json.loads(feeds_insights)` joined by spaces, or `—`.
4. `### Logged but not charted — N` — `| Metric · \`id\` | What it tells you | Why no chart |` from `cut_reason`.
5. `### Cut — N` — *"Recorded so the decision is not re-litigated every week."*
6. `### The six that carry the story`, with a hardcoded one-line justification per starred metric (e.g. `taps_per_utterance` → *"the whole product claim, in one number"*, `independence_rate` → *"proves the AI assists rather than replaces"*).

`plain_explanation` is truncated at **110** characters in the shown tables, **100** in logged, **90** in cut; `truncate()` cuts on the last whole word and appends `…`. `esc()` escapes `|`, flattens newlines, and renders an empty value as `—`.

Success prints `regenerated metric index in <path>` and returns `0`.

### `gen_fixtures.py`

```bash
python3 tools/gen_fixtures.py --db aac.db --child sofia_r --window last_14d
```

| Flag | Default |
|---|---|
| `--db` | `<repo root>/aac.db` |
| `--child` | `sofia_r` |
| `--window` | `last_14d` |
| `--class-id` | `class_y3` |
| `--adult` | `adult_patel` |
| `--out` | `<repo root>/mcp/fixtures/<child>-<window>.json` |

**The 14 calls**, in `build_calls()` order:

| # | Tool | Arguments |
|---|---|---|
| 1 | `list_children` | `adult_id` |
| 2 | `get_child_profile` | `child_id` |
| 3 | `get_metrics` | `child_id`, `window` |
| 4 | `get_metric_timeseries` | `child_id`, `metric_id: "mistap_rate"` |
| 5 | `get_card_stats` | `child_id`, `limit: 12`, `order_by: "taps_desc"` |
| 6 | `get_cell_heat` | `child_id` |
| 7 | `get_word_pairs` | `child_id`, `limit: 8` |
| 8 | `get_scene_breakdown` | `child_id`, `by: "function"` |
| 9 | `get_utterances` | `child_id`, `limit: 5` |
| 10 | `get_partner_metrics` | `child_id` |
| 11 | `get_board_revisions` | `child_id` |
| 12 | `get_fired_rules` | `child_id` |
| 13 | `get_attention_queue` | `class_id` |
| 14 | `query` | raw SQL: `SELECT scene, COUNT(*) AS utterances FROM utterances WHERE child_id = '<child>' AND spoken = 1 GROUP BY scene ORDER BY utterances DESC` |

**Transport.** One JSON-RPC 2.0 line per call (`{"jsonrpc":"2.0","id":i,"method":"tools/call","params":{"name":…,"arguments":…}}`), all piped to `subprocess.run(["node", "<root>/mcp/server.ts", "--db", db], input=…, capture_output=True, text=True)`. A non-zero return code prints the server's stderr and raises `SystemExit(f"server exited {code}")`. Only stdout lines whose stripped form starts with `{` are parsed, so log noise is tolerated.

**Response unwrapping.** Each response's `result.content[0].text` is `json.loads`ed into the envelope body. An error response is stored as `{"request": …, "error": …}` instead. Requests and responses are zipped by position, so a dropped line would misalign the capture.

**Fixture shape.** The written document is `{"_about": {...}, "tools": {<tool_name>: {"request":…, "response":…}}}`, JSON `indent=2`, `ensure_ascii=False`, trailing newline. `_about` carries, as data:

- `description` — *"Real MCP responses captured from the seeded database. Not hand-written — regenerate with `tools/gen_fixtures.py` so this can never drift from the server."*
- `child_id`, `window`, `generated_from` (the database filename)
- `envelope` — one line per envelope key: `data`, `meta` (*"window, row_count, truncated, data_freshness"*), `dictionary` (*"one `metrics_catalog` entry per metric present — unit, polarity, min_n, caveat"*), `guidance` (*"warnings computed for THIS result. Read before the numbers."*), `forbidden_actions` (*"recommendations that must never be made, whatever the evidence suggests"*), `next_calls` (*"what the MCP CLIENT should fetch next. Not a hint to the model."*)
- `null_semantics` — `"value null + n > 0"` → *"measured, but below min_n. NOT zero."*; `"value null + n = 0"` → *"never observed. The feature is not in use for this child."*; `"direction not_applicable"` → *"the metric's polarity is neutral — it is neither good nor bad."*
- `read_first` — `docs/aac-clinical-constraints.md` and `docs/mcp-api.md`

**Console report.** `wrote <path>  (<KB>, <n> tools)` then one line per tool with an approximate token count (`len(json.dumps(body)) // 4`) and flags counting `guidance`, `forbidden_actions` and `next_calls` entries. Errored tools print `ERROR <first 50 chars of message>`.

Checked-in fixtures: `mcp/fixtures/maya_t-last_14d.json` and `mcp/fixtures/sofia_r-last_14d.json`, regenerated by `tools/build.sh`.

## Dependencies & Connections

### Depends On
- [MCP stdio Server](../mcp/stdio-server.md) — `gen_fixtures.py` runs `node mcp/server.ts` as a subprocess; the fixture is literally that server's output
- [Analytics Schema and Indices](../database/schema.md) — `metrics_catalog` is the only definition of a metric
- [L2 Rollup](l2-rollup.md) and [Nightly Rule Materialisation](rule-materialisation.md) — the data the fixtures capture
- [Deterministic Build Pipeline](build-pipeline.md) — the `docs + fixtures` stage runs both

### Depended On By
- `docs/analytics-metrics.md` — its metric index block is machine-owned and must not be hand-edited
- [CSV Export](csv-export.md) — `--fixture` reads the JSON these produce
- Dashboard and MCP-client development — the fixtures are the reference response shapes
- [Data Dictionary](../analytics/data-dictionary.md) and [Metric Readers](../analytics/metric-readers.md) — same catalogue metadata, surfaced in-app

### Shared Resources
- `docs/analytics-metrics.md` between the `METRIC-INDEX` markers
- `mcp/fixtures/*.json`
- `aac.db` (read-only, `query_only` + deny-ATTACH)
- Node ≥ 24 on `PATH` (the server relies on built-in `node:sqlite` and type stripping)

## Change Risks
- **Hand-editing the metric index block loses the edit** on the next build; the summary line tells readers *"edit the database, not this table."*
- **Removing or renaming the `METRIC-INDEX` markers** makes the generator exit `1`, which under `set -e` fails `tools/build.sh` at the docs stage — after the database is already built and verified.
- **Adding a metric group beyond `A–H`** renders the bare group letter as its heading (`GROUP_NAMES.get(g, g)`), silently. A new `polarity` value, by contrast, raises `KeyError` on `polarity_glyph[...]` and aborts the run.
- **Editing `STARRED` or the `why` dictionary** changes the pitch section only; the six ids must still exist in `metrics_catalog` or their rows are skipped (`if mid in by_id`).
- **Changing an MCP tool name, argument or response shape** changes the fixtures on the next build. Anything coded against a fixture field — dashboard scaffolding, `export_csv.py`'s `TABULAR` payload keys — breaks at that point rather than at the server.
- **Dropping the deny-ATTACH authorizer** re-opens the hole `docs/mcp-api.md` §10 documents: `query_only` does not block `ATTACH`, so one `ATTACH` reaches `aac_text.db` and every utterance a child ever produced.
- **A server that writes non-JSON to stdout** is tolerated by the `startswith("{")` filter, but a server that *drops* a response silently misaligns the positional `zip(calls, responses)` and mislabels every subsequent capture.
- **The `query` fixture call interpolates `child_id` directly into SQL.** It is a generator run against a local seeded database with a fixed default, but the pattern must not be copied into anything that takes untrusted input.
