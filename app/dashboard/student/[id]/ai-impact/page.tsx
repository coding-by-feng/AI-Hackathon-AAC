import Link from 'next/link'
import { currentViewer, requireChild } from '@/lib/access'
import { windowOf } from '@/lib/db'
import {
  tapsSaved,
  suggestionFunnel,
  vocabularyGaps,
  visualSourceSplit,
  eventTypeCollected,
} from '@/lib/metrics'
import { Panel, Bar, NotCollected, EmptyState } from '@/components/ui'
import { StudentTabs } from '@/components/status'

export const dynamic = 'force-dynamic'

/**
 * Does the AI actually help, or is it clutter?
 *
 * One screen, one argument. F2 is the whole claim in the unit that matters to
 * someone with cerebral palsy: presses not made.
 *
 * F1, F3 and F4 depend on suggestion_shown, suggestion_tap and gap_detected
 * events that no client emits yet. They render as "not recorded" rather than as
 * zeroes — a 0% acceptance rate would read as "the suggestions are useless",
 * which is a different and false claim.
 */
export default async function AiImpactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const viewer = await currentViewer()
  const child = requireChild(viewer, id)
  const w = windowOf(7)

  const saved = tapsSaved(id, w)
  const funnel = suggestionFunnel(id, w)
  const gaps = vocabularyGaps(id, w)
  const sources = visualSourceSplit(id, w)

  const hasSuggestionEvents = eventTypeCollected('suggestion_shown')
  const hasGapEvents = eventTypeCollected('gap_detected')

  const firstName = child.display_name.split(' ')[0]
  const maxArm = Math.max(saved.withoutAi ?? 0, saved.withAi ?? 0, 1)
  const perSentence = (saved.withoutAi ?? 0) - (saved.withAi ?? 0)
  const totalVisuals = sources.reduce((n, s) => n + s.count, 0)
  const freeVisuals = sources
    .filter((s) => s.resolved_by !== 'generated' && s.resolved_by !== 'failed')
    .reduce((n, s) => n + s.count, 0)

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
          <h1 className="mt-1 text-2xl font-semibold">AI impact</h1>
          <p className="text-sm text-[var(--color-ink-muted)]">Last 7 days</p>
        </div>
        <StudentTabs childId={id} active="ai-impact" />
      </div>

      <Panel title="Presses she did not have to make" subtitle="The whole claim, in one number">
        {saved.saved === null || saved.uses === 0 ? (
          <EmptyState title="No suggestions were used this week">
            Every sentence {firstName} spoke was built from the board herself.
          </EmptyState>
        ) : (
          <>
            <dl className="space-y-4">
              <div>
                <div className="flex items-baseline justify-between gap-4 text-sm">
                  <dt>Building it herself</dt>
                  <dd className="flex items-baseline gap-2 tabular-nums">
                    <span><strong className="text-lg font-semibold">{saved.withoutAi?.toFixed(1)}</strong> presses</span>
                    <span className="text-xs text-[var(--color-ink-faint)]">n = {saved.nWithout}</span>
                  </dd>
                </div>
                <div className="mt-1">
                  <Bar value={saved.withoutAi ?? 0} max={maxArm} tone="neutral" />
                </div>
              </div>
              <div>
                <div className="flex items-baseline justify-between gap-4 text-sm">
                  <dt>Taking a suggestion</dt>
                  <dd className="flex items-baseline gap-2 tabular-nums">
                    <span><strong className="text-lg font-semibold">{saved.withAi?.toFixed(1)}</strong> presses</span>
                    <span className="text-xs text-[var(--color-ink-faint)]">n = {saved.nWith}</span>
                  </dd>
                </div>
                <div className="mt-1">
                  <Bar value={saved.withAi ?? 0} max={maxArm} tone="accent" />
                </div>
              </div>
            </dl>

            {/*
              A difference that rounds to zero per sentence is not a result, and
              multiplying it by the number of sentences turns a rounding artefact
              into a headline. Say there is no measurable effect instead.
            */}
            {perSentence < 0.05 ? (
              <p className="mt-5 border-t border-[var(--color-line)] pt-4">
                <strong>No measurable difference yet.</strong> Sentences built with a suggestion
                took about as many presses as sentences {firstName} built herself, so there is
                nothing here to claim.
              </p>
            ) : (
              <p className="mt-5 border-t border-[var(--color-line)] pt-4 text-lg">
                <strong className="tabular-nums">{perSentence.toFixed(1)}</strong> fewer presses ×{' '}
                <strong className="tabular-nums">{saved.uses}</strong> sentences ={' '}
                <strong className="tabular-nums">{Math.round(saved.saved)}</strong> presses{' '}
                {firstName} did not have to make this week.
              </p>
            )}
            <p className="mt-2 text-xs text-[var(--color-ink-faint)]">
              Both figures count spoken sentences only, so the two arms describe the same
              population.
            </p>
          </>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Are the suggestions any good?">
          {!hasSuggestionEvents ? (
            <NotCollected
              what="Suggestion acceptance"
              why="The board is not yet logging when a suggestion is shown or tapped, so there is no denominator to divide by."
            />
          ) : (
            <dl className="space-y-3 text-sm">
              <FunnelRow label="Shown to her" value={funnel.shown} max={funnel.shown} />
              <FunnelRow label="Tapped" value={funnel.tapped} max={funnel.shown} />
              <FunnelRow label="Actually spoken" value={funnel.spoken} max={funnel.shown} />
              {funnel.acceptance !== null && (
                <p className="pt-2 text-sm">
                  {Math.round(funnel.acceptance * 100)}% accepted.{' '}
                  {funnel.acceptance < 0.2
                    ? 'Below about a fifth, the strip is costing her more scanning than it saves — show it less often.'
                    : 'Worth the space it takes on screen.'}
                </p>
              )}
            </dl>
          )}
        </Panel>

        <Panel title="Where her pictures come from">
          {!hasGapEvents ? (
            <NotCollected
              what="Picture sourcing"
              why="The board is not yet logging how each picture was resolved, so the split between reused and generated images is unknown."
            />
          ) : (
            <>
              <ul className="space-y-2.5">
                {sources.map((s) => (
                  <li key={s.resolved_by}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span>{s.resolved_by.replace(/_/g, ' ')}</span>
                      <span className="tabular-nums text-[var(--color-ink-muted)]">{s.count}</span>
                    </div>
                    <div className="mt-1">
                      <Bar
                        value={s.count}
                        max={totalVisuals}
                        tone={s.resolved_by === 'generated' ? 'warn' : 'accent'}
                      />
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm">
                {totalVisuals > 0 && `${Math.round((freeVisuals / totalVisuals) * 100)}% reused.`}{' '}
                The target is 90% or better — the AI is meant to fill gaps in her vocabulary, not to
                draw every symbol.
              </p>
            </>
          )}
        </Panel>
      </div>

      <Panel
        title="Words she reached for that do not exist"
        subtitle="This list is the teaching to-do"
      >
        {!hasGapEvents ? (
          <NotCollected
            what="Vocabulary gaps"
            why="The board is not yet logging the moments when she needed a word that was not there. This is the single most useful thing the dashboard can tell you, so it is worth wiring first."
          />
        ) : gaps.length === 0 ? (
          <EmptyState title="No gaps this week" tone="good">
            Everything {firstName} reached for already existed on her board.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {gaps.map((g) => (
              <li key={g.concept} className="flex flex-wrap items-center gap-3 py-3">
                <span className="font-medium">“{g.concept}”</span>
                <span className="text-sm text-[var(--color-ink-muted)]">
                  reached for {g.asked}× · {g.scenes?.replace(/,/g, ', ')}
                </span>
                <span className="ml-auto flex gap-2">
                  <button className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white">
                    Add to her board
                  </button>
                  <button className="rounded-md border border-[var(--color-line)] px-3 py-1.5 text-sm">
                    Not needed
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}

function FunnelRow({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <dt>{label}</dt>
        <dd className="tabular-nums font-medium">{value}</dd>
      </div>
      <div className="mt-1">
        <Bar value={value} max={Math.max(1, max)} tone="accent" />
      </div>
    </div>
  )
}
