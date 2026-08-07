import Link from 'next/link'
import { currentViewer, visibleChildren } from '@/lib/access'
import { listReports } from '@/lib/report-store'
import { Panel, EmptyState } from '@/components/ui'
import { generateReportAction } from './actions'

export const dynamic = 'force-dynamic'

/**
 * Reports — a list of what has been written, and a form to write another.
 *
 * A report is an artifact rather than a rendered page: the eight numbers are
 * frozen into it when it is generated. That is what lets the chat panel be a
 * conversation about a specific report instead of about whatever the data
 * happens to say at the moment someone opens it.
 */
export default async function ReportsPage() {
  const viewer = await currentViewer()
  const children = visibleChildren(viewer)

  if (!children.length) {
    return (
      <EmptyState title="No children shared with you">
        Reports needs at least one child on your roster.
      </EmptyState>
    )
  }

  const reports = listReports(children.map((c) => c.child_id))

  return (
    <div>
      <header className="mb-4">
        <h1 className="text-xl font-semibold">Reports</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          Each report freezes the eight numbers it was written from, so it still means the
          same thing when you open it next month.
        </p>
      </header>

      <Panel title="Write a new one">
        <form action={generateReportAction} className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-[var(--color-ink-muted)]">Child</span>
            <select name="child_id" required
                    className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm">
              {children.map((c) => (
                <option key={c.child_id} value={c.child_id}>{c.display_name}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-[var(--color-ink-muted)]">Period</span>
            <select name="days" defaultValue="28"
                    className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm">
              <option value="7">Last week</option>
              <option value="28">Last month</option>
              <option value="90">This term</option>
            </select>
          </label>
          <button type="submit"
                  className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white">
            Generate
          </button>
        </form>
      </Panel>

      <div className="mt-4">
        <Panel title={`${reports.length} report${reports.length === 1 ? '' : 's'}`}>
          {reports.length === 0 ? (
            <p className="text-sm text-[var(--color-ink-muted)]">
              None yet. Generating one takes a second and does not change any data.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {reports.map((r) => (
                <li key={r.report_id} className="py-3">
                  <Link href={`/dashboard/reports/${r.report_id}`} className="group block">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium group-hover:underline">
                        {r.display_name}
                      </span>
                      <span className="text-xs tabular-nums text-[var(--color-ink-faint)]">
                        {r.period_start} → {r.period_end}
                        {' · written '}
                        {new Date(r.generated_at).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-[var(--color-ink-muted)]">
                      {r.summary}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  )
}
