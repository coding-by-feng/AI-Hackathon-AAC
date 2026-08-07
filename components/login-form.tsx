'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Adult = { adult_id: string; display_name: string; role: string }

/**
 * Adult sign-in for the dashboard.
 *
 * While no account exists at all this becomes a setup form instead. That
 * window is open only until the first account is claimed, after which the
 * setup branch is refused server-side and never returns.
 */
export function LoginForm({ setupOpen, adults }: { setupOpen: boolean; adults: Adult[] }) {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [adultId, setAdultId] = useState(adults[0]?.adult_id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (setupOpen && password !== confirm) {
      setError('The two passwords do not match')
      return
    }

    setBusy(true)
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          setupOpen ? { username, password, adultId, setup: true } : { username, password },
        ),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Could not sign in')
        return
      }
      router.push('/dashboard')
      router.refresh()
    } catch {
      setError('Could not reach the server')
    } finally {
      setBusy(false)
    }
  }

  return (
    /* `.dash` scopes the dashboard's fixed dark tokens — this page belongs to
       the dashboard surface even though it renders outside its layout. */
    <main className="dash flex min-h-[100dvh] flex-col justify-center p-6">
      <div className="mx-auto w-full max-w-md rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
      <h1 className="text-2xl font-semibold">
        {setupOpen ? 'Set up the dashboard' : 'Sign in'}
      </h1>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
        {setupOpen
          ? 'No account exists yet. Create the first one — after this, sign-in is required.'
          : 'The dashboard shows children’s communication records.'}
      </p>

      <form onSubmit={submit} className="mt-6 space-y-4">
        {setupOpen && (
          <label className="block">
            <span className="text-sm font-medium">This account is for</span>
            <select
              value={adultId}
              onChange={(e) => setAdultId(e.target.value)}
              className="mt-1 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-base"
            >
              {adults.map((a) => (
                <option key={a.adult_id} value={a.adult_id}>
                  {a.display_name} — {a.role}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-[var(--color-ink-muted)]">
              Which children you can see is decided by the roster, not by this account.
            </span>
          </label>
        )}

        <label className="block">
          <span className="text-sm font-medium">Username</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            required
            className="mt-1 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-base"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={setupOpen ? 'new-password' : 'current-password'}
            required
            minLength={setupOpen ? 8 : undefined}
            className="mt-1 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-base"
          />
          {setupOpen && (
            <span className="mt-1 block text-xs text-[var(--color-ink-muted)]">
              At least 8 characters.
            </span>
          )}
        </label>

        {setupOpen && (
          <label className="block">
            <span className="text-sm font-medium">Password again</span>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
              className="mt-1 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-base"
            />
          </label>
        )}

        {error && (
          <p className="rounded-md bg-[var(--color-alert-soft)] px-3 py-2 text-sm text-[var(--color-alert)]">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-[var(--color-accent)] px-4 py-3 font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Working…' : setupOpen ? 'Create account and sign in' : 'Sign in'}
        </button>
      </form>

      {setupOpen && (
        <p className="mt-6 rounded-md border-l-2 border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-3 py-2 text-sm">
          This page is reachable by anyone until the first account is created. Claim it now.
        </p>
      )}
      </div>
    </main>
  )
}
