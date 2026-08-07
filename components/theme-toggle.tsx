'use client'

/**
 * Three-way theme toggle: black → white → warm → black.
 *
 * Writes `data-theme` on <html> and persists to localStorage('aac-theme');
 * app/layout.tsx re-applies it pre-paint so a reload never flashes the wrong
 * theme. One control serves both surfaces — `compact` renders icon-only for
 * the kid top bar, the default adds a label for the dashboard rail.
 *
 * The board's card colours are untouched by any theme (learned colour code);
 * only page surfaces and ink change.
 */
import { useEffect, useState } from 'react'

const ORDER = ['black', 'white', 'warm'] as const
type Theme = (typeof ORDER)[number]

const LABEL: Record<Theme, string> = { black: 'Black', white: 'White', warm: 'Warm' }

function current(unsetAs?: Theme): Theme {
  const t = document.documentElement.dataset.theme
  if (t === 'white' || t === 'warm' || t === 'black') return t
  // No forced theme yet: report what the surface actually shows — the
  // dashboard is fixed dark (`unsetAs="black"`), the kid surface follows the OS.
  if (unsetAs) return unsetAs
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'black' : 'white'
}

function Swatch({ theme }: { theme: Theme }) {
  const fill = theme === 'black' ? '#14171e' : theme === 'white' ? '#ffffff' : '#f2e0c2'
  const ring = theme === 'black' ? '#6f7889' : theme === 'white' ? '#8b94a3' : '#a05a24'
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
      <circle cx="10" cy="10" r="8" fill={fill} stroke={ring} strokeWidth="2" />
    </svg>
  )
}

export function ThemeToggle({
  compact = false,
  unsetAs,
}: {
  compact?: boolean
  /** What an unset theme looks like on this surface (dashboard: 'black'). */
  unsetAs?: Theme
}) {
  // Server renders a stable placeholder; the real value arrives after mount —
  // the theme itself was already applied pre-paint by the layout script.
  const [theme, setTheme] = useState<Theme | null>(null)
  useEffect(() => setTheme(current(unsetAs)), [unsetAs])

  const next = theme ? ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length] : 'black'
  const apply = () => {
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem('aac-theme', next)
    } catch {
      /* private browsing: the theme still applies for this visit */
    }
    setTheme(next)
  }

  return (
    <button
      type="button"
      onClick={apply}
      title={`Theme: ${theme ? LABEL[theme] : '…'} — tap for ${LABEL[next]}`}
      aria-label={`Change theme (now ${theme ? LABEL[theme] : 'loading'})`}
      className={
        compact
          ? 'flex h-9 w-9 items-center justify-center rounded-full border border-[var(--color-line)]'
          : 'flex w-[60px] flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
      }
    >
      <Swatch theme={theme ?? 'black'} />
      {!compact && (theme ? LABEL[theme] : 'Theme')}
    </button>
  )
}
