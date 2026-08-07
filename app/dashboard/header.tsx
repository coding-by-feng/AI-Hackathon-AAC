/**
 * The shared dashboard header row from the mockup: title large, context muted,
 * then right-aligned the period, the analysed pill and the user chip.
 *
 * A server component — it reads the viewer and analysis freshness itself so
 * every page gets the pill without re-plumbing it.
 */
import { currentViewer } from '@/lib/access'
import { analysisFreshness, rollupThrough } from '@/lib/queue'
import { AnalysisFreshness } from '@/components/status'
import { UserChip } from './user-chip'

export async function DashHeader({
  title,
  subtitle,
  period,
}: {
  title: string
  subtitle?: string
  period?: string
}) {
  const viewer = await currentViewer()
  const fresh = analysisFreshness()

  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-[var(--color-ink-muted)]">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {period && (
          <span className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-ink-muted)]">
            {period}
          </span>
        )}
        <AnalysisFreshness
          lastRun={fresh.lastRun}
          ageHours={fresh.ageHours}
          rollupThrough={rollupThrough()}
        />
        <UserChip name={viewer.display_name} role={viewer.role} />
      </div>
    </header>
  )
}
