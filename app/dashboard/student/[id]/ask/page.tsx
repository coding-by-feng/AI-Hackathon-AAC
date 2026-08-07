import { currentViewer, requireChild } from '@/lib/access'
import { Panel } from '@/components/ui'
import { StudentTabs } from '@/components/status'
import { AskPanel } from '@/components/chat/ask-panel'

export const dynamic = 'force-dynamic'

/**
 * Per-child Ask. Scope is resolved server-side here and again in /api/chat —
 * this call decides what the page may render, that one decides what the model
 * may read. Neither trusts the other.
 */
export default async function StudentAskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const viewer = await currentViewer()
  const child = requireChild(viewer, id)
  const isParent = viewer.role === 'parent'
  const first = child.display_name.split(' ')[0]

  const suggestions = isParent
    ? [
        `How has ${first} been this month?`,
        'What new words has she used?',
        'What is she saying most often?',
        'Is there anything I should know?',
      ]
    : [
        `What changed for ${first} this month?`,
        'Are there any open findings, and what caused them?',
        'Which words does she reach for that are hard to get to?',
        'Has this happened before?',
      ]

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <header className="mb-4">
        <h1 className="text-xl font-semibold">{child.display_name}</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          {[child.year_group, child.profile_note].filter(Boolean).join(' · ')}
        </p>
      </header>

      <StudentTabs childId={id} active="ask" />

      <Panel
        title="Ask"
        subtitle={
          isParent
            ? 'Questions about your child, answered from the same data the school sees.'
            : 'Plain-language questions. Every answer shows the data behind it.'
        }
      >
        <AskPanel childId={id} childName={first} suggestions={suggestions} />
      </Panel>

      <p className="mt-4 text-xs text-[var(--color-ink-faint)]">
        The assistant can read counts, rates and findings. It cannot read what{' '}
        {first} actually said — utterance text is a separate consent tier and is
        not available to it.
      </p>
    </div>
  )
}
