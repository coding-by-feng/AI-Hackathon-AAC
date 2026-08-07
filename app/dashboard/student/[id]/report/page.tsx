import Link from 'next/link'
import { currentViewer, requireChild } from '@/lib/access'
import { windowOf } from '@/lib/db'
import { reportMetrics, plainSummary } from '@/lib/report'
import { MetricCard, MetricCaveats } from '@/components/metric-card'
import { StudentTabs } from '@/components/status'

export const dynamic = 'force-dynamic'

/**
 * The progress dashboard from the reference design.
 *
 * Eight metrics in two rows — four traditional, four AI-generated — then the
 * report in plain words, then the chat about it.
 *
 * Everything readable comes from metrics_catalog: the name, the one-line
 * explanation and the caveat. Nothing here hardcodes a metric, so adding a
 * ninth is a database change.
 */
export default async function StudentReportPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ days?: string }>
}) {
  const { id } = await params
  const { days } = await searchParams
  const viewer = await currentViewer()
  const child = requireChild(viewer, id)
  const first = child.display_name.split(' ')[0]

  const period = Number(days) === 7 ? 7 : Number(days) === 90 ? 90 : 28
  const w = windowOf(period)
  const metrics = reportMetrics(id, w)
  const { summary, guidance } = plainSummary(first, metrics)

  // Grouped as the filtered index groups them, not by how they are computed.
  const GROUPS: Record<string, string> = {
    A: 'Effort and speed', B: 'Errors and reach', C: 'Words she uses',
    D: 'How the board is laid out', E: 'Whose voice', G: 'The adult',
    H: 'How she communicates',
  }
  const grouped = Object.entries(GROUPS)
    .map(([g, title]) => ({ g, title, items: metrics.filter((m) => m.group === g) }))
    .filter((s) => s.items.length)

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{child.display_name}</h1>
          <p className="text-sm text-[var(--color-ink-muted)]">
            {[child.year_group, child.profile_note].filter(Boolean).join(' · ')}
          </p>
        </div>
        <nav className="flex gap-1 rounded-[var(--radius-card)] border border-[var(--color-line)] p-1 text-xs">
          {[
            { d: 7, label: 'This week' },
            { d: 28, label: 'This month' },
            { d: 90, label: 'This term' },
          ].map((o) => (
            <Link
              key={o.d}
              href={`/dashboard/student/${id}/report?days=${o.d}`}
              className={`rounded-md px-3 py-1.5 font-medium ${
                period === o.d
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunk)]'
              }`}
            >
              {o.label}
            </Link>
          ))}
        </nav>
      </header>

      <StudentTabs childId={id} active="report" />

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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">This period in plain words</h2>
          <div className="flex gap-2 text-xs">
            <button className="rounded-md border border-[var(--color-line)] px-3 py-1.5">
              Save as PDF
            </button>
            <Link
              href={`/dashboard/student/${id}/ask`}
              className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 font-medium text-white"
            >
              Ask about this
            </Link>
          </div>
        </div>

        <p className="text-sm leading-relaxed">{summary}</p>
        <p className="mt-2 text-sm leading-relaxed">{guidance}</p>

        <p className="mt-3 border-t border-[var(--color-line)] pt-2 text-[11px] text-[var(--color-ink-faint)]">
          Written from the {metrics.length} numbers above and nothing else.
        </p>
      </section>

      <div className="mt-4">
        <MetricCaveats metrics={metrics} />
      </div>
    </div>
  )
}
