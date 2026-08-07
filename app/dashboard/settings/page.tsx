import { currentViewer } from '@/lib/access'
import { settingsStatus } from '@/lib/chat/settings'
import { DashHeader } from '../header'
import { SettingsForm } from './settings-form'

export const dynamic = 'force-dynamic'

/**
 * AI provider settings.
 *
 * The page renders the CURRENT status server-side (selection + masked key
 * presence) and hands it to a client form. Keys travel one way: browser ->
 * POST /api/dashboard/settings -> aac_app.db. Nothing here can render one.
 */
export default async function SettingsPage() {
  const viewer = await currentViewer()
  const allowed = viewer.role === 'teacher' || viewer.role === 'slt' || viewer.role === 'admin'

  if (!allowed) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <DashHeader title="Settings" subtitle="AI provider configuration" />
        <p className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5 text-sm text-[var(--color-ink-muted)]">
          Only teachers and speech therapists can change AI settings. Ask a teacher on
          this class if something needs adjusting.
        </p>
      </div>
    )
  }

  const status = settingsStatus()

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <DashHeader
        title="Settings"
        subtitle="Which AI model answers the Ask panel — applies to every question from the next one on"
      />
      <SettingsForm initial={status} />
    </div>
  )
}
