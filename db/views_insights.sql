-- ============================================================================
--  AAC ANALYTICS — insight views  (I1 … I8)
--
--  Each view returns EVIDENCE plus a `triggered` flag and the thresholds it
--  used, as columns. The thresholds are exposed rather than baked into a WHERE
--  clause, so a model or a therapist can disagree with a rule that fired at
--  8.1% against a threshold of 8%.
--
--  These are plain SQL on purpose. The seven diagnostic rules must be
--  deterministic and explainable to a speech therapist; a model narrates them
--  afterwards but never decides them. See TECH_STACK.md.
--
--  Apply after views_metrics.sql:  sqlite3 aac.db < db/views_insights.sql
-- ============================================================================

DROP VIEW IF EXISTS v_window;
CREATE VIEW v_window AS
SELECT
  (SELECT MAX(day_local) FROM events)                              AS w_end,
  date((SELECT MAX(day_local) FROM events), '-13 days')            AS w_start,
  date((SELECT MAX(day_local) FROM events), '-27 days')            AS w_start_28,
  date((SELECT MAX(day_local) FROM events), '-6 days')             AS w_start_7,
  date((SELECT MAX(day_local) FROM events), '-13 days')            AS prev_end_7;

-- ============================================================================
--  I1 — unintended presses: physical or conceptual?
--
--  Note what this does NOT count: repeated pressing with no delete. That is
--  communication, not error (constraint C1), and it lives in v_m_repeat_tap_rate.
-- ============================================================================

DROP VIEW IF EXISTS v_i1_mistap_classification;
CREATE VIEW v_i1_mistap_classification AS
WITH w AS (SELECT * FROM v_window),
agg AS (
  SELECT t.child_id,
         SUM(CASE WHEN t.type = 'card_tap' THEN 1 ELSE 0 END) AS taps,
         SUM(CASE WHEN t.type = 'delete_last' AND t.ms_delta < 1500 THEN 1 ELSE 0 END) AS mistaps,
         COUNT(DISTINCT t.day_local) AS active_days
  FROM v_tap_sequence t, w
  WHERE t.day_local BETWEEN w.w_start AND w.w_end
  GROUP BY t.child_id
),
adj AS (
  SELECT m.child_id,
         SUM(m.correction_adjacent) AS n_adjacent,
         COUNT(m.correction_adjacent) AS n_classified
  FROM v_mistaps m, w
  WHERE m.day_local BETWEEN w.w_start AND w.w_end AND m.correction_adjacent IS NOT NULL
  GROUP BY m.child_id
),
lat AS (
  SELECT child_id, AVG(value) AS median_latency_ms
  FROM v_m_time_to_first_tap, w
  WHERE day_local BETWEEN w.w_start AND w.w_end
  GROUP BY child_id
)
SELECT
  agg.child_id,
  (SELECT w_start FROM w) AS window_start,
  (SELECT w_end   FROM w) AS window_end,
  agg.taps, agg.mistaps, agg.active_days,
  CAST(agg.mistaps AS REAL) / NULLIF(agg.taps, 0)              AS mistap_rate,
  adj.n_adjacent, adj.n_classified,
  CAST(adj.n_adjacent AS REAL) / NULLIF(adj.n_classified, 0)   AS adjacent_ratio,
  ROUND(lat.median_latency_ms)                                 AS median_latency_ms,
  -- thresholds, exposed not applied
  0.08 AS threshold_mistap_rate,
  5    AS threshold_min_days,
  0.60 AS threshold_adjacent_motor,
  1500 AS mistap_threshold_ms,
  CASE
    WHEN CAST(agg.mistaps AS REAL) / NULLIF(agg.taps, 0) > 0.08
     AND agg.active_days >= 5 THEN 1 ELSE 0
  END AS triggered,
  CASE
    WHEN CAST(adj.n_adjacent AS REAL) / NULLIF(adj.n_classified, 0) >= 0.60 THEN 'motor'
    WHEN CAST(adj.n_adjacent AS REAL) / NULLIF(adj.n_classified, 0) <= 0.35 THEN 'semantic'
    ELSE 'ambiguous'
  END AS classification
FROM agg
LEFT JOIN adj ON adj.child_id = agg.child_id
LEFT JOIN lat ON lat.child_id = agg.child_id;

-- Where on the grid the errors are. Dead cells ringed by errors mean reach.
DROP VIEW IF EXISTS v_i1_evidence_cells;
CREATE VIEW v_i1_evidence_cells AS
SELECT h.child_id, h.board_id, h.grid_rows, h.grid_cols, h.grid_row, h.grid_col,
       SUM(h.taps) AS taps, SUM(h.mistaps) AS mistaps,
       CAST(SUM(h.mistaps) AS REAL) / NULLIF(SUM(h.taps) + SUM(h.mistaps), 0) AS mistap_share
FROM v_cell_heat h, v_window w
WHERE h.day_local BETWEEN w.w_start AND w.w_end
GROUP BY h.child_id, h.board_id, h.grid_rows, h.grid_cols, h.grid_row, h.grid_col;

-- ============================================================================
--  I2 — slow to start, or not given time?
--  The partner columns are not decoration: a child cannot look fast when the
--  adult refills the silence after 1.2 seconds.
-- ============================================================================

DROP VIEW IF EXISTS v_i2_scanning_load;
CREATE VIEW v_i2_scanning_load AS
WITH w AS (SELECT * FROM v_window),
child AS (
  SELECT u.child_id,
         AVG(u.ms_to_first_tap) AS mean_latency_ms,
         COUNT(*) AS n_utterances,
         -- "the tap was correct": no delete anywhere in the utterance
         AVG(CASE WHEN u.delete_count = 0 THEN 1.0 ELSE 0.0 END) AS clean_share
  FROM utterances u, w
  WHERE u.actor = 'child' AND u.ms_to_first_tap IS NOT NULL
    AND u.day_local BETWEEN w.w_start AND w.w_end
  GROUP BY u.child_id
),
baseline AS (
  SELECT child_id, AVG(value) AS baseline_ms
  FROM v_m_time_to_first_tap, w
  WHERE day_local < w.w_start
  GROUP BY child_id
),
partner AS (
  SELECT p.child_id,
         AVG(p.ms_to_next_partner_turn) AS partner_wait_ms,
         AVG(CASE WHEN p.interrupted_utterance_id IS NOT NULL THEN 1.0 ELSE 0.0 END) AS interruption_rate,
         COUNT(*) AS n_turns
  FROM partner_turns p, w
  WHERE p.day_local BETWEEN w.w_start AND w.w_end
  GROUP BY p.child_id
),
grid AS (
  SELECT child_id, MAX(grid_rows * grid_cols) AS cells_on_page
  FROM boards b JOIN board_cells bc ON bc.board_id = b.board_id
  WHERE b.kind = 'robust' GROUP BY child_id
)
SELECT
  c.child_id,
  (SELECT w_start FROM w) AS window_start,
  (SELECT w_end   FROM w) AS window_end,
  ROUND(c.mean_latency_ms)   AS mean_latency_ms,
  ROUND(b.baseline_ms)       AS baseline_ms,
  c.n_utterances, ROUND(c.clean_share, 3) AS clean_tap_share,
  g.cells_on_page,
  ROUND(p.partner_wait_ms)   AS partner_wait_ms,
  ROUND(p.interruption_rate, 3) AS partner_interruption_rate,
  5000 AS threshold_latency_ms,
  0.80 AS threshold_clean_share,
  2000 AS partner_wait_concern_ms,
  CASE WHEN c.mean_latency_ms > 5000 AND c.clean_share >= 0.80 THEN 1 ELSE 0 END AS triggered,
  -- Which reading the evidence supports. The dashboard must show both.
  CASE WHEN p.partner_wait_ms IS NOT NULL AND p.partner_wait_ms < 2000
       THEN 'partner_may_not_be_waiting' ELSE 'child_scanning_load' END AS likely_cause
FROM child c
LEFT JOIN baseline b ON b.child_id = c.child_id
LEFT JOIN partner  p ON p.child_id = c.child_id
LEFT JOIN grid     g ON g.child_id = c.child_id;

-- ============================================================================
--  I3 — a much-used word is buried
--  Action is ADD A COPY, never move. Constraint C3.
-- ============================================================================

DROP VIEW IF EXISTS v_i3_buried_words;
CREATE VIEW v_i3_buried_words AS
WITH ranked AS (
  SELECT s.child_id, s.card_id, s.label, s.taps, s.avg_nav_depth,
         PERCENT_RANK() OVER (PARTITION BY s.child_id ORDER BY s.taps) AS pct_rank
  FROM v_card_stats s
)
SELECT child_id, card_id, label, taps,
       ROUND(avg_nav_depth, 1) AS nav_depth,
       ROUND(pct_rank, 3)      AS frequency_percentile,
       0.95 AS threshold_percentile,
       3    AS threshold_nav_depth,
       CASE WHEN pct_rank >= 0.95 AND avg_nav_depth >= 3 THEN 1 ELSE 0 END AS triggered
FROM ranked
WHERE pct_rank >= 0.90;

-- ============================================================================
--  I4 — obsolete word, or a preference?
--  Case B must never route to retraining. A refusal is successful communication.
-- ============================================================================

DROP VIEW IF EXISTS v_i4_unused_vocabulary;
CREATE VIEW v_i4_unused_vocabulary AS
-- CASE A: nothing anywhere, for a long time
SELECT
  u.child_id, u.card_id, u.label,
  'obsolete' AS case_kind,
  NULL       AS scene,
  0          AS taps_in_scene,
  u.days_since_last,
  30         AS threshold_days,
  CASE WHEN u.days_since_last >= 30 THEN 1 ELSE 0 END AS triggered,
  'replace'  AS suggested_disposition
FROM v_unused_cards u
JOIN cards c ON c.card_id = u.card_id
-- Never propose removing an essential OR A CORE word. Core vocabulary is
-- aspirational: an unused core word is a modelling target, not dead weight.
-- Removing "different" because a child has not used it yet takes away the very
-- word that would let them refuse something.
WHERE u.is_essential = 0 AND c.is_core = 0

UNION ALL

-- CASE B: silent about ONE thing, in a scene where she is otherwise talkative
-- and actively saying no. That is a preference, and it needs no intervention.
SELECT
  ch.child_id, c.card_id, c.label,
  'preference' AS case_kind,
  act.scene,
  0 AS taps_in_scene,
  NULL AS days_since_last,
  10 AS threshold_days,
  CASE WHEN act.protest_taps >= 10 AND act.total_taps >= 50 THEN 1 ELSE 0 END AS triggered,
  'no_action' AS suggested_disposition
FROM children ch
CROSS JOIN cards c
JOIN (
  SELECT e.child_id, e.scene,
         COUNT(*) AS total_taps,
         SUM(CASE WHEN cd.default_function = 'protest' THEN 1 ELSE 0 END) AS protest_taps
  FROM events e JOIN cards cd ON cd.card_id = e.card_id
  WHERE e.actor = 'child' AND e.type = 'card_tap'
  GROUP BY e.child_id, e.scene
) act ON act.child_id = ch.child_id
LEFT JOIN v_scene_matrix sm
  ON sm.child_id = ch.child_id AND sm.scene = act.scene AND sm.label = c.label
WHERE c.category IN ('food','drink')
  AND c.is_essential = 0
  AND sm.taps IS NULL;

-- ============================================================================
--  I5 — words known, not yet combined
-- ============================================================================

DROP VIEW IF EXISTS v_i5_missing_combinations;
CREATE VIEW v_i5_missing_combinations AS
WITH mlu AS (
  SELECT child_id, AVG(value) AS mlu FROM v_m_mlu, v_window w
  WHERE day_local BETWEEN w.w_start_28 AND w.w_end GROUP BY child_id
)
SELECT p.child_id, p.word_a, p.word_b, p.solo_a, p.solo_b, p.together,
       ROUND(m.mlu, 2) AS mlu,
       MIN(p.solo_a, p.solo_b) AS weaker_solo,
       ROW_NUMBER() OVER (
         PARTITION BY p.child_id ORDER BY MIN(p.solo_a, p.solo_b) DESC
       ) AS target_rank,
       20   AS threshold_min_solo,
       1.30 AS threshold_max_mlu,
       CASE WHEN p.solo_a >= 20 AND p.solo_b >= 20 AND p.together = 0 AND m.mlu < 1.30
            THEN 1 ELSE 0 END AS triggered
FROM v_word_pairs p
JOIN mlu m ON m.child_id = p.child_id
WHERE p.together = 0;

-- Child-level form of I5. One finding per child, with the three most promising
-- pairs to model. "Teach want + biscuit" is actionable; 94 pair rows are not.
DROP VIEW IF EXISTS v_i5_summary;
CREATE VIEW v_i5_summary AS
SELECT child_id,
       MAX(mlu)                              AS mlu,
       COUNT(*)                              AS missing_pairs,
       MAX(CASE WHEN target_rank = 1 THEN word_a || ' + ' || word_b END) AS target_1,
       MAX(CASE WHEN target_rank = 2 THEN word_a || ' + ' || word_b END) AS target_2,
       MAX(CASE WHEN target_rank = 3 THEN word_a || ' + ' || word_b END) AS target_3,
       1 AS triggered
FROM v_i5_missing_combinations
WHERE triggered = 1
GROUP BY child_id;

-- ============================================================================
--  I6 — works in one place, not another
--  The intervention targets the adults in the other setting, never the child.
-- ============================================================================

DROP VIEW IF EXISTS v_i6_scene_bound;
CREATE VIEW v_i6_scene_bound AS
WITH totals AS (
  SELECT child_id, label, SUM(taps) AS total_taps, COUNT(DISTINCT scene) AS scenes
  FROM v_scene_matrix GROUP BY child_id, label
),
active_scenes AS (
  SELECT child_id, COUNT(DISTINCT scene) AS n_scenes, SUM(taps) AS all_taps
  FROM v_scene_matrix GROUP BY child_id
),
in_therapy AS (
  SELECT child_id, label, SUM(taps) AS therapy_taps
  FROM v_scene_matrix WHERE scene = 'therapy' GROUP BY child_id, label
),
elsewhere AS (
  SELECT child_id, label, SUM(taps) AS other_taps
  FROM v_scene_matrix WHERE scene IN ('home','free_play','community') GROUP BY child_id, label
)
SELECT t.child_id, t.label,
       COALESCE(i.therapy_taps, 0) AS therapy_taps,
       COALESCE(e.other_taps, 0)   AS other_taps,
       t.total_taps, t.scenes, a.n_scenes AS child_active_scenes,
       10 AS threshold_therapy_taps,
       CASE WHEN COALESCE(i.therapy_taps, 0) >= 10
             AND COALESCE(e.other_taps, 0) = 0
             AND a.n_scenes >= 3
            THEN 1 ELSE 0 END AS triggered
FROM totals t
JOIN active_scenes a ON a.child_id = t.child_id
LEFT JOIN in_therapy i ON i.child_id = t.child_id AND i.label = t.label
LEFT JOIN elsewhere  e ON e.child_id = t.child_id AND e.label = t.label;

-- ============================================================================
--  I7 — the adult has stopped modelling
--  Aimed at a grown-up. Check Modeling Mode was actually switched on before
--  concluding no modelling happened.
-- ============================================================================

DROP VIEW IF EXISTS v_i7_modeling_gap;
CREATE VIEW v_i7_modeling_gap AS
WITH w AS (SELECT * FROM v_window),
recent AS (
  SELECT child_id, AVG(value) AS modeling_per_day, COUNT(*) AS days
  FROM v_m_teacher_modeling, w
  WHERE day_local BETWEEN w.w_start AND w.w_end GROUP BY child_id
),
prior AS (
  SELECT child_id, AVG(value) AS modeling_per_day
  FROM v_m_teacher_modeling, w
  WHERE day_local < w.w_start GROUP BY child_id
),
growth AS (
  SELECT child_id,
         SUM(CASE WHEN day_local BETWEEN (SELECT w_start FROM w) AND (SELECT w_end FROM w)
                  THEN value ELSE 0 END) AS new_words_recent,
         SUM(CASE WHEN day_local < (SELECT w_start FROM w) THEN value ELSE 0 END) AS new_words_prior
  FROM v_m_new_words GROUP BY child_id
),
modeling_days AS (
  SELECT child_id, COUNT(DISTINCT day_local) AS days_with_any_modeling
  FROM events WHERE actor = 'adult' GROUP BY child_id
)
SELECT r.child_id,
       ROUND(r.modeling_per_day, 2) AS modeling_per_day_recent,
       ROUND(p.modeling_per_day, 2) AS modeling_per_day_prior,
       g.new_words_recent, g.new_words_prior,
       md.days_with_any_modeling,
       3 AS threshold_modeling_per_day,
       CASE WHEN r.modeling_per_day < 3 THEN 1 ELSE 0 END AS triggered,
       -- Zero modelling may mean "nobody modelled" OR "nobody switched the mode on".
       CASE WHEN md.days_with_any_modeling = 0 THEN 1 ELSE 0 END AS modeling_mode_never_used
FROM recent r
LEFT JOIN prior p ON p.child_id = r.child_id
LEFT JOIN growth g ON g.child_id = r.child_id
LEFT JOIN modeling_days md ON md.child_id = r.child_id;

-- ============================================================================
--  I8 — our own change broke something
--  The only rule that points at us. Without it, every layout recommendation
--  the dashboard makes is unfalsifiable.
-- ============================================================================

DROP VIEW IF EXISTS v_i8_layout_disruption;
CREATE VIEW v_i8_layout_disruption AS
WITH revs AS (
  SELECT r.revision_id, b.child_id, r.board_id, r.day_local, r.change_kind,
         r.card_id, r.suggested_by_insight, r.actor_id, r.reason
  FROM board_revisions r JOIN boards b ON b.board_id = r.board_id
  WHERE r.change_kind IN ('move','resize','remove')
),
before AS (
  SELECT v.revision_id,
         AVG(m.value) AS mistap_before, COUNT(*) AS days_before
  FROM revs v JOIN v_m_mistap_rate m
    ON m.child_id = v.child_id
   AND m.day_local >= date(v.day_local, '-7 days')
   AND m.day_local <  v.day_local
  GROUP BY v.revision_id
),
after AS (
  SELECT v.revision_id,
         AVG(m.value) AS mistap_after, COUNT(*) AS days_after
  FROM revs v JOIN v_m_mistap_rate m
    ON m.child_id = v.child_id
   AND m.day_local >= v.day_local
   AND m.day_local <  date(v.day_local, '+7 days')
  GROUP BY v.revision_id
)
SELECT r.child_id, r.revision_id, r.day_local AS changed_on, r.change_kind,
       r.card_id, r.suggested_by_insight, r.reason,
       ROUND(b.mistap_before, 4) AS mistap_rate_before_7d,
       ROUND(a.mistap_after, 4)  AS mistap_rate_after_7d,
       ROUND(a.mistap_after - b.mistap_before, 4) AS delta,
       b.days_before, a.days_after,
       0.0 AS threshold_delta,
       CASE WHEN a.mistap_after > b.mistap_before
             AND b.days_before >= 3 AND a.days_after >= 3
            THEN 1 ELSE 0 END AS triggered
FROM revs r
LEFT JOIN before b ON b.revision_id = r.revision_id
LEFT JOIN after  a ON a.revision_id = r.revision_id;

-- ============================================================================
--  Roll-up: which rules fired, for whom. tools/verify.py gates on this.
-- ============================================================================

DROP VIEW IF EXISTS v_insights_fired;
CREATE VIEW v_insights_fired AS
  SELECT 'I1' AS insight_id, child_id, COUNT(*) AS evidence_rows
    FROM v_i1_mistap_classification WHERE triggered = 1 GROUP BY child_id
  UNION ALL
  SELECT 'I2', child_id, COUNT(*) FROM v_i2_scanning_load  WHERE triggered = 1 GROUP BY child_id
  UNION ALL
  SELECT 'I3', child_id, COUNT(*) FROM v_i3_buried_words   WHERE triggered = 1 GROUP BY child_id
  UNION ALL
  SELECT 'I4', child_id, COUNT(*) FROM v_i4_unused_vocabulary WHERE triggered = 1 GROUP BY child_id
  UNION ALL
  SELECT 'I5', child_id, COUNT(*) FROM v_i5_summary WHERE triggered = 1 GROUP BY child_id
  UNION ALL
  SELECT 'I6', child_id, COUNT(*) FROM v_i6_scene_bound    WHERE triggered = 1 GROUP BY child_id
  UNION ALL
  SELECT 'I7', child_id, COUNT(*) FROM v_i7_modeling_gap   WHERE triggered = 1 GROUP BY child_id
  UNION ALL
  SELECT 'I8', child_id, COUNT(*) FROM v_i8_layout_disruption WHERE triggered = 1 GROUP BY child_id;
