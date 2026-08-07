/**
 * Tool implementations. Every one returns the universal envelope from
 * docs/mcp-api.md §2 — data, meta, dictionary, guidance, forbidden_actions.
 *
 * The `guidance` array is the point of this file. A model that has to REMEMBER
 * to check whether the layout changed mid-window will eventually forget, and
 * then it tells a teacher a child regressed when an adult moved a button. So
 * the server computes the warnings and attaches them to the result that needs
 * them.
 */
import { randomUUID } from 'node:crypto'
import { Db, McpError, type Row } from './db.ts'

export interface Envelope {
  data: Record<string, unknown>
  meta: Record<string, unknown>
  dictionary?: Record<string, Row>
  guidance?: Guidance[]
  forbidden_actions?: string[]
  next_calls?: { tool: string; args: Record<string, unknown>; because: string }[]
}

interface Guidance {
  level: 'info' | 'warning' | 'critical'
  code: string
  detail: string
  affects?: string[]
}

const WINDOWS: Record<string, number> = {
  today: 1, last_7d: 7, last_14d: 14, last_28d: 28, term: 90,
}

function resolveWindow(db: Db, window = 'last_7d', start?: string, end?: string) {
  const maxDay = db.scalar<string>('SELECT MAX(day_local) FROM events')!
  if (window === 'custom') {
    if (!start || !end) throw new McpError('SQL_REJECTED', 'custom window needs start and end')
    const days = Math.round(
      (Date.parse(end) - Date.parse(start)) / 86_400_000
    ) + 1
    if (days > 120) throw new McpError('WINDOW_TOO_LARGE', `${days} days requested; maximum is 120.`, true)
    return { start, end, days }
  }
  // Loud rejection, not a silent 7-day fallback: a model that asked for
  // "28d" and silently received 7 days of numbers would caption them as a
  // month — the wrong window is worse than no answer.
  const days = WINDOWS[window]
  if (days === undefined) {
    throw new McpError(
      'SQL_REJECTED',
      `'${window}' is not a window. Allowed: ${Object.keys(WINDOWS).join(', ')}, custom.`,
    )
  }
  const s = db.scalar<string>(`SELECT date(?, '-${days - 1} days')`, [maxDay])!
  return { start: s, end: maxDay, days }
}

function dictionaryFor(db: Db, metricIds: string[]): Record<string, Row> {
  if (!metricIds.length) return {}
  const q = metricIds.map(() => '?').join(',')
  const rows = db.all(
    `SELECT metric_id, name, group_code, plain_explanation, formula, unit,
            polarity, tier, min_n, caveat
     FROM metrics_catalog WHERE metric_id IN (${q})`, metricIds)
  return Object.fromEntries(rows.map(r => [r.metric_id as string, r]))
}

/**
 * Warnings computed from the actual result. Order matters: `critical` items
 * invalidate comparisons outright and should be read before any number.
 */
function computeGuidance(
  db: Db, childId: string | null, w: { start: string; end: string },
  metrics: Row[] = [],
): Guidance[] {
  const g: Guidance[] = []
  const maxDay = db.scalar<string>('SELECT MAX(day_local) FROM events')

  // Three different reasons a value can be null, and conflating them is how a
  // model concludes a child stopped doing something they were never measured on.
  const small = metrics.filter(m => m.value === null && (m.n as number) > 0)
  const absent = metrics.filter(m => m.value === null && (m.n as number) === 0)
  if (small.length) {
    g.push({
      level: 'warning', code: 'SMALL_SAMPLE',
      detail: `${small.length} metric(s) returned null because n < min_n — measured, but too few observations to report. NOT zero, and NOT "did not happen".`,
      affects: small.map(m => m.metric_id as string),
    })
  }
  if (absent.length) {
    g.push({
      level: 'info', code: 'NOT_COLLECTED',
      detail: `${absent.length} metric(s) have no observations at all: the feature that produces them is not in use for this child. Draw no conclusion from their absence.`,
      affects: absent.map(m => m.metric_id as string),
    })
  }
  if (w.end === maxDay) {
    g.push({
      level: 'info',
      code: 'PARTIAL_WINDOW',
      detail: `${maxDay} is still being recorded — its numbers may rise as the day goes on.`,
    })
  }

  if (childId) {
    const revs = db.all(`
      SELECT r.day_local, r.change_kind, r.card_id
      FROM board_revisions r JOIN boards b ON b.board_id = r.board_id
      WHERE b.child_id = ? AND r.day_local BETWEEN ? AND ?
        AND r.change_kind IN ('move','resize','remove')`, [childId, w.start, w.end])
    if (revs.length) {
      const resized = revs.some(r => r.change_kind === 'resize')
      g.push({
        level: 'critical',
        code: resized ? 'GRID_RESIZED_MID_WINDOW' : 'LAYOUT_CHANGED_MID_WINDOW',
        detail: `${revs.length} disruptive layout change(s) inside this window (${
          revs.map(r => `${r.change_kind} on ${r.day_local}`).join(', ')
        }). Spatial and error metrics span two layouts and are not comparable across those dates.`,
        affects: ['cell_heat', 'mistap_rate', 'correction_adjacent_rate', 'taps_per_utterance'],
      })
    }

    const activeDays = db.scalar<number>(
      'SELECT COUNT(DISTINCT day_local) FROM events WHERE child_id = ?', [childId]) ?? 0
    if (activeDays < 14) {
      g.push({
        level: 'warning', code: 'BASELINE_THIN',
        detail: `Only ${activeDays} active days recorded. "Elevated vs baseline" is not yet meaningful.`,
      })
    }

    const gap = db.scalar<number>(`
      SELECT CAST(julianday(?) - julianday(MAX(day_local)) AS INTEGER)
      FROM utterances WHERE child_id = ? AND spoken = 1`, [w.end, childId])
    if (gap !== undefined && gap !== null && gap >= 2) {
      g.push({
        level: 'info', code: 'ABSENCE_IN_WINDOW',
        detail: `No communication recorded for the last ${gap} day(s). Rates cover active days only.`,
      })
    }

    const unknownShare = db.scalar<number>(`
      SELECT AVG(CASE WHEN scene = 'unknown' THEN 1.0 ELSE 0.0 END)
      FROM events WHERE child_id = ? AND day_local BETWEEN ? AND ?`, [childId, w.start, w.end])
    if ((unknownShare ?? 0) > 0.4) {
      g.push({
        level: 'warning', code: 'SCENE_MOSTLY_UNKNOWN',
        detail: `${Math.round((unknownShare ?? 0) * 100)}% of events have scene='unknown'. Scene comparisons are unreliable.`,
      })
    }

    const modelingDays = db.scalar<number>(
      "SELECT COUNT(DISTINCT day_local) FROM events WHERE child_id = ? AND actor = 'adult'",
      [childId]) ?? 0
    if (modelingDays === 0) {
      g.push({
        level: 'warning', code: 'MODELING_MODE_UNUSED',
        detail: 'No adult events at all. teacher_modeling of zero may mean "not recorded", not "did not happen".',
        affects: ['teacher_modeling'],
      })
    }

    const repeat = db.scalar<number>(`
      SELECT AVG(value) FROM agg_daily_metric
      WHERE child_id = ? AND metric_id = 'repeat_tap_rate' AND day_local BETWEEN ? AND ?`,
      [childId, w.start, w.end])
    if ((repeat ?? 0) > 0.15) {
      g.push({
        level: 'info', code: 'HIGH_REPETITION_NEUTRAL',
        detail: 'Repeated pressing is elevated. This is NOT an error: it is exploration, motor learning, gestalt processing or stimming. If vocabulary coverage is thin here, treat it as a possible vocabulary gap — never as a mistake to correct.',
        affects: ['repeat_tap_rate'],
      })
    }

    const wait = db.scalar<number>(`
      SELECT AVG(ms_to_next_partner_turn) FROM partner_turns
      WHERE child_id = ? AND child_responded = 0 AND day_local BETWEEN ? AND ?`,
      [childId, w.start, w.end])
    if (wait !== null && wait !== undefined && wait < 2000) {
      g.push({
        level: 'warning', code: 'PARTNER_WAIT_SHORT',
        detail: `The adult waits about ${Math.round(wait)} ms on average before speaking again. AAC output runs around 15 words per minute; any finding about the child being slow is confounded by this.`,
        affects: ['time_to_first_tap', 'abandonment_rate'],
      })
    }
  }
  return g
}

function base(db: Db, childId: string | null, w: { start: string; end: string; days: number }, rowCount: number, truncated = false) {
  const maxDay = db.scalar<string>('SELECT MAX(day_local) FROM events')
  return {
    child_id: childId,
    window: { start: w.start, end: w.end, days: w.days },
    row_count: rowCount,
    truncated,
    data_freshness: {
      rollup_through: db.scalar<string>('SELECT MAX(day_local) FROM agg_daily_metric') ?? null,
      live_from: maxDay,
      is_partial_day: w.end === maxDay,
    },
  }
}

// ---------------------------------------------------------------------------
// Dimensional slicing
//
// agg_daily_metric has one dimension: the day. Anything sliced by scene, hour
// or weekday has to be recomputed from L0/L1, so only the metrics that can be
// derived that way are supported — and asking for one that cannot is an ERROR,
// never a silently blended number.
// ---------------------------------------------------------------------------

type Dimension = 'scene' | 'hour' | 'day_of_week'

/**
 * Metrics that can be recomputed per-dimension from L0/L1. Everything else —
 * silence_streak, taps_saved, layout_stability, the AI-value metrics — has no
 * meaningful per-scene or per-hour form, and asking for one returns an error
 * naming this list rather than a blended number.
 */
const SLICEABLE_IDS = [
  'mistap_rate', 'taps_per_utterance', 'abandonment_rate', 'independence_rate',
  'mlu', 'composition_time', 'time_to_first_tap', 'ndw', 'core_fringe_ratio',
]


function bucketExpr(dim: Dimension, tzParam: string, tsCol = 'ts', dayCol = 'day_local'): string {
  switch (dim) {
    case 'scene':
      return 'scene'
    case 'hour':
      // ts is epoch ms UTC; the child's own offset makes it a local hour.
      return `CAST(strftime('%H', (${tsCol} + ${tzParam} * 60000) / 1000, 'unixepoch') AS INTEGER)`
    case 'day_of_week':
      return `CAST(strftime('%w', ${dayCol}) AS INTEGER)`
  }
}

function sliceMetrics(
  db: Db, childId: string, w: { start: string; end: string },
  dim: Dimension, metricIds: string[],
) {
  const tz = String(
    db.scalar<number>('SELECT COALESCE(MAX(tz_offset_min), 0) FROM events WHERE child_id = ?',
      [childId]) ?? 0)

  const uB = bucketExpr(dim, tz, 'u.ts', 'u.day_local')
  const eB = bucketExpr(dim, tz, 'e.ts', 'e.day_local')
  const tB = bucketExpr(dim, tz, 't.ts', 't.day_local')

  const U = `FROM utterances u WHERE u.child_id = ? AND u.actor='child' AND u.day_local BETWEEN ? AND ?`
  const P = [childId, w.start, w.end]

  const QUERIES: Record<string, { sql: string; params: unknown[] }> = {
    mistap_rate: {
      sql: `SELECT ${tB} AS bucket,
              CAST(SUM(CASE WHEN t.type='delete_last' AND t.ms_delta<1500 THEN 1 ELSE 0 END) AS REAL)
                / NULLIF(SUM(CASE WHEN t.type='card_tap' THEN 1 ELSE 0 END),0) AS value,
              SUM(CASE WHEN t.type='card_tap' THEN 1 ELSE 0 END) AS n
            FROM (SELECT s.*, e.ts, e.scene FROM v_tap_sequence s
                  JOIN events e ON e.child_id = s.child_id AND e.day_local = s.day_local
                                AND e.ts = s.ts AND e.type = s.type) t
            WHERE t.child_id = ? AND t.day_local BETWEEN ? AND ?
            GROUP BY bucket`, params: P },
    taps_per_utterance: {
      sql: `SELECT ${uB} AS bucket, AVG(u.tap_count) AS value, COUNT(*) AS n ${U} GROUP BY bucket`, params: P },
    abandonment_rate: {
      sql: `SELECT ${uB} AS bucket, AVG(CASE WHEN u.spoken=0 THEN 1.0 ELSE 0.0 END) AS value,
              COUNT(*) AS n ${U} GROUP BY bucket`, params: P },
    independence_rate: {
      sql: `SELECT ${uB} AS bucket, AVG(CASE WHEN u.used_suggestion=0 THEN 1.0 ELSE 0.0 END) AS value,
              COUNT(*) AS n ${U} AND u.spoken=1 GROUP BY bucket`, params: P },
    mlu: {
      sql: `SELECT ${uB} AS bucket, AVG(u.symbol_count) AS value, COUNT(*) AS n
            ${U} AND u.spoken=1 GROUP BY bucket`, params: P },
    composition_time: {
      sql: `SELECT ${uB} AS bucket, AVG(u.ms_compose) AS value, COUNT(*) AS n
            ${U} AND u.ms_compose IS NOT NULL GROUP BY bucket`, params: P },
    time_to_first_tap: {
      sql: `SELECT ${uB} AS bucket, AVG(u.ms_to_first_tap) AS value, COUNT(*) AS n
            ${U} AND u.ms_to_first_tap IS NOT NULL GROUP BY bucket`, params: P },
    ndw: {
      sql: `SELECT ${eB} AS bucket, COUNT(DISTINCT e.label) * 1.0 AS value, COUNT(*) AS n
            FROM events e WHERE e.child_id=? AND e.actor='child' AND e.type='card_tap'
              AND e.day_local BETWEEN ? AND ? GROUP BY bucket`, params: P },
    core_fringe_ratio: {
      sql: `SELECT ${eB} AS bucket, AVG(CASE WHEN c.is_core=1 THEN 1.0 ELSE 0.0 END) AS value,
              COUNT(*) AS n
            FROM events e JOIN cards c ON c.card_id = e.card_id
            WHERE e.child_id=? AND e.actor='child' AND e.type='card_tap'
              AND e.day_local BETWEEN ? AND ? GROUP BY bucket`, params: P },
  }

  const rows: Record<string, unknown>[] = []
  const unsupported: string[] = []
  for (const id of metricIds) {
    const q = QUERIES[id]
    if (!q) { unsupported.push(id); continue }
    const minN = db.scalar<number>(
      'SELECT min_n FROM metrics_catalog WHERE metric_id = ?', [id]) ?? 1
    for (const r of db.all(q.sql, q.params)) {
      const n = Number(r.n ?? 0)
      rows.push({
        metric_id: id,
        bucket: dim === 'day_of_week'
          ? ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][Number(r.bucket)] ?? r.bucket
          : r.bucket,
        value: n >= minN && r.value !== null ? Math.round(Number(r.value) * 10000) / 10000 : null,
        n,
        suppressed_reason: r.value === null ? 'not_collected' : n < minN ? 'small_sample' : null,
      })
    }
  }
  return { rows, unsupported }
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

type Args = Record<string, any>

export const tools: Record<string, { description: string; schema: object; run: (db: Db, a: Args) => Envelope }> = {

  list_children: {
    description: 'Children this adult may see, with the triage numbers. Always the first call.',
    schema: {
      type: 'object',
      properties: {
        adult_id: { type: 'string', description: 'Access is scoped through roster; expired rows excluded.' },
        class_id: { type: 'string' },
      },
      required: ['adult_id'],
    },
    run: (db, a) => {
      const rows = db.all(`
        SELECT c.child_id, c.display_name, c.year_group, c.profile_note, r.relation,
               (SELECT COUNT(DISTINCT day_local) FROM events e
                 WHERE e.child_id = c.child_id
                   AND e.day_local >= date((SELECT MAX(day_local) FROM events), '-13 days')
               ) AS active_days_last_14,
               (SELECT CAST(julianday((SELECT MAX(day_local) FROM events))
                          - julianday(MAX(u.day_local)) AS INTEGER)
                  FROM utterances u WHERE u.child_id = c.child_id AND u.spoken = 1
               ) AS silence_streak_days,
               (SELECT COUNT(*) FROM v_insights_fired f WHERE f.child_id = c.child_id
               ) AS open_insight_count
        FROM children c
        JOIN roster r ON r.child_id = c.child_id AND r.adult_id = ?
         AND (r.expires_at IS NULL OR r.expires_at > strftime('%s','now') * 1000)
        WHERE (? IS NULL OR c.class_id = ?)
        ORDER BY silence_streak_days DESC, c.display_name`,
        [a.adult_id, a.class_id ?? null, a.class_id ?? null])
      if (!rows.length) throw new McpError('NOT_AUTHORISED', `No children are rostered to ${a.adult_id}.`)
      const w = resolveWindow(db, 'last_14d')
      return { data: { children: rows }, meta: base(db, null, w, rows.length) }
    },
  },

  get_child_profile: {
    description: 'Everything needed to interpret this child\'s numbers: board, baselines, consent, modelling history.',
    schema: { type: 'object', properties: { child_id: { type: 'string' } }, required: ['child_id'] },
    run: (db, a) => {
      const child = db.one(
        'SELECT child_id, display_name, year_group, profile_note FROM children WHERE child_id = ?',
        [a.child_id])
      if (!child) throw new McpError('CHILD_NOT_FOUND', `No child ${a.child_id}.`)

      const board = db.one(`
        SELECT b.board_id, b.grid_rows, b.grid_cols,
               b.grid_rows * b.grid_cols AS total_cells,
               (SELECT COUNT(*) FROM board_cells WHERE board_id = b.board_id AND masked = 1) AS masked_cells,
               (SELECT COUNT(*) FROM board_cells WHERE board_id = b.board_id) AS cards_placed,
               (SELECT COUNT(*) FROM child_vocabulary WHERE child_id = b.child_id) AS vocabulary_size
        FROM boards b WHERE b.child_id = ? AND b.kind = 'robust'`, [a.child_id])

      const modes = db.all(`
        SELECT b.board_id, b.name,
               (SELECT COUNT(*) FROM mode_selection WHERE board_id = b.board_id) AS card_count,
               (SELECT value FROM agg_daily_metric
                 WHERE child_id = b.child_id AND metric_id = 'position_consistency'
                 ORDER BY day_local DESC LIMIT 1) AS position_consistency
        FROM boards b WHERE b.child_id = ? AND b.kind = 'mode'`, [a.child_id])

      const baseline = db.all(`
        SELECT metric_id, ROUND(AVG(value), 4) AS mean, COUNT(*) AS days
        FROM agg_daily_metric
        WHERE child_id = ? AND value IS NOT NULL
          AND day_local >= date((SELECT MAX(day_local) FROM events), '-27 days')
        GROUP BY metric_id`, [a.child_id])

      const span = db.one(
        'SELECT MIN(day_local) AS first_day, MAX(day_local) AS last_day, COUNT(DISTINCT day_local) AS active_days FROM events WHERE child_id = ?',
        [a.child_id])

      const w = resolveWindow(db, 'last_28d')
      return {
        data: {
          ...child,
          robust_board: board,
          active_modes: modes,
          baseline_4w: Object.fromEntries(baseline.map(b => [b.metric_id, { mean: b.mean, days: b.days }])),
          ...span,
          consent_tiers: db.all('SELECT tier FROM consent WHERE child_id = ? AND revoked_at IS NULL', [a.child_id]).map(r => r.tier),
          modeling_mode_used_days: db.scalar<number>(
            "SELECT COUNT(DISTINCT day_local) FROM events WHERE child_id = ? AND actor = 'adult'", [a.child_id]),
        },
        meta: base(db, a.child_id, w, 1),
        guidance: computeGuidance(db, a.child_id, w),
      }
    },
  },

  get_metrics: {
    description: 'All shown metrics for a window, with deltas, sample sizes and interpretation guidance.',
    schema: {
      type: 'object',
      properties: {
        child_id: { type: 'string' },
        window: { type: 'string', enum: ['today', 'last_7d', 'last_14d', 'last_28d', 'term', 'custom'] },
        start: { type: 'string' }, end: { type: 'string' },
        metric_ids: { type: 'array', items: { type: 'string' }, maxItems: 40 },
        groups: { type: 'array', items: { type: 'string', enum: ['A','B','C','D','E','F','G','H'] } },
        compare_to: { type: 'string', enum: ['previous_window', 'baseline_4w', 'none'] },
        include_dictionary: { type: 'boolean', description: 'Default true. Set false on repeat calls to save ~2.5k tokens.' },
        group_by: {
          type: 'string', enum: ['scene', 'hour', 'day_of_week'],
          description:
            'Slice each metric by a dimension instead of returning one blended number. ' +
            'Only some metrics can be sliced; asking for one that cannot is an error, not a silent blend.',
        },
      },
      required: ['child_id'],
    },
    run: (db, a) => {
      const w = resolveWindow(db, a.window, a.start, a.end)

      // ---- sliced path --------------------------------------------------
      if (a.group_by) {
        const asked: string[] = a.metric_ids?.length ? a.metric_ids : SLICEABLE_IDS
        const { rows, unsupported } = sliceMetrics(db, a.child_id, w, a.group_by, asked)
        if (unsupported.length && !a.metric_ids?.length) {
          // Caller took the default set; quietly narrowing to what works is fine.
        } else if (unsupported.length) {
          throw new McpError(
            'METRIC_NOT_SLICEABLE',
            `Cannot group ${unsupported.join(', ')} by ${a.group_by}. ` +
              `These have no per-${a.group_by} form. Sliceable metrics: ${SLICEABLE_IDS.join(', ')}.`,
          )
        }
        const ids = [...new Set(rows.map(r => r.metric_id as string))]
        const g = computeGuidance(db, a.child_id, w, rows)
        g.push({
          level: 'info', code: 'SLICED_RECOMPUTED',
          detail: `Values are recomputed from the event log per ${a.group_by}, not read from the ` +
            `daily rollup, so they will not sum to the blended figure exactly. Each row carries its own n.`,
        })
        return {
          data: { group_by: a.group_by, rows, metrics_returned: ids },
          meta: base(db, a.child_id, w, rows.length),
          dictionary: a.include_dictionary === false ? undefined : dictionaryFor(db, ids),
          guidance: g,
        }
      }

      // ---- blended path -------------------------------------------------
      const prevEnd = db.scalar<string>(`SELECT date(?, '-1 day')`, [w.start])!
      const prevStart = db.scalar<string>(`SELECT date(?, '-${w.days - 1} days')`, [prevEnd])!

      const filters: string[] = ["m.status = 'shown'"]
      const params: unknown[] = [a.child_id, w.start, w.end, a.child_id, prevStart, prevEnd]
      if (a.metric_ids?.length) filters.push(`m.metric_id IN (${a.metric_ids.map(() => '?').join(',')})`)
      if (a.groups?.length) filters.push(`m.group_code IN (${a.groups.map(() => '?').join(',')})`)

      // Per-metric window rollup, mirroring lib/metrics.ts ROLLUP. A plain
      // AVG of daily rows reported teacher_modeling (catalogue unit: count)
      // as a per-day figure — 348 modelled presses read back as "12.4".
      // Genuine daily tallies sum; point-in-time metrics take the newest row;
      // everything else is a weighted mean so a 3-utterance day cannot
      // outvote a 60-utterance day. Window-grain min_n suppression happens
      // in JS below — value withheld, n reported, matching the dashboard.
      const SUM_METRICS = ['new_words', 'teacher_modeling', 'taps_saved', 'vocabulary_gaps',
        'layout_stability', 'keyboard_use']
      const LAST_METRICS = ['silence_streak', 'zero_activation_days', 'position_consistency']

      // What this child's pipeline has EVER produced, and whether they were
      // present at all this window — the difference between "not collected",
      // "no data in this window", and a meaningful zero.
      const everIds = new Set(
        db.all('SELECT DISTINCT metric_id FROM agg_daily_metric WHERE child_id = ?',
          [a.child_id]).map(r => r.metric_id as string))
      const activeInWindow = (db.scalar<number>(
        `SELECT COUNT(*) FROM events
         WHERE child_id = ? AND actor = 'child' AND day_local BETWEEN ? AND ?`,
        [a.child_id, w.start, w.end]) ?? 0) > 0

      const rows = db.all(`
        WITH cur AS (
          SELECT metric_id,
                 SUM(value)                              AS sum_value,
                 SUM(value * n) / NULLIF(SUM(n), 0)      AS wmean_value,
                 SUM(n) AS n, COUNT(*) AS days_with_data
          FROM agg_daily_metric
          WHERE child_id = ? AND day_local BETWEEN ? AND ? AND value IS NOT NULL
          GROUP BY metric_id),
        prev AS (
          SELECT metric_id,
                 SUM(value)                              AS sum_value,
                 SUM(value * n) / NULLIF(SUM(n), 0)      AS wmean_value
          FROM agg_daily_metric
          WHERE child_id = ? AND day_local BETWEEN ? AND ? AND value IS NOT NULL
          GROUP BY metric_id),
        latest AS (
          SELECT metric_id, value AS last_value
          FROM (SELECT metric_id, value,
                       ROW_NUMBER() OVER (PARTITION BY metric_id ORDER BY day_local DESC) AS rn
                FROM agg_daily_metric
                WHERE child_id = ? AND value IS NOT NULL)
          WHERE rn = 1)
        SELECT m.metric_id, m.polarity, m.min_n,
               cur.sum_value, cur.wmean_value, latest.last_value,
               cur.n, cur.days_with_data,
               prev.sum_value AS prev_sum, prev.wmean_value AS prev_wmean
        FROM metrics_catalog m
        LEFT JOIN cur    ON cur.metric_id    = m.metric_id
        LEFT JOIN prev   ON prev.metric_id   = m.metric_id
        LEFT JOIN latest ON latest.metric_id = m.metric_id
        WHERE ${filters.join(' AND ')}
        ORDER BY m.group_code, m.metric_id`,
        [...params, a.child_id, ...(a.metric_ids ?? []), ...(a.groups ?? [])]).map((r) => {
        const id = r.metric_id as string
        const round = (v: unknown) => (v === null || v === undefined ? null : Math.round((v as number) * 10000) / 10000)
        const pick = (sum: unknown, wmean: unknown, last: unknown) =>
          SUM_METRICS.includes(id) ? sum : LAST_METRICS.includes(id) ? last : wmean
        let value = round(pick(r.sum_value, r.wmean_value, r.last_value))
        const comparison = round(pick(r.prev_sum, r.prev_wmean, null))
        // A tally with no in-window rows is ZERO when the child was present —
        // the catalogue's own new_words example: 0 after a batch of card
        // additions means the additions missed, and that must be reportable.
        if (value === null && SUM_METRICS.includes(id) && everIds.has(id) && activeInWindow) {
          value = 0
        } else if (value !== null && ((r.n as number) ?? 0) < (r.min_n as number)) {
          // Window-grain suppression: value withheld below min_n, n kept.
          value = null
        }
        return {
          metric_id: id, polarity: r.polarity, min_n: r.min_n,
          value, n: r.n, days_with_data: r.days_with_data ?? 0,
          ever_recorded: everIds.has(id),
          comparison_value: value !== null ? comparison : null,
          delta: value !== null && comparison !== null ? round(value - comparison) : null,
        }
      })

      const metrics = rows.map(r => {
        const delta = r.delta as number | null
        let direction = 'not_applicable'
        // Direction is resolved through polarity here, once, so the model never
        // has to decide whether "up" is good. Neutral metrics never get one.
        if (delta !== null && r.polarity !== 'neutral') {
          if (Math.abs(delta) < 1e-9) direction = 'unchanged'
          else if (r.polarity === 'higher_better') direction = delta > 0 ? 'improved' : 'worsened'
          else direction = delta < 0 ? 'improved' : 'worsened'
        }
        return {
          metric_id: r.metric_id, value: r.value, n: r.n ?? 0,
          comparison_value: r.comparison_value, delta, direction,
          days_with_data: r.days_with_data ?? 0,
          // Number() rather than `?? 0`: rows are Record<string, unknown>, so
          // `r.n ?? 0` widens to {} and the comparison silently fails to compile
          // under Next's stricter typecheck.
          // Three distinct absences: too few samples ≠ the pipeline never
          // produced this metric ≠ produced before but nothing this window
          // (an absent child). Conflating them told a teacher a feature was
          // broken when the child was simply away.
          suppressed_reason: r.value === null && Number(r.n ?? 0) > 0 ? 'small_sample'
            : r.value === null && r.ever_recorded ? 'no_data_in_window'
            : r.value === null ? 'not_collected' : null,
        }
      })

      // The MCP client drives the sequence; a 4B model cannot reliably chain
      // calls. These are instructions to the client, not hints to the model.
      const next: Envelope['next_calls'] = []
      const by = Object.fromEntries(metrics.map(m => [m.metric_id, m])) as Record<string, any>
      if ((by.mistap_rate?.value ?? 0) > 0.08) {
        next.push({ tool: 'get_fired_rules', args: { child_id: a.child_id, insight_ids: ['I1', 'I8'] },
          because: 'unintended presses are elevated — classify motor vs semantic before concluding anything' })
        next.push({ tool: 'get_cell_heat', args: { child_id: a.child_id },
          because: 'find out WHERE on the grid the errors are' })
        next.push({ tool: 'get_board_revisions', args: { child_id: a.child_id },
          because: 'a layout change is the most common cause of a sudden rise, and it may be one we recommended' })
      }
      if ((by.time_to_first_tap?.value ?? 0) > 5000) {
        next.push({ tool: 'get_partner_metrics', args: { child_id: a.child_id },
          because: 'a slow response may be the adult not waiting, not the child being slow' })
      }
      if ((by.abandonment_rate?.value ?? 0) > 0.25) {
        next.push({ tool: 'get_partner_metrics', args: { child_id: a.child_id },
          because: 'high abandonment often pairs with an adult interrupting mid-sentence' })
      }

      return {
        data: { metrics },
        meta: base(db, a.child_id, w, metrics.length),
        dictionary: a.include_dictionary === false ? undefined
          : dictionaryFor(db, metrics.filter(m => m.value !== null).map(m => m.metric_id as string)),
        guidance: computeGuidance(db, a.child_id, w, metrics),
        next_calls: next.length ? next : undefined,
      }
    },
  },

  get_metric_timeseries: {
    description: 'One metric over time — daily, weekly or monthly — with annotations for layout changes.',
    schema: {
      type: 'object',
      properties: {
        child_id: { type: 'string' }, metric_id: { type: 'string' },
        from: { type: 'string' }, to: { type: 'string' },
        granularity: {
          type: 'string', enum: ['day', 'week', 'month'],
          description: 'Default day. Weekly smooths daily noise over a term; monthly is for a year.',
        },
      },
      required: ['child_id', 'metric_id'],
    },
    run: (db, a) => {
      const w = resolveWindow(db, a.from ? 'custom' : 'last_28d', a.from, a.to)
      const grain: 'day' | 'week' | 'month' = a.granularity ?? 'day'

      // Weekly and monthly points are averaged across the days in the bucket and
      // their sample sizes summed. Averaging pre-averaged daily rates is not the
      // same as recomputing from raw events — a day with 3 utterances counts as
      // much as a day with 60 — so `days` rides along and the caveat is in the note.
      const period =
        grain === 'week' ? `strftime('%Y-W%W', day_local)`
          : grain === 'month' ? `strftime('%Y-%m', day_local)`
          : `day_local`

      // Day-grain masking: the rollup stores TRUE values for every day and
      // each reader suppresses at its own grain. Here a day below min_n
      // contributes nothing to its bucket's value — its n still rides along.
      const points = db.all(`
        SELECT ${period} AS period,
               ROUND(AVG(CASE WHEN a2.n >= mc.min_n THEN a2.value END), 4) AS value,
               SUM(a2.n) AS n,
               COUNT(*) AS days,
               MIN(a2.day_local) AS period_start,
               MAX(a2.day_local) AS period_end
        FROM agg_daily_metric a2 JOIN metrics_catalog mc ON mc.metric_id = a2.metric_id
        WHERE a2.child_id = ? AND a2.metric_id = ? AND a2.day_local BETWEEN ? AND ?
        GROUP BY ${period}
        ORDER BY MIN(a2.day_local)`, [a.child_id, a.metric_id, w.start, w.end])

      // Annotations are why this tool exists. A spike means one thing alone and
      // another entirely when a layout change sits on the same date.
      const annotations = db.all(`
        SELECT r.day_local AS date, 'layout_change' AS kind,
               r.change_kind || ' ' || COALESCE(r.card_id, '') ||
               CASE WHEN r.suggested_by_insight IS NOT NULL
                    THEN ' (suggested by ' || r.suggested_by_insight || ')' ELSE '' END AS detail
        FROM board_revisions r JOIN boards b ON b.board_id = r.board_id
        WHERE b.child_id = ? AND r.day_local BETWEEN ? AND ?`, [a.child_id, w.start, w.end])

      const g = computeGuidance(db, a.child_id, w)
      if (grain !== 'day') {
        g.push({
          level: 'info', code: 'AGGREGATED_PERIOD',
          detail: `Points are ${grain}ly means of daily values, not recomputed from raw events. ` +
            `A quiet day weighs the same as a busy one. Each point carries 'days' and 'n'.`,
          affects: [a.metric_id],
        })
      }

      return {
        data: { metric_id: a.metric_id, granularity: grain, points, annotations },
        meta: base(db, a.child_id, w, points.length),
        dictionary: dictionaryFor(db, [a.metric_id]),
        guidance: g,
      }
    },
  },

  get_card_stats: {
    description: 'Per-card use, unintended presses, repeat runs, depth and duplicate positions.',
    schema: {
      type: 'object',
      properties: {
        child_id: { type: 'string' },
        order_by: { type: 'string', enum: ['taps_desc', 'taps_asc', 'mistaps_desc', 'zero_days_desc', 'repeat_runs_desc'] },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        filter: { type: 'string', enum: ['all', 'core_only', 'fringe_only', 'essential_only', 'unused'] },
      },
      required: ['child_id'],
    },
    run: (db, a) => {
      const limit = Math.min(a.limit ?? 25, 100)
      const order = ({
        taps_desc: 's.taps DESC', taps_asc: 's.taps ASC', mistaps_desc: 's.mistaps DESC',
        zero_days_desc: 's.zero_days DESC', repeat_runs_desc: 's.repeat_runs DESC',
      } as Record<string, string>)[a.order_by ?? 'taps_desc'] ?? 's.taps DESC'
      const filter = ({
        core_only: 'AND c.is_core = 1', fringe_only: 'AND c.is_core = 0',
        essential_only: 'AND c.is_essential = 1', unused: 'AND s.taps = 0',
      } as Record<string, string>)[a.filter ?? 'all'] ?? ''

      const rows = db.all(`
        SELECT s.card_id, c.label, c.is_core, c.is_essential, c.default_function,
               s.taps, s.mistaps, s.adjacent_corrections, s.repeat_runs,
               s.zero_days, s.last_used_day, s.scenes_used,
               cv.nav_depth
        FROM agg_card_stats s
        JOIN cards c ON c.card_id = s.card_id
        LEFT JOIN child_vocabulary cv ON cv.child_id = s.child_id AND cv.card_id = s.card_id
        WHERE s.child_id = ? ${filter}
        ORDER BY ${order} LIMIT ?`, [a.child_id, limit + 1])

      const truncated = rows.length > limit
      const w = resolveWindow(db, 'last_28d')
      return {
        data: { cards: truncated ? rows.slice(0, limit) : rows },
        meta: base(db, a.child_id, w, Math.min(rows.length, limit), truncated),
        dictionary: dictionaryFor(db, ['card_frequency', 'repeat_tap_rate', 'zero_activation_days']),
        guidance: computeGuidance(db, a.child_id, w),
      }
    },
  },

  get_cell_heat: {
    description: 'Grid heat map plus mis-tap heat, with dead zones precomputed.',
    schema: { type: 'object', properties: { child_id: { type: 'string' }, board_id: { type: 'string' } }, required: ['child_id'] },
    run: (db, a) => {
      const board = a.board_id ?? db.scalar<string>(
        "SELECT board_id FROM boards WHERE child_id = ? AND kind = 'robust'", [a.child_id])
      const cells = db.all(`
        SELECT h.grid_row, h.grid_col, h.grid_rows, h.grid_cols, h.taps, h.mistaps,
               bc.card_id, c.label, bc.masked,
               ROUND(CAST(h.mistaps AS REAL) / NULLIF(h.taps + h.mistaps, 0), 3) AS mistap_share
        FROM agg_cell_heat h
        LEFT JOIN board_cells bc ON bc.board_id = h.board_id
             AND bc.grid_row = h.grid_row AND bc.grid_col = h.grid_col
        LEFT JOIN cards c ON c.card_id = bc.card_id
        WHERE h.child_id = ? AND h.board_id = ?
        ORDER BY h.grid_row, h.grid_col`, [a.child_id, board])

      // Spatial reasoning over a flat list is where models slip, so the dead
      // rows are identified here rather than left to be inferred.
      const byRow = new Map<number, { taps: number; mistaps: number }>()
      for (const c of cells) {
        const r = c.grid_row as number
        const acc = byRow.get(r) ?? { taps: 0, mistaps: 0 }
        acc.taps += (c.taps as number) ?? 0
        acc.mistaps += (c.mistaps as number) ?? 0
        byRow.set(r, acc)
      }
      const totalTaps = [...byRow.values()].reduce((s, v) => s + v.taps, 0)
      const totalMistaps = [...byRow.values()].reduce((s, v) => s + v.mistaps, 0)
      const rowCount = byRow.size || 1
      const meanErrShare = totalMistaps / Math.max(totalTaps + totalMistaps, 1)

      // Two different problems, and they need different words to a teacher:
      // a row nobody touches, versus a row the child keeps missing. Maya has
      // the second — an earlier version reported "no dead zones" and hid it.
      const problem_rows = [...byRow.entries()].map(([row, v]) => {
        const share = totalTaps > 0 ? v.taps / totalTaps : 0
        const errShare = v.mistaps / Math.max(v.taps + v.mistaps, 1)
        let kind: string | null = null
        let note = ''
        if (share < 0.05 && v.mistaps > 0) {
          kind = 'unreached'
          note = 'near-zero successful taps with errors present — a reach problem, not a vocabulary gap'
        } else if (errShare > meanErrShare * 1.35 && v.mistaps >= 5) {
          kind = 'error_prone'
          note = `unintended presses here are ${(errShare / Math.max(meanErrShare, 1e-9)).toFixed(1)}x the board average — the child reaches this row and misses`
        }
        return kind ? { row, kind, taps: v.taps, mistaps: v.mistaps,
                        error_share: +errShare.toFixed(3), note } : null
      }).filter(Boolean)

      const dead = problem_rows.filter((p: any) => p.kind === 'unreached')

      // A reach problem shows up as a GRADIENT across the board, not as one hot
      // cell — error rate climbing with distance from where the hand rests.
      // Looking only for outliers missed Maya entirely: her rows run
      // 0.088 / 0.103 / 0.144 / 0.183, which is the signal, and no single row
      // is an outlier.
      const rowShares = [...byRow.entries()]
        .sort((x, y) => x[0] - y[0])
        .map(([row, v]) => ({ row, taps: v.taps,
          err: v.mistaps / Math.max(v.taps + v.mistaps, 1) }))
      let gradient: Record<string, unknown> | null = null
      if (rowShares.length >= 3) {
        const monotonic = rowShares.every((r, i) => i === 0 || r.err >= rowShares[i - 1].err - 0.01)
        const first = rowShares[0].err, last = rowShares[rowShares.length - 1].err
        const ratio = last / Math.max(first, 1e-9)
        const tapDrop = rowShares[rowShares.length - 1].taps / Math.max(rowShares[0].taps, 1)
        if (monotonic && ratio >= 1.5) {
          gradient = {
            detected: true, direction: 'increasing_by_row', ratio: +ratio.toFixed(2),
            tap_ratio_last_vs_first: +tapDrop.toFixed(2),
            per_row: rowShares.map(r => ({ row: r.row, error_share: +r.err.toFixed(3), taps: r.taps })),
            note: `Unintended presses rise steadily from row ${rowShares[0].row} to row ${rowShares[rowShares.length - 1].row} (${(first * 100).toFixed(1)}% to ${(last * 100).toFixed(1)}%), and the far row takes ${Math.round(tapDrop * 100)}% as many taps. That pattern is reach, not vocabulary. Mask the neighbours of the hardest targets or change the physical setup — do NOT move the cards or shrink the grid.`,
          }
        }
      }

      const w = resolveWindow(db, 'last_28d')
      return {
        data: {
          board_id: board, cells,
          dead_zones: dead,
          problem_rows,
          reach_gradient: gradient,
          board_mean_error_share: +meanErrShare.toFixed(3),
        },
        meta: base(db, a.child_id, w, cells.length),
        dictionary: dictionaryFor(db, ['cell_heat', 'mistap_rate']),
        guidance: computeGuidance(db, a.child_id, w),
        forbidden_actions: ['resize_grid', 'move_card'],
      }
    },
  },

  get_word_pairs: {
    description: 'Words used often but never combined — the actionable form of a syntax plateau.',
    schema: {
      type: 'object',
      properties: {
        child_id: { type: 'string' },
        min_solo: { type: 'integer', minimum: 5, maximum: 100 },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      required: ['child_id'],
    },
    run: (db, a) => {
      const minSolo = a.min_solo ?? 15
      const limit = Math.min(a.limit ?? 20, 50)
      const rows = db.all(`
        SELECT word_a, word_b, solo_a, solo_b, together,
               MIN(solo_a, solo_b) AS weaker_solo
        FROM agg_word_pairs
        WHERE child_id = ? AND together = 0 AND solo_a >= ? AND solo_b >= ?
        ORDER BY weaker_solo DESC LIMIT ?`, [a.child_id, minSolo, minSolo, limit])
      const w = resolveWindow(db, 'last_28d')
      return {
        data: { pairs: rows, note: 'Target a named pair. "Make longer sentences" is not teachable; "want + biscuit" is.' },
        meta: base(db, a.child_id, w, rows.length),
        dictionary: dictionaryFor(db, ['word_pairs', 'mlu']),
        forbidden_actions: ['demand_imitation', 'test_the_child'],
      }
    },
  },

  get_scene_breakdown: {
    description: 'Where communication happens, by word or by communication function.',
    schema: {
      type: 'object',
      properties: { child_id: { type: 'string' }, by: { type: 'string', enum: ['function', 'label'] } },
      required: ['child_id'],
    },
    run: (db, a) => {
      const by = a.by === 'label' ? 'label' : 'function'
      const rows = by === 'label'
        ? db.all('SELECT scene, label, taps, days FROM v_scene_matrix WHERE child_id = ? ORDER BY taps DESC LIMIT 100', [a.child_id])
        : db.all('SELECT scene, function, utterances FROM v_function_mix WHERE child_id = ? ORDER BY utterances DESC', [a.child_id])
      const bound = db.all(`
        SELECT label, therapy_taps, other_taps FROM v_i6_scene_bound
        WHERE child_id = ? AND triggered = 1`, [a.child_id])
      const w = resolveWindow(db, 'last_28d')
      return {
        data: { by, rows, scene_bound_items: bound },
        meta: base(db, a.child_id, w, rows.length),
        dictionary: dictionaryFor(db, ['scene_distribution', 'pragmatic_function_mix']),
        guidance: computeGuidance(db, a.child_id, w),
      }
    },
  },

  get_utterances: {
    description: 'Individual sentences — LABELS ONLY. Utterance text is not in this database.',
    schema: {
      type: 'object',
      properties: {
        child_id: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
        filter: { type: 'string', enum: ['all', 'abandoned', 'used_suggestion', 'multi_symbol'] },
      },
      required: ['child_id'],
    },
    run: (db, a) => {
      const limit = Math.min(a.limit ?? 50, 200)
      const w = resolveWindow(db, a.window ?? 'last_7d')
      const filter = ({
        abandoned: 'AND spoken = 0', used_suggestion: 'AND used_suggestion = 1',
        multi_symbol: 'AND symbol_count > 1',
      } as Record<string, string>)[a.filter ?? 'all'] ?? ''
      const rows = db.all(`
        SELECT utterance_id, day_local, scene, labels, symbol_count, word_count,
               tap_count, delete_count, ms_compose, ms_to_first_tap,
               used_suggestion, spoken, abandon_reason, function
        FROM utterances
        WHERE child_id = ? AND actor = 'child' AND day_local BETWEEN ? AND ? ${filter}
        ORDER BY ts DESC LIMIT ?`, [a.child_id, w.start, w.end, limit + 1])
      const truncated = rows.length > limit
      return {
        data: { utterances: truncated ? rows.slice(0, limit) : rows },
        meta: base(db, a.child_id, w, Math.min(rows.length, limit), truncated),
        guidance: computeGuidance(db, a.child_id, w),
      }
    },
  },

  get_partner_metrics: {
    description: 'The ADULT\'s numbers. Separate so they are never mistaken for the child\'s.',
    schema: { type: 'object', properties: { child_id: { type: 'string' } }, required: ['child_id'] },
    run: (db, a) => {
      const w = resolveWindow(db, 'last_14d')
      const row = db.one(`
        SELECT COUNT(*) AS partner_turns,
               ROUND(AVG(ms_to_next_partner_turn)) AS median_wait_ms,
               SUM(CASE WHEN interrupted_utterance_id IS NOT NULL THEN 1 ELSE 0 END) AS interruptions,
               ROUND(AVG(CASE WHEN interrupted_utterance_id IS NOT NULL THEN 1.0 ELSE 0.0 END), 3) AS interruption_rate,
               SUM(CASE WHEN child_responded = 0 THEN 1 ELSE 0 END) AS turns_with_no_child_response
        FROM partner_turns WHERE child_id = ? AND day_local BETWEEN ? AND ?`,
        [a.child_id, w.start, w.end])
      const modeling = db.one(`
        SELECT COUNT(*) AS modeling_taps, COUNT(DISTINCT day_local) AS modeling_days
        FROM events WHERE child_id = ? AND actor = 'adult' AND day_local BETWEEN ? AND ?`,
        [a.child_id, w.start, w.end])
      return {
        data: { ...row, ...modeling,
          note: 'AAC output runs around 15 words per minute. A median wait under 2000 ms means any "the child is slow" finding is confounded by the adult.' },
        meta: base(db, a.child_id, w, 1),
        dictionary: dictionaryFor(db, ['partner_wait_time', 'partner_interruption_rate', 'teacher_modeling']),
        guidance: computeGuidance(db, a.child_id, w),
      }
    },
  },

  get_board_revisions: {
    description: 'Layout changes and the mis-tap rate either side of each — the I8 evidence.',
    schema: { type: 'object', properties: { child_id: { type: 'string' } }, required: ['child_id'] },
    run: (db, a) => {
      const rows = db.all(`
        SELECT revision_id, changed_on, change_kind, card_id, suggested_by_insight, reason,
               mistap_rate_before_7d, mistap_rate_after_7d, delta, triggered
        FROM v_i8_layout_disruption WHERE child_id = ? ORDER BY changed_on DESC`, [a.child_id])
      const w = resolveWindow(db, 'last_28d')
      return {
        data: { revisions: rows },
        meta: base(db, a.child_id, w, rows.length),
        dictionary: dictionaryFor(db, ['layout_stability', 'mistap_rate']),
        forbidden_actions: ['blame_the_child', 'frame_as_regression', 'recommend_further_layout_change'],
      }
    },
  },

  get_fired_rules: {
    description: 'Which deterministic SQL rules fired, with their evidence, thresholds and forbidden actions.',
    schema: {
      type: 'object',
      properties: {
        child_id: { type: 'string' },
        insight_ids: { type: 'array', items: { type: 'string', enum: ['I1','I2','I3','I4','I5','I6','I7','I8'] } },
      },
      required: ['child_id'],
    },
    run: (db, a) => {
      const want: string[] = a.insight_ids?.length ? a.insight_ids : ['I1','I2','I3','I4','I5','I6','I7','I8']

      // Reads the MATERIALISED table, never the live views. The insight views
      // scan the event log with window functions; under concurrent write load
      // they hit 5s at p99 and the dashboard stalls. tools/run_rules.py
      // evaluates them once, nightly. See tools/concurrency_test.py.
      const candidates = want.map(iid => {
        const cat = db.one('SELECT * FROM insights_catalog WHERE insight_id = ?', [iid])!
        const fr = db.one(`
          SELECT fired_rule_id, fired_at, window_start, window_end, evidence, classification
          FROM fired_rules
          WHERE child_id = ? AND insight_id = ?
            AND dismissed_at IS NULL AND superseded_by IS NULL
          ORDER BY fired_at DESC LIMIT 1`, [a.child_id, iid])
        const evidence = fr ? JSON.parse(fr.evidence as string) : []
        const triggered = Boolean(fr)
        return {
          fired_rule_id: fr?.fired_rule_id ?? null,
          fired_at: fr?.fired_at ?? null,
          classification: fr?.classification ? JSON.parse(fr.classification as string) : null,
          insight_id: iid,
          name: cat.name,
          plain_statement: cat.plain_statement,
          triggered,
          evidence,
          // Exposed, not applied: disagree with a rule that fired at 8.1%
          // against a threshold of 8%.
          thresholds_applied: JSON.parse(cat.default_thresholds as string),
          recommended_actions: JSON.parse(cat.recommended_actions as string),
          forbidden_actions: JSON.parse(cat.forbidden_actions as string),
          safety_note: cat.safety_note,
          target_audience: cat.target_audience,
          action_kind: cat.action_kind,
          input_metrics: JSON.parse(cat.input_metrics as string),
          previously_dismissed: db.one(`
            SELECT fired_rule_id, dismissed_at, dismiss_reason FROM fired_rules
            WHERE child_id = ? AND insight_id = ? AND dismissed_at IS NOT NULL
            ORDER BY dismissed_at DESC LIMIT 1`, [a.child_id, iid]) ?? null,
        }
      })
      const w = resolveWindow(db, 'last_14d')
      const hits = candidates.filter(c => c.triggered)
      const forbidden = [...new Set(hits.flatMap(c => c.forbidden_actions as string[]))]

      // Full detail only for rules that actually fired. Returning all eight
      // with their catalogue metadata cost 7.7k tokens when four had fired —
      // most of it describing rules the model has no reason to think about.
      const quiet = candidates
        .filter(c => !c.triggered)
        .map(c => ({ insight_id: c.insight_id, name: c.name, triggered: false }))

      return {
        data: {
          candidates: hits,
          not_triggered: quiet,
          triggered_count: hits.length,
          note: hits.length === 0
            ? 'No rule fired. There is nothing to narrate — say so rather than looking for something to report.'
            : 'Thresholds are given to you, not applied for you. A rule that fired just over its threshold deserves hedging, not a confident diagnosis.',
        },
        meta: base(db, a.child_id, w, candidates.length),
        dictionary: dictionaryFor(db, [...new Set(hits.flatMap(c => c.input_metrics as string[]))]),
        guidance: computeGuidance(db, a.child_id, w),
        forbidden_actions: forbidden,
      }
    },
  },

  get_attention_queue: {
    description: 'Class triage — who needs a person today, and why.',
    schema: {
      type: 'object',
      properties: { class_id: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 30 } },
      required: ['class_id'],
    },
    run: (db, a) => {
      const limit = Math.min(a.limit ?? 10, 30)
      const kids = db.all(
        'SELECT child_id, display_name FROM children WHERE class_id = ?', [a.class_id])
      const w = resolveWindow(db, 'last_7d')

      const queue = kids.map(k => {
        const reasons: { code: string; detail: string; metric_id: string; value: unknown }[] = []
        let score = 0
        const get = (m: string) => db.scalar<number>(`
          SELECT AVG(value) FROM agg_daily_metric
          WHERE child_id = ? AND metric_id = ? AND day_local BETWEEN ? AND ?`,
          [k.child_id, m, w.start, w.end])

        const silence = db.scalar<number>(`
          SELECT CAST(julianday((SELECT MAX(day_local) FROM events)) - julianday(MAX(day_local)) AS INTEGER)
          FROM utterances WHERE child_id = ? AND spoken = 1`, [k.child_id]) ?? 0
        if (silence >= 2) { score += 3; reasons.push({ code: 'SILENCE', detail: `${silence} days since they last said anything`, metric_id: 'silence_streak', value: silence }) }

        const ab = get('abandonment_rate') ?? 0
        if (ab > 0.25) { score += 2; reasons.push({ code: 'ABANDONMENT', detail: `${Math.round(ab*100)}% of sentences are built then given up on`, metric_id: 'abandonment_rate', value: +ab.toFixed(3) }) }

        const mt = get('mistap_rate') ?? 0
        if (mt > 0.12) { score += 2; reasons.push({ code: 'MISTAPS', detail: `${Math.round(mt*100)}% unintended presses — check reach before anything else`, metric_id: 'mistap_rate', value: +mt.toFixed(3) }) }

        const open = db.all('SELECT insight_id FROM v_insights_fired WHERE child_id = ?', [k.child_id])
        const interventions = db.all(`
          SELECT f.insight_id FROM v_insights_fired f
          JOIN insights_catalog ic ON ic.insight_id = f.insight_id
          WHERE f.child_id = ? AND ic.action_kind = 'intervention'`, [k.child_id])
        if (interventions.length) { score += 1; reasons.push({ code: 'OPEN_INSIGHT', detail: `${interventions.length} open finding(s): ${interventions.map(i => i.insight_id).join(', ')}`, metric_id: '', value: interventions.length }) }

        return { child_id: k.child_id, display_name: k.display_name, score, reasons, open_rules: open.map(o => o.insight_id) }
      }).filter(q => q.score > 0).sort((x, y) => y.score - x.score).slice(0, limit)

      return {
        data: { queue, note: 'Ranked by who needs a human today, not by who has the worst numbers.' },
        meta: base(db, null, w, queue.length),
      }
    },
  },

  get_report_set: {
    description: 'The selected metrics for a child\'s report, with values, charts and caveats.',
    schema: {
      type: 'object',
      properties: {
        child_id: { type: 'string' },
        window: { type: 'string', enum: ['today','last_7d','last_14d','last_28d','term','custom'] },
        start: { type: 'string' }, end: { type: 'string' },
      },
      required: ['child_id'],
    },
    run: (db, a) => {
      const w = resolveWindow(db, a.window ?? 'last_28d', a.start, a.end)

      // Which metrics are IN the report is a database fact, not a constant here.
      // The set has already changed once — eight from proposed_metrics.docx
      // became thirteen from AAC_Filtered_Metric_Index.md — and anything that
      // hardcoded the list would now be reporting on the wrong metrics.
      const cat = db.all(`
        SELECT metric_id, name, group_code, plain_explanation, unit, polarity,
               min_n, caveat, chart, report_rank
        FROM metrics_catalog WHERE report_set = 1 ORDER BY report_rank`)

      // Not every metric is a daily scalar. Four of these are DIMENSIONAL —
      // they live in their own tables, and reading them from agg_daily_metric
      // reported them as "not collected" while the tool was simultaneously
      // telling the model not to treat a missing value as zero.
      const DIMENSIONAL: Record<string, { sql: string; unit: string }> = {
        cell_heat: {
          sql: `SELECT COUNT(*) AS n, SUM(taps) AS v FROM agg_cell_heat WHERE child_id = ?`,
          unit: 'cells' },
        card_frequency: {
          sql: `SELECT COUNT(*) AS n, SUM(taps) AS v FROM agg_card_stats WHERE child_id = ? AND taps > 0`,
          unit: 'cards' },
        word_pairs: {
          sql: `SELECT COUNT(*) AS n, COUNT(*) AS v FROM agg_word_pairs
                WHERE child_id = ? AND together = 0 AND solo_a >= 10 AND solo_b >= 10`,
          unit: 'pairs' },
        nav_depth_by_card: {
          sql: `SELECT COUNT(*) AS n, ROUND(AVG(avg_nav_depth), 2) AS v FROM v_card_stats
                WHERE child_id = ? AND avg_nav_depth > 0`,
          unit: 'screens' },
      }

      const rows = cat.map((c) => {
        const dim = DIMENSIONAL[c.metric_id as string]
        const v = dim
          ? (() => {
              const r = db.one(dim.sql, [a.child_id])
              return { value: r?.v ?? null, n: Number(r?.n ?? 0), days: null }
            })()
          : db.one(`
              SELECT ROUND(AVG(value), 4) AS value, COALESCE(SUM(n), 0) AS n, COUNT(*) AS days
              FROM agg_daily_metric
              WHERE child_id = ? AND metric_id = ? AND day_local BETWEEN ? AND ?`,
              [a.child_id, c.metric_id, w.start, w.end])
        const n = Number(v?.n ?? 0)
        return {
          rank: c.report_rank, group: c.group_code, metric_id: c.metric_id, name: c.name,
          plain: c.plain_explanation, unit: c.unit, polarity: c.polarity, chart: c.chart,
          value: v?.value ?? null, n, min_n: c.min_n,
          shape: DIMENSIONAL[c.metric_id as string] ? 'dimensional' : 'daily_scalar',
          // Three distinct reasons for a null, and conflating them is how a
          // model reports a child stopped doing something never measured.
          status: v?.value !== null && v?.value !== undefined ? 'ok'
                : n === 0 ? 'not_collected' : 'below_min_n',
          caveat: c.caveat,
        }
      })

      const g = computeGuidance(db, a.child_id, w, rows as never[])
      const missing = rows.filter((r) => r.status === 'not_collected')
      if (missing.length) {
        g.push({
          level: 'info', code: 'NOT_COLLECTED',
          detail: `${missing.map((m) => m.name).join(', ')} ${missing.length === 1 ? 'has' : 'have'} ` +
            `no observations — the feature that produces them is not in use for this child. ` +
            `Do not describe them as zero or as a decline.`,
          affects: missing.map((m) => String(m.metric_id)),
        })
      }

      return {
        data: {
          metrics: rows,
          count: rows.length,
          note: 'These are the ONLY metrics a report may cite. Do not expand beyond them, ' +
            'and do not compute new figures from them.',
        },
        meta: base(db, a.child_id, w, rows.length),
        guidance: g,
        forbidden_actions: ['resize_grid', 'move_card', 'reduce_repetition'],
      }
    },
  },

  get_insight_history: {
    description: 'Every time a rule has fired for this child, including dismissed and superseded ones.',
    schema: {
      type: 'object',
      properties: {
        child_id: { type: 'string' },
        insight_ids: { type: 'array', items: { type: 'string', enum: ['I1','I2','I3','I4','I5','I6','I7','I8'] } },
        include_dismissed: { type: 'boolean', description: 'Default true.' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      required: ['child_id'],
    },
    run: (db, a) => {
      const limit = Math.min(a.limit ?? 30, 100)
      const filters = ['f.child_id = ?']
      const params: unknown[] = [a.child_id]
      if (a.insight_ids?.length) {
        filters.push(`f.insight_id IN (${a.insight_ids.map(() => '?').join(',')})`)
        params.push(...a.insight_ids)
      }
      if (a.include_dismissed === false) filters.push('f.dismissed_at IS NULL')

      const rows = db.all(`
        SELECT f.fired_rule_id, f.insight_id, ic.name AS insight_name, ic.action_kind,
               f.fired_at, f.window_start, f.window_end,
               json_array_length(f.evidence) AS evidence_rows,
               f.classification,
               CASE WHEN f.dismissed_at IS NOT NULL THEN 'dismissed'
                    WHEN f.superseded_by IS NOT NULL THEN 'resolved'
                    ELSE 'open' END AS state,
               f.dismissed_at, f.dismiss_reason,
               (SELECT COUNT(*) FROM insights i WHERE i.fired_rule_id = f.fired_rule_id) AS narrations
        FROM fired_rules f
        JOIN insights_catalog ic ON ic.insight_id = f.insight_id
        WHERE ${filters.join(' AND ')}
        ORDER BY f.fired_at DESC, f.insight_id
        LIMIT ?`, [...params, limit + 1])

      const truncated = rows.length > limit
      const kept = truncated ? rows.slice(0, limit) : rows

      // One row per rule summarising its trajectory — "fired 3 times, dismissed
      // twice as not_accurate" is the thing worth knowing before raising it again.
      const byRule = new Map<string, { fired: number; dismissed: number; reasons: string[]; last: unknown }>()
      for (const r of kept) {
        const k = r.insight_id as string
        const acc = byRule.get(k) ?? { fired: 0, dismissed: 0, reasons: [], last: r.fired_at }
        acc.fired += 1
        if (r.state === 'dismissed') {
          acc.dismissed += 1
          if (r.dismiss_reason) acc.reasons.push(r.dismiss_reason as string)
        }
        byRule.set(k, acc)
      }
      const summary = [...byRule.entries()].map(([insight_id, v]) => ({
        insight_id, times_fired: v.fired, times_dismissed: v.dismissed,
        dismiss_reasons: [...new Set(v.reasons)], last_fired_at: v.last,
      }))

      const w = resolveWindow(db, 'last_28d')
      const rejected = summary.filter(s => s.dismiss_reasons.includes('not_accurate'))
      const g = computeGuidance(db, a.child_id, w)
      if (rejected.length) {
        g.push({
          level: 'warning', code: 'PREVIOUSLY_DISMISSED',
          detail: `${rejected.map(r => r.insight_id).join(', ')} ${rejected.length === 1 ? 'was' : 'were'} ` +
            `previously dismissed as not accurate. Re-raising a rejected finding without new evidence ` +
            `erodes trust in every other finding.`,
        })
      }

      return {
        data: { history: kept, summary,
          note: kept.length ? undefined : 'This rule has never fired for this child.' },
        meta: base(db, a.child_id, w, kept.length, truncated),
        guidance: g,
      }
    },
  },

  compare_windows: {
    description: 'Two explicit periods side by side, with a per-metric flag for whether they are comparable.',
    schema: {
      type: 'object',
      properties: {
        child_id: { type: 'string' },
        window_a: { type: 'object', properties: { start: { type: 'string' }, end: { type: 'string' } }, required: ['start','end'] },
        window_b: { type: 'object', properties: { start: { type: 'string' }, end: { type: 'string' } }, required: ['start','end'] },
        metric_ids: { type: 'array', items: { type: 'string' }, maxItems: 40 },
      },
      required: ['child_id', 'window_a', 'window_b'],
    },
    run: (db, a) => {
      const read = (win: { start: string; end: string }) => {
        const filter = a.metric_ids?.length
          ? `AND metric_id IN (${a.metric_ids.map(() => '?').join(',')})` : ''
        return db.all(`
          SELECT metric_id, AVG(value) AS value, SUM(n) AS n, COUNT(*) AS days
          FROM agg_daily_metric
          WHERE child_id = ? AND day_local BETWEEN ? AND ? ${filter}
          GROUP BY metric_id`,
          [a.child_id, win.start, win.end, ...(a.metric_ids ?? [])])
      }
      const A = new Map(read(a.window_a).map(r => [r.metric_id as string, r]))
      const B = new Map(read(a.window_b).map(r => [r.metric_id as string, r]))

      // A layout change makes spatial and error metrics incomparable — and not
      // only when it falls BETWEEN the periods. A change inside either window
      // splits that window across two layouts, which is just as invalidating.
      // An earlier version only checked the gap and reported Maya's 30 July
      // swap as comparable because it landed inside window_b.
      const lo = [a.window_a.start, a.window_b.start].sort()[0]
      const hi = [a.window_a.end, a.window_b.end].sort()[1]
      const between = db.all(`
        SELECT r.day_local, r.change_kind FROM board_revisions r
        JOIN boards b ON b.board_id = r.board_id
        WHERE b.child_id = ? AND r.day_local BETWEEN ? AND ?
          AND r.change_kind IN ('move','resize','remove')`, [a.child_id, lo, hi])
      const disrupted = between.length > 0
      const SPATIAL = new Set(['mistap_rate','correction_adjacent_rate','cell_heat','taps_per_utterance'])

      const ids = [...new Set([...A.keys(), ...B.keys()])].sort()
      const rows = ids.map(id => {
        const va = A.get(id)?.value as number | undefined
        const vb = B.get(id)?.value as number | undefined
        return {
          metric_id: id,
          a: va == null ? null : Math.round(va * 10000) / 10000,
          b: vb == null ? null : Math.round(vb * 10000) / 10000,
          n_a: Number(A.get(id)?.n ?? 0), n_b: Number(B.get(id)?.n ?? 0),
          delta: va != null && vb != null ? Math.round((vb - va) * 10000) / 10000 : null,
          comparable: !(disrupted && SPATIAL.has(id)),
          not_comparable_because: disrupted && SPATIAL.has(id)
            ? `${between.map(r => `${r.change_kind} on ${r.day_local}`).join(', ')} — the board was not the same in both periods`
            : undefined,
        }
      })

      const span = { start: a.window_a.start, end: a.window_b.end, days: 0 }
      return {
        data: { window_a: a.window_a, window_b: a.window_b, rows, layout_changes_between: between },
        meta: base(db, a.child_id, span, rows.length),
        dictionary: dictionaryFor(db, ids),
      }
    },
  },

  get_board_layout: {
    description: 'The current grid: what sits where, what is masked, and how a mode overlays it.',
    schema: {
      type: 'object',
      properties: { child_id: { type: 'string' }, board_id: { type: 'string' } },
      required: ['child_id'],
    },
    run: (db, a) => {
      const board = db.one(`
        SELECT board_id, name, kind, grid_rows, grid_cols FROM boards
        WHERE child_id = ? AND board_id = COALESCE(?, board_id) AND kind = 'robust'
        LIMIT 1`, [a.child_id, a.board_id ?? null])
      if (!board) throw new McpError('CHILD_NOT_FOUND', `No robust board for ${a.child_id}.`)

      const cells = db.all(`
        SELECT bc.grid_row, bc.grid_col, bc.card_id, c.label, c.is_core, c.is_essential,
               bc.canonical, bc.masked, bc.nav_depth
        FROM board_cells bc JOIN cards c ON c.card_id = bc.card_id
        WHERE bc.board_id = ? ORDER BY bc.grid_row, bc.grid_col`, [board.board_id])

      const buried = db.all(`
        SELECT cv.card_id, c.label, cv.nav_depth FROM child_vocabulary cv
        JOIN cards c ON c.card_id = cv.card_id
        WHERE cv.child_id = ? AND cv.nav_depth > 0 ORDER BY cv.nav_depth DESC, c.label`,
        [a.child_id])

      const modes = db.all(`
        SELECT b.board_id, b.name,
               (SELECT COUNT(*) FROM mode_selection m WHERE m.board_id = b.board_id) AS card_count,
               (SELECT COUNT(*) FROM mode_selection m
                 LEFT JOIN board_cells bc2 ON bc2.board_id = ? AND bc2.card_id = m.card_id
                 WHERE m.board_id = b.board_id AND bc2.card_id IS NULL) AS cards_not_on_robust_board
        FROM boards b WHERE b.child_id = ? AND b.kind = 'mode'`,
        [board.board_id, a.child_id])

      const dupes = new Map<string, number>()
      for (const c of cells) dupes.set(c.card_id as string, (dupes.get(c.card_id as string) ?? 0) + 1)

      const w = resolveWindow(db, 'last_28d')
      return {
        data: {
          board, cells, buried_cards: buried, modes,
          duplicate_cards: [...dupes.entries()].filter(([, n]) => n > 1)
            .map(([card_id, positions]) => ({ card_id, positions })),
          note: 'Duplicates are intentional. Constraint C3: to surface a buried word, add a copy — never move the original.',
        },
        meta: base(db, a.child_id, w, cells.length),
        forbidden_actions: ['move_card', 'resize_grid', 'remove_original'],
      }
    },
  },

  write_insight: {
    description: 'Record a narration against a rule that fired. Requires --allow-writes.',
    schema: {
      type: 'object',
      properties: {
        fired_rule_id: { type: 'string' },
        narration: { type: 'string' },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        model: { type: 'string' },
        actions_suggested: { type: 'array', items: { type: 'string' }, maxItems: 6 },
      },
      required: ['fired_rule_id', 'narration', 'confidence', 'model'],
    },
    run: (db, a) => {
      const rule = db.one(`
        SELECT f.fired_rule_id, f.child_id, f.insight_id, f.dismissed_at, f.superseded_by,
               ic.forbidden_actions
        FROM fired_rules f JOIN insights_catalog ic ON ic.insight_id = f.insight_id
        WHERE f.fired_rule_id = ?`, [a.fired_rule_id])
      if (!rule) {
        throw new McpError('SQL_REJECTED',
          `No fired rule '${a.fired_rule_id}'. You cannot invent a finding — if no rule fired, ` +
          `there is nothing to narrate.`)
      }
      if (rule.dismissed_at) throw new McpError('SQL_REJECTED', 'That finding was dismissed by an adult.')
      if (rule.superseded_by) throw new McpError('SQL_REJECTED', 'That finding has been superseded by a later run.')

      const forbidden: string[] = JSON.parse(rule.forbidden_actions as string)
      const suggested: string[] = a.actions_suggested ?? []
      const clash = suggested.filter(s => forbidden.includes(s))
      if (clash.length) {
        throw new McpError('SQL_REJECTED',
          `${clash.join(', ')} ${clash.length === 1 ? 'is' : 'are'} forbidden for ${rule.insight_id}. ` +
          `These are ruled out by AAC practice, not by preference.`)
      }
      const lower = String(a.narration).toLowerCase()
      const inProse = forbidden.filter(f => lower.includes(f.replace(/_/g, ' ')))
      if (inProse.length) {
        throw new McpError('SQL_REJECTED',
          `The narration references forbidden advice: ${inProse.join(', ')}.`)
      }
      if (String(a.narration).length > 500) {
        throw new McpError('SQL_REJECTED', 'Narration is limited to 500 characters.')
      }

      const id = `ie_${randomUUID().slice(0, 16)}`
      db.exec(
        `INSERT INTO insights (insight_event_id, fired_rule_id, child_id, written_at,
                               model, narration, confidence, actions_suggested)
         VALUES (?,?,?,?,?,?,?,?)`,
        [id, a.fired_rule_id, rule.child_id, Date.now(), a.model, a.narration,
         a.confidence, JSON.stringify(suggested)])

      const w = resolveWindow(db, 'last_7d')
      return {
        data: { insight_event_id: id, fired_rule_id: a.fired_rule_id, insight_id: rule.insight_id },
        meta: base(db, rule.child_id as string, w, 1),
      }
    },
  },

  propose_board_change: {
    description: 'Propose a layout change for a human to approve. Never applies one. Requires --allow-writes.',
    schema: {
      type: 'object',
      properties: {
        child_id: { type: 'string' },
        board_id: { type: 'string' },
        fired_rule_id: { type: 'string' },
        change_kind: {
          type: 'string', enum: ['add', 'add_copy', 'mask', 'unmask'],
          description: 'move, resize and remove are NOT available. Motor plans depend on positions staying put.',
        },
        card_id: { type: 'string' },
        to_row: { type: 'integer', minimum: 0 },
        to_col: { type: 'integer', minimum: 0 },
        rationale: { type: 'string' },
      },
      required: ['child_id', 'change_kind', 'card_id', 'rationale'],
    },
    run: (db, a) => {
      const board = db.one(
        `SELECT board_id, grid_rows, grid_cols FROM boards
         WHERE child_id = ? AND board_id = COALESCE(?, board_id) AND kind = 'robust' LIMIT 1`,
        [a.child_id, a.board_id ?? null])
      if (!board) throw new McpError('CHILD_NOT_FOUND', `No robust board for ${a.child_id}.`)
      if (!db.one('SELECT card_id FROM cards WHERE card_id = ?', [a.card_id])) {
        throw new McpError('SQL_REJECTED', `No card '${a.card_id}'.`)
      }
      if (String(a.rationale).length > 300) {
        throw new McpError('SQL_REJECTED', 'Rationale is limited to 300 characters.')
      }

      if (a.change_kind === 'add' || a.change_kind === 'add_copy') {
        if (a.to_row === undefined || a.to_col === undefined) {
          throw new McpError('SQL_REJECTED', `${a.change_kind} needs to_row and to_col.`)
        }
        if (a.to_row >= Number(board.grid_rows) || a.to_col >= Number(board.grid_cols)) {
          throw new McpError('SQL_REJECTED',
            `(${a.to_row},${a.to_col}) is outside the ${board.grid_rows}x${board.grid_cols} grid.`)
        }
        const occupant = db.one(
          `SELECT c.label FROM board_cells bc JOIN cards c ON c.card_id = bc.card_id
           WHERE bc.board_id = ? AND bc.grid_row = ? AND bc.grid_col = ? AND bc.masked = 0`,
          [board.board_id, a.to_row, a.to_col])
        if (occupant) {
          // Placing over an occupied cell would displace a learned button —
          // the same harm as a move, arriving by a different route.
          throw new McpError('SQL_REJECTED',
            `(${a.to_row},${a.to_col}) already holds '${occupant.label}'. Placing a card there would ` +
            `displace a button the child has learned. Choose an empty or masked cell.`)
        }
      }

      const id = `bcp_${randomUUID().slice(0, 16)}`
      db.exec(
        `INSERT INTO board_change_proposals
           (proposal_id, child_id, board_id, fired_rule_id, proposed_at, proposed_by,
            change_kind, card_id, to_row, to_col, rationale, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending')`,
        [id, a.child_id, board.board_id, a.fired_rule_id ?? null, Date.now(), 'mcp',
         a.change_kind, a.card_id, a.to_row ?? null, a.to_col ?? null, a.rationale])

      const w = resolveWindow(db, 'last_7d')
      return {
        data: {
          proposal_id: id, status: 'pending',
          note: 'Proposed only. A human approves it in the dashboard, which writes the ' +
            'board_revisions row so I8 can measure whether the change helped.',
        },
        meta: base(db, a.child_id, w, 1),
      }
    },
  },

  query: {
    description: 'Read-only SQL for questions the typed tools do not cover. SELECT/WITH only.',
    schema: {
      type: 'object',
      properties: { sql: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 500 } },
      required: ['sql'],
    },
    run: (db, a) => {
      const { rows, truncated, applied } = db.freeQuery(a.sql, Math.min(a.limit ?? 200, 500))
      const w = resolveWindow(db, 'last_28d')
      return {
        data: { rows, sql_executed: applied },
        meta: { ...base(db, null, w, rows.length, truncated) },
      }
    },
  },
}
