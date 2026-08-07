-- ============================================================================
--  AAC ANALYTICS — SQLite schema
--  Implements docs/analytics-metrics.md, constrained by docs/aac-clinical-constraints.md
--
--  PLATFORM: web app only (no Android, no iOS). Browser client → Node API →
--  this SQLite file. A separate read-only MCP server process reads the same file.
--
--  THIS FILE IS EXPOSED TO THE LLM as MCP resource `schema://ddl`.
--  The comments are documentation the model relies on. Keep them accurate.
--
--  Requires SQLite >= 3.37 (STRICT tables).
--  Apply with:  sqlite3 aac.db < db/schema.sql
-- ============================================================================

PRAGMA journal_mode = WAL;        -- REQUIRED: API server writes while MCP server reads
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

-- ============================================================================
--  META
-- ============================================================================

CREATE TABLE IF NOT EXISTS schema_version (
  version     INTEGER NOT NULL,
  applied_at  INTEGER NOT NULL,          -- epoch ms
  note        TEXT
) STRICT;

-- ============================================================================
--  PEOPLE AND ACCESS
-- ============================================================================

CREATE TABLE IF NOT EXISTS orgs (
  org_id      TEXT PRIMARY KEY,
  name        TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS classes (
  class_id    TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES orgs(org_id),
  name        TEXT NOT NULL
) STRICT;

-- One row per AAC user. `display_name` is a first name + initial; no full names.
CREATE TABLE IF NOT EXISTS children (
  child_id       TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL REFERENCES orgs(org_id),
  class_id       TEXT REFERENCES classes(class_id),
  display_name   TEXT NOT NULL,
  year_group     TEXT,
  profile_note   TEXT,                   -- e.g. 'CP / dysarthria'. Never a medical record.
  robust_board_id TEXT,                  -- FK added after boards exists; the stable spine (see C4)
  created_at     INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS adults (
  adult_id     TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES orgs(org_id),
  display_name TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('teacher','parent','slt','admin'))
) STRICT;

-- Who may see which child. Access EXPIRES — teacher rights end with the term.
CREATE TABLE IF NOT EXISTS roster (
  child_id    TEXT NOT NULL REFERENCES children(child_id),
  adult_id    TEXT NOT NULL REFERENCES adults(adult_id),
  relation    TEXT NOT NULL CHECK (relation IN ('teacher','parent','slt')),
  granted_at  INTEGER NOT NULL,
  expires_at  INTEGER,                   -- NULL = no expiry (parents)
  PRIMARY KEY (child_id, adult_id, relation)
) STRICT;

-- Consent is per data tier. `utterance_text` lives in a SEPARATE database file
-- (aac_text.db) that the MCP server never attaches — see docs/aac-clinical-constraints.md.
CREATE TABLE IF NOT EXISTS consent (
  child_id    TEXT NOT NULL REFERENCES children(child_id),
  tier        TEXT NOT NULL CHECK (tier IN ('aggregate','card_labels','utterance_text','partner_speech')),
  granted_by  TEXT NOT NULL REFERENCES adults(adult_id),
  granted_at  INTEGER NOT NULL,
  revoked_at  INTEGER,
  PRIMARY KEY (child_id, tier, granted_at)
) STRICT;

-- ============================================================================
--  VOCABULARY AND BOARDS
--
--  C4 (clinical constraint): the ROBUST board is the stable spine. A "mode"
--  (Cafe, Doctor, …) is a FILTERED VIEW of the robust board, never a new board
--  with new positions. Modes therefore hold no independent coordinates — they
--  reference robust cells and mark them highlighted or masked.
-- ============================================================================

CREATE TABLE IF NOT EXISTS cards (
  card_id        TEXT PRIMARY KEY,
  label          TEXT NOT NULL,
  spoken_text    TEXT NOT NULL,
  category       TEXT,
  -- Communication function this card usually serves. Closed enum from
  -- AssistiveWare's taxonomy (C6). Utterances inherit it from the head card.
  default_function TEXT CHECK (default_function IN
    ('request','protest','comment','direct','ask_question','give_opinion','share_news','start_conversation')),
  is_core        INTEGER NOT NULL DEFAULT 0 CHECK (is_core IN (0,1)),      -- resolved against core_word_list
  is_essential   INTEGER NOT NULL DEFAULT 0 CHECK (is_essential IN (0,1)), -- yes/no/stop/help/toilet/pain
  -- Drives the "sentence shapes" metric. NOT used to mark anything wrong:
  -- telegraphic AAC output is taught, and a missing determiner is not an error
  -- when the board has no determiner card. See aac-clinical-constraints.md.
  part_of_speech TEXT CHECK (part_of_speech IN
    ('pronoun','verb','noun','adjective','adverb','preposition','determiner','phrase','interjection')),
  image_path     TEXT,
  image_source   TEXT CHECK (image_source IN ('icon_pack','uploaded','photo','generated')),
  visual_concept TEXT,
  created_at     INTEGER NOT NULL
) STRICT;

-- Standard ~200-word core vocabulary. Makes core/fringe a join, not a judgement (C5).
CREATE TABLE IF NOT EXISTS core_word_list (
  word        TEXT NOT NULL,
  lang        TEXT NOT NULL DEFAULT 'en',
  rank        INTEGER NOT NULL,          -- 1 = most frequent
  word_class  TEXT,                      -- verb | adjective | preposition | pronoun | ...
  PRIMARY KEY (word, lang)
) STRICT;

CREATE TABLE IF NOT EXISTS boards (
  board_id    TEXT PRIMARY KEY,
  child_id    TEXT NOT NULL REFERENCES children(child_id),
  name        TEXT NOT NULL,
  -- 'robust' = the persistent spine (exactly one per child, ~always available).
  -- 'mode'   = a situational lens over the robust board. Holds NO positions.
  kind        TEXT NOT NULL CHECK (kind IN ('robust','mode')),
  grid_rows   INTEGER NOT NULL,
  grid_cols   INTEGER NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('system','ai','manual')),
  created_at  INTEGER NOT NULL
) STRICT;

-- Positions live ONLY on robust boards. A card may appear at more than one
-- position (C3: add a copy, never relocate); exactly one is `canonical`.
CREATE TABLE IF NOT EXISTS board_cells (
  board_id    TEXT NOT NULL REFERENCES boards(board_id),
  grid_row    INTEGER NOT NULL,
  grid_col    INTEGER NOT NULL,
  card_id     TEXT NOT NULL REFERENCES cards(card_id),
  canonical   INTEGER NOT NULL DEFAULT 1 CHECK (canonical IN (0,1)),
  masked      INTEGER NOT NULL DEFAULT 0 CHECK (masked IN (0,1)),  -- Progressive Language (C2)
  nav_depth   INTEGER NOT NULL DEFAULT 0,   -- hops from the root page; 0 = home grid
  PRIMARY KEY (board_id, grid_row, grid_col)
) STRICT;

-- Every card in this child's system, including ones reachable only through
-- folders (nav_depth > 0) and therefore having no home-grid coordinates.
-- Without this, "unused vocabulary" cannot tell a card the child never touched
-- from a card that was never on their board in the first place.
CREATE TABLE IF NOT EXISTS child_vocabulary (
  child_id    TEXT NOT NULL REFERENCES children(child_id),
  card_id     TEXT NOT NULL REFERENCES cards(card_id),
  nav_depth   INTEGER NOT NULL DEFAULT 0,   -- 0 = on the home grid
  added_at    INTEGER NOT NULL,
  PRIMARY KEY (child_id, card_id)
) STRICT;

-- A mode selects cards from the robust board. No coordinates here, by design.
CREATE TABLE IF NOT EXISTS mode_selection (
  board_id    TEXT NOT NULL REFERENCES boards(board_id),   -- kind = 'mode'
  card_id     TEXT NOT NULL REFERENCES cards(card_id),
  emphasis    TEXT NOT NULL CHECK (emphasis IN ('highlight','dim','mask')),
  rank        INTEGER,
  PRIMARY KEY (board_id, card_id)
) STRICT;

-- Every layout change, forever. Without this, I8 cannot exist and every layout
-- recommendation the dashboard makes is unfalsifiable (C2).
CREATE TABLE IF NOT EXISTS board_revisions (
  revision_id TEXT PRIMARY KEY,
  board_id    TEXT NOT NULL REFERENCES boards(board_id),
  changed_at  INTEGER NOT NULL,
  day_local   TEXT NOT NULL,
  change_kind TEXT NOT NULL CHECK (change_kind IN
    ('add','add_copy','remove','move','mask','unmask','resize','reorder')),
  card_id     TEXT REFERENCES cards(card_id),
  from_row    INTEGER, from_col INTEGER,
  to_row      INTEGER, to_col   INTEGER,
  old_rows    INTEGER, old_cols INTEGER,   -- populated on 'resize'
  new_rows    INTEGER, new_cols INTEGER,
  actor_id    TEXT REFERENCES adults(adult_id),
  reason      TEXT,                        -- free text, or an insight_id if system-suggested
  suggested_by_insight TEXT                -- traces a change back to our own advice
) STRICT;

-- ============================================================================
--  L0 — EVENTS (append-only)
--
--  NEVER sent to the LLM directly. ~1,800 rows per child per week ≈ 90k tokens.
--  Hot columns are promoted for indexing; the long tail lives in `payload` JSON.
-- ============================================================================

CREATE TABLE IF NOT EXISTS events (
  event_id      TEXT PRIMARY KEY,
  child_id      TEXT NOT NULL REFERENCES children(child_id),
  ts            INTEGER NOT NULL,         -- epoch ms UTC
  -- Written by the client, never computed in SQL. SQLite has no timezone
  -- database; every day-boundary bug in analytics comes from computing this here.
  day_local     TEXT NOT NULL,            -- 'YYYY-MM-DD'
  tz_offset_min INTEGER NOT NULL,
  session_id    TEXT NOT NULL,
  scene         TEXT NOT NULL CHECK (scene IN
    ('therapy','classroom','free_play','home','community','unknown')),
  -- 'adult' = the grown-up is modelling on the device (aided language input).
  -- Adult events are EXCLUDED from every child metric except `teacher_modeling`.
  actor         TEXT NOT NULL CHECK (actor IN ('child','adult')),
  type          TEXT NOT NULL CHECK (type IN
    ('card_tap','speak','delete_last','abandon','board_switch','scene_change',
     'listen','suggestion_shown','suggestion_tap','gap_detected','card_created',
     'keyboard_input','session_start','session_end')),

  utterance_id  TEXT,                     -- groups taps into one sentence
  board_id      TEXT REFERENCES boards(board_id),
  card_id       TEXT REFERENCES cards(card_id),
  label         TEXT,                     -- DENORMALISED on purpose: labels get
                                          -- edited, history must not change
  grid_row      INTEGER,                  -- ★ unbackfillable
  grid_col      INTEGER,                  -- ★ unbackfillable
  grid_rows     INTEGER,                  -- ★ grid dims AT THE TIME OF THE TAP
  grid_cols     INTEGER,                  -- ★
  nav_depth     INTEGER,                  -- ★ hops to reach this card
  source        TEXT CHECK (source IN
    ('board','suggestion','essential','recent','search','keyboard')),
  ms_delta      INTEGER,                  -- ms since previous tap in this utterance,
                                          -- or (for delete_last) ms since the tap it removed
  payload       TEXT                      -- JSON1, event-type-specific remainder
) STRICT;

-- ============================================================================
--  L1 — UTTERANCES  (materialised on speak/abandon)
--
--  The natural analysis unit. ~250 rows per child per week ≈ 7k tokens.
--  Safe to hand the LLM for ONE child over a SHORT window; not for a class.
-- ============================================================================

CREATE TABLE IF NOT EXISTS utterances (
  utterance_id   TEXT PRIMARY KEY,
  child_id       TEXT NOT NULL REFERENCES children(child_id),
  ts             INTEGER NOT NULL,
  day_local      TEXT NOT NULL,
  session_id     TEXT NOT NULL,
  scene          TEXT NOT NULL,
  actor          TEXT NOT NULL CHECK (actor IN ('child','adult')),
  board_id       TEXT REFERENCES boards(board_id),
  card_ids       TEXT NOT NULL,           -- JSON array, in tap order
  labels         TEXT NOT NULL,           -- JSON array, parallel to card_ids
  symbol_count   INTEGER NOT NULL,
  word_count     INTEGER NOT NULL,        -- of the SPOKEN text, not the symbol count
  tap_count      INTEGER NOT NULL,        -- includes taps later deleted
  delete_count   INTEGER NOT NULL DEFAULT 0,
  ms_compose     INTEGER,                 -- first tap → Speak. NULL if abandoned.
  ms_to_first_tap INTEGER,                -- partner speech end → first tap. NULL if unprompted.
  used_suggestion INTEGER NOT NULL DEFAULT 0 CHECK (used_suggestion IN (0,1)),
  was_expanded   INTEGER NOT NULL DEFAULT 0 CHECK (was_expanded IN (0,1)),
  spoken         INTEGER NOT NULL CHECK (spoken IN (0,1)),   -- 0 = abandoned
  abandon_reason TEXT CHECK (abandon_reason IN
    ('cleared','timeout','navigated_away','session_end')),
  -- Communication function (C6). Inherited from the head card, or classified.
  function       TEXT CHECK (function IN
    ('request','protest','comment','direct','ask_question','give_opinion','share_news','start_conversation')),
  function_source TEXT CHECK (function_source IN ('card','llm','manual'))
) STRICT;

-- Partner speech segments (C7). Enables measuring whether the ADULT gave
-- processing time — a long child latency may be the partner's fault.
CREATE TABLE IF NOT EXISTS partner_turns (
  turn_id        TEXT PRIMARY KEY,
  child_id       TEXT NOT NULL REFERENCES children(child_id),
  ts             INTEGER NOT NULL,        -- start of partner speech
  day_local      TEXT NOT NULL,
  session_id     TEXT NOT NULL,
  scene          TEXT NOT NULL,
  ms_duration    INTEGER NOT NULL,
  source         TEXT NOT NULL CHECK (source IN ('stt','manual')),
  -- ms until the partner spoke AGAIN with no child response in between.
  -- Small values = the adult filled the silence instead of waiting.
  ms_to_next_partner_turn INTEGER,
  child_responded INTEGER NOT NULL DEFAULT 0 CHECK (child_responded IN (0,1)),
  ms_to_child_start INTEGER,
  -- Set when partner speech began while the child had an open utterance.
  interrupted_utterance_id TEXT REFERENCES utterances(utterance_id)
) STRICT;

-- ============================================================================
--  L2 — AGGREGATES  (nightly rollup; views UNION live "today" from L1)
--
--  This is what the LLM reads by default. ~1.2k tokens per child-week.
-- ============================================================================

CREATE TABLE IF NOT EXISTS agg_daily_metric (
  child_id    TEXT NOT NULL REFERENCES children(child_id),
  day_local   TEXT NOT NULL,
  metric_id   TEXT NOT NULL REFERENCES metrics_catalog(metric_id),
  value       REAL,                       -- NULL when n < metrics_catalog.min_n
  n           INTEGER NOT NULL,           -- sample size BEHIND the value. Always read this.
  PRIMARY KEY (child_id, day_local, metric_id)
) STRICT;

CREATE TABLE IF NOT EXISTS agg_card_stats (
  child_id     TEXT NOT NULL REFERENCES children(child_id),
  card_id      TEXT NOT NULL REFERENCES cards(card_id),
  window_start TEXT NOT NULL,             -- 'YYYY-MM-DD' inclusive
  window_end   TEXT NOT NULL,             -- inclusive
  taps         INTEGER NOT NULL DEFAULT 0,
  mistaps      INTEGER NOT NULL DEFAULT 0,   -- tap + delete within threshold
  adjacent_corrections INTEGER NOT NULL DEFAULT 0,
  repeat_runs  INTEGER NOT NULL DEFAULT 0,   -- runs of >=3 consecutive taps, NO delete.
                                             -- NOT an error. See C1.
  zero_days    INTEGER NOT NULL DEFAULT 0,
  last_used_day TEXT,
  scenes_used  TEXT NOT NULL DEFAULT '[]',   -- JSON array of scene values
  PRIMARY KEY (child_id, card_id, window_start, window_end)
) STRICT;

CREATE TABLE IF NOT EXISTS agg_cell_heat (
  child_id     TEXT NOT NULL REFERENCES children(child_id),
  board_id     TEXT NOT NULL REFERENCES boards(board_id),
  grid_rows    INTEGER NOT NULL,          -- part of the key: never merge different grid sizes
  grid_cols    INTEGER NOT NULL,
  grid_row     INTEGER NOT NULL,
  grid_col     INTEGER NOT NULL,
  window_start TEXT NOT NULL,
  window_end   TEXT NOT NULL,
  taps         INTEGER NOT NULL DEFAULT 0,
  mistaps      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (child_id, board_id, grid_rows, grid_cols, grid_row, grid_col, window_start, window_end)
) STRICT;

-- Only pairs where BOTH words have >= 10 solo uses, or this fills with noise.
CREATE TABLE IF NOT EXISTS agg_word_pairs (
  child_id     TEXT NOT NULL REFERENCES children(child_id),
  word_a       TEXT NOT NULL,             -- lexicographically first, so (a,b) is stored once
  word_b       TEXT NOT NULL,
  window_start TEXT NOT NULL,
  window_end   TEXT NOT NULL,
  solo_a       INTEGER NOT NULL,
  solo_b       INTEGER NOT NULL,
  together     INTEGER NOT NULL,
  PRIMARY KEY (child_id, word_a, word_b, window_start, window_end)
) STRICT;

-- ============================================================================
--  CATALOGUES — the LLM's data dictionary
--
--  Exposed as MCP resources `schema://dictionary` and `schema://insights`.
--  A number without its unit, polarity and caveat is how a model becomes
--  confidently wrong. These tables exist to prevent that.
-- ============================================================================

CREATE TABLE IF NOT EXISTS metrics_catalog (
  metric_id     TEXT PRIMARY KEY,         -- stable slug, e.g. 'taps_per_utterance'
  name          TEXT NOT NULL,
  group_code    TEXT NOT NULL,            -- A effort · B errors · C vocabulary
                                          -- D layout · E voice · F ai_value · G partner
  plain_explanation TEXT NOT NULL,        -- one sentence a teacher would understand
  formula       TEXT NOT NULL,            -- human-readable derivation
  unit          TEXT NOT NULL,            -- 'count' | 'ratio' | 'ms' | 'days' | 'wpm' | 'index'
  -- CRITICAL for the UI and for the LLM's tone. 'neutral' means the value must
  -- NEVER be styled or described as good or bad. Repetition and stimming are neutral.
  polarity      TEXT NOT NULL CHECK (polarity IN ('higher_better','lower_better','neutral')),
  tier          TEXT NOT NULL CHECK (tier IN ('P0','P1','P2')),
  audience      TEXT NOT NULL,            -- CSV of teacher,parent,slt
  -- Below this sample size the value is meaningless. agg_daily_metric.value is
  -- NULL when n < min_n. Do not infer from a NULL that nothing happened.
  min_n         INTEGER NOT NULL DEFAULT 1,
  feeds_insights TEXT NOT NULL DEFAULT '[]',  -- JSON array of insight_ids
  caveat        TEXT,                     -- how this metric misleads. Read it.
  status        TEXT NOT NULL CHECK (status IN ('shown','logged','cut')),
  cut_reason    TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS insights_catalog (
  insight_id        TEXT PRIMARY KEY,     -- 'I1' … 'I8'
  name              TEXT NOT NULL,
  plain_statement   TEXT NOT NULL,
  trigger_rule      TEXT NOT NULL,        -- human-readable rule
  input_metrics     TEXT NOT NULL,        -- JSON array of metric_ids
  default_thresholds TEXT NOT NULL,       -- JSON object; TUNE PER CHILD after 2 weeks
  recommended_actions TEXT NOT NULL,      -- JSON array
  -- Actions that must NEVER be recommended for this insight. Enforced here rather
  -- than left to whoever writes the UI string. See docs/aac-clinical-constraints.md.
  forbidden_actions TEXT NOT NULL DEFAULT '[]',
  target_audience   TEXT NOT NULL CHECK (target_audience IN ('child','adult','system')),
  action_kind       TEXT NOT NULL CHECK (action_kind IN ('intervention','informational','system_fix')),
  safety_note       TEXT
) STRICT;

-- ----------------------------------------------------------------------------
--  RULE FIRING vs MODEL NARRATION — deliberately two tables.
--
--  `fired_rules` is produced by plain SQL, nightly. Deterministic, explainable
--  to a speech therapist, reproducible. No model involved.
--
--  `insights` is produced by a model reading a fired rule and writing one
--  sentence a teacher will actually read. It CANNOT exist without a
--  fired_rule_id, so no model prose ever reaches a teacher without SQL behind it.
--
--  Keeping them apart is what makes the dashboard auditable: you can always ask
--  "what number caused this?" and get an answer that is not a model's opinion.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fired_rules (
  fired_rule_id  TEXT PRIMARY KEY,
  child_id       TEXT NOT NULL REFERENCES children(child_id),
  insight_id     TEXT NOT NULL REFERENCES insights_catalog(insight_id),
  fired_at       INTEGER NOT NULL,
  window_start   TEXT NOT NULL,
  window_end     TEXT NOT NULL,
  evidence       TEXT NOT NULL,           -- JSON: the exact rows and values that triggered it
  thresholds_used TEXT NOT NULL,          -- JSON: what the rule compared against, so a
                                          -- disagreement can be traced to a number
  -- I1 only: how the motor/semantic split resolved. NULL for every other rule.
  classification TEXT,                    -- JSON {motor_share, semantic_share, ambiguous}
  superseded_by  TEXT REFERENCES fired_rules(fired_rule_id),  -- a later run replacing this
  dismissed_at   INTEGER,
  dismissed_by   TEXT REFERENCES adults(adult_id),
  dismiss_reason TEXT CHECK (dismiss_reason IN
    ('not_accurate','already_known','not_actionable','disagree_with_advice','other'))
) STRICT;

CREATE TABLE IF NOT EXISTS insights (
  insight_event_id TEXT PRIMARY KEY,
  fired_rule_id  TEXT NOT NULL REFERENCES fired_rules(fired_rule_id),  -- REQUIRED
  child_id       TEXT NOT NULL REFERENCES children(child_id),
  written_at     INTEGER NOT NULL,
  model          TEXT NOT NULL,           -- e.g. 'gemma-3-4b'; which model said this
  narration      TEXT NOT NULL,           -- <=500 chars, shown to the adult
  confidence     REAL,                    -- 0..1
  -- Rejected at write time if it contains any term from the rule's
  -- insights_catalog.forbidden_actions. Enforced in the tool handler.
  actions_suggested TEXT NOT NULL DEFAULT '[]'
) STRICT;

-- A model may propose a layout change; it may never apply one. A human approves.
-- Proposals are checked against forbidden_actions before they are even stored.
CREATE TABLE IF NOT EXISTS board_change_proposals (
  proposal_id    TEXT PRIMARY KEY,
  child_id       TEXT NOT NULL REFERENCES children(child_id),
  board_id       TEXT NOT NULL REFERENCES boards(board_id),
  fired_rule_id  TEXT REFERENCES fired_rules(fired_rule_id),
  proposed_at    INTEGER NOT NULL,
  proposed_by    TEXT NOT NULL,           -- model name or adult_id
  -- 'move' and 'resize' are NOT permitted here. Motor planning (C2/C3).
  change_kind    TEXT NOT NULL CHECK (change_kind IN ('add','add_copy','mask','unmask')),
  card_id        TEXT REFERENCES cards(card_id),
  to_row         INTEGER, to_col INTEGER,
  rationale      TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','approved','rejected','applied')),
  decided_at     INTEGER,
  decided_by     TEXT REFERENCES adults(adult_id),
  applied_revision_id TEXT REFERENCES board_revisions(revision_id)
) STRICT;

-- ============================================================================
--  Deferred FK (children.robust_board_id → boards.board_id)
--  SQLite cannot ALTER a column to add a FK; enforce in the API layer.
--  Documented here so the LLM knows the relationship exists.
-- ============================================================================

-- ============================================================================
--  SESSIONS
--
--  A sitting at the device. Teachers think in sessions — "this morning's speech
--  session" — and a bad DAY is very often one bad session. It also carries the
--  within-session fatigue signal (unintended presses climbing after ~18 min)
--  that day-level aggregates flatten away.
--
--  session_id already existed on every event; this table gives it a home.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sessions (
  session_id   TEXT PRIMARY KEY,
  child_id     TEXT NOT NULL REFERENCES children(child_id),
  day_local    TEXT NOT NULL,
  started_at   INTEGER NOT NULL,
  ended_at     INTEGER,
  minutes      REAL,
  scene        TEXT NOT NULL,
  end_reason   TEXT CHECK (end_reason IN ('normal','idle_timeout','crash','battery','force_quit')),
  utterances   INTEGER NOT NULL DEFAULT 0,
  taps         INTEGER NOT NULL DEFAULT 0,
  mistaps      INTEGER NOT NULL DEFAULT 0,
  abandoned    INTEGER NOT NULL DEFAULT 0,
  new_words    INTEGER NOT NULL DEFAULT 0,
  -- Mis-tap rate in the last third of the session over the first third.
  -- Above ~1.5 suggests fatigue rather than a layout problem.
  fatigue_ratio REAL
) STRICT;

-- ============================================================================
--  FEELING WORDS  (proposed metric 5)
--
--  Pre-classified vocabulary, per proposed_metrics.docx. Counting which feeling
--  words a child USED — never inferring an emotional state. An AAC user can
--  only express feelings their board contains; with no "frustrated" card the
--  mix reads positive whatever the child feels. Every card that renders this
--  must show how many feeling words were available.
-- ============================================================================

CREATE TABLE IF NOT EXISTS emotion_lexicon (
  word      TEXT NOT NULL,
  lang      TEXT NOT NULL DEFAULT 'en',
  category  TEXT NOT NULL CHECK (category IN ('positive','neutral','upset')),
  PRIMARY KEY (word, lang)
) STRICT;

-- ============================================================================
--  SENTENCE SHAPES  (proposed metric 6)
--
--  Which grammatical structures are APPEARING. Deliberately not "errors":
--  "want biscuit" is correct, efficient AAC use, not a missing determiner.
--  Scoring omissions as mistakes would score the child for our own vocabulary
--  decisions. `stage` gives a rough developmental order so the dashboard can
--  show what is emerging next rather than what is absent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS syntax_patterns (
  pattern_id   TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  pos_sequence TEXT NOT NULL,       -- space-separated, e.g. 'verb noun'
  example      TEXT,
  stage        INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE TABLE IF NOT EXISTS utterance_structures (
  utterance_id TEXT NOT NULL REFERENCES utterances(utterance_id),
  pattern_id   TEXT NOT NULL REFERENCES syntax_patterns(pattern_id),
  PRIMARY KEY (utterance_id, pattern_id)
) STRICT;

-- ============================================================================
--  REPORTS
--
--  metric_snapshot is the point. The chat panel is a conversation ABOUT a
--  report, so the eight numbers are frozen into the row when it is generated.
--  Recomputing them live would let yesterday's conversation drift out of step
--  with today's data while the prose above it stayed unchanged.
--
--  `metrics_used` enforces the docx rule that the model may cite only the
--  canonical eight — checkable after the fact, not merely asked for in a prompt.
-- ============================================================================

CREATE TABLE IF NOT EXISTS reports (
  report_id       TEXT PRIMARY KEY,
  child_id        TEXT NOT NULL REFERENCES children(child_id),
  period_start    TEXT NOT NULL,
  period_end      TEXT NOT NULL,
  generated_at    INTEGER NOT NULL,
  model           TEXT,
  summary         TEXT NOT NULL,
  guidance        TEXT NOT NULL,
  metric_snapshot TEXT NOT NULL,    -- JSON: the 8 values, frozen at generation
  metrics_used    TEXT NOT NULL DEFAULT '[]'
) STRICT;

INSERT INTO schema_version (version, applied_at, note)
VALUES (2, CAST(strftime('%s','now') AS INTEGER) * 1000,
        'v2 — sessions, feeling words, sentence shapes, reports; 8-metric report set');
