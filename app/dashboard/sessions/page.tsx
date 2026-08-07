import Link from 'next/link'
import { currentViewer, visibleChildren } from '@/lib/access'
import { sittings, sittingStats } from '@/lib/sittings'
import { Panel, EmptyState } from '@/components/ui'

export const dynamic = 'force-dynamic'

const ORDERS = [
  { key: 'recent', label: 'Most recent' },
  { key: 'worst', label: 'Hardest going' },
  { key: 'longest', label: 'Longest' },
] as const

/**
 * Sessions — one row per sitting at the device.
 *
 * The reason this page exists: a difficult DAY is very often one difficult
 * sitting, and a day-level average hides it completely. Maya's hardest sitting
 * runs a 22% unintended-press rate against a 9% daily figure.
 *
 * "Hardest going" is deliberately not called "worst". A sitting where a child
 * kept trying through a lot of missed presses is not a failure on their part.
 */
export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ child?: string; order?: string; days?: string }>
}) {
  const { child, order, days } = await searchParams
  const viewer = await currentViewer()
  const children = visibleChildren(viewer)

  if (!children.length) {
    return (
      <EmptyState title="No children shared with you">
        Sessions needs at least one child on your roster.
      </EmptyState>
    )
  }

  const ids = children.map((c) => c.child_id)
  const window = Number(days) === 7 ? 7 : Number(days) === 42 ? 42 : 14
  const sortKey = (ORDERS.find((o) => o.key === order)?.key ?? 'recent') as
    'recent' | 'worst' | 'longest'

  const rows = sittings(ids, { childId: child, days: window, order: sortKey, limit: 60 })
  const stats = sittingStats(child ? [child] : ids, window)

  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams()
    const merged = { child, order: sortKey, days: String(window), ...over }
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v)
    return `?${p.toString()}`
  }

  return (
    <div>
      <header className="mb-4">
        <h1 className="text-xl font-semibold">Sessions</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          One row per sitting at the device — split wherever the tablet was idle for
          twenty minutes. A hard day is often a single hard sitting.
        </p>
      </header>

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Stat label="Sittings" value={String(stats.count)} sub={`last ${window} days`} />
        <Stat label="Typical length" value={stats.median_minutes ? `${stats.median_minutes} min` : '—'} />
        <Stat label="Typical presses" value={stats.median_taps ? String(stats.median_taps) : '—'} />
        <Stat
          label="Tiring sittings"
          value={String(stats.fatigued)}
          sub={stats.fatigued ? 'errors rose towards the end' : 'none'}
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-[var(--color-ink-faint)]">Sort</span>
        {ORDERS.map((o) => (
          <Link key={o.key} href={qs({ order: o.key })}
                className={`rounded-full border px-3 py-1 ${
                  sortKey === o.key
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                    : 'border-[var(--color-line)] text-[var(--color-ink-muted)]'
                }`}>
            {o.label}
          </Link>
        ))}
        <span className="ml-3 text-[var(--color-ink-faint)]">Child</span>
        <Link href={qs({ child: undefined })}
              className={`rounded-full border px-3 py-1 ${
                !child ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                       : 'border-[var(--color-line)] text-[var(--color-ink-muted)]'
              }`}>
          Everyone
        </Link>
        {children.map((c) => (
          <Link key={c.child_id} href={qs({ child: c.child_id })}
                className={`rounded-full border px-3 py-1 ${
                  child === c.child_id
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                    : 'border-[var(--color-line)] text-[var(--color-ink-muted)]'
                }`}>
            {c.display_name}
          </Link>
        ))}
      </div>

      <Panel title={`${rows.length} sitting${rows.length === 1 ? '' : 's'}`}>
        {rows.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-muted)]">
            Nothing in this period with more than ten presses.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--color-ink-faint)]">
                  <th className="pb-2 font-medium">When</th>
                  <th className="pb-2 font-medium">Who</th>
                  <th className="pb-2 font-medium">Where</th>
                  <th className="pb-2 text-right font-medium">Length</th>
                  <th className="pb-2 text-right font-medium">Said</th>
                  <th className="pb-2 text-right font-medium">Presses</th>
                  <th className="pb-2 text-right font-medium">Not meant</th>
                  <th className="pb-2 font-medium">Towards the end</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const rate = s.mistap_rate ?? 0
                  const hard = rate > 0.12
                  const tiring = (s.fatigue_ratio ?? 0) >= 1.5
                  return (
                    <tr key={s.session_id} className="border-t border-[var(--color-line)]">
                      <td className="py-1.5 tabular-nums">
                        {s.day_local}
                        <span className="ml-1 text-[var(--color-ink-faint)]">
                          {new Date(s.started_at).toLocaleTimeString([], {
                            hour: '2-digit', minute: '2-digit',
                          })}
                        </span>
                      </td>
                      <td className="py-1.5">
                        <Link href={`/dashboard/student/${s.child_id}/report`}
                              className="text-[var(--color-accent)] hover:underline">
                          {s.display_name}
                        </Link>
                      </td>
                      <td className="py-1.5 text-[var(--color-ink-muted)]">
                        {s.scene.replace('_', ' ')}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {s.minutes ? `${Math.round(s.minutes)} min` : '—'}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{s.utterances}</td>
                      <td className="py-1.5 text-right tabular-nums">{s.taps}</td>
                      <td className={`py-1.5 text-right tabular-nums ${
                        hard ? 'font-medium text-[var(--color-warn)]' : ''
                      }`}>
                        {s.mistaps} <span className="text-[var(--color-ink-faint)]">
                          ({Math.round(rate * 100)}%)
                        </span>
                      </td>
                      <td className="py-1.5 text-xs">
                        {s.fatigue_ratio === null ? (
                          <span className="text-[var(--color-ink-faint)]">too short to tell</span>
                        ) : tiring ? (
                          <span className="text-[var(--color-warn)]">
                            harder ({s.fatigue_ratio}×)
                          </span>
                        ) : (
                          <span className="text-[var(--color-ink-muted)]">steady</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="mt-3 text-xs text-[var(--color-ink-faint)]">
        A sitting where presses got harder towards the end usually means tiredness, and the
        answer is a break — not a change to the board. Moving buttons a child has already
        learned undoes the motor pattern they built.
      </p>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-[var(--color-ink-faint)]">{sub}</p>}
    </div>
  )
}
