import { Rail } from './rail'

/**
 * Dashboard shell: fixed dark theme (scoped by `.dash` — the kid app keeps its
 * adaptive theme), a slim icon rail on the left, content to the right.
 *
 * Page-level headers (child name, period, analysed pill, user chip) render per
 * page via `DashHeader`, because the title belongs to the page, not the shell.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="dash flex min-h-dvh">
      <Rail />
      <div className="min-w-0 flex-1">
        <main className="mx-auto max-w-[1440px] px-6 py-6">{children}</main>
        <footer className="mx-auto max-w-[1440px] px-6 pb-10 text-xs text-[var(--color-ink-faint)]">
          Findings are hypotheses with their evidence attached, never diagnoses. Thresholds are
          starting values tuned per child, not clinical cut-offs.
        </footer>
      </div>
    </div>
  )
}
