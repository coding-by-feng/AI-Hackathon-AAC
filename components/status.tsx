import Link from 'next/link'
import type { ChildSummary, ConsentTier } from '@/lib/access'
import { lockReason } from '@/lib/access'

/**
 * Analysis freshness.
 *
 * Analysis runs in batch on a separate device, so "stale" is a normal operating
 * state rather than an error. It is shown on every page, always — a dashboard
 * that only mentions freshness when something is wrong teaches people not to
 * look for it.
 */
export function AnalysisFreshness({
  lastRun,
  ageHours,
  rollupThrough,
}: {
  lastRun: number | null
  ageHours: number | null
  rollupThrough: string | null
}) {
  const chip =
    'rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-xs'

  if (lastRun === null) {
    return <span className={`${chip} text-[var(--color-warn)]`}>analysis has never run</span>
  }
  const stale = (ageHours ?? 0) > 36
  const when =
    (ageHours ?? 0) < 24
      ? `${Math.max(1, Math.round(ageHours ?? 0))} h ago`
      : `${Math.round((ageHours ?? 0) / 24)} days ago`

  return (
    <span
      className={`${chip} ${stale ? 'text-[var(--color-warn)]' : 'text-[var(--color-ink-muted)]'}`}
      title={[
        rollupThrough ? `figures complete through ${rollupThrough}` : null,
        stale ? 'findings may not reflect the last two days' : null,
      ]
        .filter(Boolean)
        .join(' · ') || undefined}
    >
      {stale ? `analysis ${when} · stale` : `analysed ${when}`}
    </span>
  )
}

/**
 * A consent-gated panel is shown locked rather than hidden.
 *
 * Hiding it makes people ask for access they do not need. Showing the boundary,
 * and what sits either side of it, usually ends the conversation.
 */
export function ConsentLock({
  child,
  tier,
  title,
  youCanSee,
}: {
  child: ChildSummary
  tier: ConsentTier
  title: string
  youCanSee: string
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-sunk)] p-5">
      <p className="flex items-center gap-2 font-medium">
        <span aria-hidden>🔒</span> {title}
      </p>
      <p className="mt-2 max-w-prose text-sm text-[var(--color-ink-muted)]">
        {lockReason(child, tier)}
      </p>
      <dl className="mt-3 space-y-1 text-sm">
        <div className="flex gap-2">
          <dt className="text-[var(--color-ink-faint)]">You can see</dt>
          <dd>{youCanSee}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-[var(--color-ink-faint)]">You cannot see</dt>
          <dd>what {child.display_name.split(' ')[0]} actually said</dd>
        </div>
      </dl>
    </div>
  )
}

/**
 * Baseline banner. Numbers are real from day one; nothing is flagged until the
 * child has enough of their own history for a threshold to mean anything.
 */
export function BaselineBanner({
  name,
  activeDays,
  targetDays,
  progress,
  reason,
}: {
  name: string
  activeDays: number
  targetDays: number
  progress: number
  reason: string | null
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-accent)] bg-[var(--color-accent-soft)] p-5">
      <p className="font-medium">Still learning what is normal for {name}</p>
      <p className="mt-1 max-w-prose text-sm">
        The numbers below are real. Nothing will be flagged yet — thresholds tuned to a different
        child would be worse than no thresholds at all.
      </p>
      <div className="mt-3 h-2 w-full max-w-sm overflow-hidden rounded-full bg-[var(--color-surface)]">
        <div
          className="h-full rounded-full bg-[var(--color-accent)]"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
        {reason ?? `${activeDays} of ${targetDays} active days`}
      </p>
    </div>
  )
}

export function StudentTabs({ childId, active }: { childId: string; active: string }) {
  const tabs = [
    { key: 'report', href: `/dashboard/student/${childId}/report`, label: 'Progress' },
    { key: 'overview', href: `/dashboard/student/${childId}`, label: 'Overview' },
    { key: 'access', href: `/dashboard/student/${childId}/access`, label: 'Reach & errors' },
    { key: 'ai-impact', href: `/dashboard/student/${childId}/ai-impact`, label: 'AI impact' },
    { key: 'ask', href: `/dashboard/student/${childId}/ask`, label: 'Ask' },
  ]
  return (
    <nav className="flex gap-1 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-1">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${
            active === t.key
              ? 'bg-[var(--color-accent)] text-white'
              : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunk)]'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
