/**
 * Sittings at the device.
 *
 * Named "sittings" in code because lib/session.ts already means something else
 * — which child is holding the tablet. The UI says "sessions", because that is
 * what a teacher calls it.
 *
 * The grain exists because a bad DAY is very often one bad sitting. Maya's
 * worst sitting runs a 22% unintended-press rate against a 9% daily average;
 * a day-level row averages that away and nobody ever sees it.
 *
 * Rows are derived by splitting the event stream on 20-minute idle gaps, not by
 * trusting a session id — that is also how it has to work against real data,
 * where nothing announces that a child put the tablet down.
 */
import { all, one } from './db'

export type Sitting = {
  session_id: string
  child_id: string
  display_name: string
  day_local: string
  started_at: number
  minutes: number | null
  scene: string
  utterances: number
  taps: number
  mistaps: number
  abandoned: number
  mistap_rate: number | null
  fatigue_ratio: number | null
}

export type SittingFilter = {
  childId?: string
  days?: number
  order?: 'recent' | 'worst' | 'longest'
  limit?: number
}

export function sittings(childIds: string[], f: SittingFilter = {}): Sitting[] {
  if (!childIds.length) return []
  const scope = f.childId && childIds.includes(f.childId) ? [f.childId] : childIds
  const holes = scope.map(() => '?').join(',')
  const order =
    f.order === 'worst'
      ? 'mistap_rate DESC NULLS LAST, s.taps DESC'
      : f.order === 'longest'
        ? 's.minutes DESC'
        : 's.started_at DESC'

  return all<Sitting>(
    `SELECT s.session_id, s.child_id, c.display_name, s.day_local, s.started_at,
            s.minutes, s.scene, s.utterances, s.taps, s.mistaps, s.abandoned,
            ROUND(CAST(s.mistaps AS REAL) / NULLIF(s.taps, 0), 3) AS mistap_rate,
            s.fatigue_ratio
     FROM sessions s
     JOIN children c ON c.child_id = s.child_id
     WHERE s.child_id IN (${holes})
       AND s.day_local >= date((SELECT MAX(day_local) FROM events), ?)
       -- Below ~10 taps a rate is noise, and a list of one-tap sittings buries
       -- the ones worth looking at.
       AND s.taps >= 10
     ORDER BY ${order}
     LIMIT ?`,
    [...scope, `-${(f.days ?? 14) - 1} days`, Math.min(f.limit ?? 40, 200)],
  )
}

export function sitting(sessionId: string): Sitting | undefined {
  return one<Sitting>(
    `SELECT s.session_id, s.child_id, c.display_name, s.day_local, s.started_at,
            s.minutes, s.scene, s.utterances, s.taps, s.mistaps, s.abandoned,
            ROUND(CAST(s.mistaps AS REAL) / NULLIF(s.taps, 0), 3) AS mistap_rate,
            s.fatigue_ratio
     FROM sessions s JOIN children c ON c.child_id = s.child_id
     WHERE s.session_id = ?`, [sessionId])
}

/** What was actually said in a sitting. Labels only — never utterance text. */
export function sittingUtterances(s: Sitting, limit = 40) {
  return all<{
    utterance_id: string; ts: number; labels: string; symbol_count: number
    spoken: number; tap_count: number; delete_count: number
  }>(
    `SELECT utterance_id, ts, labels, symbol_count, spoken, tap_count, delete_count
     FROM utterances
     WHERE child_id = ? AND actor = 'child' AND ts BETWEEN ? AND ?
     ORDER BY ts LIMIT ?`,
    [s.child_id, s.started_at, s.started_at + (s.minutes ?? 0) * 60000 + 1000, limit])
}

export type SittingStats = {
  count: number
  median_minutes: number | null
  median_taps: number | null
  worst_rate: number | null
  fatigued: number
}

/**
 * Sittings where the last third had a materially worse error rate than the
 * first. The answer to fatigue is a break, never a board change — so this is
 * counted separately from anything that looks like a layout problem.
 */
export function sittingStats(childIds: string[], days = 14): SittingStats {
  if (!childIds.length) {
    return { count: 0, median_minutes: null, median_taps: null, worst_rate: null, fatigued: 0 }
  }
  const holes = childIds.map(() => '?').join(',')
  const row = one<SittingStats>(
    `WITH s AS (
       SELECT *, CAST(mistaps AS REAL) / NULLIF(taps, 0) AS rate
       FROM sessions
       WHERE child_id IN (${holes})
         AND day_local >= date((SELECT MAX(day_local) FROM events), ?)
         AND taps >= 10
     )
     SELECT COUNT(*) AS count,
            ROUND(AVG(minutes), 1) AS median_minutes,
            ROUND(AVG(taps)) AS median_taps,
            ROUND(MAX(rate), 3) AS worst_rate,
            SUM(CASE WHEN fatigue_ratio >= 1.5 THEN 1 ELSE 0 END) AS fatigued
     FROM s`,
    [...childIds, `-${days - 1} days`])
  return row ?? { count: 0, median_minutes: null, median_taps: null, worst_rate: null, fatigued: 0 }
}
