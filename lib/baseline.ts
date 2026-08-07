/**
 * Baseline gating.
 *
 * Every threshold in the system — mis-tap rate, abandonment, the Attention
 * Queue score, all eight insight rules — compares a child against their own
 * history. Before that history exists, a threshold tuned to a different child
 * is worse than no threshold at all.
 *
 * So: numbers are shown from day one, and nothing is flagged until the child
 * has enough of their own data to be compared against.
 *
 * Why active DAYS and not calendar days: a child who barely uses the app never
 * accumulates a usable baseline, and a calendar gate would quietly start
 * flagging them at day 14 on almost no data. This is the failure that made
 * Jonah — 8 utterances then silence — the hardest case in the seed set.
 */
import { one } from './db'

/** docs/aac-clinical-constraints.md defers to the metrics spec here: 4 weeks of thresholds, 14 active days to arm them. */
export const BASELINE_ACTIVE_DAYS = 14
export const BASELINE_MIN_UTTERANCES = 40

export type Baseline = {
  ready: boolean
  activeDays: number
  utterances: number
  /** 0..1 — how far through the baseline this child is. */
  progress: number
  reason: string | null
}

export function baseline(childId: string): Baseline {
  const row = one<{ active_days: number; utterances: number }>(
    `
    SELECT COUNT(DISTINCT day_local) AS active_days,
           COUNT(*)                  AS utterances
    FROM utterances
    WHERE child_id = ? AND actor = 'child' AND spoken = 1
    `,
    [childId],
  )
  const activeDays = Number(row?.active_days ?? 0)
  const utterances = Number(row?.utterances ?? 0)

  const dayProgress = Math.min(1, activeDays / BASELINE_ACTIVE_DAYS)
  const uttProgress = Math.min(1, utterances / BASELINE_MIN_UTTERANCES)
  const progress = Math.min(dayProgress, uttProgress)
  const ready = activeDays >= BASELINE_ACTIVE_DAYS && utterances >= BASELINE_MIN_UTTERANCES

  let reason: string | null = null
  if (!ready) {
    reason =
      activeDays < BASELINE_ACTIVE_DAYS
        ? `${activeDays} of ${BASELINE_ACTIVE_DAYS} active days`
        : `${utterances} of ${BASELINE_MIN_UTTERANCES} sentences`
  }

  return { ready, activeDays, utterances, progress, reason }
}

/**
 * Rolling comparison basis for one metric — the mean and spread of the child's
 * own recent history, which is what "elevated" has to mean.
 */
export function rollingBaseline(
  childId: string,
  metricId: string,
  days = 28,
): { mean: number; stdev: number; n: number } | null {
  const row = one<{ mean: number; sd: number; n: number }>(
    `
    WITH recent AS (
      -- Day-grain read: below-min_n days are real values now (the rollup no
      -- longer NULLs them) but too noisy for a spread estimate — mask here.
      SELECT a.value FROM agg_daily_metric a
      JOIN metrics_catalog mc ON mc.metric_id = a.metric_id
      WHERE a.child_id = ? AND a.metric_id = ? AND a.value IS NOT NULL
        AND a.n >= mc.min_n
      ORDER BY a.day_local DESC LIMIT ?
    )
    SELECT AVG(value) AS mean,
           -- population stdev; SQLite has no stdev()
           SQRT(AVG(value * value) - AVG(value) * AVG(value)) AS sd,
           COUNT(*) AS n
    FROM recent
    `,
    [childId, metricId, days],
  )
  if (!row || !row.n) return null
  return { mean: Number(row.mean ?? 0), stdev: Number(row.sd ?? 0), n: Number(row.n) }
}
