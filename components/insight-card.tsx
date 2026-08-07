'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Pill } from './ui'
import { DISMISS_LABELS, type DismissReason } from '@/lib/dismiss'

export type InsightCardData = {
  fired_rule_id: string
  insight_id: string
  name: string
  plain_statement: string
  narration: string | null
  narrationModel: string | null
  firedAt: number
  window: string
  evidence: { values: [string, string][]; thresholds: [string, string][] }
  classification: Record<string, unknown> | null
  recommended_actions: string[]
  forbidden_actions: string[]
  action_kind: 'intervention' | 'informational' | 'system_fix'
  target_audience: 'child' | 'adult' | 'system'
  safety_note: string | null
}

/**
 * One component, eight rules.
 *
 * The constraints that live here rather than in copy:
 *
 *  - `action_kind === 'informational'` renders NO action button. I4 case B is a
 *    child refusing something; offering an intervention there teaches them that
 *    their "no" does not count (constraint C1/C4 in the clinical doc).
 *  - `forbidden_actions` is displayed, not merely respected. A teacher reading
 *    "never move the card" understands the recommendation better than one who
 *    just isn't offered the option.
 *  - `target_audience === 'adult'` is stated plainly, because I2, I6, I7 and I8
 *    are about the grown-up or about our own software, and reading them as
 *    findings about the child is exactly the failure mode.
 *  - The heading is a question. The system proposes; the human decides.
 */
export function InsightCard({
  data,
  onDismiss,
}: {
  data: InsightCardData
  onDismiss: (firedRuleId: string, reason: DismissReason) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [done, setDone] = useState(false)
  const [pending, start] = useTransition()
  const detailRef = useRef<HTMLDivElement>(null)

  // "Yes" must always visibly answer the click, even when the numbers were
  // already open (its old behaviour was setOpen(true) — a no-op in that state).
  useEffect(() => {
    if (!confirmed) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    detailRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' })
  }, [confirmed])

  if (done) return null

  const aboutUs = data.target_audience === 'system'
  const aboutAdult = data.target_audience === 'adult'

  return (
    <article className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)]">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <h3 className="max-w-prose text-base font-semibold">{data.name}</h3>
        <div className="flex shrink-0 items-center gap-2">
          {aboutUs && <Pill tone="warn">about our software</Pill>}
          {aboutAdult && <Pill tone="accent">for the adult</Pill>}
          <Pill>{data.insight_id}</Pill>
        </div>
      </div>

      <p className="max-w-prose px-5 pt-2 text-sm leading-relaxed text-[var(--color-ink-muted)]">
        {data.narration ?? data.plain_statement}
      </p>

      {data.safety_note && (
        <p className="mx-5 mt-3 rounded-md border-l-2 border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-3 py-2 text-sm">
          {data.safety_note}
        </p>
      )}

      <div className="px-5 pt-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-sm font-medium text-[var(--color-accent)] underline-offset-2 hover:underline"
          aria-expanded={open}
        >
          {open ? 'Hide the numbers' : 'What number caused this?'}
        </button>
      </div>

      {open && (
        <div ref={detailRef} className="mx-5 mt-3 rounded-md bg-[var(--color-surface-sunk)] p-4 text-sm">
          <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {data.evidence.values.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-[var(--color-line)] py-1">
                <dt className="text-[var(--color-ink-muted)]">{k}</dt>
                <dd className="font-medium tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>

          {data.evidence.thresholds.length > 0 && (
            <>
              <p className="mt-3 text-xs font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">
                compared against
              </p>
              <dl className="mt-1 grid gap-x-6 gap-y-1 sm:grid-cols-2">
                {data.evidence.thresholds.map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 py-0.5">
                    <dt className="text-[var(--color-ink-faint)]">{k}</dt>
                    <dd className="tabular-nums text-[var(--color-ink-muted)]">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-xs text-[var(--color-ink-faint)]">
                These are starting values, not clinical cut-offs. If a number sits just over its
                threshold, treat the finding as a question rather than a conclusion.
              </p>
            </>
          )}

          <p className="mt-3 text-xs text-[var(--color-ink-faint)]">
            rule {data.fired_rule_id} · window {data.window} ·{' '}
            {data.narrationModel ? `narrated by ${data.narrationModel}` : 'no narration written'}
          </p>
        </div>
      )}

      {/* Informational findings deliberately have no action list. */}
      {data.action_kind !== 'informational' && data.recommended_actions.length > 0 && (
        <div className="px-5 pt-4">
          <p className="text-xs font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">
            what usually helps
          </p>
          <ul className="mt-1 space-y-1 text-sm">
            {data.recommended_actions.map((a) => (
              <li key={a} className="flex gap-2">
                <span aria-hidden className="text-[var(--color-ink-faint)]">
                  •
                </span>
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.forbidden_actions.length > 0 && (
        <div className="px-5 pt-3">
          <p className="text-xs font-semibold tracking-wide text-[var(--color-alert)] uppercase">
            do not
          </p>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            {data.forbidden_actions.map(readableForbidden).join(' · ')}
          </p>
        </div>
      )}

      <footer className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--color-line)] px-5 py-3">
        {!choosing ? (
          <>
            <span className="mr-auto text-sm font-medium">
              {confirmed ? 'Noted — the numbers behind it are shown above.' : 'Does that match what you see?'}
            </span>
            <button
              type="button"
              onClick={() => setChoosing(true)}
              className="rounded-md border border-[var(--color-line)] px-3 py-1.5 text-sm hover:bg-[var(--color-surface-sunk)]"
            >
              No, that&apos;s not it
            </button>
            {!confirmed && (
              <button
                type="button"
                onClick={() => {
                  setOpen(true)
                  setConfirmed(true)
                }}
                className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white"
              >
                Yes — show me the detail
              </button>
            )}
          </>
        ) : (
          <div className="w-full">
            <p className="text-sm font-medium">Why not? This is how the rules get better.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(Object.keys(DISMISS_LABELS) as DismissReason[]).map((reason) => (
                <button
                  key={reason}
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      await onDismiss(data.fired_rule_id, reason)
                      setDone(true)
                    })
                  }
                  className="rounded-md border border-[var(--color-line)] px-3 py-1.5 text-sm hover:bg-[var(--color-surface-sunk)] disabled:opacity-50"
                >
                  {DISMISS_LABELS[reason]}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setChoosing(false)}
                className="px-2 py-1.5 text-sm text-[var(--color-ink-muted)] underline-offset-2 hover:underline"
              >
                cancel
              </button>
            </div>
          </div>
        )}
      </footer>
    </article>
  )
}

function readableForbidden(action: string): string {
  const map: Record<string, string> = {
    resize_grid: 'change the grid size',
    move_card: 'move a card she already knows',
    remove_original: 'remove the original card',
    reduce_repetition: 'try to stop repeated pressing',
    retrain_preference: 'retrain a preference',
    reintroduce_refused_item: 'reintroduce something she refused',
    treat_refusal_as_deficit: 'treat a refusal as a problem',
    demand_faster_response: 'ask her to answer faster',
    demand_imitation: 'ask her to copy you',
    test_the_child: 'test her',
    retrain_without_access_check: 'reteach before checking she can physically reach it',
  }
  return map[action] ?? action.replace(/_/g, ' ')
}
