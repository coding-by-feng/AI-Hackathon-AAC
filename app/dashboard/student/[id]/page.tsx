import Link from 'next/link'
import { currentViewer, requireChild } from '@/lib/access'
import { one, windowOf, type Window } from '@/lib/db'
import { reportMetrics, plainSummary, type ReportMetric } from '@/lib/report'
import { listReports } from '@/lib/report-store'
import { MetricCard, MetricCaveats } from '@/components/metric-card'
import { InsightList } from '@/components/insight-list'
import { openInsights, toCardData } from '@/lib/insights'
import { AskPanel } from '@/components/chat/ask-panel'
import { DashHeader } from '../../header'

export const dynamic = 'force-dynamic'

/**
 * The student page IS the report, per the approved dark mockup: four sections
 * of metric cards, then the prose report block, the caveats row, and the chat
 * docked underneath — one scroll, nothing hidden behind tabs.
 *
 * Everything readable comes from metrics_catalog via lib/report.ts. The four
 * section headers group the catalogue's A–H codes; removing a metric removes
 * its card with no code change here.
 */

// Group codes -> the four mockup sections. G (partner) and E (voice) sit with
// layout because all three describe the environment around the child rather
// than the child's own output.
const SECTIONS: { title: string; groups: string[] }[] = [
  { title: 'Effort & speed', groups: ['A'] },
  { title: 'Errors & reach', groups: ['B'] },
  { title: 'Vocabulary', groups: ['C'] },
  { title: 'Layout & voice', groups: ['D', 'E', 'G', 'H'] },
]

/**
 * Sample size per metric, from the same tables the metric itself reads.
 *
 * `ReportMetric` does not carry n, and the card contract requires it — so it
 * is attributed here, per metric shape (scalar metrics from agg_daily_metric,
 * dimensional ones from their own tables). A metric whose n cannot be
 * attributed gets none rendered, never `n = 0`.
 */
function metricN(childId: string, m: ReportMetric, w: Window): number | null {
  switch (m.metric_id) {
    case 'taps_per_utterance':
    case 'correction_adjacent_rate':
    case 'core_fringe_ratio':
    case 'repeat_tap_rate':
    case 'teacher_modeling':
    case 'partner_wait_time':
    case 'keyboard_use': {
      const r = one<{ n: number }>(
        `SELECT COALESCE(SUM(n), 0) AS n FROM agg_daily_metric
         WHERE child_id = ? AND metric_id = ? AND day_local BETWEEN ? AND ?`,
        [childId, m.metric_id, w.start, w.end],
      )
      return r?.n ?? null
    }
    case 'silence_streak': {
      const r = one<{ n: number }>(
        `SELECT COUNT(*) AS n FROM utterances WHERE child_id = ? AND spoken = 1`,
        [childId],
      )
      return r?.n ?? null
    }
    case 'card_frequency': {
      const r = one<{ n: number }>(
        `SELECT COALESCE(SUM(taps), 0) AS n FROM agg_card_stats WHERE child_id = ?`,
        [childId],
      )
      return r?.n ?? null
    }
    case 'cell_heat': {
      const r = one<{ n: number }>(
        `SELECT COALESCE(SUM(taps + mistaps), 0) AS n FROM agg_cell_heat WHERE child_id = ?`,
        [childId],
      )
      return r?.n ?? null
    }
    case 'new_words': {
      const c = Number(m.headline)
      return Number.isFinite(c) && c > 0 ? c : null
    }
    case 'word_pairs':
      return m.pairs?.length || null
    case 'nav_depth_by_card':
      return m.scatter?.length || null
    default:
      return null
  }
}

const fmtDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })

export default async function StudentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ days?: string }>
}) {
  const { id } = await params
  const { days } = await searchParams
  const viewer = await currentViewer()
  const child = requireChild(viewer, id)
  const first = child.display_name.split(' ')[0]

  const period = [7, 14, 28, 90].includes(Number(days)) ? Number(days) : 14
  const w = windowOf(period)
  const metrics = reportMetrics(id, w)
  const { summary, guidance } = plainSummary(first, metrics)
  const nById = new Map(metrics.map((m) => [m.metric_id, metricN(id, m, w)]))

  const sections = SECTIONS.map((s) => ({
    ...s,
    items: metrics.filter((m) => s.groups.includes(m.group)),
  })).filter((s) => s.items.length)

  // The attention queue's OPEN_INSIGHT chips point here — this is where a
  // firing is actually shown, with its evidence, thresholds and the actions
  // the catalogue forbids. The card contract carries two clinical invariants
  // (informational ⇒ no action button; forbidden_actions displayed), so this
  // list being mounted is itself a safety property, not decoration.
  const findings = openInsights(id).map(toCardData)

  // "Save as PDF" downloads the latest frozen report if one exists; otherwise
  // it goes to the report archive where one can be generated. The live numbers
  // on this page are not silently passed off as a frozen artifact.
  const latest = listReports([id], 1)[0]
  const printHref = latest ? `/api/reports/${latest.report_id}/pdf` : null

  const suggestions =
    viewer.role === 'parent'
      ? [
          `How has ${first} been this fortnight?`,
          'What new words has she used?',
          'Is there anything I should know?',
        ]
      : [
          'Why are corrections landing next door?',
          `What changed for ${first} this fortnight?`,
          'Which words does she reach for that are hard to get to?',
        ]

  return (
    // Capped width: on a wide monitor unbounded columns scatter the cards and
    // leave the page mostly empty.
    <div className="mx-auto max-w-[1400px] space-y-6">
      <DashHeader
        title={child.display_name}
        subtitle={[child.year_group, child.profile_note].filter(Boolean).join(' · ')}
        period={`Last ${period} days`}
      />

      {sections.map((sec) => (
        <section key={sec.title}>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">
            {sec.title}
          </h2>
          {/* Wrap-and-grow: every row fills the full width — a one-card section
              stretches, and an orphan card on the last row does too, so no
              section leaves an empty tract beside it. */}
          <div className="flex flex-wrap gap-3">
            {sec.items.map((m) => (
              <div key={m.metric_id} className="min-w-[min(280px,100%)] max-w-full grow basis-[300px] [&>article]:h-full">
                <MetricCard m={m} n={nById.get(m.metric_id)} />
              </div>
            ))}
          </div>
        </section>
      ))}

      {/* Below the numbers by request: the queue already surfaces urgency, and
          these cards are guidance to read after the metrics, not a banner. */}
      <section>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">
          Findings — {findings.length} open
        </h2>
        <InsightList items={findings} />
      </section>

      <section className="rounded-[var(--radius-card)] border border-[var(--color-line)] border-l-[3px] border-l-[var(--color-accent)] bg-[var(--color-surface)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div className="min-w-0 max-w-3xl">
            <h2 className="text-sm font-semibold">
              Report — {fmtDay(w.start)} to {fmtDay(w.end)}
            </h2>
            <p className="mt-2 text-sm leading-relaxed">
              <span className="font-medium text-[var(--color-accent)]">Summary: </span>
              {summary}
            </p>
            <p className="mt-2 text-sm leading-relaxed">
              <span className="font-medium text-[var(--color-accent)]">What to try: </span>
              {guidance}
            </p>
            <p className="mt-3 text-[11px] text-[var(--color-ink-faint)]">
              Written from {metrics.length} numbers, nothing else.
            </p>
          </div>
          <div className="flex shrink-0 gap-2 text-sm">
            {printHref ? (
              <a
                href={printHref}
                className="rounded-lg border border-[var(--color-line)] px-4 py-2 font-medium hover:bg-[var(--color-surface-sunk)]"
              >
                Save as PDF
              </a>
            ) : (
              <Link
                href="/dashboard/reports"
                title="No frozen report yet — generate one first"
                className="rounded-lg border border-[var(--color-line)] px-4 py-2 font-medium hover:bg-[var(--color-surface-sunk)]"
              >
                Save as PDF
              </Link>
            )}
            <a
              href="#ask"
              className="rounded-lg bg-[var(--color-accent)] px-4 py-2 font-medium text-white"
            >
              Ask about this
            </a>
          </div>
        </div>
      </section>

      <MetricCaveats metrics={metrics} />

      <section
        id="ask"
        className="scroll-mt-6 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5"
      >
        <h2 className="mb-1 text-sm font-semibold">Ask about this report</h2>
        <p className="mb-4 text-xs text-[var(--color-ink-muted)]">
          Answers come from the same data as the cards above, and every answer shows which numbers
          it used. It cannot read what {first} actually said.
        </p>
        <AskPanel childId={id} childName={first} suggestions={suggestions} />
      </section>

      <p className="text-xs text-[var(--color-ink-faint)]">
        More detail:{' '}
        <Link className="underline-offset-2 hover:underline" href={`/dashboard/student/${id}/access`}>
          reach &amp; errors
        </Link>{' '}
        ·{' '}
        <Link className="underline-offset-2 hover:underline" href={`/dashboard/student/${id}/ai-impact`}>
          AI impact
        </Link>{' '}
        ·{' '}
        <Link className="underline-offset-2 hover:underline" href={`/dashboard/student/${id}/report`}>
          progress view
        </Link>
      </p>
    </div>
  )
}
