import { direction, formatValue } from '@/lib/catalog'
import type { MetricValue } from '@/lib/metrics'

/**
 * One headline number.
 *
 * Three rules this component exists to enforce:
 *
 *  1. `n` is always visible. 38% from 121 impressions and 38% from 8 are not
 *     the same claim, and a tile without its sample size lies by omission.
 *  2. Colour comes from the catalogue's polarity, never from the sign of the
 *     delta. A `neutral` metric is never green or red — repeat_tap_rate exists
 *     precisely so the system stops treating stimming as a fault (constraint C1).
 *  3. During the baseline window the delta is suppressed entirely. "Down 4
 *     points" against three days of history is noise dressed as a finding.
 */
export function KpiTile({
  m,
  label,
  inBaseline = false,
  hint,
}: {
  m: MetricValue
  label: string
  inBaseline?: boolean
  hint?: string
}) {
  const dir = inBaseline ? 'flat' : direction(m.metric_id, m.delta)
  const neutral = m.meta?.polarity === 'neutral'

  const deltaTone =
    dir === 'better'
      ? 'text-[var(--color-good)]'
      : dir === 'worse'
        ? 'text-[var(--color-alert)]'
        : 'text-[var(--color-ink-muted)]'

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <p className="text-xs font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">
        {label}
      </p>

      <p className="mt-3 text-3xl font-semibold tabular-nums">
        {m.suppressed ? '—' : formatValue(m.metric_id, m.value)}
      </p>

      <div className="mt-2 min-h-[2.5rem] text-sm">
        {m.suppressed === 'not_collected' ? (
          <p className="text-[var(--color-ink-faint)]">not recorded yet</p>
        ) : m.suppressed === 'small_sample' ? (
          <p className="text-[var(--color-ink-faint)]">
            too few to report{m.meta ? ` (needs ${m.meta.min_n})` : ''}
          </p>
        ) : inBaseline ? (
          <p className="text-[var(--color-ink-faint)]">still learning what is normal</p>
        ) : m.delta !== null && !neutral ? (
          <p className={deltaTone}>
            {m.delta > 0 ? '+' : ''}
            {formatValue(m.metric_id, m.delta)} vs last week
          </p>
        ) : (
          <p className="text-[var(--color-ink-faint)]">{neutral ? 'not a target' : 'no comparison yet'}</p>
        )}

        {m.n > 0 && <p className="mt-0.5 text-xs text-[var(--color-ink-faint)]">n = {m.n}</p>}
      </div>

      {(hint ?? m.meta?.plain_explanation) && (
        <p className="mt-2 border-t border-[var(--color-line)] pt-2 text-xs leading-snug text-[var(--color-ink-muted)]">
          {hint ?? m.meta?.plain_explanation}
        </p>
      )}
    </div>
  )
}
