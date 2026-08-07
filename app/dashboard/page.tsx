import Link from 'next/link'
import { currentViewer, visibleChildren } from '@/lib/access'
import { buildQueue, classesFor } from '@/lib/queue'
import { formatValue } from '@/lib/catalog'
import { Panel, EmptyState, Pill } from '@/components/ui'
import { DashHeader } from './header'

export const dynamic = 'force-dynamic'

/**
 * The class view — where a teacher lands.
 *
 * The Attention Queue answers one question: who needs a person today. Sorting
 * five children by "most utterances" answers a question nobody asked; a child
 * who has stopped talking is the one that matters, and totals bury them.
 */
export default async function ClassPage() {
  const viewer = await currentViewer()
  const children = visibleChildren(viewer)
  const queue = buildQueue(children)

  const needsAttention = queue.filter((q) => q.score > 0)
  const settled = queue.filter((q) => q.score === 0)

  return (
    <div className="space-y-8">
      <DashHeader
        title={classesFor(children)}
        subtitle={`${children.length} children`}
        period="Last 7 days"
      />

      <Panel
        title="Needs a person today"
        subtitle="Ranked by how much is going wrong, not by how much they talk"
      >
        {needsAttention.length === 0 ? (
          /* This must be a real, good-looking state. A queue that always has
             five rows trains people to stop reading it. */
          <EmptyState title="Nothing needs you today" tone="good">
            Every child is inside their usual range, and no finding is waiting for a decision.
          </EmptyState>
        ) : (
          <ol className="space-y-3">
            {needsAttention.map((q, i) => (
              <li
                key={q.child.child_id}
                className="rounded-[var(--radius-card)] border border-[var(--color-line)] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-baseline gap-3">
                    <span className="text-lg font-semibold text-[var(--color-ink-faint)] tabular-nums">
                      {i + 1}
                    </span>
                    <div>
                      <Link
                        href={`/dashboard/student/${q.child.child_id}`}
                        className="text-lg font-semibold underline-offset-2 hover:underline"
                      >
                        {q.child.display_name}
                      </Link>
                      {q.child.profile_note && (
                        <p className="text-sm text-[var(--color-ink-muted)]">
                          {q.child.year_group} · {q.child.profile_note}
                        </p>
                      )}
                    </div>
                  </div>
                  <Link
                    href={`/dashboard/student/${q.child.child_id}`}
                    className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white"
                  >
                    Open
                  </Link>
                </div>

                {/* The score breakdown is shown, not hidden. A teacher who
                    cannot see why this child is first will not trust the order. */}
                <ul className="mt-3 space-y-1 text-sm">
                  {q.reasons.map((r) => (
                    <li key={r.code} className="flex items-baseline justify-between gap-4">
                      <span>{r.detail}</span>
                      <span className="shrink-0 text-xs text-[var(--color-ink-faint)] tabular-nums">
                        +{r.points}
                      </span>
                    </li>
                  ))}
                  <li className="flex items-baseline justify-between gap-4 border-t border-[var(--color-line)] pt-1 font-medium">
                    <span className="text-[var(--color-ink-muted)]">priority</span>
                    <span className="tabular-nums">{q.score}</span>
                  </li>
                </ul>
              </li>
            ))}
          </ol>
        )}

        {settled.length > 0 && (
          <p className="mt-4 text-sm text-[var(--color-ink-muted)]">
            {settled.map((s) => s.child.display_name).join(', ')}{' '}
            {settled.length === 1 ? 'is' : 'are'} within their usual range today.
          </p>
        )}
      </Panel>

      <Panel title="Everyone" subtitle="Last 7 days">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="border-b border-[var(--color-line)] text-left text-xs tracking-wide text-[var(--color-ink-muted)] uppercase">
                <th className="py-2 pr-4 font-semibold">Child</th>
                <th className="py-2 pr-4 font-semibold">Last spoke</th>
                <th className="py-2 pr-4 font-semibold">Presses per sentence</th>
                <th className="py-2 pr-4 font-semibold">Own words</th>
                <th className="py-2 pr-4 font-semibold">New words</th>
                <th className="py-2 font-semibold">Notes</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((q) => (
                <tr key={q.child.child_id} className="border-b border-[var(--color-line)] last:border-0">
                  <td className="py-2.5 pr-4">
                    <Link
                      href={`/dashboard/student/${q.child.child_id}`}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {q.child.display_name}
                    </Link>
                  </td>
                  <td className="py-2.5 pr-4 tabular-nums">
                    {q.silence === 0 ? 'today' : `${q.silence} d ago`}
                  </td>
                  <td className="py-2.5 pr-4 tabular-nums">
                    {q.tapsPerUtterance === null
                      ? '—'
                      : formatValue('taps_per_utterance', q.tapsPerUtterance)}
                  </td>
                  <td className="py-2.5 pr-4 tabular-nums">
                    {q.independence === null
                      ? '—'
                      : formatValue('independence_rate', q.independence)}
                  </td>
                  <td className="py-2.5 pr-4 tabular-nums">{q.newWords}</td>
                  <td className="py-2.5">
                    {q.inBaseline ? (
                      <Pill tone="accent">
                        settling in · {Math.round(q.baselineProgress * 100)}%
                      </Pill>
                    ) : q.reasons.length > 0 ? (
                      <span className="text-[var(--color-ink-muted)]">
                        {q.reasons.map((r) => r.code.toLowerCase()).join(' · ')}
                      </span>
                    ) : (
                      <span className="text-[var(--color-ink-faint)]">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-[var(--color-ink-faint)]">
          A child marked “settling in” is shown with real numbers but is never flagged — there is not
          yet enough of their own history for a threshold to mean anything.
        </p>
      </Panel>
    </div>
  )
}
