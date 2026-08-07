# Analytics Schema and Indices

## Function
Defines the entire `aac.db` SQLite database — 31 STRICT tables spanning people/access, vocabulary and boards, the three-layer event pipeline (L0 events → L1 utterances → L2 aggregates), the LLM-facing catalogues, the fired-rule/insight split, sessions, feeling words, sentence shapes and reports — plus the 33 indices that keep every metric view under the 50 ms budget.

## Purpose
This is the single physical data model shared by the Next.js API, the dashboard, the Python pipeline and the read-only MCP server. `db/schema.sql` is itself exposed to the local Gemma model as MCP resource `schema://ddl`, so its comments are not incidental documentation — they are the model's only description of what each column means. The header states this plainly: *"THIS FILE IS EXPOSED TO THE LLM as MCP resource `schema://ddl`. The comments are documentation the model relies on. Keep them accurate."*

The layering exists for a token budget, not for tidiness. `events` runs ~1,800 rows per child per week ≈ 90k tokens and is **never sent to the LLM**. `utterances` is ~250 rows per child per week ≈ 7k tokens — safe for one child over a short window. The L2 aggregates are ~1.2k tokens per child-week and are what the LLM reads by default.

Several tables and columns exist only because of the binding clinical constraints in [aac-clinical-constraints.md](../../aac-clinical-constraints.md):

- **C1** (repetition is communication, not error) — `agg_card_stats.repeat_runs` is defined as runs with **no delete**, and carries the comment "NOT an error."
- **C2** (motor plans depend on stable positions) — `board_cells.masked` implements Progressive Language; `board_revisions` records *every* layout change forever so I8 can measure the harm of our own advice.
- **C3** (never relocate a learned button) — `board_cells` allows one `card_id` at several positions, exactly one flagged `canonical`.
- **C4** (topic boards must not replace a robust board) — `boards.kind ∈ {robust, mode}`, and modes hold **no coordinates at all**; `mode_selection` only references cards.
- **C5** — `core_word_list` makes core/fringe a join, not a judgement.
- **C6** — the eight communication functions are a closed enum on `cards.default_function` and `utterances.function`.
- **C7** — `partner_turns` measures the adult, so a slow child latency can be attributed correctly.
- **C8** — `events.type` includes `keyboard_input` and `events.source` includes `keyboard`, so the schema anticipates alphabet access even though the product has none.

## Source Files
| File | Role |
|------|------|
| `db/schema.sql` | All 31 table definitions, PRAGMAs, CHECK enums, and the `schema_version` row |
| `db/indices.sql` | 33 indices (11 of them partial) plus `ANALYZE` |

## Implementation

### Applying
```bash
sqlite3 aac.db < db/schema.sql
sqlite3 aac.db < db/indices.sql
```
`tools/build.sh` runs both as step **1/7 "schema + indices"** after `rm -f "$DB" "$DB-wal" "$DB-shm"`.

Requires **SQLite >= 3.37** (STRICT tables). Every table in the file is `STRICT`.

### PRAGMAs set by schema.sql
| PRAGMA | Value | Reason given in the file |
|---|---|---|
| `journal_mode` | `WAL` | "REQUIRED: API server writes while MCP server reads" |
| `foreign_keys` | `ON` | |
| `busy_timeout` | `5000` (ms) | |

`journal_mode` is persistent in the file; `foreign_keys` and `busy_timeout` are per-connection and are re-set by each consumer (see [connection-layer.md](connection-layer.md)).

### Table inventory (31 tables)

**Meta** — `schema_version (version, applied_at, note)`. The file ends by inserting `version = 2`, `applied_at = strftime('%s','now') * 1000`, note `'v2 — sessions, feeling words, sentence shapes, reports; 8-metric report set'`. There is no migration runner; the row is descriptive only.

**People and access**
- `orgs (org_id, name)`
- `classes (class_id, org_id → orgs, name)`
- `children (child_id, org_id, class_id, display_name, year_group, profile_note, robust_board_id, created_at)` — `display_name` is "a first name + initial; no full names"; `profile_note` is e.g. `'CP / dysarthria'`, "Never a medical record."
- `adults (adult_id, org_id, display_name, role)` — `role ∈ ('teacher','parent','slt','admin')`
- `roster (child_id, adult_id, relation, granted_at, expires_at)` PK `(child_id, adult_id, relation)` — `relation ∈ ('teacher','parent','slt')`; `expires_at` NULL = no expiry (parents). "Access EXPIRES — teacher rights end with the term."
- `consent (child_id, tier, granted_by, granted_at, revoked_at)` PK `(child_id, tier, granted_at)` — `tier ∈ ('aggregate','card_labels','utterance_text','partner_speech')`. Header note: *"`utterance_text` lives in a SEPARATE database file (aac_text.db) that the MCP server never attaches."*

**Vocabulary and boards**
- `cards (card_id, label, spoken_text, category, default_function, is_core, is_essential, part_of_speech, image_path, image_source, visual_concept, created_at)`
  - `default_function ∈ ('request','protest','comment','direct','ask_question','give_opinion','share_news','start_conversation')` — AssistiveWare's taxonomy (C6)
  - `is_core`, `is_essential ∈ (0,1)`; `is_essential` covers yes/no/stop/help/toilet/pain
  - `part_of_speech ∈ ('pronoun','verb','noun','adjective','adverb','preposition','determiner','phrase','interjection')` — "NOT used to mark anything wrong: telegraphic AAC output is taught"
  - `image_source ∈ ('icon_pack','uploaded','photo','generated')`
- `core_word_list (word, lang DEFAULT 'en', rank, word_class)` PK `(word, lang)` — ~200-word standard core set, `rank` 1 = most frequent
- `boards (board_id, child_id, name, kind, grid_rows, grid_cols, source, created_at)` — `kind ∈ ('robust','mode')`, `source ∈ ('system','ai','manual')`
- `board_cells (board_id, grid_row, grid_col, card_id, canonical, masked, nav_depth)` PK `(board_id, grid_row, grid_col)` — positions live **only** on robust boards; `nav_depth = 0` is the home grid
- `child_vocabulary (child_id, card_id, nav_depth, added_at)` PK `(child_id, card_id)` — every card in the child's system including folder-only cards. "Without this, 'unused vocabulary' cannot tell a card the child never touched from a card that was never on their board in the first place."
- `mode_selection (board_id, card_id, emphasis, rank)` PK `(board_id, card_id)` — `emphasis ∈ ('highlight','dim','mask')`. **No coordinates, by design (C4).**
- `board_revisions (revision_id, board_id, changed_at, day_local, change_kind, card_id, from_row, from_col, to_row, to_col, old_rows, old_cols, new_rows, new_cols, actor_id, reason, suggested_by_insight)` — `change_kind ∈ ('add','add_copy','remove','move','mask','unmask','resize','reorder')`. `suggested_by_insight` "traces a change back to our own advice."

**L0 — events (append-only)**
`events (event_id, child_id, ts, day_local, tz_offset_min, session_id, scene, actor, type, utterance_id, board_id, card_id, label, grid_row, grid_col, grid_rows, grid_cols, nav_depth, source, ms_delta, payload)`
- `ts` is epoch ms UTC; `day_local` is `'YYYY-MM-DD'` **written by the client, never computed in SQL** — "SQLite has no timezone database; every day-boundary bug in analytics comes from computing this here."
- `scene ∈ ('therapy','classroom','free_play','home','community','unknown')`
- `actor ∈ ('child','adult')` — "Adult events are EXCLUDED from every child metric except `teacher_modeling`."
- `type ∈ ('card_tap','speak','delete_last','abandon','board_switch','scene_change','listen','suggestion_shown','suggestion_tap','gap_detected','card_created','keyboard_input','session_start','session_end')` (14 values)
- `source ∈ ('board','suggestion','essential','recent','search','keyboard')`
- `label` is denormalised on purpose: "labels get edited, history must not change"
- Five columns are marked ★ **unbackfillable**: `grid_row`, `grid_col`, `grid_rows`, `grid_cols`, `nav_depth` — grid dims are recorded *at the time of the tap*
- `ms_delta` = ms since the previous tap in this utterance, or for `delete_last`, ms since the tap it removed
- `payload` is JSON1 for the event-type-specific remainder

**L1 — utterances**
`utterances (utterance_id, child_id, ts, day_local, session_id, scene, actor, board_id, card_ids, labels, symbol_count, word_count, tap_count, delete_count, ms_compose, ms_to_first_tap, used_suggestion, was_expanded, spoken, abandon_reason, function, function_source)`
- `card_ids` and `labels` are parallel JSON arrays in tap order
- `word_count` is "of the SPOKEN text, not the symbol count"; `tap_count` "includes taps later deleted"
- `spoken ∈ (0,1)` — 0 = abandoned; `abandon_reason ∈ ('cleared','timeout','navigated_away','session_end')`
- `function` is the same 8-value enum as `cards.default_function`; `function_source ∈ ('card','llm','manual')`

`partner_turns (turn_id, child_id, ts, day_local, session_id, scene, ms_duration, source, ms_to_next_partner_turn, child_responded, ms_to_child_start, interrupted_utterance_id)` — `source ∈ ('stt','manual')`. "Small values [of `ms_to_next_partner_turn`] = the adult filled the silence instead of waiting."

**L2 — aggregates** (nightly rollup; the views UNION live "today" from L1)
- `agg_daily_metric (child_id, day_local, metric_id → metrics_catalog, value, n)` — `value` is NULL when `n < metrics_catalog.min_n`; "`n` — sample size BEHIND the value. Always read this."
- `agg_card_stats (child_id, card_id, window_start, window_end, taps, mistaps, adjacent_corrections, repeat_runs, zero_days, last_used_day, scenes_used)` — `repeat_runs` = "runs of >=3 consecutive taps, NO delete. NOT an error. See C1."
- `agg_cell_heat (child_id, board_id, grid_rows, grid_cols, grid_row, grid_col, window_start, window_end, taps, mistaps)` — grid dims are **part of the primary key**: "never merge different grid sizes"
- `agg_word_pairs (child_id, word_a, word_b, window_start, window_end, solo_a, solo_b, together)` — `word_a` is lexicographically first so `(a,b)` is stored once; "Only pairs where BOTH words have >= 10 solo uses, or this fills with noise."

**Catalogues** — `metrics_catalog` and `insights_catalog`. Column-level detail lives in [catalogues.md](catalogues.md). Structurally: `metrics_catalog.polarity ∈ ('higher_better','lower_better','neutral')`, `tier ∈ ('P0','P1','P2')`, `status ∈ ('shown','logged','cut')`, `min_n INTEGER NOT NULL DEFAULT 1`, `feeds_insights TEXT NOT NULL DEFAULT '[]'`. `insights_catalog.target_audience ∈ ('child','adult','system')`, `action_kind ∈ ('intervention','informational','system_fix')`, `forbidden_actions TEXT NOT NULL DEFAULT '[]'`.

**Rule firing vs model narration — deliberately two tables**
- `fired_rules (fired_rule_id, child_id, insight_id → insights_catalog, fired_at, window_start, window_end, evidence, thresholds_used, classification, superseded_by → fired_rules, dismissed_at, dismissed_by → adults, dismiss_reason)` — produced by plain SQL, nightly. `classification` is **I1 only**, JSON `{motor_share, semantic_share, ambiguous}`, NULL for every other rule. `dismiss_reason ∈ ('not_accurate','already_known','not_actionable','disagree_with_advice','other')`.
- `insights (insight_event_id, fired_rule_id → fired_rules **REQUIRED**, child_id, written_at, model, narration, confidence, actions_suggested)` — `narration` is documented as `<=500 chars` (a comment, **not** a CHECK constraint); `confidence` is `0..1` (also uncheck­ed); `actions_suggested` is "Rejected at write time if it contains any term from the rule's `insights_catalog.forbidden_actions`. Enforced in the tool handler."

  The rationale, verbatim: *"Keeping them apart is what makes the dashboard auditable: you can always ask 'what number caused this?' and get an answer that is not a model's opinion."*

- `board_change_proposals (proposal_id, child_id, board_id, fired_rule_id, proposed_at, proposed_by, change_kind, card_id, to_row, to_col, rationale, status, decided_at, decided_by, applied_revision_id)` — `change_kind ∈ ('add','add_copy','mask','unmask')`; **`'move'` and `'resize'` are not permitted here** (C2/C3). `status ∈ ('pending','approved','rejected','applied')` DEFAULT `'pending'`. "A model may propose a layout change; it may never apply one."

**Sessions** — `sessions (session_id, child_id, day_local, started_at, ended_at, minutes, scene, end_reason, utterances, taps, mistaps, abandoned, new_words, fatigue_ratio)`. `end_reason ∈ ('normal','idle_timeout','crash','battery','force_quit')`. `fatigue_ratio` is "Mis-tap rate in the last third of the session over the first third. Above ~1.5 suggests fatigue rather than a layout problem." The header explains the table's existence: "Teachers think in sessions… and a bad DAY is very often one bad session."

**Feeling words** — `emotion_lexicon (word, lang DEFAULT 'en', category)` PK `(word, lang)`, `category ∈ ('positive','neutral','upset')`. "Counting which feeling words a child USED — never inferring an emotional state."

**Sentence shapes** — `syntax_patterns (pattern_id, name, pos_sequence, example, stage DEFAULT 1)` where `pos_sequence` is space-separated, e.g. `'verb noun'`; `utterance_structures (utterance_id, pattern_id)` PK on both. "Deliberately not 'errors': 'want biscuit' is correct, efficient AAC use, not a missing determiner."

**Reports** — `reports (report_id, child_id, period_start, period_end, generated_at, model, summary, guidance, metric_snapshot, metrics_used DEFAULT '[]')`. `metric_snapshot` is "JSON: the 8 values, frozen at generation" — frozen so a chat conversation about a report cannot drift out of step with the prose above it. `metrics_used` "enforces the docx rule that the model may cite only the canonical eight — checkable after the fact, not merely asked for in a prompt."

### Known schema gaps, as written in the file
- **`children.robust_board_id` has no foreign key.** The column is declared `TEXT` with a comment "FK added after boards exists". A trailing section states: *"SQLite cannot ALTER a column to add a FK; enforce in the API layer. Documented here so the LLM knows the relationship exists."* Nothing in `db/` enforces it.
- **`agg_daily_metric.metric_id REFERENCES metrics_catalog(metric_id)` is a forward reference** — `metrics_catalog` is created ~60 lines later in the same file. SQLite only resolves FK parents at DML time, so this is legal, but it means the table cannot be created standalone without `metrics_catalog` also existing before any insert.
- **`insights.narration <= 500 chars` and `confidence 0..1` are comments, not CHECK constraints.**
- The `metrics_catalog.group_code` comment lists groups **A–G** only ("A effort · B errors · C vocabulary · D layout · E voice · F ai_value · G partner"). `db/seed_catalogues.sql` also seeds **group H — communication style** (`repeat_tap_rate`, `keyboard_use`, `feeling_words`). There is no CHECK on `group_code`, so the rows insert fine; the schema comment is simply out of date.

### Indices (db/indices.sql)

Sizing assumption stated in the header: **5 children × 6 weeks ≈ 180k events, ~7.5k utterances. Target: no metric view takes > 50 ms on that volume.** 33 indices total; 11 are partial.

**`events`** — "the only table large enough for index choice to matter"
| Index | Columns | Partial predicate | Serves |
|---|---|---|---|
| `ix_events_child_ts` | `(child_id, ts)` | — | "The workhorse. Nearly every query is 'this child, this date range'." |
| `ix_events_child_type_day` | `(child_id, type, day_local)` | — | metric views that filter by `type` first |
| `ix_events_utterance` | `(utterance_id, ts)` | `utterance_id IS NOT NULL` | utterance reconstruction and adjacency |
| `ix_events_child_card_ts` | `(child_id, card_id, ts)` | `card_id IS NOT NULL` | `card_frequency`, `zero_activation_days`, repeat-tap runs |
| `ix_events_heat` | `(child_id, board_id, grid_rows, grid_cols, grid_row, grid_col)` | `type = 'card_tap'` | cell heat; grid dims included "so different grid sizes never merge" |
| `ix_events_child_scene_day` | `(child_id, scene, day_local)` | — | scene comparisons (I4B dislike vs I6 generalisation) |
| `ix_events_adult` | `(child_id, day_local, type)` | `actor = 'adult'` | `teacher_modeling` (E2) |
| `ix_events_navdepth` | `(child_id, card_id, nav_depth)` | `type = 'card_tap' AND nav_depth IS NOT NULL` | I3 buried word |

**`utterances`** — `ix_utt_child_day (child_id, day_local)`; `ix_utt_child_spoken_ts (child_id, spoken, ts)` for `silence_streak`; `ix_utt_child_scene_function (child_id, scene, function)` for the I6 cross-tab; `ix_utt_child_suggestion (child_id, used_suggestion, day_local)` for `taps_saved`.

**`partner_turns`** — `ix_partner_child_day (child_id, day_local)`; `ix_partner_interruptions (child_id, interrupted_utterance_id)` partial on `interrupted_utterance_id IS NOT NULL`.

**Boards and revisions** — `ix_board_cells_card (card_id, canonical)`; `ix_child_vocab_depth (child_id, nav_depth)`; `ix_boards_child_kind (child_id, kind)`; `ix_revisions_board_day (board_id, day_local)`; `ix_revisions_disruptive (board_id, changed_at)` partial on `change_kind IN ('move','resize','remove')` — "I8: was there a layout change, and did errors rise after it?"

**Aggregates** ("small tables, but these are the LLM's hot path") — `ix_agg_daily_metric_lookup (metric_id, day_local, child_id)`; `ix_agg_card_stats_window (child_id, window_end, taps)`; `ix_agg_word_pairs_missing (child_id, window_end, together)`.

**Access control** ("hit on every single query, so keep them tight") — `ix_roster_adult (adult_id, relation)`; `ix_consent_active (child_id, tier)` partial on `revoked_at IS NULL`; `ix_children_class (class_id)`.

**Feedback loop** — `ix_fired_rules_open (child_id, insight_id, fired_at)` partial on `dismissed_at IS NULL AND superseded_by IS NULL` (open findings); `ix_fired_rules_dismissed (child_id, insight_id, dismissed_at)` partial on `dismissed_at IS NOT NULL` — "'Has this been raised and rejected before?' — checked before re-raising"; `ix_insights_by_rule (fired_rule_id)`; `ix_proposals_pending (child_id, status)` partial on `status = 'pending'`.

**`ANALYZE;`** runs at this point — **before** the four v2 indices below it. Those four (`ix_sessions_child_day`, `ix_sessions_worst (child_id, mistaps DESC)`, `ix_utt_structures_pattern (pattern_id)`, `ix_reports_child_period (child_id, period_end DESC)`) therefore get no statistics from this file. In practice `tools/rollup.py` re-runs `ANALYZE` at build step 5/7, which populates them.

### Verified against the built database
`sqlite3 aac.db` on the committed build reports **31 tables, 33 `ix_*` indices, 53 views**.

## Dependencies & Connections

### Depends On
- Nothing. `db/schema.sql` is the root of the build; every other artefact is applied on top of it.

### Depended On By
- [Metric and Insight Catalogues](catalogues.md) — seeds `metrics_catalog` and `insights_catalog`, and `ALTER TABLE`s three columns onto `metrics_catalog`
- [Metric Views](metric-views.md) — every view reads these tables
- [Insight Rule Views](insight-views.md) — I1–I8 read `events`, `utterances`, `partner_turns`, `board_revisions`, `boards`, `cards`, `children`
- [Connection Layer](connection-layer.md) — opens the file, mirrors `busy_timeout = 5000` and `foreign_keys = ON`
- [../pipeline/build-pipeline.md](../pipeline/build-pipeline.md) — `tools/build.sh` applies both files as step 1/7
- [../pipeline/l2-rollup.md](../pipeline/l2-rollup.md) — writes `agg_daily_metric`, `agg_card_stats`, `agg_cell_heat`, `agg_word_pairs`
- [../pipeline/rule-materialisation.md](../pipeline/rule-materialisation.md) — writes `fired_rules`
- [../api/event-ingest.md](../api/event-ingest.md) — `lib/ingest.ts` writes `events`; its header notes it validates ahead of SQLite because "`events` is a STRICT table with CHECK constraints on scene, actor, type and source"
- [../mcp/tool-surface.md](../mcp/tool-surface.md) — the file itself is served as MCP resource `schema://ddl`
- [../auth/role-consent-scoping.md](../auth/role-consent-scoping.md) — `roster` and `consent` are the access primitives

### Shared Resources
- The file `aac.db` (path from `AAC_DB`, default `<cwd>/aac.db`), opened WAL by the Next API (read + narrow write), the MCP server (read-only) and the Python pipeline (read/write) simultaneously.
- `aac_text.db` — a **separate** database holding `utterance_text`, deliberately never attached by the MCP server.
- `aac_app.db` — a separate application database for category folders (`lib/categories/store.ts`); its header says explicitly "`db/schema.sql` belongs to the analytics pipeline."

## Change Risks

- **Renaming or dropping a column changes what the LLM is told.** `db/schema.sql` is served verbatim as `schema://ddl`. A stale comment here becomes a wrong belief in every narration the model writes. The group-code comment (A–G, missing H) is an existing instance.
- **Adding a table without an index** breaks the stated 50 ms budget silently. Every metric view is unbounded over `events`; there is no query timeout anywhere in the stack.
- **Loosening `boards.kind` or giving `mode_selection` coordinates violates C4** and immediately makes `v_m_position_consistency` meaningful in the wrong direction — that view exists precisely to prove the invariant holds (see [metric-views.md](metric-views.md)).
- **Adding `'move'` or `'resize'` to `board_change_proposals.change_kind`** would let a model propose the one class of change C2/C3 forbid. The CHECK constraint is the enforcement, not the UI.
- **Dropping the `fired_rules` → `insights` FK** removes the only structural guarantee that no model prose reaches a teacher without SQL behind it.
- **Changing an enum** (`events.type`, `events.scene`, `cards.default_function`, …) breaks `lib/ingest.ts` validation, every `CASE WHEN` in `db/views_*.sql`, and the MCP tool schemas at once — STRICT tables mean a mismatch throws at insert rather than degrading.
- **Removing `grid_rows`/`grid_cols` from `agg_cell_heat`'s primary key** merges heat maps across grid sizes, which the file explicitly forbids ("the coordinates mean different things").
- **Re-ordering `metrics_catalog` columns** breaks `db/seed_catalogues.sql`, whose first five INSERT blocks use positional `VALUES` with no column list.
- **Adding an index without moving `ANALYZE`** leaves it unanalysed by `indices.sql`; the build only recovers because `tools/rollup.py` runs `ANALYZE` again later.
