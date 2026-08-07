'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CardFace } from './card-face'

export type SignInChild = {
  child_id: string
  display_name: string
  year_group: string | null
  hasPasscode: boolean
}

/** Symbols offered for a picture passcode. Recognisable, and nothing abstract. */
const PIN_SYMBOLS = ['ball', 'book', 'home', 'music', 'water', 'apple', 'play', 'garden']

/**
 * Signing in without reading or typing.
 *
 * A password field excludes the person the board is for. So does a list of
 * names they must read. A photo is the name, and the tap target is large enough
 * for someone with limited fine motor control.
 */
export function WhoPicker({ children }: { children: SignInChild[] }) {
  const router = useRouter()
  const [selected, setSelected] = useState<SignInChild | null>(null)
  const [attempt, setAttempt] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(false)

  const signIn = async (child: SignInChild, passcode: string[] = []) => {
    setBusy(true)
    setRetry(false)
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ childId: child.child_id, passcode }),
      })
      const data = (await res.json()) as { ok: boolean; reason?: string }
      if (data.ok) {
        router.push('/')
        router.refresh()
        return
      }
      // Wrong sequence simply asks again. No lockout, no counter, and nothing
      // phrased as failure — this catches a mis-tap, it is not guarding a secret.
      setAttempt([])
      setRetry(true)
    } finally {
      setBusy(false)
    }
  }

  const pick = (child: SignInChild) => {
    if (!child.hasPasscode) {
      void signIn(child)
      return
    }
    setSelected(child)
    setAttempt([])
  }

  const tapSymbol = (sym: string) => {
    if (!selected) return
    const next = [...attempt, sym]
    setAttempt(next)
    if (next.length >= 3) void signIn(selected, next)
  }

  if (selected) {
    const firstName = selected.display_name.split(' ')[0]
    return (
      <main className="mx-auto flex min-h-[100dvh] max-w-3xl flex-col justify-center p-6">
        <h1 className="text-2xl font-semibold">Hello {firstName}. Tap your three pictures.</h1>

        <div className="mt-4 flex gap-2" aria-label="pictures chosen so far">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="flex h-14 w-14 items-center justify-center rounded-lg border-2 border-[var(--color-line)] bg-[var(--color-surface)]"
            >
              {attempt[i] ? <CardFace label={attempt[i]} size={28} showLabel={false} /> : null}
            </span>
          ))}
        </div>

        {retry && (
          <p className="mt-3 text-[var(--color-ink-muted)]">Let&apos;s try that again.</p>
        )}

        <div className="mt-6 grid grid-cols-4 gap-3">
          {PIN_SYMBOLS.map((sym) => (
            <button
              key={sym}
              type="button"
              disabled={busy}
              onClick={() => tapSymbol(sym)}
              className="flex aspect-square items-center justify-center rounded-[var(--radius-card)] border-2 border-[var(--color-line)] bg-[var(--color-surface)] disabled:opacity-50"
              style={{ minHeight: 96 }}
            >
              <CardFace label={sym} size={40} showLabel={false} />
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => {
            setSelected(null)
            setAttempt([])
            setRetry(false)
          }}
          className="mt-6 self-start rounded-md border border-[var(--color-line)] px-4 py-3 text-base"
        >
          Someone else
        </button>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-4xl flex-col justify-center p-6">
      <h1 className="text-2xl font-semibold">Who is using the board?</h1>
      <p className="mt-1 text-[var(--color-ink-muted)]">Tap your picture.</p>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {children.map((c) => {
          const firstName = c.display_name.split(' ')[0]
          return (
            <button
              key={c.child_id}
              type="button"
              disabled={busy}
              onClick={() => pick(c)}
              className="flex flex-col items-center gap-3 rounded-[var(--radius-card)] border-2 border-[var(--color-line)] bg-[var(--color-surface)] p-4 disabled:opacity-50"
              style={{ minHeight: 160 }}
            >
              {/* A real photo belongs here. Until one is uploaded, initials are
                  at least stable and recognisable — never a generic avatar that
                  looks the same for every child. */}
              <span
                aria-hidden
                className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-2xl font-bold text-[var(--color-accent)]"
              >
                {firstName.charAt(0)}
              </span>
              <span className="text-xl font-semibold">{firstName}</span>
              {c.hasPasscode && (
                <span className="text-xs text-[var(--color-ink-faint)]">pictures needed</span>
              )}
            </button>
          )
        })}
      </div>

      <p className="mt-8 text-sm text-[var(--color-ink-muted)]">
        Signing in keeps each person&apos;s words in their own record, so the reports describe the
        right child.
      </p>
    </main>
  )
}
