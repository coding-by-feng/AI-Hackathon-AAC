# Nightly Rule Materialisation

## Function
`tools/run_rules.py` evaluates the eight diagnostic insight views (`v_i1_*` … `v_i8_*`), writes one `fired_rules` row per `(child, insight)` that triggered, and supersedes the previous run's rows without ever erasing a dismissal.

## Purpose
From the file header: *"Runs nightly (the `/api/cron/rules` handler in production). Plain SQL, no model: the rules must be deterministic and explainable to a speech therapist."*

The performance rationale is the load-bearing one: *"Why this exists rather than the MCP server querying the views directly: the insight views scan the event table with window functions. Under concurrent write load they took over five seconds at p99 — the dashboard would stall whenever a class was mid-session. `tools/concurrency_test.py` catches that. So the rules run once, here, and everyone reads the resulting rows."*

And the boundary against the model: *"A model may later narrate a fired rule (`insights.fired_rule_id`), but it can never invent one."* This is the same split described in [Fired Rules & Evidence](../analytics/fired-rules-and-evidence.md) — `fired_rules` is deterministic SQL, `insights` is narration that cannot exist without a `fired_rule_id`.

**The `/api/cron/rules` route named in the header does not exist in this repo.** `app/api/` contains `auth`, `cards`, `categories`, `chat`, `dashboard/settings`, `events`, `mcp`, `reports` (including `[id]/print` and `[id]/pdf`), `session`, `session/switch` and `visuals` — no `cron`. Today this script is invoked only by `tools/build.sh` stage 6/7 and by hand.

## Source Files
| File | Role |
|------|------|
| `tools/run_rules.py` | The `RULES` map, evidence capture, supersede/resolve logic, CLI |

## Implementation

### CLI

```bash
python3 tools/run_rules.py --db aac.db
```

| Flag | Behaviour |
|---|---|
| `--db` | default `<repo root>/aac.db` |
| `--keep-dismissed` | `store_true`, help text *"preserve dismissals by superseding rather than deleting"* — **parsed but never read in the body.** Superseding rather than deleting is unconditional, so the flag is currently a no-op. |

`PRAGMA foreign_keys = ON` on connect.

### `RULES` — view and evidence cap per insight

```python
RULES: dict[str, tuple[str, int]] = {
    "I1": ("v_i1_mistap_classification", 1),
    "I2": ("v_i2_scanning_load",         1),
    "I3": ("v_i3_buried_words",         10),
    "I4": ("v_i4_unused_vocabulary",    15),
    "I5": ("v_i5_summary",               1),
    "I6": ("v_i6_scene_bound",          10),
    "I7": ("v_i7_modeling_gap",          1),
    "I8": ("v_i8_layout_disruption",    10),
}
```

The comment above it explains the caps: *"Which view carries the evidence for each rule, and how much of it to keep. I4 is capped because unused-vocabulary housekeeping can return dozens of rows and nobody acts on more than a handful."*

### Execution order

1. **Window** — `SELECT w_start, w_end FROM v_window`. `v_window` derives every bound from `MAX(day_local) FROM events`; `w_start` is `-13 days`, i.e. a 14-day window.
2. **`now_ms`** — `int(time.time() * 1000)`, one timestamp shared by every row this run writes.
3. **Snapshot the prior open set into Python:**
   ```sql
   SELECT fired_rule_id, child_id, insight_id FROM fired_rules
   WHERE superseded_by IS NULL AND dismissed_at IS NULL
   ```
   Dismissed rows are deliberately excluded. *"A dismissal is the only feedback we get on whether a rule is any good, so a re-run must never silently erase one."* The set is *"held in Python, not marked with a sentinel: `superseded_by` REFERENCES `fired_rules(fired_rule_id)`, so the old `SET superseded_by = 'pending'` violated the FK on any database that already had findings — which meant this script had only ever succeeded on the empty table `build.sh` gives it, and crashed on the nightly re-run it exists for."* Re-run-safe since 2026-08-08, proven on a populated table — 24 rows, 12 superseded, 0 dismissals lost; audit trail in [`docs/feature-verification.md`](../../feature-verification.md) §"Metric-calculation pass".
4. **Per rule**, `SELECT * FROM <view> WHERE triggered = 1`, group rows by `child_id`, and read `insights_catalog.default_thresholds` for the insight (falling back to the string `"{}"` if the catalogue row is missing).
5. **Per child with evidence**, insert one row:
   - `fired_rule_id = f"fr_{uuid.uuid4().hex[:16]}"`
   - `evidence = json.dumps(evidence[:cap], default=str)` — capped per the `RULES` table
   - `thresholds_used` = the catalogue's `default_thresholds` verbatim, so a reader can disagree with a rule that fired just over its line
   - `classification` is populated **for I1 only**:
     ```json
     {"motor_share": round(adjacent_ratio, 3),
      "semantic_share": round(1 - adjacent_ratio, 3),
      "verdict": <view's classification column>}
     ```
     `adjacent_ratio` falls back to `0` when absent, which yields `motor_share 0.0 / semantic_share 1.0`.
   - Columns written: `fired_rule_id, child_id, insight_id, fired_at, window_start, window_end, evidence, thresholds_used, classification`. Everything else on `fired_rules` takes its schema default.
6. **Link or resolve each prior row, one parameterised `UPDATE` per row:**
   ```sql
   UPDATE fired_rules SET superseded_by = (
     SELECT new.fired_rule_id FROM fired_rules AS new
     WHERE new.child_id = ? AND new.insight_id = ?
       AND new.fired_at = ?
     LIMIT 1)
   WHERE fired_rule_id = ?
   ```
   bound to `(child_id, insight_id, now_ms, fired_rule_id)` for each row captured in step 3. There is no `superseded_by IS NULL` predicate anywhere — the subquery finds this run's replacement by `(child_id, insight_id, fired_at = now_ms)` alone. When the rule did not fire again, the subquery yields `NULL`, and per the comment: *"A row nothing replaced keeps superseded_by NULL (the subquery yields NULL): the rule stopped firing, which is a resolution, and the row stays visible as the current finding until dismissed."* The "open findings" count is therefore currently-true findings plus resolved-but-not-replaced ones, not a strictly monotonic queue. A single `conn.commit()` follows this loop — the run's only commit.
7. **Report:**
   ```sql
   SELECT COUNT(*) FROM fired_rules WHERE dismissed_at IS NULL AND superseded_by IS NULL
   ```
   printed as `open findings`, after one line per insight (`I1  1 child(ren)`) and a header line `rules evaluated in 0.05s  window <w_start> .. <w_end>`.

Return code is always `0`.

### Helper

`rows_as_dicts(conn, sql, params)` reads `cur.description` for column names and zips each row into a `dict`, so evidence JSON carries the view's own column names verbatim.

## Dependencies & Connections

### Depends On
- [Analytics Schema and Indices](../database/schema.md) — `fired_rules`, `insights_catalog.default_thresholds`, and the `v_i1..v_i8` / `v_window` views in `db/views_insights.sql`
- [L2 Rollup](l2-rollup.md) — runs before this in the build
- [Seed Cohort Generation](seed-generation.md) — the planted conditions are what make each rule trigger
- [Deterministic Build Pipeline](build-pipeline.md) — stage 6/7

### Depended On By
- [Clinical Safety Verification Gate](verification-gate.md) — its COVERAGE and RESTRAINT sections read `v_insights_fired`, which is built on `fired_rules`
- [Fired Rules & Evidence](../analytics/fired-rules-and-evidence.md) — the dashboard's read model over these rows
- [Attention Queue](../dashboard/attention-queue.md) — ranks children from open findings
- [MCP stdio Server](../mcp/stdio-server.md) — `get_fired_rules` and `get_attention_queue` serve materialised rows rather than live views, which is the entire point of this script
- [CSV Export](csv-export.md) — `fired_rules.csv` exports rows `WHERE superseded_by IS NULL`
- [Pre-Demo Test Harnesses](test-harnesses.md) — the concurrency reader queries `fired_rules WHERE dismissed_at IS NULL AND superseded_by IS NULL`

### Shared Resources
- Table `fired_rules` — this script is its only writer; the dashboard writes only `dismissed_at` / `dismiss_reason`
- `insights_catalog.default_thresholds` — copied into every row as `thresholds_used`
- `v_window` — the same window definition the metric views use

## Change Risks
- **Deleting instead of superseding destroys dismissal feedback.** The header calls dismissals *"the only feedback we get on whether a rule is any good"*; `docs/analytics-metrics.md` §8 says the same. Losing them makes it impossible to retire a rule nobody accepts.
- **Raising an evidence cap inflates every downstream payload.** `evidence` is serialised into the MCP envelope and into `fired_rules.csv`; I4's cap of 15 exists because *"nobody acts on more than a handful"*.
- **Dropping `thresholds_used`** removes the ability to disagree with a borderline firing — `csv_docs.py` documents it as *"Exposed rather than applied, so you can disagree with a rule that fired at 8.1% against a threshold of 8%."*
- **Letting a model write `fired_rules`** breaks the invariant that a narration must reference a rule the SQL produced. `insights.fired_rule_id` is a foreign key precisely so a model cannot invent a finding.
- **Renaming a view in `RULES`** still produces an `sqlite3.OperationalError` mid-run, but it can no longer poison the table: the script writes nothing before the per-child inserts and commits exactly once at the end, so a failure leaves the previous run's rows exactly as they were. The failure mode is a partial insert set that dies with the uncommitted transaction — not rows stuck at a sentinel value no reader understands.
- **Moving rule evaluation back into the read path** re-creates the 5-second p99 the header describes. `tools/concurrency_test.py` fails the build-adjacent check at `reader p99 > 1000 ms`.
- **Adding a ninth insight** requires an entry in `RULES`, a view, an `insights_catalog` row, and a persona plant — otherwise `verify.py`'s coverage check fails and `personas.py`'s `UNCOVERED` assertion raises at import.
- **Wiring up the missing `/api/cron/rules` route** must reuse this logic exactly, including the supersede semantics; a second writer with different rules would corrupt the supersede chain.
