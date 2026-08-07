import Link from 'next/link'
import { currentViewer, requireChild, canSee } from '@/lib/access'
import { windowOf } from '@/lib/db'
import { readMetric, cellHeat } from '@/lib/metrics'
import { formatValue } from '@/lib/catalog'
import { Panel, EmptyState } from '@/components/ui'
import { HeatGridPair } from '@/components/heat-grid'
import { StudentTabs, ConsentLock } from '@/components/status'

export const dynamic = 'force-dynamic'

/**
 * Reach and errors.
 *
 * The page exists to answer one question that no single number can: is this a
 * vocabulary problem or a physical one? The two heat maps side by side are the
 * only way to see the difference, and the intervention is completely different
 * in each case.
 */
export default async function AccessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const viewer = await currentViewer()
  const child = requireChild(viewer, id)
  const w = windowOf(14)

  const grid = cellHeat(id, w)
  const mistap = readMetric('mistap_rate', id, w)
  const adjacency = readMetric('correction_adjacent_rate', id, w)
  const compose = readMetric('composition_time', id, w)
  const firstTap = readMetric('time_to_first_tap', id, w)
  const partnerWait = readMetric('partner_wait_time', id, w)

  const adjacent = adjacency.value ?? 0
  const reading =
    adjacency.value === null
      ? null
      : adjacent >= 0.6
        ? 'motor'
        : adjacent <= 0.35
          ? 'semantic'
          : 'ambiguous'

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href={`/dashboard/student/${id}`}
            className="text-sm text-[var(--color-ink-muted)] hover:underline"
          >
            ← {child.display_name}
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">Reach &amp; errors</h1>
          <p className="text-sm text-[var(--color-ink-muted)]">Last 14 days</p>
        </div>
        <StudentTabs childId={id} active="access" />
      </div>

      <Panel title="Where presses land">
        {grid ? (
          <HeatGridPair grid={grid} />
        ) : (
          <EmptyState title="No board layout recorded for this child" />
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Hand or meaning?">
          <dl className="space-y-3 text-sm">
            <Row
              label="Presses undone straight away"
              value={formatValue('mistap_rate', mistap.value)}
              n={mistap.n}
            />
            <Row
              label="Corrections landing on a neighbouring button"
              value={formatValue('correction_adjacent_rate', adjacency.value)}
              n={adjacency.n}
            />
          </dl>

          {reading && (
            <p className="mt-4 rounded-md bg-[var(--color-surface-sunk)] p-3 text-sm">
              {reading === 'motor' && (
                <>
                  Most corrections land right next to the button she meant. That pattern is a hand
                  that missed, not a meaning that changed — and with cerebral palsy it is the
                  expected reading. Treat it as a reach problem unless you have seen otherwise.
                </>
              )}
              {reading === 'semantic' && (
                <>
                  Corrections mostly land elsewhere on the board, which points at the meaning rather
                  than the reach. Check she can physically hit the target before reteaching anything.
                </>
              )}
              {reading === 'ambiguous' && (
                <>
                  The split is unclear. Default to the reach reading — recommending vocabulary work
                  to a child whose hand is the problem costs far more than the reverse.
                </>
              )}
            </p>
          )}

          <p className="mt-3 text-xs text-[var(--color-ink-faint)]">
            A press only counts as unintended if she undid it. Repeated pressing with no delete is
            never counted here — it is exploration, motor learning, or self-regulation, and it
            appears on the overview as a neutral figure.
          </p>
        </Panel>

        <Panel title="Timing">
          <dl className="space-y-3 text-sm">
            <Row
              label="Time to build a sentence"
              value={formatValue('composition_time', compose.value)}
              n={compose.n}
            />
            <Row
              label="Pause before she starts answering"
              value={formatValue('time_to_first_tap', firstTap.value)}
              n={firstTap.n}
            />
          </dl>

          {/* C7: a long child latency may be the adult not waiting. The adult's
              own number is shown beside the child's, never instead of it. */}
          {canSee(child, 'partner_speech') ? (
            <div className="mt-4 rounded-md bg-[var(--color-surface-sunk)] p-3">
              <p className="text-sm font-medium">And how long the adult waited</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {formatValue('partner_wait_time', partnerWait.value)}
              </p>
              <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
                {partnerWait.value !== null && partnerWait.value < 2000
                  ? 'Under two seconds. AAC output runs around 15 words per minute — a slow answer here is the adult’s doing before it is the child’s.'
                  : 'The adult is leaving processing time, so a slow answer is more likely to be about scanning than about being rushed.'}
              </p>
            </div>
          ) : (
            <div className="mt-4">
              <ConsentLock
                child={child}
                tier="partner_speech"
                title="How long the adult waited"
                youCanSee="how long she takes to start, and how long a sentence takes to build"
              />
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}

function Row({ label, value, n }: { label: string; value: string; n: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--color-line)] pb-2">
      <dt className="text-[var(--color-ink-muted)]">{label}</dt>
      <dd className="flex items-baseline justify-end gap-2 text-right">
        <span className="text-lg font-semibold tabular-nums">{value}</span>
        {n > 0 && <span className="text-xs text-[var(--color-ink-faint)]">n = {n}</span>}
      </dd>
    </div>
  )
}
