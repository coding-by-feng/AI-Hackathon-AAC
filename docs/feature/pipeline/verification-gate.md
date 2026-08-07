# Clinical Safety Verification Gate

## Function
`tools/verify.py` runs four ordered check sections — SAFETY, COVERAGE, RESTRAINT, INTEGRITY — against the built database and exits `1` if any check fails, which fails the whole build.

## Purpose
From the file header: *"The gate. Fails the build if the analytics layer is lying. Checks, in order of how badly a failure would hurt a real child:*

- *SAFETY — clinical constraints are enforced in data, not in copywriting*
- *COVERAGE — every insight rule can actually fire on plausible data*
- *RESTRAINT — the control child triggers no intervention*
- *INTEGRITY — metrics agree with their catalogue; no orphans; no silent nulls*

*An insight that cannot be made to fire on realistic seed data has a broken rule, not unlucky data. That is the whole point of checking it here rather than discovering it in front of a speech therapist."*

The SAFETY section is the machine-readable form of `docs/aac-clinical-constraints.md` — the eight binding constraints C1–C8. That document says the copy rules *"are stored as fields on `insights_catalog`, not left to whoever writes the UI string"*; this script is what proves they actually are.

## Source Files
| File | Role |
|------|------|
| `tools/verify.py` | All four check sections, the `Report` accumulator, exit-code policy |

## Implementation

### CLI and constants

```bash
python3 tools/verify.py --db aac.db      # npm run verify
```

| Constant | Value |
|---|---|
| `CONTROL_CHILD` | `"amara_o"` |
| `ALL_INSIGHTS` | `["I1","I2","I3","I4","I5","I6","I7","I8"]` |
| `GREEN, RED, YELLOW, DIM, RESET` | `\033[32m`, `\033[31m`, `\033[33m`, `\033[2m`, `\033[0m` |

`--db` defaults to `<repo root>/aac.db`. `PRAGMA foreign_keys = ON` on connect.

### `Report`

- `check(section, name, ok, detail="")` prints `[PASS]` / `[FAIL]` plus a dim detail string and appends `f"{section}: {name} — {detail}"` to `failures` when `ok` is falsy.
- `warn(name, detail="")` prints `[WARN]` and appends to `warnings`.

### Exit policy (`main`)

| Condition | Output | Exit |
|---|---|---|
| any failure | `FAILED — N check(s)` plus one `· <section>: <name> — <detail>` line each | `1` |
| warnings only | `PASSED with N warning(s)` | `0` |
| clean | `PASSED — all checks green` | `0` |

`NOT_YET_GENERATED` is never empty, so a healthy run always reports **at least one** warning (`known gaps in seed data`). The other warn sources are `persona expectations unavailable` (the pre-step-3 `EXPECTED_FIRING` import failed), `<iid> has no active planter at this horizon` (COVERAGE step 1's activity probe) and `<iid> plant for <child> predates the rule window` (COVERAGE step 3's softening).

### SAFETY — `check_safety()`

| Constraint | Check name | Assertion |
|---|---|---|
| C1 | `repeat_tap_rate is not filed under errors` | `metrics_catalog.group_code != 'B'` for `repeat_tap_rate` |
| C1 | `repeat_tap_rate polarity is neutral` | `polarity == 'neutral'`; detail text: *"a neutral metric may not be styled as a warning"* |
| C1 | `no insight recommends reducing repetition` | no `insights_catalog` row whose lowercased `recommended_actions` contains `"repet"` **and** any of `("reduc", "discourag", "stop the repet", "limit repet", "extinguish", "prevent repet")` |
| C2/C3 | `board_change_proposals rejects move / resize / remove` | a real `INSERT` is attempted for each of `move`, `resize`, `remove` and all three must raise `sqlite3.IntegrityError` (the table's `CHECK (change_kind IN ('add','add_copy','mask','unmask'))`), then `conn.rollback()` |
| C2/C3 | `no insight recommends relocating a learned button` | no `recommended_actions LIKE '%resize the grid%' OR '%move the card%' OR '%relocate%'` |
| consistency | `no action is both recommended and forbidden` | for each insight, no entry of `json.loads(forbidden_actions)` appears (with `_` replaced by a space) inside lowercased `recommended_actions` |
| C4 | `every AI mode is a filtered view of the robust board` | no `agg_daily_metric` row with `metric_id='position_consistency' AND value < 1.0` |
| C4 | `no board_cells rows belong to a mode` | `COUNT(*) FROM board_cells JOIN boards ON kind='mode'` is `0` |
| C5 | `never proposes removing a core or essential word` | no `v_i4_unused_vocabulary` row with `triggered = 1 AND suggested_disposition = 'replace'` joined to a card with `is_core = 1 OR is_essential = 1`; detail: *"core vocabulary is a modelling target, not dead weight"* |
| C1/autonomy | `a refusal is never routed to retraining` | no `v_i4_unused_vocabulary` row with `case_kind = 'preference' AND suggested_disposition <> 'no_action'` |

Two comments in this section record earlier versions that passed while being wrong, and are worth preserving verbatim:

- On the C1 recommendation scan: *"The real test is that no rule RECOMMENDS it — not how many happen to list it as forbidden. Counting forbid-entries was measuring paperwork."*
- On the C2/C3 probe: *"Test the BEHAVIOUR, not the DDL text: an earlier version of this check passed by reading a comment that happened to contain the word 'move'. Try the insert and require it to be rejected."* The probe inserts `proposal_id = f"_probe_{kind}"` for `maya_t` / `board_maya_t` and deletes it again on the (failing) path where the insert succeeds.

### COVERAGE — `check_coverage()`

1. For each of `I1..I8`: `SELECT child_id, evidence_rows FROM v_insights_fired WHERE insight_id=? LIMIT 1` must return a row. The check label carries the insight's `name` from `insights_catalog`; the failure detail is `"RULE IS BROKEN or no persona plants it"`. The assertion is softened by a **planter-activity probe**: the function computes `win14` — `date(MAX(day_local), '-13 days') .. MAX(day_local)`, the final 14 days of data — and, when an insight has not fired, checks whether any persona in `EXPECTED_FIRING[iid]` has `actor='child'` events inside that window. If none does, the check is skipped with a **WARN** (`<iid> has no active planter at this horizon` — *"every persona that plants this pattern is silent in the final 14 days of data — the windowed rule correctly sees nothing"*). The inline comment ties both softenings together: the assertions are *"only meaningful while some planter is active inside the rules' evaluation window — persona day-indices are tuned for `--days 42`"*.
2. `EXPECTED_FIRING` is imported **twice**, and the two imports fail differently. The first (`from tools.seed.personas import EXPECTED_FIRING as _EXP`, feeding step 1's probe) swallows any exception into `_EXP = {}` **silently** — which disables the softening probe, so with a broken `personas.py` step 1 reverts to hard failures. The second, before step 3, warns visibly (`persona expectations unavailable`) and returns early rather than failing.
3. For every `(insight_id, child_id)` in `EXPECTED_FIRING`, a matching `v_insights_fired` row must exist. Failure detail: `"persona declares this plant but the rule did not fire"`. This too is softened per plant: a planter with no `actor='child'` events in the final 14 days of data downgrades to a **WARN** (`<iid> plant for <child> predates the rule window` — *"no child activity in the final 14 days of data — the windowed rule cannot see the planted pattern at this horizon"*). The comment explains why warning is right: at longer horizons *"a child like jonah_k has been silent for months, the windowed rule CORRECTLY stays quiet, and failing here would push someone to 'fix' a rule that is right. The gate is data-driven, not horizon-driven."*

The comment states the direction of truth: *"personas.py declares what it plants; the database must agree."*

A `fired` dict is built at the top of this function from `v_insights_fired` and never used — dead code, harmless.

### RESTRAINT — `check_restraint()`

Reads every `v_insights_fired` row for `amara_o` joined to `insights_catalog.action_kind`.

- **Fails** if any has `action_kind == 'intervention'`. Detail: *"a dashboard that cries wolf gets ignored"*.
- Rows with any other `action_kind` are printed as a dim `informational only (acceptable)` line and do **not** fail. So the control child may legitimately appear in informational insights.

### INTEGRITY — `check_integrity()`

| Check | Assertion |
|---|---|
| `no foreign key violations` | `PRAGMA foreign_key_check` returns nothing |
| `every stored metric exists in the catalogue` | no `agg_daily_metric` row whose `metric_id` is missing from `metrics_catalog` |
| `every stored value carries the n a reader gates on` | no `agg_daily_metric` row with `value IS NOT NULL AND (n IS NULL OR n <= 0)`; detail: `"<n> values stored without a sample size"` |
| `<metric> has data` × 7 | each `DIMENSIONAL` query returns `> 0` |
| `no unexplained empty metric` | every `metrics_catalog` row with `status='shown'` and no `agg_daily_metric` rows must be listed in `DIMENSIONAL` or `NOT_YET_GENERATED` |
| `no duplicate metric rows` | no duplicate `(child_id, day_local, metric_id)` |
| `enough history for a 4-week baseline` | `COUNT(DISTINCT day_local) FROM events >= 28`; detail reports days, children and event count |

The sample-size check's inline comment records why it asserts the *presence of `n`* rather than the absence of under-powered values: *"min_n is enforced at READ time, at each reader's own grain — the store keeps the true daily value so window aggregates are computable (writing NULL destroyed them: a 28-day window with 170 corrections reported from the 53 that cleared the daily bar). The publishable contract is therefore that `n` rides with every value, so every reader CAN gate. A row with a value and no n is the one thing that makes read-time suppression impossible, and that is what fails the gate."*

`DIMENSIONAL` — metrics that are real but do not live in `agg_daily_metric`. The comment: *"Not every shown metric is a daily scalar. The dimensional ones live in their own tables; checking them against `agg_daily_metric` reported eleven false gaps."*

| metric_id | Presence query |
|---|---|
| `cell_heat` | `SELECT COUNT(*) FROM agg_cell_heat` |
| `card_frequency` | `SELECT COUNT(*) FROM agg_card_stats` |
| `zero_activation_days` | `SELECT COUNT(*) FROM agg_card_stats WHERE zero_days > 0` |
| `word_pairs` | `SELECT COUNT(*) FROM agg_word_pairs` |
| `nav_depth_by_card` | `SELECT COUNT(*) FROM v_card_stats WHERE avg_nav_depth > 0` |
| `scene_distribution` | `SELECT COUNT(*) FROM v_scene_matrix` |
| `pragmatic_function_mix` | `SELECT COUNT(*) FROM v_function_mix` |

`NOT_YET_GENERATED` — *"Defined, deliberately not yet produced by the generator. Named so the gap is a decision on the record rather than a silent blank tile."*

| metric_id | Recorded reason |
|---|---|
| `suggestion_acceptance` | `needs suggestion_shown / suggestion_tap events` |
| `vocabulary_gaps` | `needs gap_detected events` |
| `visual_source_split` | `needs gap_detected events` |
| `keyboard_use` | `needs the alphabet feature to exist (constraint C8)` |

The last one is C8 in the constraints doc — *"our spec has no keyboard"*, flagged there as a product gap the schema anticipates.

## Dependencies & Connections

### Depends On
- [Seed Cohort Generation](seed-generation.md) — imports `tools.seed.personas.EXPECTED_FIRING`; a persona plant that stops working fails this gate
- [L2 Rollup](l2-rollup.md) — reads `agg_daily_metric`, `agg_card_stats`, `agg_cell_heat`, `agg_word_pairs`
- [Nightly Rule Materialisation](rule-materialisation.md) — reads `v_insights_fired`, built on `fired_rules`
- [Analytics Schema and Indices](../database/schema.md) — the `board_change_proposals` CHECK constraint is what makes the C2/C3 probe meaningful; `metrics_catalog` and `insights_catalog` carry the polarity / forbidden-action fields
- [Deterministic Build Pipeline](build-pipeline.md) — stage 7/7; `npm run verify` runs it standalone

### Depended On By
- [Deterministic Build Pipeline](build-pipeline.md) — a non-zero exit here fails the build under `set -e`
- Anyone shipping a change to `db/seed_catalogues.sql`, an insight view, or a persona — this is the only automated check that catches a clinically unsafe recommendation

### Shared Resources
- `EXPECTED_FIRING` from `tools/seed/personas.py`
- `metrics_catalog.polarity` / `.group_code` / `.min_n`, `insights_catalog.recommended_actions` / `.forbidden_actions` / `.action_kind`
- `board_change_proposals` — the probe inserts and rolls back; it writes nothing permanent

## Change Risks
- **Softening any SAFETY check removes the only enforcement of a clinical constraint.** These constraints exist because, per `docs/aac-clinical-constraints.md`, *"several metrics and two of the seven insights, as originally specified, would have produced advice that harms AAC users."* A green build with a weakened check is worse than a red one.
- **Replacing the C2/C3 behavioural probe with a text scan re-introduces the exact bug the comment records** — a check that passed by matching the word "move" inside a comment.
- **Adding a `change_kind` to `board_change_proposals`** named `move`, `resize` or `remove` makes the probe pass with `len(rejected) < 3` and fails the build — which is the intended outcome, since it would mean the schema now permits relocating a learned button.
- **Adding a `status='shown'` metric with no data** fails `no unexplained empty metric` unless it is registered in `DIMENSIONAL` (with a presence query) or `NOT_YET_GENERATED` (with a reason). Registering it in `NOT_YET_GENERATED` adds to the warning line but keeps the build green — that is the documented escape hatch, and it is deliberately visible.
- **Renaming `amara_o`** breaks `CONTROL_CHILD` and silently disables the RESTRAINT section (the query simply returns no rows and the check passes vacuously).
- **Shortening the seeded history below 28 days** fails `enough history for a 4-week baseline` and simultaneously invalidates every baseline-gated metric — see [Baseline Gating](../analytics/baseline-gating.md).
- **Moving `verify.py` earlier in the build** would let stage 6/7's rules run after the gate, so a broken rule would ship.
- **A failure in the persona import degrades to a warning, not a failure.** If `tools/seed/personas.py` raises (for example via its `UNCOVERED` assertion), the planted-firing checks are skipped and the build can still pass on the weaker generic coverage check alone — which, with the first import silently reduced to `_EXP = {}`, runs un-softened.
- **Building at horizons longer than `--days 42` degrades plant assertions to warnings.** Persona day-indices are tuned for 42 days; at a longer horizon a planter can fall outside the final 14 days of data, and the activity probe — not the calendar — decides whether each plant check asserts or warns. Plant warnings on a long-horizon build are the gate behaving as designed; the same warnings on a 42-day build mean a plant has genuinely gone stale.
