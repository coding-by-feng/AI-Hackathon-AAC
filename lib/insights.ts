/**
 * Fired rules and their evidence.
 *
 * Two tables, deliberately: `fired_rules` is produced by plain SQL and is
 * deterministic and explainable; `insights` is model narration that cannot
 * exist without a fired_rule_id. The dashboard shows the rule first and the
 * narration second, so a teacher can always ask "what number caused this?"
 *
 * The catalogue's forbidden_actions, target_audience and action_kind travel
 * with every insight to the UI. They are not advisory: an insight whose
 * action_kind is 'informational' renders no action button at all, which is what
 * stops I4 case B — a child refusing something — turning into a training task.
 */
import { all, write } from './db'
import { insightMeta, type InsightMeta } from './catalog'
import type { DismissReason } from './dismiss'
import type { InsightCardData } from '@/components/insight-card'

export type { DismissReason }

export type EvidenceRow = Record<string, unknown>

export type FiredRule = {
  fired_rule_id: string
  child_id: string
  insight_id: string
  fired_at: number
  window_start: string
  window_end: string
  evidence: EvidenceRow[]
  thresholds: Record<string, unknown>
  classification: Record<string, unknown> | null
  dismissed_at: number | null
  dismiss_reason: string | null
  meta: InsightMeta | undefined
  narration: string | null
  narrationModel: string | null
}

function parse<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string') return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function hydrate(r: Record<string, unknown>): FiredRule {
  return {
    fired_rule_id: r.fired_rule_id as string,
    child_id: r.child_id as string,
    insight_id: r.insight_id as string,
    fired_at: Number(r.fired_at),
    window_start: r.window_start as string,
    window_end: r.window_end as string,
    evidence: parse<EvidenceRow[]>(r.evidence, []),
    thresholds: parse<Record<string, unknown>>(r.thresholds_used, {}),
    classification: r.classification ? parse<Record<string, unknown>>(r.classification, {}) : null,
    dismissed_at: r.dismissed_at ? Number(r.dismissed_at) : null,
    dismiss_reason: (r.dismiss_reason as string) ?? null,
    meta: insightMeta(r.insight_id as string),
    narration: (r.narration as string) ?? null,
    narrationModel: (r.model as string) ?? null,
  }
}

/**
 * Open insights for a child. Superseded firings are excluded — a later run
 * replacing an earlier one should not show both.
 */
export function openInsights(childId: string): FiredRule[] {
  const rows = all<Record<string, unknown>>(
    `
    SELECT f.*, i.narration, i.model
    FROM fired_rules f
    LEFT JOIN insights i ON i.fired_rule_id = f.fired_rule_id
    WHERE f.child_id = ? AND f.dismissed_at IS NULL AND f.superseded_by IS NULL
    ORDER BY f.fired_at DESC, f.insight_id
    `,
    [childId],
  )
  return rows.map(hydrate)
}

export function insightHistory(childId: string, limit = 30): FiredRule[] {
  const rows = all<Record<string, unknown>>(
    `
    SELECT f.*, i.narration, i.model
    FROM fired_rules f
    LEFT JOIN insights i ON i.fired_rule_id = f.fired_rule_id
    WHERE f.child_id = ?
    ORDER BY f.fired_at DESC
    LIMIT ?
    `,
    [childId, limit],
  )
  return rows.map(hydrate)
}

export function openInsightCount(childId: string): number {
  return openInsights(childId).length
}

/**
 * Dismissing is the only feedback this system gets on whether its rules are any
 * good. After a term of dismissals, a rule nobody ever accepts can be retired —
 * which is impossible if the reason is not recorded.
 */
export function dismissInsight(
  firedRuleId: string,
  adultId: string,
  reason: DismissReason,
): void {
  write(
    `UPDATE fired_rules
     SET dismissed_at = CAST(strftime('%s','now') AS INTEGER) * 1000,
         dismissed_by = ?, dismiss_reason = ?
     WHERE fired_rule_id = ? AND dismissed_at IS NULL`,
    [adultId, reason, firedRuleId],
  )
}

/**
 * Split an evidence row into the measured values and the thresholds they were
 * compared against.
 *
 * Showing both is the difference between "the system says she is struggling"
 * and "11.8% against a threshold of 8%, over 14 active days" — the second can
 * be argued with, which is the point.
 */
export function splitEvidence(row: EvidenceRow): {
  values: [string, unknown][]
  thresholds: [string, unknown][]
} {
  const skip = new Set(['child_id', 'window_start', 'window_end', 'triggered'])
  const values: [string, unknown][] = []
  const thresholds: [string, unknown][] = []
  for (const [k, v] of Object.entries(row)) {
    if (skip.has(k) || v === null) continue
    if (k.startsWith('threshold_') || k.endsWith('_threshold_ms')) thresholds.push([k, v])
    else values.push([k, v])
  }
  return { values, thresholds }
}

/** `mistap_rate` -> `mis-tap rate`; keeps evidence readable without a lookup table. */
export function humanKey(key: string): string {
  return key
    .replace(/^threshold_/, '')
    .replace(/_/g, ' ')
    .replace(/\bms\b/, '(ms)')
    .replace(/mistap/g, 'mis-tap')
    .replace(/^n /, 'count of ')
}

/**
 * Shape a fired rule for the insight card.
 *
 * The fallbacks are chosen for safety, not convenience: a firing whose
 * catalogue row is missing renders as `informational` — no action button —
 * rather than inviting an intervention nobody specified.
 */
export function toCardData(fr: FiredRule): InsightCardData {
  const split = splitEvidence(fr.evidence[0] ?? {})
  const fmt = (pairs: [string, unknown][]): [string, string][] =>
    pairs.map(([k, v]) => [humanKey(k), humanEvidenceValue(k, v)])
  return {
    fired_rule_id: fr.fired_rule_id,
    insight_id: fr.insight_id,
    name: fr.meta?.name ?? fr.insight_id,
    plain_statement: fr.meta?.plain_statement ?? '',
    narration: fr.narration,
    narrationModel: fr.narrationModel,
    firedAt: fr.fired_at,
    window: `${fr.window_start} to ${fr.window_end}`,
    evidence: { values: fmt(split.values), thresholds: fmt(split.thresholds) },
    classification: fr.classification,
    recommended_actions: fr.meta?.recommended_actions ?? [],
    forbidden_actions: fr.meta?.forbidden_actions ?? [],
    action_kind: fr.meta?.action_kind ?? 'informational',
    target_audience: fr.meta?.target_audience ?? 'adult',
    safety_note: fr.meta?.safety_note ?? null,
  }
}

export function humanEvidenceValue(key: string, value: unknown): string {
  if (typeof value !== 'number') return String(value)
  if (key.includes('rate') || key.includes('ratio') || key.includes('share')) {
    return `${(value * 100).toFixed(1)}%`
  }
  if (key.endsWith('_ms')) return `${(value / 1000).toFixed(1)} s`
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}
