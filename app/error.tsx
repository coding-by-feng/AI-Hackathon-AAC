'use client'

import { useEffect } from 'react'

/**
 * What the user sees when something throws.
 *
 * For most apps a friendly apology is enough. This one is somebody's voice, so
 * the page has to stay useful even while broken: the six words that matter most
 * are rendered as plain buttons that speak directly through the Web Speech API,
 * with no application state behind them.
 *
 * If the board itself has failed, a child can still say "help" and "toilet".
 */
const FALLBACK = [
  { label: 'help', say: 'I need help.' },
  { label: 'stop', say: 'Stop.' },
  { label: 'yes', say: 'Yes.' },
  { label: 'no', say: 'No.' },
  { label: 'toilet', say: 'I need the toilet.' },
  { label: 'hurt', say: 'It hurts.' },
]

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console -- the only place a runtime failure surfaces
    console.error('AAC board error:', error)
  }, [error])

  const say = (text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text))
  }

  return (
    <div className="flex min-h-[100dvh] flex-col p-4">
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="text-xl font-semibold">The board stopped working</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          These words still work. Press one to speak it.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {FALLBACK.map((f) => (
            <button
              key={f.label}
              type="button"
              onClick={() => say(f.say)}
              className="rounded-[var(--radius-card)] border-2 border-[var(--color-ink)] bg-[var(--color-surface)] px-4 py-6 text-xl font-bold"
              style={{ minHeight: 88 }}
            >
              {f.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={reset}
          className="mt-6 w-full rounded-[var(--radius-card)] bg-[var(--color-accent)] px-4 py-4 text-lg font-semibold text-white"
        >
          Try the board again
        </button>

        <details className="mt-6 text-sm text-[var(--color-ink-muted)]">
          <summary className="cursor-pointer">Details for whoever fixes this</summary>
          <pre className="mt-2 overflow-x-auto rounded-md bg-[var(--color-surface-sunk)] p-3 text-xs">
            {error.message}
            {error.digest ? `\ndigest: ${error.digest}` : ''}
          </pre>
        </details>
      </div>
    </div>
  )
}
