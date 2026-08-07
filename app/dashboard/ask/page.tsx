import Link from 'next/link'
import { currentViewer, visibleChildren } from '@/lib/access'
import { Panel, EmptyState } from '@/components/ui'
import { AskPanel } from '@/components/chat/ask-panel'

export const dynamic = 'force-dynamic'

/**
 * Class-level Ask. No childId is passed, so the model gets child_id as an ENUM
 * of this adult's roster — it can choose between the children they already
 * support and cannot name one they do not.
 *
 * A parent lands here with exactly one child, so the panel focuses
 * automatically and behaves identically to the per-child page.
 */
export default async function ClassAskPage() {
  const viewer = await currentViewer()
  const children = visibleChildren(viewer)
  const isParent = viewer.role === 'parent'
  const solo = children.length === 1 ? children[0] : undefined

  if (!children.length) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-6">
        <EmptyState title="No children shared with you">
          Ask needs at least one child on your roster.
        </EmptyState>
      </div>
    )
  }

  const suggestions = solo
    ? [
        `How has ${solo.display_name.split(' ')[0]} been this month?`,
        'What has changed recently?',
        'Is there anything I should know?',
      ]
    : [
        'Who needs attention today, and why?',
        'Has anyone gone quiet this week?',
        'Which children have open findings?',
        'Where are we spending on generated images?',
      ]

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <header className="mb-4">
        <h1 className="text-xl font-semibold">Ask</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          {solo
            ? `Questions about ${solo.display_name}.`
            : `Questions across the ${children.length} children you support.`}
        </p>
      </header>

      <Panel
        title={solo ? solo.display_name : 'Your class'}
        subtitle={
          isParent
            ? 'Answered from the same data the school sees.'
            : 'Every answer shows which numbers produced it.'
        }
      >
        <AskPanel
          childId={solo?.child_id}
          childName={solo?.display_name.split(' ')[0]}
          suggestions={suggestions}
        />
      </Panel>

      {!solo && (
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <span className="text-[var(--color-ink-faint)]">Or open a child directly:</span>
          {children.map((c) => (
            <Link
              key={c.child_id}
              href={`/dashboard/student/${c.child_id}/ask`}
              className="text-[var(--color-accent)] hover:underline"
            >
              {c.display_name}
            </Link>
          ))}
        </div>
      )}

      <p className="mt-4 text-xs text-[var(--color-ink-faint)]">
        The assistant can only see the children on your roster, and cannot read what
        any child actually said — utterance text is a separate consent tier.
      </p>
    </div>
  )
}
