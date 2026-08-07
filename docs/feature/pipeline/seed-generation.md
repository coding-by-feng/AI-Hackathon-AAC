# Seed Cohort Generation

## Function
Generates the entire demo database deterministically — five children with deliberately planted clinical conditions, their vocabulary and board layouts, and 42 days of L0 `events` plus L1 `utterances`, `partner_turns`, `board_revisions`, `utterance_structures` and `sessions`.

## Purpose
From `personas.py`: *"Seed data is NOT random. Each persona carries a specific pathology so that every one of the eight insight rules fires at least once — the acceptance criterion in `docs/analytics-metrics.md`. If an insight cannot be made to fire on plausible data, the rule is wrong, and `tools/verify.py` fails the build."*

`docs/analytics-metrics.md` §13 states the criterion directly: *"Seeded demo data must cause every one of the 7 insights to fire at least once, and the Attention Queue must rank at least three children with different reasons. If an insight cannot be made to fire with plausible data, its rule is wrong."* (The constraints document later adds I8, making it eight.)

Amara O. is the control: *"She has nothing planted. If any insight fires on her, the rules are too eager, and a dashboard that cries wolf gets ignored within a week."*

From `generate.py`: *"Deterministic: every child has its own PRNG seed, so adding a child does not shift anyone else's history, and two runs produce byte-identical output."*

`vocab.py` exists because of constraint **C5** — *"about 200 words account for ~80% of everyday communication, so `is_core` is resolved by joining this list rather than by anyone's judgement."*

## Source Files
| File | Role |
|------|------|
| `tools/seed/generate.py` | Reference-data writer, event/utterance generator, sitting materialisation, CLI entry point |
| `tools/seed/personas.py` | The five personas, their planted conditions, and `EXPECTED_FIRING` |
| `tools/seed/vocab.py` | Core word list, card library, part-of-speech table, emotion lexicon, syntax patterns, board grids, buried-card depths |
| `db/seed_core_words.sql` | 200-word core vocabulary (ranks 1–200), `INSERT OR IGNORE` into `core_word_list` plus a `cards.is_core` recompute-by-join — applied **by hand** after `seed_catalogues.sql`, never run by the build; cites constraint C5 |

## Implementation

### CLI

```bash
python3 -m tools.seed.generate --db aac.db --days 42 --end 2026-08-07
```

| Flag | Default |
|---|---|
| `--db` | `<repo root>/aac.db` |
| `--days` | `42` |
| `--end` | `2026-08-07` |

`main()` deletes the target database and its `-wal` / `-shm` siblings, then `executescript`s `db/schema.sql`, `db/indices.sql` and `db/seed_catalogues.sql` before generating. It prints row counts for `events`, `utterances`, `partner_turns`, `board_revisions`, `cards`.

### Module constants (`generate.py`)

| Constant | Value | Meaning |
|---|---|---|
| `TZ_OFFSET_MIN` | `720` | NZST, fixed for the demo; written to every event's `tz_offset_min` |
| `IDLE_GAP_MS` | `20 * 60 * 1000` | *"A sitting ends when the device is idle this long. 20 minutes separates 'went to lunch' from 'paused to think'."* |
| `ORG_ID` | `"org_demo"` | |
| `CLASS_ID` | `"class_y3"` | |
| `SCHOOL_SCENES` | hours 8–18 → `home, classroom, therapy, classroom, free_play, classroom, classroom, free_play, home, home, home` | *"Deliberately lumpy: a real child does not communicate uniformly, and flat data makes every time-based metric look wrong."* |
| `WEEKEND_SCENES` | `(9,home) (11,community) (13,home) (15,free_play) (17,home)` | |

`epoch_ms(d, hour, minute, second)` builds a UTC datetime then subtracts `TZ_OFFSET_MIN * 60_000`. `uid(prefix)` returns `f"{prefix}_{uuid4().hex[:12]}"` — **not** seeded, so ids differ between runs even though behaviour does not.

### The five personas

| child_id | display_name | Year | Profile note | Grid | seed | `fires` |
|---|---|---|---|---|---|---|
| `maya_t` | Maya T. | Year 3 | CP / dysarthria | `MAYA_GRID` 4×4 | 1001 | I1, I3, I4, I8 |
| `jonah_k` | Jonah K. | Year 3 | CP / cortical visual impairment | `JONAH_GRID` 6×6 | 1002 | I2 |
| `amara_o` | Amara O. | Year 4 | Dysarthria | `AMARA_GRID` (= `JONAH_GRID`) | 1003 | *(none — control)* |
| `liam_w` | Liam W. | Year 2 | CP / apraxia | `LIAM_GRID` 4×5 | 1004 | I4, I5 |
| `sofia_r` | Sofia R. | Year 2 | Nonspeaking / autistic | `SOFIA_GRID` 4×5 | 1005 | I6, I7 |

`EXPECTED_FIRING` is derived by inverting `Persona.fires`, giving
`{I1:[maya_t], I3:[maya_t], I4:[maya_t, liam_w], I8:[maya_t], I2:[jonah_k], I5:[liam_w], I6:[sofia_r], I7:[sofia_r]}`.
A module-level `assert not UNCOVERED` fails at import time if any of `I1..I8` has no planting persona — so a rule with no plant breaks `import tools.seed.personas`, not just the build.

### Planted conditions (`Persona` fields)

| Field | Default | What it plants |
|---|---|---|
| `dead_rows` | `()` | rows the child cannot reach → I1 motor. Maya: `(3,)` |
| `semantic_error_share` | `0.45` | share of unintended presses corrected from *far away* rather than next door. Maya `0.14` (*"overwhelmingly a reach problem"*), Jonah `0.58` (*"visual, not motor"*), Amara `0.5`, Liam `0.42`, Sofia `0.47`. *"Without a mix, I1's classifier is degenerate and always answers 'motor'."* |
| `scan_slow` | `False` | Jonah `True` → I2 |
| `silence_from_day` | `None` | Jonah `38` — no events at all from day index 38 onward (4 quiet days) |
| `abandon_rate` | `0.06` | Liam `0.31` (*"builds sentences, gives up"*), Maya `0.09`, Jonah `0.14`, Sofia `0.07`, Amara `0.04` |
| `never_combine` | `None` | Liam `("want","biscuit")` → I5 |
| `scene_bound` | `None` | Sofia `("thank you","therapy")` → I6 |
| `modeling_per_day` | `(4, 12)` | Sofia `(0, 1)` → I7; Amara `(8, 18)` |
| `dead_word` | `None` | Liam `"helicopter"` — weight forced to 0 everywhere → I4 case A |
| `disliked` | `None` | Maya `("cookie","classroom")` — weight 0 in that scene only → I4 case B |
| `layout_change_day` | `None` | Maya `33` → I8 |
| `partner_wait_ms` | `(2800, 6000)` | Jonah `(900, 1900)` — *"adult waits under 2s → I2 partner side"* |
| `partner_interrupt_rate` | `0.05` | Jonah `0.22` |
| `improving` | `False` | Amara `True` — utterance count scaled by `0.82 + 0.36 * day_index / days` |

Baseline behaviour fields: `utterances_per_school_day` (min,max), `mean_symbols` (drives MLU; Liam `1.08` = essentially single words, Amara `3.4`), `base_mistap_rate` (Amara `0.02` … Maya `0.07`), `base_latency_ms` (Jonah `(5200, 9000)` — *"slow, but taps are correct"*), `suggestion_accept`, `weekend_activity` multiplier.

### Vocabulary (`vocab.py`)

- `CORE_WORDS` — 30 `(word, rank, word_class)` tuples, a trimmed standard core set; `CORE_SET` is the word set. `is_core(card_id)` = `CARD_BY_ID[card_id].label in CORE_SET` — never hardcoded on the card. These 30 tuples are what `generate.py` writes into `core_word_list`; `db/seed_core_words.sql` supersedes them with the full 200-word list (ranks 1–200) and recomputes `cards.is_core` by joining it — but the build never runs that file, so a built `aac.db` carries the 30-word list unless the SQL was applied manually afterwards.
- `CARDS` — 49 `Card(card_id, label, spoken_text, category, function, is_essential, pos)` rows. Six essentials: `yes`, `no`, `stop`, `help`, `toilet`, `pain` (label `hurt`) — *"always available, never re-ranked, never AI-generated."*
- `POS` — part-of-speech table applied after construction via `CARDS = [c._replace(pos=POS.get(c.label)) for c in CARDS]`. *"Used ONLY to spot which structures are appearing — never to mark anything missing. A board with no determiner card cannot produce a determiner, and counting that against the child would score them for our vocabulary decisions."*
- `EMOTION_LEXICON` — 11 `(word, category)` pairs across `positive` / `neutral` / `upset`. *"Deliberately SHORT: assigning an emotional reading to core vocabulary ('help' = distress) is the overreach the metric's caveat warns about."*
- `SYNTAX_PATTERNS` — 6 `(id, name, pos_sequence, example, stage)` rows: `two_word_request`, `agent_action`, `more_thing` (stage 1), `agent_act_object`, `action_again` (stage 2), `describe_thing` (stage 3).
- Board grids hold **the home page only**: `MAYA_GRID` (4×4, `(3,3)` empty, row 3 is the planted dead zone and holds no essential card — *"which is exactly why a reach problem can hide for weeks"*), `JONAH_GRID` (6×6, *"dense on purpose"*), `AMARA_GRID = JONAH_GRID`, `LIAM_GRID` (4×5), `SOFIA_GRID` (4×5).
- `FEELINGS = {happy:2, sad:2, tired:2, scared:3, excited:3}` is merged into every child's `BURIED` map at import time.
- `BURIED[child_id][card_id] = nav_depth` for folder-reachable cards. Maya's `snack` is at depth **4** — the I3 plant.
- `grid_cards(grid)` yields `(row, col, card_id)` for every non-`None` cell.

### `Layout` — geometry over time

- `base` = card → `(row, col)` from the persona grid; `buried` = `vocab.BURIED[child_id]`.
- `swapped` is hardcoded to `("water", "more")` whenever `layout_change_day` is set. `position(card_id, day_index)` returns the swapped coordinates for `day_index >= change_day`. *"Maya's board is rearranged on day 33 by a well-meaning adult following our own I3 advice. Two learned buttons move. This is what I8 exists to catch."*
- `nav_depth(card_id)` = `0` if on the home grid, else `buried.get(card_id, 2)`.
- `neighbours(pos, day_index)` = home-grid cards within Chebyshev distance 1, excluding `pos` itself.

### `weighted_vocab()` — where the plants live

Starting weight `1.0`, then multiplicatively:

| Rule | Factor |
|---|---|
| `is_core(cid)` | `× 3.2` |
| `card.is_essential` | `× 2.4` |
| `maya_t` + `snack` | `× 22.0` |
| card in `never_combine` | `× 9.0` |
| card == `dead_word` | `w = 0.0` |
| card == `disliked[0]` and scene == `disliked[1]` | `w = 0.0` |
| card == `scene_bound[0]` | `14.0` in the bound scene, `0.0` elsewhere |
| buried card (except Maya's `snack`) | `× 0.45 ** depth` |
| scene `home`/`community` and category in `food, drink, place` | `× 1.8` |
| scene `therapy` and core | `× 1.5` |
| scene `free_play` and category `play` | `× 2.5` |

Zero-weight cards are dropped from the candidate list. The disliked-item plant is scene-scoped deliberately: *"a global zero would look obsolete (I4 case A) rather than like a preference (I4 case B), and the two need opposite responses."*

`pick()` is a linear-scan weighted choice over the `(cid, weight)` list.

### `write_reference()` — reference rows

Writes, in order: `orgs` (`org_demo`, "Demo Primary School"), `classes` (`class_y3`, "Year 3 — Mrs Patel"), three `adults` (`adult_patel` teacher, `adult_slt` "J. Okonkwo (SLT)", `adult_parent_maya` parent), `emotion_lexicon`, `syntax_patterns`, `core_word_list`, `cards` (image path `/icons/<card_id>.png`, source `icon_pack`). `core_word_list` gets the 30 `CORE_WORDS` rows; to widen it to the full 200-word standard set, apply `db/seed_core_words.sql` by hand after the build (`sqlite3 aac.db < db/seed_core_words.sql`).

Per persona: `children`, two `roster` rows (`adult_patel` teacher, `adult_slt` slt), `consent` for tiers `aggregate` and `card_labels`. Only `maya_t` additionally gets `adult_parent_maya` on the roster and a `utterance_text` consent row — *"Parents hold the `utterance_text` tier that teachers do not — the tier difference is the point."*

Then `boards` (`board_<child_id>`, name "Robust board", kind `robust`, created_by `system`), `board_cells` for every filled grid cell, `child_vocabulary` for every available card with its `nav_depth`, and a mode board `mode_<child_id>_snack` (name "Snack time", kind `mode`, created_by `ai`) whose contents are written to `mode_selection` as `highlight` rows for `want, more, no, finished, water, please` — **no `board_cells` rows**. *"A 'mode' is a FILTERED VIEW of the robust board — it holds no positions of its own. Constraint C4."*

### `generate_child()` — per-day loop

1. `rng = random.Random(p.seed)` — one PRNG per child.
2. If `layout_change_day` is set, append one `board_revisions` row at `08:30` on `start + layout_change_day` with `change_kind = 'move'`, `changed_by = 'adult_patel'`, rationale *"Moved 'water' into easier reach and swapped 'more' down"*, and `driven_by = 'I3'`.
3. For each `day_index in range(days)`: skip entirely if `silence_from_day` is reached; pick `n = rng.randint(*utterances_per_school_day)`, scaled by `weekend_activity` on Sat/Sun (`max(1, …)`) and by the improving ramp if set.
4. One `session_id` per child-day; scene/hour drawn per utterance from `SCHOOL_SCENES` or `WEEKEND_SCENES`; `minutes_into_session = (i / n) * 45`.
5. `generate_modeling()` then `generate_partner_turns()`, then a `session_start` event at `08:00`.

### `generate_utterance()`

- **62 %** of utterances are preceded by a partner turn (`rng.random() < 0.62`) with `lead` 1200–9000 ms and `dur` 1200–4200 ms. Header comment: *"Emitting partner turns at random times made only 1% of utterances pair with one, so 'answers vs starts' read as 99% self-started — a measurement artifact, not a finding."*
- Symbol target: `max(1, min(6, int(rng.gauss(mean_symbols, 0.7) + 0.5)))`.
- Fatigue: `fatigue = 1.0 + 0.9 * (minutes_into_session / 45.0)`, so `mistap_p = base_mistap_rate * fatigue`. After `layout_change_day`, `mistap_p *= 2.3` — *"the I8 plant: our advice made it worse."*
- A card in a `dead_rows` row gets `effective_p = mistap_p * 5.5`.
- An unintended press emits a `card_tap` on the wrong card **plus** a `delete_last` `250–1300 ms` later (`ms_delta` = that gap). Motor slips choose a `neighbours()` card; semantic slips (`rng.random() < semantic_error_share`) choose from cards more than one cell away. This delete requirement is constraint **C1** in the data: a mis-tap only exists where a delete follows.
- Repetition: `rng.random() < 0.11` for `maya_t`, `0.05` otherwise → `repeats = rng.randint(3, 5)` consecutive taps of the same card **with no delete**. *"Repeated pressing — NOT an error. Exploration, stimming, or a word she does not have. Constraint C1: never logged as a mistake."*
- Inter-symbol delay: `rng.randint(2000, 6500)` ms. Header: *"500-2600ms between symbols implied ~27 words per minute, which no AAC user achieves and which a speech therapist would flag on sight. Direct selection with a motor impairment runs 2-6 seconds per symbol."*
- Outcome: `abandon` event (`payload {"reason":"timeout","ms_alive":ms_compose}`) at `ts + 4000` if `rng.random() < abandon_rate`, otherwise a `speak` event at `ts + 300` with `payload {"symbol_count": len(chosen)}`.
- Structures: the part-of-speech sequence of the chosen cards is joined with spaces and each `SYNTAX_PATTERNS` sequence is tested with `in`. Only matches are recorded — *"Nothing is recorded for what is absent — a missing determiner is not a fact about the child when the board has no determiner card."* Abandoned utterances record no structures.
- `word_count`: for a single-card utterance it is the word count of that card's `spoken_text`; for multi-card it is the summed word count of the **labels**. Header: *"Summing each card's standalone sentence counted 'I want water.' as three words for a single tap and inflated every rate built on it."*
- `used_suggestion = rng.random() < suggestion_accept * 0.4`; when true the first tap's `source` is `"suggestion"`.

### `generate_modeling()` and `generate_partner_turns()`

- Modeling emits `rng.randint(*modeling_per_day)` `card_tap` events with `actor='adult'`, scene `classroom`, between 09:00 and 14:59 — aided language input, which is what I7 measures the absence of.
- `generate_partner_turns()` emits `rng.randint(3, 9)` **unanswered** turns per day (the answered ones are emitted inside `generate_utterance`). An interruption references a real `utterance_id` drawn from that day's list — *"a synthetic id would pass generation and fail every join downstream."* Note `responded` is hardcoded `False` in this function, so `wait_ms` is always populated and `responded`/`response_ms` are always `0`/`NULL` here.

### `materialise_sessions()` — sittings, not days

Runs inside `flush()` after the bulk inserts. From the docstring: *"One row per SITTING, split on idle gaps — not one row per day. The first version grouped by the generator's `session_id`, which is issued per day, and produced 10-hour 'sessions'. That is a day wearing a session label, and it destroys the only reason to have the grain: a bad day is very often one bad sitting."*

1. A window function marks a new sitting whenever `ts - LAG(ts) > IDLE_GAP_MS` (20 min) over `PARTITION BY child_id ORDER BY ts`, restricted to `actor='child'` and `type IN ('card_tap','delete_last','speak','abandon')`.
2. A running `SUM(starts_session)` gives `sid`; `session_id` is written as `child_id || '_s' || sid`. Scene is the modal scene of the sitting. `HAVING SUM(card_tap) >= 3` drops trivial sittings.
3. A second `UPDATE` fills `taps`, `mistaps` (`type='delete_last' AND ms_delta < 1500`), `utterances` (`spoken = 1`) and `abandoned` (`spoken = 0`) by joining on the **time range**, because the derived sittings share no key with the source rows.
4. A third `UPDATE` computes `fatigue_ratio` = mis-tap rate in the last third of the sitting (`frac >= 0.67`) divided by the first third (`frac < 0.33`), rounded to 2 dp, only `WHERE minutes >= 10 AND taps >= 20`. *"Above ~1.5 points at tiredness, not at the layout — and the answer is a break, not a board change."*

`flush()` also uses `INSERT OR IGNORE` for `utterance_structures` — *"one row per (utterance, pattern), and a pattern can match twice in a long utterance."*

## Dependencies & Connections

### Depends On
- [Analytics Schema and Indices](../database/schema.md) — executes `db/schema.sql`, `db/indices.sql`, `db/seed_catalogues.sql` and writes into 20+ of its tables
- [Deterministic Build Pipeline](build-pipeline.md) — stage 3/7 is the normal way this runs

### Depended On By
- [L2 Rollup](l2-rollup.md) — every `agg_*` row is derived from these events
- [Nightly Rule Materialisation](rule-materialisation.md) — the insight views read these events and utterances
- [Clinical Safety Verification Gate](verification-gate.md) — imports `tools.seed.personas.EXPECTED_FIRING` and asserts the database agrees with what each persona declares it plants
- [Pre-Demo Test Harnesses](test-harnesses.md) — `concurrency_test.py` writes synthetic `maya_t` events shaped like these; `test-api.sh` asserts five children exist
- [CSV Export](csv-export.md), [Generated Artefacts](generated-artefacts.md) — export and fixture content
- Dashboard and MCP reads — the demo cohort is the only data these ever see

### Shared Resources
- `aac.db` — deleted and recreated by `main()`
- `EXPECTED_FIRING` is a public contract consumed by `tools/verify.py`
- Child ids `maya_t`, `jonah_k`, `amara_o`, `liam_w`, `sofia_r` and `class_y3` / `adult_patel` are hardcoded in `tools/gen_fixtures.py`, `tools/concurrency_test.py`, `tools/verify.py` (`CONTROL_CHILD = "amara_o"`) and `tools/test-api.sh`

## Change Risks
- **Changing a persona's `seed` rewrites that child's entire history.** The per-child PRNG exists so this does *not* happen when other children change; sharing one PRNG across children would make adding a sixth child shift everyone's data and invalidate every screenshot and fixture.
- **Weakening a plant breaks the verification gate, not just a chart.** Lowering Maya's `snack` weight below the I3 threshold, raising Liam's `mean_symbols` above the I5 threshold, or giving Sofia any modelling makes `verify.py` fail with *"persona declares this plant but the rule did not fire"*.
- **Planting anything on `amara_o` fails the RESTRAINT check** in `verify.py` — the control child must trigger no `intervention`-kind insight.
- **Adding an insight without a plant fails at import time.** `personas.py` asserts `UNCOVERED` is empty, so `import tools.seed.personas` raises — which also takes down `verify.py`'s coverage section.
- **Removing the delete after a wrong tap silently deletes the mis-tap signal.** `mistap_rate`, I1's classifier, `agg_card_stats.mistaps`, `agg_cell_heat.mistaps` and `sessions.fatigue_ratio` all key off `delete_last` with `ms_delta < 1500`.
- **Emitting repeats with a delete would violate C1** — repetition would become an error everywhere downstream, exactly the harm the constraint document forbids.
- **Writing `board_cells` rows for a mode board fails the C4 check** in `verify.py` (`no board_cells rows belong to a mode`) and breaks the architectural invariant that a mode is a lens over the robust board.
- **Changing `IDLE_GAP_MS`** re-cuts every sitting; `sessions.session_id` (`child_id || '_s' || sid`) is positional, so all session ids change and any stored reference to one goes stale.
- **`uid()` is not seeded.** Row ids (`ev_*`, `utt_*`, `sess_*`, `pt_*`, `rev_*`) differ between runs even though the *behaviour* is deterministic, so the header's "byte-identical output" claim holds for the generated behaviour, not for the id columns. Anything that diffs the database file or pins an `event_id` will see churn.
- **`--end` defaults to `2026-08-07`.** Every window view (`v_window`) is anchored to `MAX(day_local)`, so changing it moves all windows; leaving it fixed means the seeded data ages relative to wall-clock time.
