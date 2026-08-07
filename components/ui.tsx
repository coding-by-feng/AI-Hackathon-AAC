import type { ReactNode } from 'react'

export function Panel({
  title,
  subtitle,
  right,
  children,
  className = '',
}: {
  title?: string
  subtitle?: string
  right?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={`rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] ${className}`}
    >
      {(title || right) && (
        <header className="flex items-baseline justify-between gap-4 border-b border-[var(--color-line)] px-5 py-3">
          <div>
            {title && <h2 className="text-sm font-semibold tracking-wide uppercase">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">{subtitle}</p>}
          </div>
          {right}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  )
}

/**
 * Horizontal bar. `tone` defaults to neutral on purpose — a bar only becomes
 * coloured when a caller has a catalogue polarity to justify it.
 */
export function Bar({
  value,
  max,
  tone = 'neutral',
}: {
  value: number
  max: number
  tone?: 'neutral' | 'accent' | 'good' | 'warn' | 'alert'
}) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0
  const bg = {
    neutral: 'var(--color-neutral)',
    accent: 'var(--color-accent)',
    good: 'var(--color-good)',
    warn: 'var(--color-warn)',
    alert: 'var(--color-alert)',
  }[tone]
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-sunk)]">
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: bg }} />
    </div>
  )
}

export function EmptyState({
  title,
  children,
  tone = 'quiet',
}: {
  title: string
  children?: ReactNode
  tone?: 'quiet' | 'good'
}) {
  return (
    <div
      className={`rounded-[var(--radius-card)] border border-dashed px-5 py-8 text-center ${
        tone === 'good'
          ? 'border-[var(--color-good)] bg-[var(--color-good-soft)]'
          : 'border-[var(--color-line)] bg-[var(--color-surface-sunk)]'
      }`}
    >
      <p className="font-medium">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-prose text-sm text-[var(--color-ink-muted)]">{children}</p>}
    </div>
  )
}

/**
 * "This is not collected yet" is a different statement from "this is zero", and
 * the distinction matters enough to have its own component. A dashboard that
 * renders an uninstrumented metric as 0% is lying quietly.
 */
export function NotCollected({ what, why }: { what: string; why: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface-sunk)] px-4 py-6">
      <p className="text-sm font-medium">{what} is not being recorded yet</p>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{why}</p>
      <p className="mt-2 text-xs text-[var(--color-ink-faint)]">
        Shown as unavailable rather than zero — a zero here would read as “this never happens”.
      </p>
    </div>
  )
}

export function Pill({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'good' | 'warn' | 'alert' | 'accent'
  children: ReactNode
}) {
  const styles = {
    neutral: 'bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)]',
    good: 'bg-[var(--color-good-soft)] text-[var(--color-good)]',
    warn: 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]',
    alert: 'bg-[var(--color-alert-soft)] text-[var(--color-alert)]',
    accent: 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]',
  }[tone]
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles}`}>
      {children}
    </span>
  )
}

export function Sparkline({ points, height = 36 }: { points: number[]; height?: number }) {
  if (points.length < 2) return null
  const max = Math.max(...points, 0.0001)
  const w = 100
  const step = w / (points.length - 1)
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(1)} ${(height - (p / max) * height).toFixed(1)}`)
    .join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${height}`} height={height} className="w-full" preserveAspectRatio="none" aria-hidden>
      <path d={d} fill="none" stroke="var(--color-accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
