/**
 * metrics_catalog and insights_catalog — the data dictionary.
 *
 * Nothing in the UI hardcodes a metric's name, unit, polarity or caveat. A
 * number rendered without those is how a dashboard becomes confidently wrong,
 * which is the same argument docs/mcp-api.md §1 makes for the LLM surface.
 *
 * `polarity: 'neutral'` is load-bearing, not cosmetic. Clinical constraint C1
 * forbids styling repetition or stimming as a problem, and the only thing that
 * stops the UI doing it is this field. See docs/aac-clinical-constraints.md.
 */
import { all, one } from './db'

export type Polarity = 'higher_better' | 'lower_better' | 'neutral'
export type Tier = 'P0' | 'P1' | 'P2'
export type MetricStatus = 'shown' | 'logged' | 'cut'

export type MetricMeta = {
  metric_id: string
  name: string
  group_code: string
  plain_explanation: string
  formula: string
  unit: string
  polarity: Polarity
  tier: Tier
  audience: string
  min_n: number
  feeds_insights: string[]
  caveat: string | null
  status: MetricStatus
}

export type InsightMeta = {
  insight_id: string
  name: string
  plain_statement: string
  trigger_rule: string
  input_metrics: string[]
  default_thresholds: Record<string, unknown>
  recommended_actions: string[]
  /** Actions that must never be recommended for this insight. Enforced in the UI. */
  forbidden_actions: string[]
  target_audience: 'child' | 'adult' | 'system'
  action_kind: 'intervention' | 'informational' | 'system_fix'
  safety_note: string | null
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string') return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

let metricCache: Map<string, MetricMeta> | null = null

export function metricCatalog(): Map<string, MetricMeta> {
  if (metricCache) return metricCache
  const rows = all<Record<string, unknown>>(`
    SELECT metric_id, name, group_code, plain_explanation, formula, unit,
           polarity, tier, audience, min_n, feeds_insights, caveat, status
    FROM metrics_catalog
  `)
  metricCache = new Map(
    rows.map((r) => [
      r.metric_id as string,
      {
        metric_id: r.metric_id as string,
        name: r.name as string,
        group_code: r.group_code as string,
        plain_explanation: r.plain_explanation as string,
        formula: r.formula as string,
        unit: r.unit as string,
        polarity: r.polarity as Polarity,
        tier: r.tier as Tier,
        audience: r.audience as string,
        min_n: Number(r.min_n ?? 1),
        feeds_insights: parseJson<string[]>(r.feeds_insights, []),
        caveat: (r.caveat as string) ?? null,
        status: r.status as MetricStatus,
      },
    ]),
  )
  return metricCache
}

export function metric(id: string): MetricMeta | undefined {
  return metricCatalog().get(id)
}

export function shownMetrics(): MetricMeta[] {
  return [...metricCatalog().values()].filter((m) => m.status === 'shown')
}

export function insightMeta(id: string): InsightMeta | undefined {
  const r = one<Record<string, unknown>>(
    `SELECT * FROM insights_catalog WHERE insight_id = ?`,
    [id],
  )
  if (!r) return undefined
  return {
    insight_id: r.insight_id as string,
    name: r.name as string,
    plain_statement: r.plain_statement as string,
    trigger_rule: r.trigger_rule as string,
    input_metrics: parseJson<string[]>(r.input_metrics, []),
    default_thresholds: parseJson<Record<string, unknown>>(r.default_thresholds, {}),
    recommended_actions: parseJson<string[]>(r.recommended_actions, []),
    forbidden_actions: parseJson<string[]>(r.forbidden_actions, []),
    target_audience: r.target_audience as InsightMeta['target_audience'],
    action_kind: r.action_kind as InsightMeta['action_kind'],
    safety_note: (r.safety_note as string) ?? null,
  }
}

/**
 * Direction of travel, resolved through polarity.
 *
 * A neutral metric always returns 'flat' regardless of the delta. That is what
 * keeps repeat_tap_rate — the P0 signal added specifically to stop the system
 * pathologising normal behaviour — from ever being painted red.
 */
export function direction(
  metricId: string,
  delta: number | null,
): 'better' | 'worse' | 'flat' {
  if (delta === null || delta === 0) return 'flat'
  const m = metric(metricId)
  if (!m || m.polarity === 'neutral') return 'flat'
  const improving = m.polarity === 'higher_better' ? delta > 0 : delta < 0
  return improving ? 'better' : 'worse'
}

/** Display formatting driven by the catalogue's `unit`, never by the call site. */
export function formatValue(metricId: string, value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—'
  const unit = metric(metricId)?.unit ?? 'count'
  switch (unit) {
    case 'ratio':
      return `${Math.round(value * 100)}%`
    case 'ms':
      return `${(value / 1000).toFixed(1)} s`
    case 'days':
      return value === 1 ? '1 day' : `${Math.round(value)} days`
    case 'wpm':
      return `${value.toFixed(1)} wpm`
    default:
      return Math.abs(value) >= 10 ? Math.round(value).toString() : value.toFixed(1)
  }
}
