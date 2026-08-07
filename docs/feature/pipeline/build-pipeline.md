# Deterministic Build Pipeline

## Function
`tools/build.sh` rebuilds `aac.db` from nothing in seven numbered stages plus an unnumbered docs-and-fixtures stage, and exits non-zero if any stage fails.

## Purpose
From the file header: *"Build the analytics database from nothing and prove it works. Deterministic: same input, byte-identical output. Safe to run repeatedly. Exits non-zero if any stage fails, so CI can use it directly."*

The whole analytics stack — schema, catalogues, seed cohort, views, L2 rollup, fired rules, verification gate — is reproducible from a single command, so a reviewer never has to trust a database file that arrived by hand. The verification stage (7/7) is the gate: [Clinical Safety Verification Gate](verification-gate.md) fails the build if the analytics layer is lying, which means a broken insight rule stops the build rather than surfacing in front of a speech therapist.

## Source Files
| File | Role |
|------|------|
| `tools/build.sh` | The seven-stage orchestrator, the only entry point that produces a complete `aac.db` |

## Implementation

### Invocation

```bash
./tools/build.sh [db_path]        # db_path defaults to aac.db
npm run build                      # package.json → "./tools/build.sh aac.db"
```

- Shell options: `set -euo pipefail` — any stage failing aborts the run.
- `cd "$(dirname "$0")/.."` — always runs from the repo root regardless of caller cwd.
- `DB="${1:-aac.db}"` — the single positional argument is the database path.
- `step()` prints a bold `── <name>` banner. Most stages pipe their child process through `sed 's/^/     /'` to indent sub-output; stage 7/7 (`verify.py`) is *not* indented, so its own PASS/FAIL colouring reads unmodified.

### Stage order

| Stage | Command | Reported output |
|---|---|---|
| 1/7 `schema + indices` | `rm -f "$DB" "$DB-wal" "$DB-shm"`, then `sqlite3 "$DB" < db/schema.sql` and `< db/indices.sql` | `COUNT(*) FROM sqlite_master WHERE type='table'` tables, `type='index' AND name LIKE 'ix_%'` indices |
| 2/7 `metric + insight catalogues` | `sqlite3 "$DB" < db/seed_catalogues.sql` | `COUNT(*) FROM metrics_catalog` metrics, `COUNT(*) FROM insights_catalog` insight rules |
| 3/7 `seed data (deterministic)` | `python3 -m tools.seed.generate --db "$DB"` | row counts printed by the generator |
| 4/7 `views` | `sqlite3 "$DB" < db/views_metrics.sql` then `< db/views_insights.sql` | `COUNT(*) FROM sqlite_master WHERE type='view'` |
| 5/7 `rollup (L2)` | `python3 tools/rollup.py --db "$DB"` | per-table row counts + suppressed count |
| 6/7 `evaluate rules` | `python3 tools/run_rules.py --db "$DB"` | per-insight child counts + open findings |
| 7/7 `verify` | `python3 tools/verify.py --db "$DB"` | PASS/FAIL per check; non-zero exit fails the build |
| `docs + fixtures` | `python3 tools/gen_metric_index.py --db "$DB"`, then for `child in maya_t sofia_r`: `python3 tools/gen_fixtures.py --db "$DB" --child "$child" --window last_14d \| head -1` | one line per artefact |

Note that the fixture loop pipes through `head -1`, so only the "wrote …" summary line of each fixture capture is shown; the per-tool token table is discarded.

### Stages 1 and 2 are rebuilt by stage 3

`tools/seed/generate.py` `main()` deletes the target database (and its `-wal` / `-shm` files) and re-executes `db/schema.sql`, `db/indices.sql` and `db/seed_catalogues.sql` itself before generating anything. The database counted by stages 1/7 and 2/7 is therefore discarded and recreated by stage 3/7. The counts printed by those two stages are still accurate for the DDL files, but they do not describe the database that survives the build. Running `tools/seed/generate.py` standalone is sufficient to get a schema + catalogues + seed database; stages 1–2 exist so a failure in the DDL is reported before the slower Python stage runs.

### Closing output

```
Build complete.  <db>
  run the MCP server:   node mcp/server.ts --db <db>
  concurrency check:    python3 tools/concurrency_test.py --db <db>
```

Neither of those two is executed by the build — they are printed as next steps. See [Pre-Demo Test Harnesses](test-harnesses.md).

## Dependencies & Connections

### Depends On
- [Seed Cohort Generation](seed-generation.md) — stage 3/7 produces every L0/L1 row the rest of the pipeline reads
- [L2 Rollup](l2-rollup.md) — stage 5/7 materialises `agg_*` from the metric views
- [Nightly Rule Materialisation](rule-materialisation.md) — stage 6/7 writes `fired_rules`
- [Clinical Safety Verification Gate](verification-gate.md) — stage 7/7, the only stage that can fail the build on a clinical-safety violation
- [Generated Artefacts](generated-artefacts.md) — the trailing docs + fixtures stage
- [Analytics Schema and Indices](../database/schema.md) — `db/schema.sql`, `db/indices.sql`, `db/seed_catalogues.sql`, `db/views_metrics.sql`, `db/views_insights.sql` are all executed directly by this script

### Depended On By
- [MCP stdio Server](../mcp/stdio-server.md) — reads the `aac.db` this script produces
- Dashboard and API reads — every `agg_*` and `fired_rules` row the app serves originates here
- CI / demo setup — `npm run build` is the documented one-command reproduction

### Shared Resources
- `aac.db` (plus `aac.db-wal`, `aac.db-shm`), deleted and recreated on every run
- `sqlite3` CLI and `python3` must both be on `PATH`
- `docs/analytics-metrics.md` is rewritten in place by the docs stage
- `mcp/fixtures/maya_t-last_14d.json` and `mcp/fixtures/sofia_r-last_14d.json` are rewritten by the fixtures stage

## Change Risks
- **Reordering stages breaks the dependency chain silently under `set -e` only if a stage still exits 0.** Rollup (5/7) reads views created in 4/7; rules (6/7) read the `v_i1..v_i8` views *and* the `agg_daily_metric` rows written in 5/7 (verify's C4 check reads `agg_daily_metric` for `position_consistency`). Moving verify earlier turns real failures into false passes.
- **Deleting the `rm -f "$DB-wal" "$DB-shm"` line** leaves a stale WAL beside a fresh main file; SQLite will either refuse to open it or replay unrelated frames.
- **Adding a stage that writes to the database after 7/7** puts data past the gate. Anything that mutates `aac.db` must run before verify.
- **Changing the fixture loop's child list** (`maya_t sofia_r`) changes which fixtures ship; `tools/export_csv.py --fixture` and any dashboard scaffolding coded against those two files break.
- **Running the script against a path that is not disposable destroys it** — stage 1 `rm -f`s the target unconditionally. There is no confirmation prompt and no `--force` flag.
- **`npm run build` and `npm run build:web` are different things.** The former is this pipeline, the latter is `next build`. Renaming either script silently changes what CI does.
