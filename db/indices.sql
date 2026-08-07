-- ============================================================================
--  AAC ANALYTICS — indices
--  Apply after schema.sql:  sqlite3 aac.db < db/indices.sql
--
--  Sizing assumption: 5 children x 6 weeks ~= 180k events, ~7.5k utterances.
--  Target: no metric view takes > 50 ms on that volume.
-- ============================================================================

-- ---------------------------------------------------------------------------
--  events — the only table large enough for index choice to matter
-- ---------------------------------------------------------------------------

-- The workhorse. Nearly every query is "this child, this date range".
CREATE INDEX IF NOT EXISTS ix_events_child_ts
  ON events (child_id, ts);

-- Metric views filter by type first: counts of card_tap, speak, delete_last.
CREATE INDEX IF NOT EXISTS ix_events_child_type_day
  ON events (child_id, type, day_local);

-- Utterance reconstruction and adjacency: gather all taps for one sentence
-- in tap order. Partial — most events have no utterance_id.
CREATE INDEX IF NOT EXISTS ix_events_utterance
  ON events (utterance_id, ts)
  WHERE utterance_id IS NOT NULL;

-- card_frequency, zero_activation_days, repeat_tap runs.
CREATE INDEX IF NOT EXISTS ix_events_child_card_ts
  ON events (child_id, card_id, ts)
  WHERE card_id IS NOT NULL;

-- Cell heat maps. Includes grid dims so different grid sizes never merge.
CREATE INDEX IF NOT EXISTS ix_events_heat
  ON events (child_id, board_id, grid_rows, grid_cols, grid_row, grid_col)
  WHERE type = 'card_tap';

-- Scene comparisons (I4B dislike vs I6 generalisation).
CREATE INDEX IF NOT EXISTS ix_events_child_scene_day
  ON events (child_id, scene, day_local);

-- teacher_modeling (E2) — adult events are a small minority, so partial.
CREATE INDEX IF NOT EXISTS ix_events_adult
  ON events (child_id, day_local, type)
  WHERE actor = 'adult';

-- nav_depth crossed with frequency (I3 buried word).
CREATE INDEX IF NOT EXISTS ix_events_navdepth
  ON events (child_id, card_id, nav_depth)
  WHERE type = 'card_tap' AND nav_depth IS NOT NULL;

-- ---------------------------------------------------------------------------
--  utterances
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS ix_utt_child_day
  ON utterances (child_id, day_local);

-- silence_streak: MAX(ts) WHERE spoken = 1.
CREATE INDEX IF NOT EXISTS ix_utt_child_spoken_ts
  ON utterances (child_id, spoken, ts);

-- Scene x function cross-tab for I6.
CREATE INDEX IF NOT EXISTS ix_utt_child_scene_function
  ON utterances (child_id, scene, function);

-- taps_saved: split by whether a suggestion was used.
CREATE INDEX IF NOT EXISTS ix_utt_child_suggestion
  ON utterances (child_id, used_suggestion, day_local);

-- ---------------------------------------------------------------------------
--  partner_turns
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS ix_partner_child_day
  ON partner_turns (child_id, day_local);

CREATE INDEX IF NOT EXISTS ix_partner_interruptions
  ON partner_turns (child_id, interrupted_utterance_id)
  WHERE interrupted_utterance_id IS NOT NULL;

-- ---------------------------------------------------------------------------
--  boards and revisions
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS ix_board_cells_card
  ON board_cells (card_id, canonical);

CREATE INDEX IF NOT EXISTS ix_child_vocab_depth
  ON child_vocabulary (child_id, nav_depth);

CREATE INDEX IF NOT EXISTS ix_boards_child_kind
  ON boards (child_id, kind);

-- I8: was there a layout change, and did errors rise after it?
CREATE INDEX IF NOT EXISTS ix_revisions_board_day
  ON board_revisions (board_id, day_local);

CREATE INDEX IF NOT EXISTS ix_revisions_disruptive
  ON board_revisions (board_id, changed_at)
  WHERE change_kind IN ('move','resize','remove');

-- ---------------------------------------------------------------------------
--  aggregates — small tables, but these are the LLM's hot path
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS ix_agg_daily_metric_lookup
  ON agg_daily_metric (metric_id, day_local, child_id);

CREATE INDEX IF NOT EXISTS ix_agg_card_stats_window
  ON agg_card_stats (child_id, window_end, taps);

CREATE INDEX IF NOT EXISTS ix_agg_word_pairs_missing
  ON agg_word_pairs (child_id, window_end, together);

-- ---------------------------------------------------------------------------
--  access control — hit on every single query, so keep them tight
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS ix_roster_adult
  ON roster (adult_id, relation);

CREATE INDEX IF NOT EXISTS ix_consent_active
  ON consent (child_id, tier)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_children_class
  ON children (class_id);

-- ---------------------------------------------------------------------------
--  fired_rules / insights / proposals — the feedback loop
-- ---------------------------------------------------------------------------

-- Open findings: fired, not dismissed, not superseded.
CREATE INDEX IF NOT EXISTS ix_fired_rules_open
  ON fired_rules (child_id, insight_id, fired_at)
  WHERE dismissed_at IS NULL AND superseded_by IS NULL;

-- "Has this been raised and rejected before?" — checked before re-raising.
CREATE INDEX IF NOT EXISTS ix_fired_rules_dismissed
  ON fired_rules (child_id, insight_id, dismissed_at)
  WHERE dismissed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_insights_by_rule
  ON insights (fired_rule_id);

CREATE INDEX IF NOT EXISTS ix_proposals_pending
  ON board_change_proposals (child_id, status)
  WHERE status = 'pending';

ANALYZE;

-- ---------------------------------------------------------------------------
--  v2: sessions, sentence shapes, reports
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS ix_sessions_child_day
  ON sessions (child_id, day_local);

CREATE INDEX IF NOT EXISTS ix_sessions_worst
  ON sessions (child_id, mistaps DESC);

CREATE INDEX IF NOT EXISTS ix_utt_structures_pattern
  ON utterance_structures (pattern_id);

CREATE INDEX IF NOT EXISTS ix_reports_child_period
  ON reports (child_id, period_end DESC);
