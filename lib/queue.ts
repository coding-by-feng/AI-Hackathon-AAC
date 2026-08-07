/**
 * The Attention Queue — who needs a person today.
 *
 * This is the surface a teacher with five AAC students actually uses. Charts
 * are for when a question already exists; the queue is what raises one.
 *
 * Scoring is docs/analytics-metrics.md §9, with one addition the spec does not
 * have: a child still inside their baseline window cannot be scored at all.
 * Thresholds tuned to another child would rank them for no reason.
 *
 * The score breakdown is returned, not just the total. A teacher who cannot see
 * why a child is first will not trust the order, and the formula is simple
 * enough to show.
 */
import { all, one, windowOf, type Window } from './db'
import { silenceStreak, readMetric } from './metrics'
import { openInsights } from './insights'
import { baseline } from './baseline'
import type { ChildSummary } from './access'

export type QueueReason = {
  code: string
  detail: string
  points: number
  metric_id: string | null
}

export type QueueEntry = {
  child: ChildSummary
  score: number
  reasons: QueueReason[]
  inBaseline: boolean
  baselineProgress: number
  /** Roster-row metrics, shown whether or not the child scores. */
  silence: number
  tapsPerUtterance: number | null
  independence: number | null
  newWords: number
}

const SCORE = {
  silence: 3,
  abandonment: 2,
  mistap: 2,
  gaps: 1,
  openInsight: 1,
} as const

const THRESHOLD = {
  silenceDays: 2,
  abandonment: 0.25,
  mistap: 0.12,
  gaps: 3,
} as const

function unreviewedGapCount(childId: string, w: Window): number {
  return Number(
    one<{ c: number }>(
      `SELECT COUNT(DISTINCT json_extract(payload,'$.normalizedConcept')) c
       FROM events
       WHERE child_id = ? AND type = 'gap_detected'
         AND json_extract(payload,'$.resolvedBy') = 'generated'
         AND day_local BETWEEN ? AND ?`,
      [childId, w.start, w.end],
    )?.c ?? 0,
  )
}

export function buildQueue(children: ChildSummary[], days = 7): QueueEntry[] {
  const w = windowOf(days)

  const entries = children.map((child): QueueEntry => {
    const base = baseline(child.child_id)
    const silence = silenceStreak(child.child_id)
    const abandonment = readMetric('abandonment_rate', child.child_id, w)
    const mistap = readMetric('mistap_rate', child.child_id, w)
    const taps = readMetric('taps_per_utterance', child.child_id, w)
    const independence = readMetric('independence_rate', child.child_id, w)
    const gaps = unreviewedGapCount(child.child_id, w)
    const insights = openInsights(child.child_id)

    const newWordCount = Number(
      one<{ c: number }>(
        `WITH firsts AS (
           SELECT label, MIN(day_local) d FROM events
           WHERE child_id = ? AND actor='child' AND type='card_tap' AND label IS NOT NULL
           GROUP BY label)
         SELECT COUNT(*) c FROM firsts WHERE d BETWEEN ? AND ?`,
        [child.child_id, w.start, w.end],
      )?.c ?? 0,
    )

    const reasons: QueueReason[] = []

    // A child inside their baseline still appears on the roster with real
    // numbers — they simply cannot be flagged against thresholds that do not
    // yet mean anything for them.
    if (base.ready) {
      if (silence >= THRESHOLD.silenceDays) {
        reasons.push({
          code: 'SILENCE',
          detail: `Has not spoken for ${silence} days`,
          points: SCORE.silence,
          metric_id: 'silence_streak',
        })
      }
      if (abandonment.value !== null && abandonment.value > THRESHOLD.abandonment) {
        reasons.push({
          code: 'ABANDONMENT',
          detail: `Gives up on ${Math.round(abandonment.value * 100)}% of sentences`,
          points: SCORE.abandonment,
          metric_id: 'abandonment_rate',
        })
      }
      if (mistap.value !== null && mistap.value > THRESHOLD.mistap) {
        reasons.push({
          code: 'MISTAP',
          detail: `${Math.round(mistap.value * 100)}% of presses are undone straight away`,
          points: SCORE.mistap,
          metric_id: 'mistap_rate',
        })
      }
      if (gaps >= THRESHOLD.gaps) {
        reasons.push({
          code: 'GAPS',
          detail: `${gaps} words she reached for that do not exist`,
          points: SCORE.gaps,
          metric_id: 'vocabulary_gaps',
        })
      }
      if (insights.length > 0) {
        const names = insights.map((i) => i.insight_id).join(', ')
        reasons.push({
          code: 'INSIGHT',
          detail: `${insights.length} open ${insights.length === 1 ? 'finding' : 'findings'} (${names})`,
          points: SCORE.openInsight,
          metric_id: null,
        })
      }
    }

    return {
      child,
      score: reasons.reduce((n, r) => n + r.points, 0),
      reasons,
      inBaseline: !base.ready,
      baselineProgress: base.progress,
      silence,
      tapsPerUtterance: taps.value,
      independence: independence.value,
      newWords: newWordCount,
    }
  })

  return entries.sort((a, b) => b.score - a.score || a.child.display_name.localeCompare(b.child.display_name))
}

/** When analysis last ran. Stale is a normal state here, not an error. */
export function analysisFreshness(): { lastRun: number | null; ageHours: number | null } {
  const ts = one<{ t: number }>(`SELECT MAX(fired_at) t FROM fired_rules`)?.t
  if (!ts) return { lastRun: null, ageHours: null }
  return { lastRun: Number(ts), ageHours: (Date.now() - Number(ts)) / 3_600_000 }
}

export function rollupThrough(): string | null {
  return one<{ d: string }>(`SELECT MAX(day_local) d FROM agg_daily_metric`)?.d ?? null
}

export function classesFor(children: ChildSummary[]): string {
  const names = all<{ name: string }>(
    `SELECT DISTINCT name FROM classes WHERE class_id IN (${children
      .map(() => '?')
      .join(',') || "''"})`,
    children.map((c) => c.class_id ?? ''),
  )
  return names.map((n) => n.name).join(', ') || 'Class'
}
