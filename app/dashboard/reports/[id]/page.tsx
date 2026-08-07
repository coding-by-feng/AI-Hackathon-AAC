import Link from 'next/link'
import { notFound } from 'next/navigation'
import { currentViewer, requireChild } from '@/lib/access'
import { readReport } from '@/lib/report-store'
import { MetricCard, MetricCaveats } from '@/components/metric-card'
import { Panel } from '@/components/ui'
import { AskPanel } from '@/components/chat/ask-panel'

export const dynamic = 'force-dynamic'

/**
 * One report.
 *
 * The metrics rendered here come from the FROZEN snapshot, not from a fresh
 * query. Open this in six months and the prose still matches the numbers above
 * it — which is the whole reason the chat below can be a conversation about
 * "this report" rather than about today's data.
 */
export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const report = readReport(id)
  if (!report) notFound()

  // Reading a report is reading a child's data. Scope it the same way.
  const viewer = await currentViewer()
  const child = requireChild(viewer, report.child_id)
  const first = child.display_name.split(' ')[0]

  const GROUPS: Record<string, string> = {
    A: 'Effort and speed', B: 'Errors and reach', C: 'Words she uses',
    D: 'How the board is laid out', E: 'Whose voice', G: 'The adult',
    H: 'How she communicates',
  }
  const grouped = Object.entries(GROUPS)
    .map(([g, title]) => ({ g, title, items: report.metrics.filter((m) => m.group === g) }))
    .filter((s) => s.items.length)
  const ageDays = Math.floor((Date.now() - report.generated_at) / 86_400_000)

  return (
    <div>
      <nav className="mb-3 text-xs">
        <Link href="/dashboard/reports" className="text-[var(--color-accent)] hover:underline">
          ← All reports
        </Link>
      </nav>

      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{child.display_name}</h1>
          <p className="text-sm text-[var(--color-ink-muted)]">
            {report.period_start} → {report.period_end}
            {' · written '}
            {new Date(report.generated_at).toLocaleDateString()}
            {ageDays > 0 && ` (${ageDays} day${ageDays === 1 ? '' : 's'} ago)`}
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <Link href={`/dashboard/student/${child.child_id}/report`}
                className="rounded-md border border-[var(--color-line)] px-3 py-1.5">
            See live numbers
          </Link>
          <a href={`/api/reports/${report.report_id}/print`} target="_blank" rel="noopener"
             className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 font-medium text-white">
            Save as PDF
          </a>
        </div>
      </header>

      {ageDays >= 7 && (
        <p className="mb-4 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-sunk)] px-3 py-2 text-xs text-[var(--color-ink-muted)]">
          These numbers are frozen as they were on{' '}
          {new Date(report.generated_at).toLocaleDateString()}. They have not been updated —
          that is deliberate, so the words below still describe the figures beside them.
        </p>
      )}

      {grouped.map((sec) => (
        <section key={sec.g} className="mt-5">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
            {sec.title}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {sec.items.map((m) => <MetricCard key={m.metric_id} m={m} />)}
          </div>
        </section>
      ))}

      <section className="mt-6 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <h2 className="mb-3 text-sm font-semibold">In plain words</h2>
        <p className="text-sm leading-relaxed">{report.summary}</p>
        <p className="mt-2 text-sm leading-relaxed">{report.guidance}</p>
        <p className="mt-3 border-t border-[var(--color-line)] pt-2 text-[11px] text-[var(--color-ink-faint)]">
          Written from {report.metricsUsed.length} of the {report.metrics.length} numbers above and nothing else
          {report.model ? ` · ${report.model}` : ' · no model — deterministic summary'}.
        </p>
      </section>

      <div className="mt-4">
        <MetricCaveats metrics={report.metrics} />
      </div>

      <div className="mt-6">
        <Panel
          title="Ask about this report"
          subtitle="Questions about these numbers. Every answer shows what it looked at."
        >
          <AskPanel
            childId={child.child_id}
            childName={first}
            suggestions={[
              'What should I try next?',
              'Which of these matters most?',
              'What does the pairs number mean?',
            ]}
          />
        </Panel>
      </div>
    </div>
  )
}
