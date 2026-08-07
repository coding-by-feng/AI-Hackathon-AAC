# CSV Export and Column Dictionaries

## Function
`tools/export_csv.py` writes the analytics data to a folder of CSVs — from the database by default, or from an MCP fixture with `--fixture` — and `tools/csv_docs.py` ships two dictionary files alongside them and fails the export if any exported column is undocumented.

## Purpose
From `export_csv.py`'s header, the two failure modes this feature exists to prevent:

> **1.** *A null metric means "measured, but below `min_n`" — NOT zero. An empty cell is summed as zero by Excel and averaged as skipped by Sheets, and the two disagree. Every metric export therefore carries an explicit `status` column (`ok` / `below_min_n` / `not_collected`) and writes nothing in `value` when suppressed, so a reader has to look at `status` to get a number.*
>
> **2.** *Polarity. Outside the API nobody knows that a rising `repeat_tap_rate` is neutral, and someone will colour it red. Every export carries `polarity`, and `metric_catalog.csv` ships alongside so the caveats travel with the data.*

Point 2 is constraint **C1** leaving the system: `metrics_catalog.polarity` exists *"specifically so the UI cannot colour a neutral signal as a warning"*, and a CSV has no UI to enforce that — so the polarity column and the caveat text travel in the file.

From `csv_docs.py`: *"Why as CSV rather than a README: the person who opens `card_stats.csv` in Excel next month will not read a markdown file in a repo they may not have. The explanation has to travel in the same folder, in the same format."*

And on why the database is the default source: *"The MCP fixtures are nested envelopes holding fourteen differently-shaped payloads; flattening them loses rows the tools truncated with a `limit`. Use `--fixture` only when you specifically want the snapshot a model was given."*

## Source Files
| File | Role |
|------|------|
| `tools/export_csv.py` | Queries, wide pivot, fixture flattening, CLI, encoding choice, exit code |
| `tools/csv_docs.py` | `COLUMN_DOCS`, `RESPONSE_FIELDS`, `write_dictionaries()`, `check_coverage()` |

## Implementation

### CLI

```bash
python3 tools/export_csv.py --db aac.db --out exports/
python3 tools/export_csv.py --fixture mcp/fixtures/maya_t-last_14d.json --out exports/
python3 tools/export_csv.py --db aac.db --child maya_t --excel
```

| Flag | Default | Behaviour |
|---|---|---|
| `--db` | `<repo root>/aac.db` | database source; errors with *"Run ./tools/build.sh first."* if absent |
| `--fixture` | — | export from an MCP fixture instead of the database |
| `--child` | — | limit the database export to one child |
| `--out` | `<repo root>/exports` | created with `mkdir(parents=True, exist_ok=True)` |
| `--excel` | off | switch encoding to `utf-8-sig` |

`BOM = "utf-8-sig"`, with the reason recorded inline: *"Excel on Windows and on Chinese-locale macOS reads a BOM-less UTF-8 CSV as the system codepage and mangles every non-ASCII character. The BOM costs 3 bytes."*

The database connection sets `PRAGMA query_only = ON`.

### Database exports — 10 files

| File | Source | Notable filter / shape |
|---|---|---|
| `metrics_daily_long.csv` | `agg_daily_metric` ⋈ `metrics_catalog` ⋈ `children` | one row per child/day/metric — *"the analysable shape"*; carries `unit, polarity, tier, value, n, min_n, status` |
| `metrics_daily_wide.csv` | pivot of the above | columns `child_id, display_name, day_local`, then `<metric_id>` and `<metric_id>__status` for every `status='shown'` metric |
| `metric_catalog.csv` | `metrics_catalog` | `metric_id, name, group_code, plain_explanation, formula, unit, polarity, tier, audience, min_n, status, cut_reason, caveat` |
| `insight_catalog.csv` | `insights_catalog` | includes `recommended_actions`, `forbidden_actions`, `safety_note` |
| `fired_rules.csv` | `fired_rules` ⋈ `insights_catalog` ⋈ `children` | `WHERE f.superseded_by IS NULL`; `fired_at_utc = datetime(fired_at/1000,'unixepoch')`; `evidence_rows = json_array_length(evidence)`; `state = open/dismissed` |
| `card_stats.csv` | `agg_card_stats` ⋈ `cards` ⋈ `children`, LEFT JOIN `child_vocabulary` for `nav_depth` | ordered by `taps DESC` |
| `cell_heat.csv` | `agg_cell_heat` LEFT JOIN `board_cells` → `cards.label` | adds `error_share = ROUND(mistaps / NULLIF(taps+mistaps,0), 4)` |
| `word_pairs.csv` | `agg_word_pairs` | `WHERE together = 0 AND solo_a >= 10 AND solo_b >= 10`, ordered by `weaker_solo = MIN(solo_a, solo_b)` DESC |
| `utterances.csv` | `utterances` ⋈ `children` | `WHERE u.actor = 'child'`; carries `labels` (card labels only — utterance text is a separate consent tier and is **not** exported) |
| `children.csv` | `children` LEFT JOIN `classes` | adds `active_days` (distinct `day_local` in `events`) and `vocabulary_size` (rows in `child_vocabulary`) |

### The `status` column

```sql
CASE
  WHEN a.value IS NOT NULL THEN 'ok'
  WHEN a.n = 0             THEN 'not_collected'
  ELSE                          'below_min_n'
END AS status
```

In the wide pivot, a non-`ok` row writes `""` into the value column and puts the reason in the sibling `<metric_id>__status` column. Inline comment: *"Writing 0 here would be a lie a spreadsheet cannot detect."*

### Fixture exports

`TABULAR` maps an MCP tool to `(payload key, output filename)`:

| Tool | Payload key | File |
|---|---|---|
| `get_metrics` | `metrics` | `fixture_metrics.csv` |
| `get_card_stats` | `cards` | `fixture_card_stats.csv` |
| `get_cell_heat` | `cells` | `fixture_cell_heat.csv` |
| `get_word_pairs` | `pairs` | `fixture_word_pairs.csv` |
| `get_utterances` | `utterances` | `fixture_utterances.csv` |
| `list_children` | `children` | `fixture_children.csv` |
| `get_attention_queue` | `queue` | `fixture_attention_queue.csv` |

`child_id` is prepended from `doc["_about"]["child_id"]`; nested `dict`/`list` values are re-serialised with `json.dumps(..., ensure_ascii=False)`. Every tool's `response.guidance[]` is flattened into `fixture_guidance.csv` (`tool, level, code, detail, affects`) — *"Guidance is not tabular but it is the part a reader most needs, so it gets its own file rather than being dropped on the floor."*

### Dictionaries — `csv_docs.py`

`write_dictionaries(out, encoding)` always runs, for both source modes, and emits:

- **`_column_dictionary.csv`** — columns `file, column, type, unit, meaning, gotcha`. Built from `COLUMN_DOCS`, a `dict[filename, dict[column, (type, unit, meaning, gotcha)]]` covering **17 files and 136 column entries**. A `SHARED` block (`child_id`, `display_name`, `day_local`, `label`, `taps`, `mistaps`) is spread into most file entries.
- **`_mcp_response_fields.csv`** — columns `path, type, meaning, why_it_matters`, from `RESPONSE_FIELDS` (**25 entries**) documenting the MCP envelope: `data`, `meta.*`, `dictionary.<metric_id>`, `guidance[]` and its four sub-fields, `forbidden_actions[]`, `next_calls[]`, `data.metrics[].*` and `data.candidates[].*`.

The gotchas carry the clinical constraints out with the data. A representative set:

- `mistaps` — *"REQUIRES a delete. Repeated pressing with no delete is never counted here; see `repeat_runs`."* (C1)
- `repeat_runs` — *"NOT AN ERROR. Exploration, motor learning, gestalt processing or stimming. If it clusters where vocabulary is thin, it signals a MISSING WORD. Never present this as a problem to fix."* (C1)
- `group_code` — *"Group H is NOT errors. Repetition lives there and is neutral."*
- `is_core` — *"An unused core word is a teaching target, never a candidate for deletion."* (C5)
- `grid_rows` — *"Part of the key. NEVER compare cells across different grid sizes."* (C2)
- `ms_to_first_tap` — *"A long pause may be the ADULT not waiting. Check partner metrics before reading it as the child being slow."* (C7)
- `action_kind` — *"`informational` needs no action — I4 case B records a preference, and acting on it would override a refusal."*
- `forbidden_actions` — *"Not stylistic. Each entry is an action AAC practice says causes harm — resizing a grid, relocating a learned card, reducing repetition, retraining a refusal."*
- `guidance[]` — *"READ BEFORE THE NUMBERS. This is the field that stops a model reporting a child regressed when an adult moved a button."*

`guidance[].code` documents the closed set of warning codes: `SMALL_SAMPLE · NOT_COLLECTED · LAYOUT_CHANGED_MID_WINDOW · GRID_RESIZED_MID_WINDOW · MODE_POSITION_DRIFT · MODELING_MODE_UNUSED · HIGH_REPETITION_NEUTRAL · PARTNER_WAIT_SHORT · ABSENCE_IN_WINDOW · BASELINE_THIN · SCENE_MOSTLY_UNKNOWN · PARTIAL_WINDOW`.

### `check_coverage()` — undocumented columns fail the export

Reads the header row back **off disk** from every `*.csv` in the output folder, skipping files whose name starts with `_`. It strips a leading BOM (`col.lstrip("﻿")`) so `--excel` output is checked identically. Two exemptions: `metrics_daily_wide.csv` (metric columns are generated, documented as the patterns `<metric_id>` and `<metric_id>__status`) and any `fixture_*.csv` (*"fixture files reuse names from their database equivalents"*).

`main()` prints up to 12 offenders, tells the caller *"Add them to `COLUMN_DOCS` in `tools/csv_docs.py`"*, and **returns `1`**. Docstring: *"Adding a column to a query without documenting it is how a dictionary rots. This makes it loud instead of silent."*

### Console output

Per-file row counts and KB sizes, a total, then a fixed reminder block:

```
  _column_dictionary.csv    every column in every file, with its gotchas
  _mcp_response_fields.csv  every field in the MCP envelope
  metric_catalog.csv        unit, polarity, min_n and caveat per metric

  A `status` of below_min_n or not_collected means the value cell is EMPTY
  ON PURPOSE — it is not zero, and Excel will sum it as one if you let it.
```

## Dependencies & Connections

### Depends On
- [L2 Rollup](l2-rollup.md) — `agg_daily_metric` (`value`/`n` semantics), `agg_card_stats`, `agg_cell_heat`, `agg_word_pairs`
- [Nightly Rule Materialisation](rule-materialisation.md) — `fired_rules` and the `superseded_by IS NULL` filter
- [Seed Cohort Generation](seed-generation.md) — `utterances`, `children`, `child_vocabulary`
- [Analytics Schema and Indices](../database/schema.md) — every table and the catalogue columns
- [Generated Artefacts](generated-artefacts.md) — the fixture files consumed by `--fixture`
- [Data Dictionary](../analytics/data-dictionary.md) — the same catalogue metadata the app surfaces in-product

### Depended On By
- Teachers, therapists and parents receiving an export — the dictionaries are the only documentation that reaches them
- Nothing in the running application imports these modules; `export_csv.py` is not called by `tools/build.sh`

### Shared Resources
- `exports/` output folder (`_column_dictionary.csv`, `_mcp_response_fields.csv`, and the data files)
- `mcp/fixtures/*.json` in `--fixture` mode
- `COLUMN_DOCS` and `RESPONSE_FIELDS` are the export-side mirror of the MCP envelope contract in `docs/mcp-api.md`

## Change Risks
- **Adding a column to any query without a `COLUMN_DOCS` entry makes the export exit `1`.** That is intentional; the fix is to document the column, not to widen an exemption.
- **Removing the `status` column, or writing `0` for a suppressed value,** re-creates the exact Excel/Sheets disagreement the header describes. Every downstream spreadsheet formula silently changes meaning.
- **Dropping `polarity` from `metrics_daily_long.csv` or `metric_catalog.csv`** removes the only signal that a neutral metric must not be coloured as a warning — outside the app there is nothing else enforcing C1.
- **Changing the `word_pairs.csv` thresholds** (`solo_a >= 10 AND solo_b >= 10`) changes which combinations a teacher is told to model next; the file is specifically the "never together" list, so relaxing `together = 0` changes what the file *means*.
- **Exporting utterance text** would breach the consent tier — `utterances.csv` deliberately carries `labels` only, and `csv_docs.py` states *"Utterance text lives in a separate consent tier and is not in this export."* See [Role and Consent Scoping](../auth/role-consent-scoping.md).
- **Widening the `fixture_*` exemption in `check_coverage()`** to real database files disables the whole guarantee.
- **Renaming an MCP payload key** (`metrics`, `cards`, `cells`, `pairs`, `utterances`, `children`, `queue`) silently produces an empty fixture export — the code `continue`s when the key is missing rather than erroring.
- **Changing `RESPONSE_FIELDS`** without changing the MCP envelope, or vice versa, lets the shipped documentation drift from the actual contract; there is no automated check tying them together.
