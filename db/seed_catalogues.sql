-- ============================================================================
--  AAC ANALYTICS — metrics_catalog + insights_catalog seed
--
--  THIS IS THE LLM'S DATA DICTIONARY. It is served as MCP resources
--  `schema://dictionary` and `schema://insights`, and every metric value the
--  MCP server returns is accompanied by its row from here.
--
--  A number without its unit, polarity, minimum sample size and caveat is how
--  a language model becomes confidently wrong. Every field below exists to
--  prevent a specific misreading. Do not trim this file for brevity.
--
--  38 metrics: 30 shown · 4 logged-only · 4 cut
--   8 insights: I1-I8
--
--  Apply after schema.sql:  sqlite3 aac.db < db/seed_catalogues.sql
-- ============================================================================

DELETE FROM metrics_catalog;

-- ============================================================================
--  GROUP A — EFFORT & SPEED
-- ============================================================================

INSERT INTO metrics_catalog VALUES
('taps_per_utterance','Taps per utterance','A',
 'How many buttons the child presses to say one thing.',
 'median(count of card_tap events grouped by utterance_id), per day, child actor only',
 'count','lower_better','P0','teacher,parent,slt',5,'["I3"]',
 'Use the MEDIAN, never the mean: one 12-tap struggle distorts an average. A rise is not automatically bad - it can mean the child is building longer, richer sentences. Always read alongside mlu and independence_rate before concluding anything.',
 'shown',NULL),

('composition_time','Composition time','A',
 'Seconds from the first button press to pressing Speak.',
 'median(utterances.ms_compose) per day, spoken utterances only',
 'ms','neutral','P0','teacher,slt',5,'[]',
 'Neutral on purpose. Slow with FEW taps suggests scanning or thinking; slow with MANY taps suggests fighting the layout. Faster is not a goal in itself - a child taking longer to say something better has improved.',
 'shown',NULL),

('time_to_first_tap','Time to first tap','A',
 'The pause between someone finishing speaking and the child starting to answer.',
 'median(utterances.ms_to_first_tap) where a partner_turn ended within 30s before',
 'ms','neutral','P0','slt',5,'["I1","I2"]',
 'A HIGH value may not be about the child. AAC users produce ~15 words per minute against 150-170 for speech; partners are expected to wait. Before reading this as slow processing, check partner_wait_time - the adult may have filled the silence or changed the subject.',
 'shown',NULL),

('words_per_minute','Words per minute','A',
 'Speaking rate in words of spoken output per active minute.',
 'sum(utterances.word_count) / active_minutes, per day',
 'wpm','neutral','P1','teacher,parent,slt',20,'[]',
 'AAC rates sit around 2-15 wpm against 150-170 for speech. NEVER compare to typing or talking, and never across children. Render as caption text, not a headline tile - a big number invites exactly the wrong comparison.',
 'logged','Recognisable but not actionable. Shown as small caption text under taps_per_utterance, never as a KPI tile.'),

('inter_tap_interval','Pause between taps','A',
 'Typical gap between one button press and the next within a sentence.',
 'median(events.ms_delta) where type = card_tap and ms_delta is not null',
 'ms','neutral','P2','slt',10,'[]',
 'Steady rhythm suggests fluent retrieval; spiky suggests every word is a fresh search. Nobody acts on this directly - query it when a specific question comes up.',
 'logged','Fully derivable, no adult acts on it directly.');

-- ============================================================================
--  GROUP B — ERRORS & MOTOR
--  NOTE: repetition is NOT in this group. See group H and clinical constraint C1.
-- ============================================================================

INSERT INTO metrics_catalog VALUES
('mistap_rate','Unintended activation rate','B',
 'How often a button was pressed and then deleted almost immediately - a press the child did not mean.',
 'count(delete_last where ms_delta < mistap_threshold_ms) / count(card_tap), per day',
 'ratio','lower_better','P0','teacher,slt',30,'["I1","I8"]',
 'REQUIRES A DELETE. Repeated pressing WITHOUT a delete is never counted here - that is repeat_tap_rate, and it is normal communication, not error. The 1500ms threshold is a starting default: for athetoid cerebral palsy 2500ms is often more accurate. Sustained above ~10% points at layout or physical access, not at learning.',
 'shown',NULL),

('correction_adjacent_rate','Correction adjacency','B',
 'When the child fixes a mistake, how often the replacement is the button right next door.',
 'of mis-taps: count where abs(row_deleted - row_next) <= 1 and abs(col_deleted - col_next) <= 1, over count(mis-taps)',
 'ratio','neutral','P0','teacher,slt',10,'["I1"]',
 'A classifier, not a score - neither high nor low is good. HIGH means the finger slipped (motor). LOW means the child changed their mind (semantic). This single ratio is what separates a physical access problem from a comprehension problem, and the two need opposite responses.',
 'shown',NULL),

('abandonment_rate','Abandoned utterances','B',
 'How often the child builds a sentence and then gives up without speaking it.',
 'count(utterances where spoken = 0) / count(all utterances), per day',
 'ratio','lower_better','P0','teacher,slt',10,'["I2"]',
 'The quietest failure mode in AAC: the child tried, nothing was said, so nobody noticed. Often more urgent than low volume. Check abandon_reason - "timeout" and "navigated_away" suggest the partner moved on, which makes this a partner metric too.',
 'shown',NULL),

('cell_heat','Grid heat map','B',
 'Which grid positions get pressed, and where mistakes cluster.',
 'count(card_tap) and count(mis-taps) grouped by (board_id, grid_rows, grid_cols, grid_row, grid_col)',
 'count','neutral','P1','slt',50,'["I1","I3"]',
 'Read the two layers TOGETHER. A cold cell surrounded by hot mis-taps is a physically hard target, not an unknown word. Never merge results across different grid sizes - the coordinates mean different things. If the layout changed during the window, split the window at the change.',
 'shown',NULL);

-- ============================================================================
--  GROUP C — VOLUME & VOCABULARY
-- ============================================================================

INSERT INTO metrics_catalog VALUES
('silence_streak','Silence streak','C',
 'Days since the child last said anything at all.',
 'days between today and max(utterances.day_local where spoken = 1)',
 'days','lower_better','P0','teacher,parent,slt',1,'[]',
 'The most urgent number in the system and the main driver of the attention queue. A child who stops communicating needs a person today. Totals-based views hide them because their historical average still looks healthy.',
 'shown',NULL),

('utterances_per_day','Utterances per day','C',
 'How many things the child said today.',
 'count(utterances where spoken = 1 and actor = child) per day',
 'count','higher_better','P1','teacher,parent',1,'[]',
 'Raw volume. Folded into silence_streak, which is the version that actually drives action.',
 'logged','Superseded by silence_streak for decision-making.'),

('card_frequency','Card frequency','C',
 'Which cards the child actually uses, ranked.',
 'count(card_tap) grouped by card_id / label, over the window, child actor only',
 'count','neutral','P0','teacher,parent,slt',20,'["I3","I4"]',
 'Read forwards for go-to vocabulary and backwards for dead weight. Beware survivorship: a card can be low-frequency because it is hard to reach (check nav_depth_by_card and cell_heat) rather than because the child does not want it.',
 'shown',NULL),

('new_words','New words','C',
 'Cards used for the very first time during this window.',
 'labels whose earliest ever card_tap falls inside the window',
 'count','higher_better','P0','teacher,parent,slt',1,'[]',
 'Also a feedback loop on the adults'' own work: when someone adds five cards, this shows whether any were ever used. A zero here after a batch of additions means the additions missed.',
 'shown',NULL),

('zero_activation_days','Days at zero','C',
 'How long a card has gone unused, and in which situations.',
 'per card: consecutive days with zero taps, plus the distinct scenes it has ever been used in',
 'days','neutral','P0','teacher,slt',1,'["I4"]',
 'Neutral, not bad. Zero everywhere for 30 days suggests the card is obsolete. Zero in ONE scene while the child is otherwise active there may simply mean they do not want that thing - a preference, not a gap. Never route a preference to retraining.',
 'shown',NULL),

('ndw','Number of different words','C',
 'How many distinct words the child used.',
 'count(distinct label) across spoken utterances in the window',
 'count','higher_better','P1','slt',30,'["I5"]',
 'Standard AAC language-sampling measure. Strongly affected by window length - never compare a 3-day window to a 14-day one.',
 'shown',NULL),

('mlu','Words per utterance (MLU)','C',
 'Average sentence length in symbols.',
 'avg(utterances.symbol_count) across spoken utterances',
 'count','higher_better','P1','slt',20,'["I5"]',
 'Parked near 1.0 for weeks is the classic syntax plateau. IMPORTANT EXCEPTION: gestalt language processors use whole memorised phrases, which can read as a single long utterance or as many short ones depending on how cards are built. Check with the SLT before treating a low MLU as a deficit.',
 'shown',NULL),

('ttr','Type-token ratio','C',
 'Variety of vocabulary against repetition.',
 'ndw / total tokens in the window',
 'ratio','higher_better','P2','slt',50,'[]',
 'Unstable at small sample sizes and mostly restates what ndw and mlu already say.',
 'logged','Redundant with ndw + mlu; unstable at our sample sizes.'),

('word_pairs','Word pairs','C',
 'Which two words the child uses often but never together.',
 'co-occurrence counts over utterances.labels; only pairs where both words have >= 10 solo uses',
 'count','neutral','P1','slt',10,'["I5"]',
 'This is what makes the syntax plateau actionable. MLU tells you sentences are short; only this tells you WHICH combination is missing. Order-independent - (want, biscuit) and (biscuit, want) are one row.',
 'shown',NULL),

('core_fringe_ratio','Core vs fringe mix','C',
 'How much of the child''s output is flexible core vocabulary versus specific nouns.',
 'count(taps where cards.is_core = 1) / count(all taps), resolved against core_word_list',
 'ratio','neutral','P1','slt',50,'[]',
 'About 200 core words account for roughly 80% of everyday communication. A fringe-heavy profile means the child can name things but not combine, refuse or negotiate - the board becomes a picture menu. Neutral rather than higher-better because the right balance depends on the child and the day.',
 'shown',NULL);

-- ============================================================================
--  GROUP D — LAYOUT & CONTEXT
-- ============================================================================

INSERT INTO metrics_catalog VALUES
('nav_depth_by_card','Path depth','D',
 'How many screens deep a card is buried.',
 'avg(events.nav_depth) grouped by card_id, or board_cells.nav_depth for the current layout',
 'count','lower_better','P1','teacher,slt',10,'["I3"]',
 'Only meaningful crossed with card_frequency: a rarely used word at depth 4 is fine, a top-5% word at depth 4 is a tax on every conversation. Fringe vocabulary in particular should be reachable without many navigation steps.',
 'shown',NULL),

('scene_distribution','Scene distribution','D',
 'Where the child communicates, and where they go quiet.',
 'count(utterances) grouped by scene; also per-label and per-function breakdowns',
 'count','neutral','P1','teacher,slt',20,'["I4","I6"]',
 'Uneven distribution is expected - a child talks more in class than in a car. What matters is a word or function that appears in ONE scene and nowhere else, which points at a skill bound to the setting it was taught in.',
 'shown',NULL),

('layout_stability','Layout stability','D',
 'How often button positions have changed, and whether errors rose afterwards.',
 'count(board_revisions where change_kind in (move, resize, remove)) per window, plus the mistap_rate delta in the 7 days after each',
 'count','higher_better','P1','teacher,slt',1,'["I8"]',
 'Motor plans depend on buttons staying put - every relocation forces relearning. This metric holds the SYSTEM accountable: if the dashboard recommends a layout change, this measures the damage that advice caused. Higher stability is better. A spike in changes with a following rise in mis-taps is a self-inflicted regression, not the child declining.',
 'shown',NULL),

('position_consistency','Position consistency','D',
 'Whether AI-generated modes keep cards where the child already learned them.',
 'count(cards in an active mode sitting at their canonical board position) / count(cards in that mode)',
 'ratio','higher_better','P1','teacher,slt',5,'["I8"]',
 'Target is exactly 1.0. A mode is meant to be a filtered VIEW of the robust board - highlighting relevant words while leaving every position untouched. Anything below 1.0 means our own AI is teaching a second, conflicting motor plan. This is a product defect metric, not a child metric.',
 'shown',NULL),

('time_of_day_chart','Time of day','D',
 'Hour-by-hour communication histogram.',
 'count(utterances) bucketed by local hour',
 'count','neutral','P2','teacher',20,'[]',
 'Timestamps are still logged; only the chart was cut.',
 'cut','Chart cut for surface area. tsLocal remains in every event, so this can be enabled later as config.');

-- ============================================================================
--  GROUP E — WHOSE VOICE
-- ============================================================================

INSERT INTO metrics_catalog VALUES
('independence_rate','Independence','E',
 'Share of sentences the child built themselves, without taking an AI suggestion.',
 'count(utterances where used_suggestion = 0 and actor = child) / count(utterances where actor = child)',
 'ratio','higher_better','P0','teacher,parent,slt',10,'[]',
 'The guardrail against the AI quietly becoming the speaker. Independence RISING while taps_per_utterance FALLS is the product working. Independence falling means the AI is over-reaching, no matter how good suggestion_acceptance looks. Read the two together, never separately.',
 'shown',NULL),

('pragmatic_function_mix','What language is used for','E',
 'The balance across the eight reasons people communicate.',
 'count(utterances) grouped by function: request, protest, comment, direct, ask_question, give_opinion, share_news, start_conversation',
 'ratio','neutral','P1','teacher,slt',20,'["I6"]',
 'The single most-cited roadblock in AAC practice is that the system gets used for requesting and nothing else. Most AAC users sit near 90% requesting. Growth looks like commenting, protesting and questioning APPEARING - not like requesting decreasing. Frame any imbalance as a goal to set, never as a failure to report.',
 'shown',NULL),

('teacher_modeling','Adult modelling','E',
 'How often the grown-up demonstrates on the device (aided language input).',
 'count(card_tap where actor = adult) per day, optionally grouped by card category',
 'count','higher_better','P1','teacher,slt',1,'["I7"]',
 'The only signal in the system about the adult, and among the strongest predictors of AAC progress. Requires Modeling Mode to be switched on, so a zero may mean "did not model" OR "modelled without switching the mode on" - check before concluding. Model without expectation: this metric must never be used to argue the child should have responded.',
 'shown',NULL);

-- ============================================================================
--  GROUP F — AI VALUE
-- ============================================================================

INSERT INTO metrics_catalog VALUES
('suggestion_acceptance','Suggestion acceptance','F',
 'How often the child taps an AI suggestion that was offered.',
 'count(suggestion_tap) / count(individual suggestions shown)',
 'ratio','neutral','P0','teacher,parent,slt',20,'[]',
 'Neutral, not higher-better: a very high rate alongside falling independence_rate means the AI is putting words in the child''s mouth. Below roughly 20% the strip is visual clutter and should be shown less often - an ignored suggestion still costs scanning effort.',
 'shown',NULL),

('taps_saved','Taps saved','F',
 'How many button presses the AI spared the child.',
 '(median taps_per_utterance without a suggestion - median with) * count(utterances that used one)',
 'count','higher_better','P0','teacher,parent,slt',20,'[]',
 'The product claim in the unit that matters to someone with a motor impairment: physical effort not spent. Requires at least 20 utterances in each arm to mean anything. Do not report if either arm is thin.',
 'shown',NULL),

('vocabulary_gaps','Vocabulary gaps','F',
 'Concepts the child reached for that did not exist on the board.',
 'gap_detected events where resolvedBy = generated, grouped by normalised concept',
 'count','neutral','P0','teacher,slt',1,'[]',
 'One event serving two purposes: an AI cost metric and the teacher''s curriculum to-do list. Also fed by repeat_tap_rate - repeated pressing with no matching vocabulary is a gap signal, not an error signal.',
 'shown',NULL),

('visual_source_split','Where images came from','F',
 'Share of image needs met from local icons and cache versus paid generation.',
 'count(gap_detected) grouped by resolvedBy: icon_pack, card_library, hash_cache, semantic, generated, failed',
 'ratio','neutral','P1','teacher,parent,slt',10,'[]',
 'Cost control made visible. Target is at least 90% resolved before reaching generation. A rising generated share means the resolution ladder is mistuned or the child has moved into genuinely new territory - check vocabulary_gaps to tell which.',
 'shown',NULL),

('generated_keep_rate','Generated card keep-rate','F',
 'Whether AI-generated cards actually get reused.',
 'count(generated cards used >= 3 times) / count(generated cards)',
 'ratio','higher_better','P2','teacher,slt',10,'[]',
 'Would show whether generation produces vocabulary or clutter.',
 'cut','visual_source_split covers the cost story; retention deferred.');

-- ============================================================================
--  GROUP G — COMMUNICATION PARTNER
--  These measure the ADULT. They exist because a slow or absent response is
--  often the partner's doing, not the child's.
-- ============================================================================

INSERT INTO metrics_catalog VALUES
('partner_wait_time','Partner wait time','G',
 'How long the adult waits before speaking again when the child has not yet responded.',
 'median(partner_turns.ms_to_next_partner_turn) where child_responded = 0',
 'ms','higher_better','P2','teacher,slt',10,'["I2"]',
 'AAC users produce around 15 words per minute; partners routinely give under two seconds. A low value here means the adult filled the silence, and it will show up as the CHILD looking slow or unresponsive. Always show this next to time_to_first_tap so the adult sees their own number beside the child''s.',
 'shown',NULL),

('partner_interruption_rate','Partner interruptions','G',
 'How often an adult starts talking while the child is mid-sentence.',
 'count(partner_turns where interrupted_utterance_id is not null) / count(partner_turns)',
 'ratio','lower_better','P2','teacher,slt',10,'["I2"]',
 'Strongly linked to abandonment_rate: a child interrupted mid-composition often gives up. If both are high, the intervention is partner coaching, not anything aimed at the child.',
 'shown',NULL);

-- ============================================================================
--  GROUP H — COMMUNICATION STYLE
--  Deliberately NOT filed under errors. See clinical constraint C1.
-- ============================================================================

INSERT INTO metrics_catalog VALUES
('repeat_tap_rate','Repeated pressing','H',
 'How often the child presses the same button several times in a row.',
 'count(runs of >= 3 consecutive card_tap on the same card_id with NO delete) / count(utterances)',
 'ratio','neutral','P0','teacher,slt',10,'["I4"]',
 'THIS IS NOT AN ERROR AND MUST NEVER BE STYLED AS ONE. Repetition has four normal causes: communicating something there is no word for, learning where a button is (repetition is how motor automaticity forms), language development including gestalt processing, and stimming for self-regulation. Trying to reduce repetition reduces overall communication. If repetition is high in a scene where vocabulary coverage is thin, treat it as a VOCABULARY GAP signal - the child may be reaching for a word that does not exist.',
 'shown',NULL),

('keyboard_use','Keyboard use','H',
 'Spelling and alphabet access - words typed rather than selected.',
 'count(keyboard_input events); words spelled that have no matching card',
 'count','neutral','P2','teacher,slt',5,'[]',
 'Alphabet access is one of the four pillars of a robust AAC system, and we have not built it yet. Defined here so the schema anticipates it. Words spelled with no matching card are the highest-quality vocabulary-gap signal available - the child told you exactly what is missing.',
 'shown',NULL);

-- ============================================================================
--  CUT — kept in the catalogue so the decision is not re-litigated
-- ============================================================================

INSERT INTO metrics_catalog VALUES
('peer_baseline','Peer baseline','D',
 'Where a child sits against similar children.',
 'percentile of any metric against a matched cohort',
 'ratio','neutral','P2','slt',200,'["I2"]',
 'Would give "5 seconds is slow" a reference point.',
 'cut','Statistical noise at our cohort size; presenting it would imply rigour we do not have. Insights compare against the child''s own 4-week rolling average instead.'),

('post_delete_entropy','Wandering after a delete','B',
 'Whether recovery after a deletion is purposeful or scattered.',
 'contextual fit of the next 3 taps following a delete_last',
 'index','neutral','P2','slt',20,'["I1"]',
 'Would add a second signal for separating motor from semantic errors.',
 'cut','Fuzzy to define, and correction_adjacent_rate already separates motor from semantic reliably.');

-- ============================================================================
--  THE REPORT SET  (proposed_metrics.docx)
--
--  Eight metrics, four traditional and four AI-generated. The generated report
--  may cite these and nothing else. Marking the set here rather than in a
--  prompt makes the rule checkable after the fact.
-- ============================================================================

ALTER TABLE metrics_catalog ADD COLUMN report_set INTEGER NOT NULL DEFAULT 0;
ALTER TABLE metrics_catalog ADD COLUMN chart TEXT;
ALTER TABLE metrics_catalog ADD COLUMN report_rank INTEGER;

-- --- the three new AI metrics ---------------------------------------------

INSERT INTO metrics_catalog
 (metric_id,name,group_code,plain_explanation,formula,unit,polarity,tier,audience,
  min_n,feeds_insights,caveat,status,cut_reason,report_set,chart,report_rank)
VALUES
('feeling_words','Feeling words','H',
 'Which feeling words the child used, grouped as positive, neutral or upset.',
 'count(card_tap) joined to emotion_lexicon, grouped by category, over the window',
 'ratio','neutral','P1','teacher,parent,slt',5,'[]',
 'A LOW-FREQUENCY metric — a child may use two feeling words in a day, so the card reads a whole window, not a single day. COUNTS WORDS USED — it does not measure how the child feels. An AAC user can only express feelings their board contains, so a board with no "frustrated" card reads positive whatever is going on. Always show how many feeling words were available alongside the mix.',
 'shown',NULL,1,'donut',5),

('sentence_shapes','Sentence shapes','C',
 'Which sentence structures are starting to appear, like "want + thing" or "I + doing word".',
 'utterance label sequences matched against syntax_patterns via cards.part_of_speech',
 'count','higher_better','P1','teacher,slt',20,'[]',
 'Counts structures APPEARING, never mistakes. Telegraphic output is taught AAC use: "want biscuit" is correct, not a missing determiner. A word absent from the board can never be counted against the child.',
 'shown',NULL,1,'scatter',6),

('answers_vs_starts','Answers and topic starts','E',
 'How often the child answers someone, and how often they start a topic themselves.',
 'utterances within 30s of a partner_turn = answer; otherwise = self-started',
 'ratio','neutral','P2','teacher,slt',20,'[]',
 'NEITHER END IS BETTER, which is why this is a split and not a score. Starting a topic is a higher-order skill than answering, so a rising share of self-started turns is growth — but a child who answers well is also communicating. Never render this as a gauge.',
 'shown',NULL,1,'split_bar',7);

-- --- the selected set, from docs/AAC_Filtered_Metric_Index.md ---------------
--
-- Thirteen metrics across seven groups. This REPLACES the earlier eight-metric
-- set from proposed_metrics.docx. The metrics that set introduced
-- (feeling_words, sentence_shapes, answers_vs_starts) keep computing and stay
-- visible elsewhere — they are simply not part of the report.

UPDATE metrics_catalog SET report_set = 0, report_rank = NULL, chart = NULL;

UPDATE metrics_catalog SET report_set=1, report_rank=1,  chart='line',
  name='Buttons to say one thing'   WHERE metric_id='taps_per_utterance';
UPDATE metrics_catalog SET report_set=1, report_rank=2,  chart='split_bar',
  name='Where corrections land'     WHERE metric_id='correction_adjacent_rate';
UPDATE metrics_catalog SET report_set=1, report_rank=3,  chart='grid',
  name='Which buttons get reached'  WHERE metric_id='cell_heat';
UPDATE metrics_catalog SET report_set=1, report_rank=4,  chart='calendar',
  name='Days since she last spoke'  WHERE metric_id='silence_streak';
UPDATE metrics_catalog SET report_set=1, report_rank=5,  chart='ranked_bar',
  name='Her go-to words'            WHERE metric_id='card_frequency';
UPDATE metrics_catalog SET report_set=1, report_rank=6,  chart='line',
  name='New words'                  WHERE metric_id='new_words';
UPDATE metrics_catalog SET report_set=1, report_rank=7,  chart='table',
  name='Words not yet paired'       WHERE metric_id='word_pairs';
UPDATE metrics_catalog SET report_set=1, report_rank=8,  chart='donut',
  name='Flexible words vs naming'   WHERE metric_id='core_fringe_ratio';
UPDATE metrics_catalog SET report_set=1, report_rank=9,  chart='scatter',
  name='How deep words are buried'  WHERE metric_id='nav_depth_by_card';
UPDATE metrics_catalog SET report_set=1, report_rank=10, chart='bar',
  name='Adult demonstrating'        WHERE metric_id='teacher_modeling';
UPDATE metrics_catalog SET report_set=1, report_rank=11, chart='line',
  name='How long the adult waits'   WHERE metric_id='partner_wait_time';
UPDATE metrics_catalog SET report_set=1, report_rank=12, chart='line',
  name='Repeated pressing'          WHERE metric_id='repeat_tap_rate';
UPDATE metrics_catalog SET report_set=1, report_rank=13, chart='none',
  name='Spelling and the alphabet'  WHERE metric_id='keyboard_use';

-- new_words reverts to a COUNT. The filtered index defines it as "cards used
-- for the very first time during this window", not the proportion the earlier
-- docx asked for. The proportion is still shown as the sub-line.

-- Plain-language names for everything else on the student page. The catalogue
-- already carried `name`; several were still engineer's names.
UPDATE metrics_catalog SET name='Presses she did not mean' WHERE metric_id='mistap_rate';
UPDATE metrics_catalog SET name='Where corrections land'   WHERE metric_id='correction_adjacent_rate';
UPDATE metrics_catalog SET name='Built but not spoken'     WHERE metric_id='abandonment_rate';
UPDATE metrics_catalog SET name='Buttons to say one thing' WHERE metric_id='taps_per_utterance';
UPDATE metrics_catalog SET name='Time to start answering'  WHERE metric_id='time_to_first_tap';
UPDATE metrics_catalog SET name='Days since she last spoke' WHERE metric_id='silence_streak';
UPDATE metrics_catalog SET name='Her own words'            WHERE metric_id='independence_rate';
UPDATE metrics_catalog SET name='Repeated pressing'        WHERE metric_id='repeat_tap_rate';
UPDATE metrics_catalog SET name='Adult demonstrating'      WHERE metric_id='teacher_modeling';

-- ============================================================================
--  INSIGHTS
-- ============================================================================

DELETE FROM insights_catalog;

INSERT INTO insights_catalog VALUES
('I1','Unintended presses: physical or conceptual?',
 'The child is pressing buttons they did not mean. The question is whether their hand missed or their meaning changed.',
 'mistap_rate > 8% across 5+ sessions. Then classify: correction_adjacent_rate HIGH and time_to_first_tap normal => MOTOR. correction_adjacent_rate LOW and time_to_first_tap elevated => SEMANTIC.',
 '["mistap_rate","correction_adjacent_rate","time_to_first_tap","cell_heat"]',
 '{"mistap_rate_min":0.08,"min_sessions":5,"mistap_threshold_ms":1500,"adjacent_ratio_motor":0.6}',
 '["MOTOR: mask the neighbouring cells of the error-prone target, leaving every other position untouched","MOTOR: physical access changes - keyguard, mount angle, dwell-select, longer touch-hold","MOTOR: increase touch target padding within the SAME grid","SEMANTIC: reteach the concept, pair with a real photograph","SEMANTIC: reduce visual distractors near the target"]',
 '["resize_grid","move_card","reduce_repetition","retrain_without_access_check"]',
 'adult','intervention',
 'With cerebral palsy, unintended presses are frequent and normal. Default to the MOTOR reading when the split is ambiguous. Never recommend shrinking the grid: every relocation destroys the motor plan the child has built. Phrase as "this looks like a reach problem - does that match what you see?"'),

('I2','Slow to start, or not given time?',
 'Long pauses before the child answers. This may be scanning difficulty, or the adult not waiting.',
 'time_to_first_tap > own 4-week baseline + 2 standard deviations (fallback 5000ms) AND the eventual tap was contextually correct AND no delete followed.',
 '["time_to_first_tap","partner_wait_time","partner_interruption_rate","abandonment_rate"]',
 '{"sigma_multiplier":2,"fallback_ms":5000,"baseline_weeks":4}',
 '["Reduce cells per page by masking, not resizing","Keep card positions identical across every mode","Colour-code by category; anchor high-use cards to a fixed corner","Coach the partner on wait time - show them partner_wait_time beside this number"]',
 '["resize_grid","move_card","demand_faster_response"]',
 'adult','intervention',
 'Always present the partner reading alongside the child reading. AAC output is around 15 words per minute; if partner_wait_time is under two seconds, the adult is the variable, not the child.'),

('I3','A much-used word is buried',
 'A word the child reaches for constantly sits several screens deep.',
 'card_frequency percentile >= 95 AND nav_depth_by_card >= 3.',
 '["card_frequency","nav_depth_by_card","cell_heat"]',
 '{"frequency_percentile":95,"min_nav_depth":3}',
 '["Add a COPY of the card at a stable prime position on the robust board","Unmask an existing copy if one is already there","Record the change in board_revisions so its effect is measured"]',
 '["move_card","resize_grid","remove_original"]',
 'adult','intervention',
 'Never relocate the original. Moving a learned button destroys the motor plan; adding a second copy costs nothing and preserves it. Duplicate cards are intended here, not a data-quality problem.'),

('I4','Unused word: obsolete, or simply not wanted?',
 'A card is going unused. Whether that means remove it or leave it alone depends entirely on which.',
 'CASE A: zero_activation_days >= 30 across ALL scenes => obsolete. CASE B: zero in one scene while the child is active there and protest-function use is high in that scene => preference.',
 '["zero_activation_days","card_frequency","scene_distribution","repeat_tap_rate","pragmatic_function_mix"]',
 '{"obsolete_days":30,"min_scene_activity":10}',
 '["CASE A: propose replacing the card with something currently relevant","CASE B: no action - record the preference and move on"]',
 '["retrain_preference","reintroduce_refused_item","treat_refusal_as_deficit"]',
 'adult','informational',
 'Case B must never route to retraining. Drilling a child to request something they have refused teaches them their "no" does not count. The refusal is successful communication.'),

('I5','Words known, not yet combined',
 'Two words the child uses constantly, never together.',
 'solo count of A >= 20 AND solo count of B >= 20 AND together = 0 AND mlu < 1.3.',
 '["word_pairs","mlu","ndw","composition_time"]',
 '{"min_solo":20,"max_mlu":1.3}',
 '["Model that specific pair during natural moments - aided language input, not drills","Model without expectation: no requirement for the child to copy","Keep modelling; one model is never enough"]',
 '["demand_imitation","test_the_child","reduce_repetition"]',
 'adult','intervention',
 'Target the named pair, not combining in general. Gestalt language processors may use whole phrases as single units - check with the SLT before reading a low MLU as a deficit.'),

('I6','Works in one place, not another',
 'A word or a whole communication function appears in therapy and nowhere else.',
 'frequency in scene=therapy is high AND frequency in scenes home/free_play = 0, sustained 2 consecutive weeks. Compare by FUNCTION as well as by word.',
 '["scene_distribution","card_frequency","pragmatic_function_mix","teacher_modeling"]',
 '{"weeks":2,"therapy_min_count":10}',
 '["Coach the partner in the other setting - the child already has the skill","Create real reasons to use the word there, rather than practising it","Model the same word in the new setting before expecting it"]',
 '["test_generalisation","demand_transfer","drill_in_therapy"]',
 'adult','intervention',
 'The intervention targets the adults in the other setting, never the child. A skill that has not generalised is an opportunity that has not been offered.'),

('I7','The adult has stopped modelling',
 'The child''s progress in a vocabulary area is falling while nobody has been demonstrating those words.',
 'child score in a vocabulary domain falling 2 consecutive weeks AND teacher_modeling in that domain is approximately zero.',
 '["teacher_modeling","card_frequency","new_words","pragmatic_function_mix"]',
 '{"weeks":2,"modeling_threshold":3}',
 '["Increase aided language input in that domain","Model without expectation - no requirement for the child to respond","Any modelling is better than none; model throughout the day, not only in sessions"]',
 '["blame_the_child","demand_output","test_the_child"]',
 'adult','intervention',
 'The only insight aimed squarely at a grown-up, and the one most likely to be resisted. Present evidence, never a verdict. Check whether Modeling Mode was simply left switched off before concluding no modelling happened.'),

('I8','Our own change broke something',
 'A layout change - ours or an adult''s - was followed by more unintended presses.',
 'a board_revisions row with change_kind in (move, resize, remove) OR position_consistency < 1.0 for an active mode, AND mistap_rate in the following 7 days exceeds the preceding 7 days by more than the child''s own week-to-week variance.',
 '["layout_stability","position_consistency","mistap_rate","cell_heat"]',
 '{"window_days":7,"variance_multiplier":1.0}',
 '["Revert the position change","Rebuild the mode as a filtered view of the robust board, preserving every position","Prefer masking over moving for any future change"]',
 '["blame_the_child","frame_as_regression","recommend_further_layout_change"]',
 'system','system_fix',
 'This insight points at us, not at the child. Without it, every layout recommendation the dashboard makes is unfalsifiable. Never present the resulting mis-tap rise as the child declining.');
