/**
 * Metric readers.
 *
 * Scalar metrics come from agg_daily_metric, which tools/rollup.py materialises
 * from v_daily_metrics_all. Dimensional metrics (per card, per cell, per pair,
 * per scene) come from their views directly — they have no scalar form and
 * never appear in agg_daily_metric.
 *
 * Every returned value carries `n`. A rate computed from four sentences is not
 * the same claim as one computed from forty-seven, and the UI is required to
 * say so.
 */
import { all, one, type Window } from './db'
import { metric, type MetricMeta } from './catalog'
import { previousWindow } from './db'

export type MetricValue = {
  metric_id: string
  meta: MetricMeta | undefined
  value: number | null
  n: number
  comparison: number | null
  delta: number | null
  daysWithData: number
  /** Non-null when the value is withheld rather than absent. */
  suppressed: 'small_sample' | 'not_collected' | null
}

/**
 * How a daily metric rolls up across a window.
 *
 * The catalogue's `unit` cannot answer this: `taps_per_utterance` and
 * `new_words` are both `count`, but the first is a per-sentence median that
 * must be averaged and the second is a daily tally that must be summed.
 * Summing seven daily medians reports a child pressing 21 buttons per sentence.
 *
 * Default is a weighted mean, so a day with three sentences does not carry the
 * same weight as a day with forty.
 */
type Rollup = 'sum' | 'weighted_mean' | 'last'

const ROLLUP: Record<string, Rollup> = {
  // Genuine daily tallies.
  new_words: 'sum',
  teacher_modeling: 'sum',
  taps_saved: 'sum',
  vocabulary_gaps: 'sum',
  layout_stability: 'sum',
  cell_heat: 'sum',
  card_frequency: 'sum',
  word_pairs: 'sum',
  scene_distribution: 'sum',
  keyboard_use: 'sum',
  // Point-in-time — the newest value is the only meaningful one.
  silence_streak: 'last',
  zero_activation_days: 'last',
  position_consistency: 'last',
}

function rollupFor(metricId: string): Rollup {
  return ROLLUP[metricId] ?? 'weighted_mean'
}

function aggregate(metricId: string, childId: string, w: Window) {
  const mode = rollupFor(metricId)
  const expr =
    mode === 'sum'
      ? 'SUM(value)'
      : mode === 'last'
        ? 'value' // ordered below
        : 'SUM(value * n) / NULLIF(SUM(n), 0)'

  const sql =
    mode === 'last'
      ? `SELECT value, n, 1 AS days
         FROM agg_daily_metric
         WHERE child_id = ? AND metric_id = ? AND day_local BETWEEN ? AND ? AND value IS NOT NULL
         ORDER BY day_local DESC LIMIT 1`
      : `SELECT ${expr} AS value, SUM(n) AS n, COUNT(value) AS days
         FROM agg_daily_metric
         WHERE child_id = ? AND metric_id = ? AND day_local BETWEEN ? AND ?
           AND value IS NOT NULL`

  const row = one<{ value: number | null; n: number; days: number }>(sql, [
    childId,
    metricId,
    w.start,
    w.end,
  ])
  return {
    value: row?.value ?? null,
    n: Number(row?.n ?? 0),
    days: Number(row?.days ?? 0),
  }
}

export function readMetric(metricId: string, childId: string, w: Window): MetricValue {
  const meta = metric(metricId)
  const cur = aggregate(metricId, childId, w)
  const prev = aggregate(metricId, childId, previousWindow(w))

  // Nothing in agg_daily_metric at all means the pipeline does not produce this
  // metric yet — a different thing from "the sample was too small", and the UI
  // must not conflate them.
  const everRecorded =
    cur.days > 0 ||
    prev.days > 0 ||
    (one<{ c: number }>(
      `SELECT COUNT(*) c FROM agg_daily_metric WHERE metric_id = ? LIMIT 1`,
      [metricId],
    )?.c ?? 0) > 0

  let value = cur.value
  let suppressed: MetricValue['suppressed'] = null
  if (!everRecorded) {
    value = null
    suppressed = 'not_collected'
  } else if (value === null && rollupFor(metricId) === 'sum') {
    // A tally with no in-window rows is ZERO when the child was actually
    // there — the catalogue's own example: five cards added, new_words 0
    // means the additions missed. Only an absent child (no events at all in
    // the window) keeps it as no-data. The count view only emits rows on
    // days something happened, so this fill is what makes 0 representable.
    const active = one<{ c: number }>(
      `SELECT COUNT(*) c FROM events
       WHERE child_id = ? AND actor = 'child' AND day_local BETWEEN ? AND ? LIMIT 1`,
      [childId, w.start, w.end],
    )
    if ((active?.c ?? 0) > 0) value = 0
  } else if (meta && cur.n < meta.min_n) {
    value = null
    suppressed = 'small_sample'
  }

  const comparison = prev.value
  const delta = value !== null && comparison !== null ? value - comparison : null

  return {
    metric_id: metricId,
    meta,
    value,
    n: cur.n,
    comparison,
    delta,
    daysWithData: cur.days,
    suppressed,
  }
}

export function readMetrics(ids: string[], childId: string, w: Window): MetricValue[] {
  return ids.map((id) => readMetric(id, childId, w))
}

/** Point-in-time, not a windowed average — days since this child last spoke. */
export function silenceStreak(childId: string): number {
  const row = one<{ v: number }>(
    `
    SELECT CAST(julianday((SELECT MAX(day_local) FROM events))
              - julianday(MAX(day_local)) AS REAL) AS v
    FROM utterances
    WHERE child_id = ? AND actor = 'child' AND spoken = 1
    `,
    [childId],
  )
  return Math.max(0, Math.round(Number(row?.v ?? 999)))
}

/* ------------------------------------------------------------------------- *
 * Dimensional metrics — read from views, never from agg_daily_metric.
 * ------------------------------------------------------------------------- */

export type CardStat = {
  card_id: string
  label: string
  is_core: number
  is_essential: number
  taps: number
  active_days: number
  scene_count: number
  avg_nav_depth: number
  days_since_last: number
  last_day: string
}

export function topCards(childId: string, w: Window, limit = 8): CardStat[] {
  return all<CardStat>(
    `
    SELECT e.card_id, c.label, c.is_core, c.is_essential,
           COUNT(*)                      AS taps,
           COUNT(DISTINCT e.day_local)   AS active_days,
           COUNT(DISTINCT e.scene)       AS scene_count,
           AVG(COALESCE(e.nav_depth, 0)) AS avg_nav_depth,
           MAX(e.day_local)              AS last_day,
           0                             AS days_since_last
    FROM events e JOIN cards c ON c.card_id = e.card_id
    WHERE e.child_id = ? AND e.actor = 'child' AND e.type = 'card_tap'
      AND e.day_local BETWEEN ? AND ?
    GROUP BY e.card_id, c.label
    ORDER BY taps DESC
    LIMIT ?
    `,
    [childId, w.start, w.end, limit],
  )
}

export type NewWord = { label: string; first_day: string }

export function newWords(childId: string, w: Window, limit = 8): NewWord[] {
  return all<NewWord>(
    `
    WITH firsts AS (
      SELECT label, MIN(day_local) AS first_day
      FROM events
      WHERE child_id = ? AND actor = 'child' AND type = 'card_tap' AND label IS NOT NULL
      GROUP BY label
    )
    SELECT label, first_day FROM firsts
    WHERE first_day BETWEEN ? AND ?
    ORDER BY first_day DESC
    LIMIT ?
    `,
    [childId, w.start, w.end, limit],
  )
}

export type HeatCell = {
  grid_row: number
  grid_col: number
  taps: number
  mistaps: number
  label: string | null
  masked: number
}

export type HeatGrid = {
  board_id: string
  board_name: string
  grid_rows: number
  grid_cols: number
  cells: HeatCell[]
  /** True when a resize landed inside the window — coordinates are not comparable across it. */
  resizedInWindow: boolean
}

/**
 * Cell heat for the child's robust board.
 *
 * Keyed on the robust board deliberately. A mode holds no coordinates of its
 * own (clinical constraint C4) — it is a filtered view of the robust board — so
 * heat belongs to the robust layout and merging grid sizes would make the
 * coordinates mean two different things.
 */
export function cellHeat(childId: string, w: Window): HeatGrid | null {
  const board = one<{ board_id: string; name: string; grid_rows: number; grid_cols: number }>(
    `SELECT board_id, name, grid_rows, grid_cols FROM boards
     WHERE child_id = ? AND kind = 'robust' ORDER BY created_at LIMIT 1`,
    [childId],
  )
  if (!board) return null

  const cells = all<HeatCell>(
    `
    SELECT bc.grid_row, bc.grid_col, bc.masked, c.label,
           COALESCE(h.taps, 0)    AS taps,
           COALESCE(h.mistaps, 0) AS mistaps
    FROM board_cells bc
    LEFT JOIN cards c ON c.card_id = bc.card_id
    LEFT JOIN (
      SELECT grid_row, grid_col, SUM(taps) AS taps, SUM(mistaps) AS mistaps
      FROM agg_cell_heat
      WHERE child_id = ? AND board_id = ?
        AND window_start >= ? AND window_end <= ?
      GROUP BY grid_row, grid_col
    ) h ON h.grid_row = bc.grid_row AND h.grid_col = bc.grid_col
    WHERE bc.board_id = ?
    ORDER BY bc.grid_row, bc.grid_col
    `,
    [childId, board.board_id, w.start, w.end, board.board_id],
  )

  const resized =
    (one<{ c: number }>(
      `SELECT COUNT(*) c FROM board_revisions
       WHERE board_id = ? AND change_kind = 'resize' AND day_local BETWEEN ? AND ?`,
      [board.board_id, w.start, w.end],
    )?.c ?? 0) > 0

  return {
    board_id: board.board_id,
    board_name: board.name,
    grid_rows: board.grid_rows,
    grid_cols: board.grid_cols,
    cells,
    resizedInWindow: resized,
  }
}

export type AbandonPoint = { day_local: string; rate: number; n: number }

export function abandonmentTrend(childId: string, w: Window): AbandonPoint[] {
  // Day-grain read, so min_n masks per DAY: the rollup stores true values for
  // every day and each reader suppresses at its own grain.
  return all<AbandonPoint>(
    `
    SELECT a.day_local,
           CASE WHEN a.n >= mc.min_n THEN a.value END AS rate,
           a.n
    FROM agg_daily_metric a
    JOIN metrics_catalog mc ON mc.metric_id = a.metric_id
    WHERE a.child_id = ? AND a.metric_id = 'abandonment_rate'
      AND a.day_local BETWEEN ? AND ?
    ORDER BY a.day_local
    `,
    [childId, w.start, w.end],
  )
}

/* ------------------------------------------------------------------------- *
 * Group F — AI value.
 *
 * These read the event log directly rather than agg_daily_metric, because the
 * suggestion and gap events they depend on are not yet emitted by any client.
 * Returning zeroes would be a lie; the callers render an explicit
 * "not collected yet" state instead. See notCollected() below.
 * ------------------------------------------------------------------------- */

export type SuggestionFunnel = {
  shown: number
  tapped: number
  spoken: number
  acceptance: number | null
  collected: boolean
}

export function suggestionFunnel(childId: string, w: Window): SuggestionFunnel {
  const row = one<{ shown: number; tapped: number }>(
    `
    SELECT
      SUM(CASE WHEN type = 'suggestion_shown' THEN 1 ELSE 0 END) AS shown,
      SUM(CASE WHEN type = 'suggestion_tap'   THEN 1 ELSE 0 END) AS tapped
    FROM events
    WHERE child_id = ? AND day_local BETWEEN ? AND ?
    `,
    [childId, w.start, w.end],
  )
  const spoken = Number(
    one<{ c: number }>(
      `SELECT COUNT(*) c FROM utterances
       WHERE child_id = ? AND actor='child' AND spoken=1 AND used_suggestion=1
         AND day_local BETWEEN ? AND ?`,
      [childId, w.start, w.end],
    )?.c ?? 0,
  )
  const shown = Number(row?.shown ?? 0)
  const tapped = Number(row?.tapped ?? 0)
  return {
    shown,
    tapped,
    spoken,
    acceptance: shown > 0 ? tapped / shown : null,
    collected: shown > 0,
  }
}

export type TapsSaved = {
  withoutAi: number | null
  withAi: number | null
  uses: number
  saved: number | null
  nWithout: number
  nWith: number
}

/**
 * F2 — the product claim in effort units.
 *
 * Both arms are restricted to spoken utterances so the two medians describe the
 * same population. (An earlier version compared a mean including abandoned
 * attempts against a mean that excluded them, which flattered the result.)
 */
export function tapsSaved(childId: string, w: Window): TapsSaved {
  const row = one<{
    without_ai: number | null
    with_ai: number | null
    uses: number
    n_without: number
    n_with: number
  }>(
    `
    SELECT
      AVG(CASE WHEN used_suggestion = 0 THEN tap_count END) AS without_ai,
      AVG(CASE WHEN used_suggestion = 1 THEN tap_count END) AS with_ai,
      SUM(used_suggestion)                                  AS uses,
      SUM(CASE WHEN used_suggestion = 0 THEN 1 ELSE 0 END)  AS n_without,
      SUM(CASE WHEN used_suggestion = 1 THEN 1 ELSE 0 END)  AS n_with
    FROM utterances
    WHERE child_id = ? AND actor = 'child' AND spoken = 1
      AND day_local BETWEEN ? AND ?
    `,
    [childId, w.start, w.end],
  )
  const withoutAi = row?.without_ai ?? null
  const withAi = row?.with_ai ?? null
  const uses = Number(row?.uses ?? 0)
  return {
    withoutAi,
    withAi,
    uses,
    saved: withoutAi !== null && withAi !== null ? (withoutAi - withAi) * uses : null,
    nWithout: Number(row?.n_without ?? 0),
    nWith: Number(row?.n_with ?? 0),
  }
}

export type VocabGap = {
  concept: string
  asked: number
  scenes: string
  days: string
}

export function vocabularyGaps(childId: string, w: Window): VocabGap[] {
  return all<VocabGap>(
    `
    SELECT json_extract(payload, '$.normalizedConcept') AS concept,
           COUNT(*)                                     AS asked,
           GROUP_CONCAT(DISTINCT scene)                 AS scenes,
           GROUP_CONCAT(DISTINCT day_local)             AS days
    FROM events
    WHERE child_id = ? AND type = 'gap_detected'
      AND json_extract(payload, '$.resolvedBy') = 'generated'
      AND day_local BETWEEN ? AND ?
    GROUP BY concept
    ORDER BY asked DESC
    `,
    [childId, w.start, w.end],
  )
}

export type VisualSource = { resolved_by: string; count: number }

export function visualSourceSplit(childId: string, w: Window): VisualSource[] {
  return all<VisualSource>(
    `
    SELECT json_extract(payload, '$.resolvedBy') AS resolved_by, COUNT(*) AS count
    FROM events
    WHERE child_id = ? AND type = 'gap_detected' AND day_local BETWEEN ? AND ?
    GROUP BY resolved_by
    ORDER BY count DESC
    `,
    [childId, w.start, w.end],
  )
}

/**
 * Whether an event type has ever been recorded at all.
 *
 * The dashboard distinguishes three states, and conflating the first two is the
 * classic analytics lie:
 *   - the client does not emit this yet   -> "not collected"
 *   - it emits, and the count is zero     -> a real zero
 *   - the sample is too small to report   -> suppressed
 */
export function eventTypeCollected(type: string): boolean {
  return (
    (one<{ c: number }>(`SELECT COUNT(*) c FROM (SELECT 1 FROM events WHERE type = ? LIMIT 1)`, [
      type,
    ])?.c ?? 0) > 0
  )
}
