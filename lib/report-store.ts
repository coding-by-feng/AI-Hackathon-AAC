/**
 * Saving and listing reports.
 *
 * `metric_snapshot` is the reason this table exists rather than the page simply
 * re-rendering from live data. The chat panel is a conversation ABOUT a report;
 * if the numbers were recomputed on every open, yesterday's conversation would
 * quietly stop matching the prose above it while both looked fine.
 *
 * `metrics_used` records which of the canonical eight the text actually cites.
 * proposed_metrics.docx requires the model not to expand beyond them, and a
 * stored list makes that checkable after the fact instead of merely requested.
 */
import { randomUUID } from 'node:crypto'
import { all, one, write } from './db'
import { reportMetrics, plainSummary, type ReportMetric } from './report'
import type { Window } from './db'

export type StoredReport = {
  report_id: string
  child_id: string
  display_name: string
  period_start: string
  period_end: string
  generated_at: number
  model: string | null
  summary: string
  guidance: string
  metric_snapshot: string
  metrics_used: string
}

export type ReportView = Omit<StoredReport, 'metric_snapshot' | 'metrics_used'> & {
  metrics: ReportMetric[]
  metricsUsed: string[]
}

/**
 * The canonical set, read from the catalogue rather than frozen here.
 *
 * It has already changed once — the eight from proposed_metrics.docx became the
 * thirteen in AAC_Filtered_Metric_Index.md — and a hardcoded array would have
 * silently started rejecting valid citations at that point.
 */
function canonicalIds(): string[] {
  return all<{ metric_id: string }>(
    `SELECT metric_id FROM metrics_catalog WHERE report_set = 1`).map((r) => r.metric_id)
}

/** Which of the eight a piece of prose actually names. */
function citedIn(text: string, metrics: ReportMetric[]): string[] {
  const lower = text.toLowerCase()
  return metrics
    .filter((m) => {
      if (lower.includes(m.name.toLowerCase())) return true
      // The prose says "24 new words", not "new_words" — match the headline too.
      const head = m.headline.replace(/[^\w\s%]/g, '').trim().toLowerCase()
      return head.length > 1 && lower.includes(head)
    })
    .map((m) => m.metric_id)
}

export function generateReport(childId: string, w: Window, childName: string): string {
  const metrics = reportMetrics(childId, w)
  const { summary, guidance } = plainSummary(childName, metrics)
  const id = `rep_${randomUUID().slice(0, 12)}`

  const used = [...new Set([...citedIn(summary, metrics), ...citedIn(guidance, metrics)])]
  const canonical = canonicalIds()
  const stray = used.filter((m) => !canonical.includes(m))
  if (stray.length) {
    // Cannot happen with the deterministic writer, but a model will replace it
    // and this is where that gets caught rather than discovered by a therapist.
    throw new Error(`Report cited metrics outside the canonical set: ${stray.join(', ')}`)
  }

  write(
    `INSERT INTO reports (report_id, child_id, period_start, period_end, generated_at,
                          model, summary, guidance, metric_snapshot, metrics_used)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, childId, w.start, w.end, Date.now(), null, summary, guidance,
     JSON.stringify(metrics), JSON.stringify(used)],
  )
  return id
}

export function listReports(childIds: string[], limit = 30): StoredReport[] {
  if (!childIds.length) return []
  const holes = childIds.map(() => '?').join(',')
  return all<StoredReport>(
    `SELECT r.report_id, r.child_id, c.display_name, r.period_start, r.period_end,
            r.generated_at, r.model, r.summary, r.guidance, r.metric_snapshot, r.metrics_used
     FROM reports r JOIN children c ON c.child_id = r.child_id
     WHERE r.child_id IN (${holes})
     ORDER BY r.generated_at DESC LIMIT ?`, [...childIds, limit])
}

export function readReport(reportId: string): ReportView | null {
  const r = one<StoredReport>(
    `SELECT r.report_id, r.child_id, c.display_name, r.period_start, r.period_end,
            r.generated_at, r.model, r.summary, r.guidance, r.metric_snapshot, r.metrics_used
     FROM reports r JOIN children c ON c.child_id = r.child_id
     WHERE r.report_id = ?`, [reportId])
  if (!r) return null

  const { metric_snapshot, metrics_used, ...rest } = r
  return {
    ...rest,
    // Frozen at generation. Deliberately NOT recomputed — see the file header.
    metrics: safeParse<ReportMetric[]>(metric_snapshot, []),
    metricsUsed: safeParse<string[]>(metrics_used, []),
  }
}

function safeParse<T>(text: string, fallback: T): T {
  try { return JSON.parse(text) as T } catch { return fallback }
}
