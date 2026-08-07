'use client'

/**
 * The slim left rail: logo mark, then Class · Sessions · Reports · Settings as
 * icon + tiny label.
 *
 * Active state is derived from the pathname. Class covers the roster AND the
 * per-student pages: "Children" used to be a second item pointing at the same
 * `/dashboard` href, which read as two tabs that did the same thing — one
 * destination gets one item.
 *
 * Every item has a destination. An earlier version allowed `href: null` for
 * an item with nowhere to go, which is a nav that lies about what exists.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ThemeToggle } from '@/components/theme-toggle'

type Item = {
  key: string
  label: string
  href: string
  active: (path: string) => boolean
  icon: React.ReactNode
}

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

const ITEMS: Item[] = [
  {
    key: 'class',
    label: 'Class',
    href: '/dashboard',
    active: (p) =>
      p === '/dashboard' || p.startsWith('/dashboard/student') || p.startsWith('/dashboard/ask'),
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden {...STROKE}>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5" />
        <circle cx="17" cy="9" r="2.4" />
        <path d="M15.5 14.7c2.6.1 4.4 1.5 5 4.3" />
      </svg>
    ),
  },
  {
    // /dashboard/sessions was a live page with no link anywhere in the app.
    key: 'sessions',
    label: 'Sessions',
    href: '/dashboard/sessions',
    active: (p) => p.startsWith('/dashboard/sessions'),
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden {...STROKE}>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7.5V12l3 1.8" />
      </svg>
    ),
  },
  {
    key: 'reports',
    label: 'Reports',
    href: '/dashboard/reports',
    active: (p) => p.startsWith('/dashboard/reports'),
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden {...STROKE}>
        <path d="M7 3.5h7l4 4V20a.9.9 0 0 1-.9.9H7a.9.9 0 0 1-.9-.9V4.4a.9.9 0 0 1 .9-.9Z" />
        <path d="M14 3.5V8h4.2" />
        <path d="M9.5 13h5M9.5 16.5h5" />
      </svg>
    ),
  },
  {
    key: 'settings',
    label: 'Settings',
    href: '/dashboard/settings',
    active: (p) => p.startsWith('/dashboard/settings'),
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden {...STROKE}>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18" />
      </svg>
    ),
  },
]

export function Rail() {
  const path = usePathname()

  return (
    <aside className="sticky top-0 flex h-dvh w-[76px] shrink-0 flex-col items-center gap-1 border-r border-[var(--color-line)] bg-[var(--color-surface-sunk)] py-4">
      {/* The mark is a symbol grid with one cell pressed — the thing this
          product is actually about. A speech bubble read as a messenger app,
          which is the one thing an AAC board is not: the child speaks, the
          software just holds the words still. */}
      <Link
        href="/dashboard"
        aria-label="AAC dashboard home"
        className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-accent)] text-white"
      >
        <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinejoin="round">
          <rect x="3.5" y="3.5" width="7.6" height="7.6" rx="1.7" />
          <rect x="12.9" y="3.5" width="7.6" height="7.6" rx="1.7" fill="currentColor" />
          <rect x="3.5" y="12.9" width="7.6" height="7.6" rx="1.7" />
          <rect x="12.9" y="12.9" width="7.6" height="7.6" rx="1.7" />
        </svg>
      </Link>

      {ITEMS.map((it) => {
        const active = it.active(path)
        const cls = `flex w-[60px] flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-medium ${
          active
            ? 'bg-[var(--color-surface)] text-[var(--color-ink)]'
            : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
        }`
        return (
          <Link key={it.key} href={it.href} className={cls} aria-current={active ? 'page' : undefined}>
            {it.icon}
            {it.label}
          </Link>
        )
      })}

      <div className="mt-auto">
        <ThemeToggle unsetAs="black" />
      </div>
    </aside>
  )
}
