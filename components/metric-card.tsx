/**
 * One card per metric, matching the approved dark mockup: plain-language name,
 * one big number, sub + `n` on one line, a small chart, and the one-sentence
 * explanation always visible at the bottom.
 *
 * A suppressed metric shows its suppression sentence *instead of* a number —
 * "too few corrections to tell" is a different fact from 0, and rendering
 * either as the other is how a dashboard lies.
 *
 * The chart type comes from `metrics_catalog.chart`, so adding a metric is a
 * database change rather than a component change. `n` is optional because not
 * every caller can attribute a sample size — a card with no real n renders no
 * n, never `n = 0`.
 */
import type { ReportMetric } from '@/lib/report'
import {
  BarChart, CalendarHeat, DonutChart, GridHeat, LineChart, PairTable,
  RankedBars, ScatterChart, SplitBar,
} from './charts'

export function MetricCard({ m, n }: { m: ReportMetric; n?: number | null }) {
  const suppressed = Boolean(m.suppressed)

  return (
    <article className="flex flex-col rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <h3 className="text-[13px] font-medium leading-snug text-[var(--color-ink-muted)]">
        {m.name}
      </h3>

      {suppressed ? (
        <div className="mt-2 flex-1">
          {m.headline !== '—' && (
            <p className="text-base font-medium text-[var(--color-ink-muted)]">{m.headline}</p>
          )}
          <p className="mt-1 text-xs leading-relaxed text-[var(--color-ink-muted)]">
            {m.suppressed}
          </p>
        </div>
      ) : (
        <>
          <p className="mt-1.5 text-[28px] font-semibold leading-none tracking-tight tabular-nums">
            {m.headline}
          </p>
          <div className="mt-1.5 flex items-baseline justify-between gap-3 text-xs">
            <span className="min-w-0 truncate text-[var(--color-ink-muted)]" title={m.sub}>
              {m.sub ?? ' '}
            </span>
            {typeof n === 'number' && n > 0 && (
              <span className="shrink-0 tabular-nums text-[var(--color-ink-faint)]">
                n = {n.toLocaleString()}
              </span>
            )}
          </div>
          <div className="my-3 min-h-[72px] flex-1">
            <Chart m={m} />
          </div>
        </>
      )}

      <p className="mt-auto border-t border-[var(--color-line)] pt-2 text-[11px] leading-snug text-[var(--color-ink-muted)]">
        {m.plain}
      </p>
    </article>
  )
}

function Chart({ m }: { m: ReportMetric }) {
  switch (m.chart) {
    case 'line':
      return <LineChart points={m.series ?? []} />
    case 'bar':
      return <BarChart points={m.series ?? []} />
    case 'table':
      return <PairTable rows={m.pairs ?? []} />
    case 'calendar':
      return <CalendarHeat days={m.calendar ?? []} />
    case 'donut':
      return <DonutChart slices={m.slices ?? []} />
    case 'scatter':
      return <ScatterChart points={m.scatter ?? []} />
    case 'grid':
      return m.grid ? (
        <GridHeat rows={m.grid.rows} cols={m.grid.cols} cells={m.grid.cells} />
      ) : null
    case 'ranked_bar':
      return <RankedBars items={m.ranked ?? []} />
    case 'none':
      return null
    case 'split_bar':
      // Both sides the SAME colour — this is a classifier between two readings
      // where neither is better, and two colours would quietly rank them.
      return m.split ? (
        <SplitBar left={m.split.left} right={m.split.right} color="var(--color-accent)" />
      ) : null
    default:
      return null
  }
}

/**
 * The caveats, collected below the grid rather than crowded onto each card.
 *
 * They are not footnotes. "Counts words used, not how she feels" is the
 * difference between a useful metric and a wrong conclusion about a child, and
 * hiding it behind a hover would put it where nobody reads it.
 */
export function MetricCaveats({ metrics }: { metrics: ReportMetric[] }) {
  const withCaveats = metrics.filter((m) => m.caveat)
  if (!withCaveats.length) return null

  return (
    <details className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
        How these numbers can mislead ({withCaveats.length})
      </summary>
      <dl className="mt-3 space-y-3">
        {withCaveats.map((m) => (
          <div key={m.metric_id}>
            <dt className="text-xs font-medium">{m.name}</dt>
            <dd className="text-xs leading-snug text-[var(--color-ink-muted)]">{m.caveat}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}
