'use client'

/**
 * The header user chip — "Mrs Patel · teacher". Clicking it signs out:
 * DELETE /api/auth, then to the login page. The chip says what it will do
 * on hover, because a control that looks like a label should not surprise.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function UserChip({ name, role }: { name: string; role: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const signOut = async () => {
    if (busy) return
    setBusy(true)
    try {
      await fetch('/api/auth', { method: 'DELETE' })
    } catch {
      // Signing out locally still proceeds — the session cookie check on the
      // server is the authority either way.
    } finally {
      router.push('/login')
      router.refresh()
    }
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      title="Sign out"
      className="flex items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs text-[var(--color-ink)] hover:border-[var(--color-ink-faint)] disabled:opacity-60"
    >
      <span
        aria-hidden
        className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-[10px] font-semibold text-[var(--color-accent)]"
      >
        {name.trim().charAt(0).toUpperCase() || '?'}
      </span>
      <span>
        {busy ? 'Signing out…' : name} <span className="text-[var(--color-ink-muted)]">· {role}</span>
      </span>
    </button>
  )
}
