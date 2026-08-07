-- ============================================================================
--  AAC ANALYTICS — metric views
--
--  These views ARE the definition of each metric. agg_daily_metric is only a
--  cache of `v_daily_metrics_all`; if the two ever disagree, the view is right.
--
--  Two shapes:
--    v_m_<slug>   scalar per (child_id, day_local)  -> value, n
--    v_<name>     dimensional (per card, per cell, per pair, per scene)
--
--  Child actor only, unless the metric is explicitly about the adult.
--  Apply after schema.sql:  sqlite3 aac.db < db/views_metrics.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
--  Shared: tap sequence with look-ahead.
--  One pass, used by the mis-tap, adjacency and repetition metrics. Correlated
--  subqueries were 40x slower on 27k events.
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS v_tap_sequence;
CREATE VIEW v_tap_sequence AS
SELECT
  e.child_id, e.day_local, e.utterance_id, e.ts, e.type,
  e.card_id, e.label, e.board_id,
  e.grid_row, e.grid_col, e.grid_rows, e.grid_cols, e.nav_depth, e.ms_delta,
  LEAD(e.type)     OVER w AS next_type,
  LEAD(e.grid_row) OVER w AS next_row,
  LEAD(e.grid_col) OVER w AS next_col,
  LAG(e.card_id, 1) OVER w AS prev1,
  LAG(e.card_id, 2) OVER w AS prev2,
  LAG(e.card_id, 3) OVER w AS prev3
FROM events e
WHERE e.actor = 'child' AND e.type IN ('card_tap','delete_last')
WINDOW w AS (PARTITION BY e.utterance_id ORDER BY e.ts);

-- Unintended activations: a tap deleted inside the threshold. REQUIRES a delete.
-- Repetition without a delete is never counted — clinical constraint C1.
--
-- The replacement is the next TAP in the utterance, found with a correlated
-- MIN(ts) rather than v_tap_sequence's LEAD: LEAD sees the next EVENT, and
-- when two deletes chain the "replacement" it compared against was the other
-- delete's coordinates — the catalogue defines adjacency against the button
-- the child actually pressed next. Deletes are ~5% of events and the lookup
-- runs on the (utterance_id, ts) index, so the 40x-correlated-subquery caveat
-- on v_tap_sequence does not bite here.
DROP VIEW IF EXISTS v_mistaps;
CREATE VIEW v_mistaps AS
WITH taps AS (
  SELECT utterance_id, ts, grid_row, grid_col
  FROM events WHERE actor = 'child' AND type = 'card_tap'
)
SELECT
  d.child_id, d.day_local, d.utterance_id, d.ts, d.card_id, d.label,
  d.grid_row, d.grid_col, d.grid_rows, d.grid_cols, d.board_id, d.ms_delta,
  t.grid_row AS next_row, t.grid_col AS next_col,
  CASE
    WHEN t.grid_row IS NULL OR d.grid_row IS NULL THEN NULL
    WHEN abs(t.grid_row - d.grid_row) <= 1 AND abs(t.grid_col - d.grid_col) <= 1 THEN 1
    ELSE 0
  END AS correction_adjacent
FROM events d
LEFT JOIN taps t
  ON t.utterance_id = d.utterance_id
 AND t.ts = (SELECT MIN(t2.ts) FROM taps t2
             WHERE t2.utterance_id = d.utterance_id AND t2.ts > d.ts)
WHERE d.actor = 'child' AND d.type = 'delete_last'
  AND d.ms_delta IS NOT NULL AND d.ms_delta < 1500;

-- ---------------------------------------------------------------------------
--  GROUP A — effort and speed
-- ---------------------------------------------------------------------------

-- SQLite has no median(). This is the standard two-middle-rows trick, and it is
-- worth the verbosity: one 12-tap struggle wrecks an average.
DROP VIEW IF EXISTS v_m_taps_per_utterance;
CREATE VIEW v_m_taps_per_utterance AS
WITH ranked AS (
  SELECT child_id, day_local, tap_count,
         ROW_NUMBER() OVER (PARTITION BY child_id, day_local ORDER BY tap_count) AS rn,
         COUNT(*)     OVER (PARTITION BY child_id, day_local) AS cnt
  FROM utterances WHERE actor = 'child'
)
SELECT child_id, day_local, AVG(tap_count) AS value, MAX(cnt) AS n
FROM ranked WHERE rn IN ((cnt + 1) / 2, (cnt + 2) / 2)
GROUP BY child_id, day_local;

DROP VIEW IF EXISTS v_m_composition_time;
CREATE VIEW v_m_composition_time AS
WITH ranked AS (
  SELECT child_id, day_local, ms_compose,
         ROW_NUMBER() OVER (PARTITION BY child_id, day_local ORDER BY ms_compose) AS rn,
         COUNT(*)     OVER (PARTITION BY child_id, day_local) AS cnt
  FROM utterances WHERE actor = 'child' AND spoken = 1 AND ms_compose IS NOT NULL
)
SELECT child_id, day_local, AVG(ms_compose) AS value, MAX(cnt) AS n
FROM ranked WHERE rn IN ((cnt + 1) / 2, (cnt + 2) / 2)
GROUP BY child_id, day_local;

DROP VIEW IF EXISTS v_m_time_to_first_tap;
CREATE VIEW v_m_time_to_first_tap AS
WITH ranked AS (
  SELECT child_id, day_local, ms_to_first_tap,
         ROW_NUMBER() OVER (PARTITION BY child_id, day_local ORDER BY ms_to_first_tap) AS rn,
         COUNT(*)     OVER (PARTITION BY child_id, day_local) AS cnt
  FROM utterances WHERE actor = 'child' AND ms_to_first_tap IS NOT NULL
)
SELECT child_id, day_local, AVG(ms_to_first_tap) AS value, MAX(cnt) AS n
FROM ranked WHERE rn IN ((cnt + 1) / 2, (cnt + 2) / 2)
GROUP BY child_id, day_local;

-- Production rate WHILE COMPOSING, which is what the AAC literature reports
-- (~15 wpm against 150-170 for speech). Not words-per-wall-clock-minute: a
-- child who says one thing an hour is not communicating at 0.1 wpm, they are
-- composing at their normal rate and speaking less often. Volume is
-- utterances_per_day; this is rate.
DROP VIEW IF EXISTS v_m_words_per_minute;
CREATE VIEW v_m_words_per_minute AS
SELECT child_id, day_local,
       SUM(word_count) * 60000.0 / NULLIF(SUM(ms_compose), 0) AS value,
       COUNT(*) AS n
FROM utterances
WHERE actor = 'child' AND spoken = 1 AND ms_compose IS NOT NULL AND ms_compose > 0
GROUP BY child_id, day_local;

-- ---------------------------------------------------------------------------
--  GROUP B — errors and motor
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS v_m_mistap_rate;
CREATE VIEW v_m_mistap_rate AS
SELECT t.child_id, t.day_local,
       CAST(SUM(CASE WHEN t.type = 'delete_last' AND t.ms_delta < 1500 THEN 1 ELSE 0 END) AS REAL)
         / NULLIF(SUM(CASE WHEN t.type = 'card_tap' THEN 1 ELSE 0 END), 0) AS value,
       SUM(CASE WHEN t.type = 'card_tap' THEN 1 ELSE 0 END) AS n
FROM v_tap_sequence t
GROUP BY t.child_id, t.day_local;

DROP VIEW IF EXISTS v_m_correction_adjacent_rate;
CREATE VIEW v_m_correction_adjacent_rate AS
SELECT child_id, day_local,
       AVG(CAST(correction_adjacent AS REAL)) AS value,
       COUNT(correction_adjacent) AS n
FROM v_mistaps WHERE correction_adjacent IS NOT NULL
GROUP BY child_id, day_local;

DROP VIEW IF EXISTS v_m_abandonment_rate;
CREATE VIEW v_m_abandonment_rate AS
SELECT child_id, day_local,
       AVG(CASE WHEN spoken = 0 THEN 1.0 ELSE 0.0 END) AS value,
       COUNT(*) AS n
FROM utterances WHERE actor = 'child'
GROUP BY child_id, day_local;

-- Grid heat. grid_rows/grid_cols are in the key so two different grid sizes are
-- never silently merged — the coordinates would mean different things.
DROP VIEW IF EXISTS v_cell_heat;
CREATE VIEW v_cell_heat AS
SELECT
  t.child_id, t.board_id, t.grid_rows, t.grid_cols, t.grid_row, t.grid_col,
  t.day_local,
  SUM(CASE WHEN t.type = 'card_tap'    THEN 1 ELSE 0 END) AS taps,
  SUM(CASE WHEN t.type = 'delete_last' AND t.ms_delta < 1500 THEN 1 ELSE 0 END) AS mistaps
FROM v_tap_sequence t
WHERE t.grid_row IS NOT NULL
GROUP BY t.child_id, t.board_id, t.grid_rows, t.grid_cols, t.grid_row, t.grid_col, t.day_local;

-- ---------------------------------------------------------------------------
--  GROUP C — volume and vocabulary
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS v_m_utterances_per_day;
CREATE VIEW v_m_utterances_per_day AS
SELECT child_id, day_local, COUNT(*) * 1.0 AS value, COUNT(*) AS n
FROM utterances WHERE actor = 'child' AND spoken = 1
GROUP BY child_id, day_local;

-- Point-in-time, not really daily: days since the child last said anything.
DROP VIEW IF EXISTS v_m_silence_streak;
CREATE VIEW v_m_silence_streak AS
SELECT c.child_id,
       (SELECT MAX(day_local) FROM utterances) AS day_local,
       CAST(julianday((SELECT MAX(day_local) FROM utterances))
            - julianday(COALESCE(MAX(u.day_local), '1970-01-01')) AS REAL) AS value,
       COUNT(u.utterance_id) AS n
FROM children c
LEFT JOIN utterances u
  ON u.child_id = c.child_id AND u.actor = 'child' AND u.spoken = 1
GROUP BY c.child_id;

DROP VIEW IF EXISTS v_m_ndw;
CREATE VIEW v_m_ndw AS
SELECT child_id, day_local, COUNT(DISTINCT label) * 1.0 AS value, COUNT(*) AS n
FROM events WHERE actor = 'child' AND type = 'card_tap' AND label IS NOT NULL
GROUP BY child_id, day_local;

DROP VIEW IF EXISTS v_m_mlu;
CREATE VIEW v_m_mlu AS
SELECT child_id, day_local, AVG(symbol_count) AS value, COUNT(*) AS n
FROM utterances WHERE actor = 'child' AND spoken = 1
GROUP BY child_id, day_local;

DROP VIEW IF EXISTS v_m_core_fringe_ratio;
CREATE VIEW v_m_core_fringe_ratio AS
SELECT e.child_id, e.day_local,
       AVG(CASE WHEN c.is_core = 1 THEN 1.0 ELSE 0.0 END) AS value,
       COUNT(*) AS n
FROM events e JOIN cards c ON c.card_id = e.card_id
WHERE e.actor = 'child' AND e.type = 'card_tap'
GROUP BY e.child_id, e.day_local;

-- proposed_metrics.docx defines this as a PROPORTION: new words in the interval
-- against the vocabulary already in use before it. Five new words means one
-- thing at a vocabulary of 20 and another at 200, and the raw count we used
-- before could not tell those apart.
DROP VIEW IF EXISTS v_first_uses;
CREATE VIEW v_first_uses AS
SELECT child_id, label, MIN(day_local) AS first_day
FROM events WHERE actor = 'child' AND type = 'card_tap' AND label IS NOT NULL
GROUP BY child_id, label;

DROP VIEW IF EXISTS v_m_new_words;
CREATE VIEW v_m_new_words AS
SELECT f.child_id, f.first_day AS day_local,
       COUNT(*) * 1.0
         / NULLIF((SELECT COUNT(*) FROM v_first_uses p
                    WHERE p.child_id = f.child_id AND p.first_day < f.first_day), 0) AS value,
       COUNT(*) AS n
FROM v_first_uses f GROUP BY f.child_id, f.first_day;

-- The raw count still matters for the headline number on the card.
DROP VIEW IF EXISTS v_new_words_count;
CREATE VIEW v_new_words_count AS
SELECT child_id, first_day AS day_local, COUNT(*) AS new_words
FROM v_first_uses GROUP BY child_id, first_day;

-- Per-card, per-window. Feeds card_frequency, zero_activation_days and I3/I4.
DROP VIEW IF EXISTS v_card_stats;
CREATE VIEW v_card_stats AS
SELECT
  e.child_id, e.card_id, c.label, c.is_core, c.is_essential, c.default_function,
  COUNT(*)                                  AS taps,
  COUNT(DISTINCT e.day_local)               AS active_days,
  COUNT(DISTINCT e.scene)                   AS scene_count,
  MIN(e.day_local)                          AS first_day,
  MAX(e.day_local)                          AS last_day,
  AVG(COALESCE(e.nav_depth, 0))             AS avg_nav_depth,
  CAST(julianday((SELECT MAX(day_local) FROM events))
       - julianday(MAX(e.day_local)) AS INTEGER) AS days_since_last
FROM events e JOIN cards c ON c.card_id = e.card_id
WHERE e.actor = 'child' AND e.type = 'card_tap'
GROUP BY e.child_id, e.card_id;

-- Cards that exist on a child's board but have NEVER been tapped. A LEFT JOIN,
-- because a card with zero taps produces zero rows in v_card_stats and would
-- otherwise be invisible to the very insight that looks for dead vocabulary.
DROP VIEW IF EXISTS v_unused_cards;
CREATE VIEW v_unused_cards AS
SELECT cv.child_id, c.card_id, c.label, c.is_essential, cv.nav_depth,
       COALESCE(s.taps, 0) AS taps,
       COALESCE(s.days_since_last, 9999) AS days_since_last
FROM child_vocabulary cv
JOIN cards c ON c.card_id = cv.card_id
LEFT JOIN v_card_stats s ON s.child_id = cv.child_id AND s.card_id = cv.card_id
WHERE COALESCE(s.taps, 0) = 0;

-- Word pairs. Only where BOTH words have real solo use, or this fills with noise.
DROP VIEW IF EXISTS v_word_pairs;
CREATE VIEW v_word_pairs AS
WITH solo AS (
  SELECT child_id, label, COUNT(*) AS uses
  FROM events WHERE actor = 'child' AND type = 'card_tap' AND label IS NOT NULL
  GROUP BY child_id, label
),
expanded AS (
  SELECT u.child_id, u.utterance_id, j.value AS label
  FROM utterances u, json_each(u.labels) j
  WHERE u.actor = 'child' AND u.spoken = 1
),
pairs AS (
  SELECT a.child_id,
         MIN(a.label, b.label) AS word_a,
         MAX(a.label, b.label) AS word_b,
         COUNT(DISTINCT a.utterance_id) AS together
  FROM expanded a JOIN expanded b
    ON a.utterance_id = b.utterance_id AND a.label < b.label
  GROUP BY a.child_id, MIN(a.label, b.label), MAX(a.label, b.label)
)
SELECT sa.child_id, sa.label AS word_a, sb.label AS word_b,
       sa.uses AS solo_a, sb.uses AS solo_b,
       COALESCE(p.together, 0) AS together
FROM solo sa
JOIN solo sb ON sb.child_id = sa.child_id AND sb.label > sa.label
LEFT JOIN pairs p
  ON p.child_id = sa.child_id AND p.word_a = sa.label AND p.word_b = sb.label
WHERE sa.uses >= 10 AND sb.uses >= 10;

-- ---------------------------------------------------------------------------
--  GROUP D — layout and context
-- ---------------------------------------------------------------------------

-- Taps that SURVIVED. A press the child deleted within the threshold was never
-- them using that word, and counting it makes every scene comparison wrong:
-- one accidental press of "thank you" at home reads as generalisation.
DROP VIEW IF EXISTS v_surviving_taps;
CREATE VIEW v_surviving_taps AS
SELECT t.child_id, t.day_local, t.scene, t.card_id, t.label, t.utterance_id,
       t.grid_row, t.grid_col, t.nav_depth
FROM (
  SELECT e.*, LEAD(e.type) OVER w AS next_type, LEAD(e.ms_delta) OVER w AS next_delta
  FROM events e
  WHERE e.actor = 'child' AND e.type IN ('card_tap','delete_last')
  WINDOW w AS (PARTITION BY e.utterance_id ORDER BY e.ts)
) t
WHERE t.type = 'card_tap'
  AND NOT (t.next_type = 'delete_last' AND t.next_delta < 1500);

DROP VIEW IF EXISTS v_scene_matrix;
CREATE VIEW v_scene_matrix AS
SELECT s.child_id, s.scene, s.label, c.default_function,
       COUNT(*) AS taps, COUNT(DISTINCT s.day_local) AS days
FROM v_surviving_taps s JOIN cards c ON c.card_id = s.card_id
GROUP BY s.child_id, s.scene, s.label;

DROP VIEW IF EXISTS v_m_layout_stability;
CREATE VIEW v_m_layout_stability AS
SELECT b.child_id, r.day_local,
       -- disruptive changes on this day; higher stability = fewer of them
       CAST(SUM(CASE WHEN r.change_kind IN ('move','resize','remove') THEN 1 ELSE 0 END) AS REAL) AS value,
       COUNT(*) AS n
FROM board_revisions r JOIN boards b ON b.board_id = r.board_id
GROUP BY b.child_id, r.day_local;

-- Modes hold no coordinates by construction (constraint C4), so any card in a
-- mode is by definition at its canonical position. This view exists to PROVE
-- that invariant holds rather than to assume it — if the schema is ever changed
-- to let modes carry positions, this starts returning < 1.0.
DROP VIEW IF EXISTS v_m_position_consistency;
CREATE VIEW v_m_position_consistency AS
SELECT b.child_id,
       (SELECT MAX(day_local) FROM events) AS day_local,
       AVG(CASE WHEN bc.card_id IS NOT NULL THEN 1.0 ELSE 0.0 END) AS value,
       COUNT(*) AS n
FROM boards b
JOIN mode_selection ms ON ms.board_id = b.board_id
LEFT JOIN board_cells bc
  ON bc.board_id = (SELECT board_id FROM boards rb
                     WHERE rb.child_id = b.child_id AND rb.kind = 'robust')
 AND bc.card_id = ms.card_id AND bc.canonical = 1
WHERE b.kind = 'mode'
GROUP BY b.child_id;

-- ---------------------------------------------------------------------------
--  GROUP E — whose voice
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS v_m_independence_rate;
CREATE VIEW v_m_independence_rate AS
SELECT child_id, day_local,
       AVG(CASE WHEN used_suggestion = 0 THEN 1.0 ELSE 0.0 END) AS value,
       COUNT(*) AS n
FROM utterances WHERE actor = 'child' AND spoken = 1
GROUP BY child_id, day_local;

DROP VIEW IF EXISTS v_m_teacher_modeling;
CREATE VIEW v_m_teacher_modeling AS
SELECT child_id, day_local, COUNT(*) * 1.0 AS value, COUNT(*) AS n
FROM events WHERE actor = 'adult' AND type = 'card_tap'
GROUP BY child_id, day_local;

DROP VIEW IF EXISTS v_function_mix;
CREATE VIEW v_function_mix AS
SELECT child_id, scene, function, COUNT(*) AS utterances
FROM utterances
WHERE actor = 'child' AND spoken = 1 AND function IS NOT NULL
GROUP BY child_id, scene, function;

-- ---------------------------------------------------------------------------
--  GROUP F — AI value
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS v_m_taps_saved;
CREATE VIEW v_m_taps_saved AS
WITH split AS (
  SELECT child_id, day_local,
         AVG(CASE WHEN used_suggestion = 0 THEN tap_count END) AS without_ai,
         AVG(CASE WHEN used_suggestion = 1 THEN tap_count END) AS with_ai,
         SUM(used_suggestion) AS uses,
         COUNT(*) AS n
  FROM utterances WHERE actor = 'child' AND spoken = 1
  GROUP BY child_id, day_local
)
SELECT child_id, day_local,
       (without_ai - with_ai) * uses AS value, n
FROM split WHERE without_ai IS NOT NULL AND with_ai IS NOT NULL;

-- ---------------------------------------------------------------------------
--  GROUP G — communication partner
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS v_m_partner_wait_time;
CREATE VIEW v_m_partner_wait_time AS
WITH ranked AS (
  SELECT child_id, day_local, ms_to_next_partner_turn AS w,
         ROW_NUMBER() OVER (PARTITION BY child_id, day_local ORDER BY ms_to_next_partner_turn) AS rn,
         COUNT(*)     OVER (PARTITION BY child_id, day_local) AS cnt
  FROM partner_turns WHERE child_responded = 0 AND ms_to_next_partner_turn IS NOT NULL
)
SELECT child_id, day_local, AVG(w) AS value, MAX(cnt) AS n
FROM ranked WHERE rn IN ((cnt + 1) / 2, (cnt + 2) / 2)
GROUP BY child_id, day_local;

DROP VIEW IF EXISTS v_m_partner_interruption_rate;
CREATE VIEW v_m_partner_interruption_rate AS
SELECT child_id, day_local,
       AVG(CASE WHEN interrupted_utterance_id IS NOT NULL THEN 1.0 ELSE 0.0 END) AS value,
       COUNT(*) AS n
FROM partner_turns
GROUP BY child_id, day_local;

-- ---------------------------------------------------------------------------
--  GROUP H — communication style
--
--  NOT errors. A run of >=3 taps on the same card with no delete is
--  exploration, motor learning, gestalt processing, or stimming — and if it
--  clusters where vocabulary is thin, it is a VOCABULARY GAP signal. It is
--  never a mistake. Clinical constraint C1.
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS v_m_repeat_tap_rate;
CREATE VIEW v_m_repeat_tap_rate AS
WITH seq AS (
  -- The catalogue formula says "consecutive card_tap ... with NO delete", so
  -- the lag chain must carry event TYPE: with card_id alone, a delete of the
  -- same card both broke runs it sat inside AND extended runs backwards,
  -- undercounting (A, del A, A, A, A holds a legal 3-run that prev3=A hid).
  SELECT child_id, day_local, utterance_id, ts, type, card_id,
         LAG(type, 1)    OVER w AS t1, LAG(card_id, 1) OVER w AS c1,
         LAG(type, 2)    OVER w AS t2, LAG(card_id, 2) OVER w AS c2,
         LAG(type, 3)    OVER w AS t3, LAG(card_id, 3) OVER w AS c3
  FROM events
  WHERE actor = 'child' AND type IN ('card_tap','delete_last')
  WINDOW w AS (PARTITION BY utterance_id ORDER BY ts)
),
runs AS (
  -- exactly one row per run of length >= 3: counted at the third tap, unless
  -- the tap before the run start was itself part of it
  SELECT child_id, day_local, utterance_id, card_id
  FROM seq
  WHERE type = 'card_tap'
    AND t1 = 'card_tap' AND c1 = card_id
    AND t2 = 'card_tap' AND c2 = card_id
    AND (t3 IS NULL OR t3 <> 'card_tap' OR c3 <> card_id)
),
per_day AS (
  SELECT child_id, day_local, COUNT(*) AS run_count FROM runs GROUP BY child_id, day_local
)
SELECT u.child_id, u.day_local,
       COALESCE(r.run_count, 0) * 1.0 / NULLIF(COUNT(*), 0) AS value,
       COUNT(*) AS n
FROM utterances u
LEFT JOIN per_day r ON r.child_id = u.child_id AND r.day_local = u.day_local
WHERE u.actor = 'child'
GROUP BY u.child_id, u.day_local;

-- Where repetition happens, and whether that card is even reachable. This is
-- the join that turns "she keeps pressing it" into "she may lack the word".
DROP VIEW IF EXISTS v_repeat_runs_by_card;
CREATE VIEW v_repeat_runs_by_card AS
SELECT child_id, card_id, COUNT(*) AS repeat_runs, COUNT(DISTINCT day_local) AS days
FROM v_tap_sequence
WHERE type = 'card_tap' AND card_id = prev1 AND card_id = prev2
  AND (prev3 IS NULL OR prev3 <> card_id)
GROUP BY child_id, card_id;

-- ---------------------------------------------------------------------------
--  FEELING WORDS  (proposed metric 5)
--
--  Which feeling words were USED. Never an inference about how the child feels.
--  v_feeling_words_available is not optional garnish: without it, "60% positive"
--  is unreadable, because a board holding two positive words and no negative one
--  can only ever report positive.
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS v_feeling_words;
CREATE VIEW v_feeling_words AS
SELECT s.child_id, s.day_local, el.category, s.label, COUNT(*) AS uses
FROM v_surviving_taps s
JOIN emotion_lexicon el ON el.word = s.label
GROUP BY s.child_id, s.day_local, el.category, s.label;

DROP VIEW IF EXISTS v_feeling_words_available;
CREATE VIEW v_feeling_words_available AS
SELECT cv.child_id, el.category, COUNT(*) AS available
FROM child_vocabulary cv
JOIN cards c ON c.card_id = cv.card_id
JOIN emotion_lexicon el ON el.word = c.label
GROUP BY cv.child_id, el.category;

-- Scalar form for the rollup: share of feeling-word use that was positive.
DROP VIEW IF EXISTS v_m_feeling_words;
CREATE VIEW v_m_feeling_words AS
SELECT child_id, day_local,
       CAST(SUM(CASE WHEN category = 'positive' THEN uses ELSE 0 END) AS REAL)
         / NULLIF(SUM(uses), 0) AS value,
       SUM(uses) AS n
FROM v_feeling_words GROUP BY child_id, day_local;

-- ---------------------------------------------------------------------------
--  SENTENCE SHAPES  (proposed metric 6)
--
--  Structures APPEARING, never mistakes. There is deliberately no view of what
--  is absent: a structure the board cannot express is not a fact about the child.
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS v_sentence_shapes;
CREATE VIEW v_sentence_shapes AS
SELECT u.child_id, u.day_local, sp.pattern_id, sp.name, sp.example, sp.stage,
       COUNT(*) AS uses
FROM utterance_structures us
JOIN utterances u ON u.utterance_id = us.utterance_id
JOIN syntax_patterns sp ON sp.pattern_id = us.pattern_id
WHERE u.actor = 'child' AND u.spoken = 1
GROUP BY u.child_id, u.day_local, sp.pattern_id;

DROP VIEW IF EXISTS v_m_sentence_shapes;
CREATE VIEW v_m_sentence_shapes AS
SELECT child_id, day_local, COUNT(DISTINCT pattern_id) * 1.0 AS value, SUM(uses) AS n
FROM v_sentence_shapes GROUP BY child_id, day_local;

-- ---------------------------------------------------------------------------
--  ANSWERS AND TOPIC STARTS  (proposed metric 7)
--
--  A SPLIT, not a score. Starting a topic is a higher-order skill than
--  answering, but a child who answers well is communicating too — so this is
--  never rendered as a gauge and has no good end.
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS v_m_answers_vs_starts;
CREATE VIEW v_m_answers_vs_starts AS
SELECT u.child_id, u.day_local,
       AVG(CASE WHEN EXISTS (
             SELECT 1 FROM partner_turns p
             WHERE p.child_id = u.child_id
               AND u.ts - (p.ts + p.ms_duration) BETWEEN 0 AND 30000
           ) THEN 1.0 ELSE 0.0 END) AS value,
       COUNT(*) AS n
FROM utterances u
WHERE u.actor = 'child' AND u.spoken = 1
GROUP BY u.child_id, u.day_local;

-- ---------------------------------------------------------------------------
--  SESSIONS
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS v_session_summary;
CREATE VIEW v_session_summary AS
SELECT s.*,
       CAST(s.mistaps AS REAL) / NULLIF(s.taps, 0) AS mistap_rate,
       CAST(s.abandoned AS REAL) / NULLIF(s.utterances + s.abandoned, 0) AS abandon_rate
FROM sessions s;

-- ============================================================================
--  UNION — every scalar daily metric, stacked.
--  tools/rollup.py inserts agg_daily_metric straight from this.
-- ============================================================================

DROP VIEW IF EXISTS v_daily_metrics_all;
CREATE VIEW v_daily_metrics_all AS
  SELECT 'taps_per_utterance'        AS metric_id, * FROM v_m_taps_per_utterance
  UNION ALL SELECT 'composition_time',            * FROM v_m_composition_time
  UNION ALL SELECT 'time_to_first_tap',           * FROM v_m_time_to_first_tap
  UNION ALL SELECT 'words_per_minute',            * FROM v_m_words_per_minute
  UNION ALL SELECT 'mistap_rate',                 * FROM v_m_mistap_rate
  UNION ALL SELECT 'correction_adjacent_rate',    * FROM v_m_correction_adjacent_rate
  UNION ALL SELECT 'abandonment_rate',            * FROM v_m_abandonment_rate
  UNION ALL SELECT 'utterances_per_day',          * FROM v_m_utterances_per_day
  UNION ALL SELECT 'silence_streak',              * FROM v_m_silence_streak
  UNION ALL SELECT 'ndw',                         * FROM v_m_ndw
  UNION ALL SELECT 'mlu',                         * FROM v_m_mlu
  UNION ALL SELECT 'core_fringe_ratio',           * FROM v_m_core_fringe_ratio
  -- The catalogue defines new_words as a COUNT ("labels whose earliest ever
  -- card_tap falls inside the window", unit 'count'), and every window reader
  -- SUMs daily rows. v_m_new_words is a proportion (kept for rule I6) — summing
  -- proportions produced a number that was neither. The count view feeds here.
  UNION ALL SELECT 'new_words', child_id, day_local, new_words * 1.0, new_words FROM v_new_words_count
  UNION ALL SELECT 'layout_stability',            * FROM v_m_layout_stability
  UNION ALL SELECT 'position_consistency',        * FROM v_m_position_consistency
  UNION ALL SELECT 'independence_rate',           * FROM v_m_independence_rate
  UNION ALL SELECT 'teacher_modeling',            * FROM v_m_teacher_modeling
  UNION ALL SELECT 'taps_saved',                  * FROM v_m_taps_saved
  UNION ALL SELECT 'partner_wait_time',           * FROM v_m_partner_wait_time
  UNION ALL SELECT 'partner_interruption_rate',   * FROM v_m_partner_interruption_rate
  UNION ALL SELECT 'repeat_tap_rate',             * FROM v_m_repeat_tap_rate
  UNION ALL SELECT 'feeling_words',                * FROM v_m_feeling_words
  UNION ALL SELECT 'sentence_shapes',              * FROM v_m_sentence_shapes
  UNION ALL SELECT 'answers_vs_starts',            * FROM v_m_answers_vs_starts;
