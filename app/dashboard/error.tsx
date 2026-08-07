'use client'

import Link from 'next/link'
import { useEffect } from 'react'

/**
 * Dashboard errors.
 *
 * This exists because the root boundary in app/error.tsx is written for a child
 * holding a tablet — it says "The board stopped working" and offers six words
 * to press. Without a boundary here, that fallback caught dashboard failures
 * too, and a teacher signing in was shown an AAC board.
 *
 * A boundary written for one audience will happily catch another's errors. Any
 * app with two distinct audiences needs one per segment.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console -- the only place a runtime failure surfaces
    console.error('Dashboard error:', error)
  }, [error])

  const signedOut = error.message.includes('NOT_SIGNED_IN')
  const notAuthorised = error.message.startsWith('NOT_AUTHORISED')

  return (
    <div className="mx-auto max-w-xl py-16">
      <h1 className="text-lg font-semibold">
        {signedOut
          ? 'You need to sign in'
          : notAuthorised
            ? 'That child is not on your roster'
            : 'Something went wrong'}
      </h1>

      <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
        {signedOut
          ? 'Your session has expired or was never started.'
          : notAuthorised
            ? 'You can only see children shared with your account. If that looks wrong, ask whoever manages the roster.'
            : 'The dashboard failed to load this page. Nothing was changed, and no data was lost.'}
      </p>

      <div className="mt-6 flex gap-2">
        {signedOut ? (
          <Link
            href="/login"
            className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white"
          >
            Sign in
          </Link>
        ) : (
          <button
            type="button"
            onClick={reset}
            className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white"
          >
            Try again
          </button>
        )}
        <Link
          href="/dashboard"
          className="rounded-md border border-[var(--color-line)] px-4 py-2 text-sm"
        >
          Back to the dashboard
        </Link>
      </div>

      {!signedOut && !notAuthorised && (
        <details className="mt-8 text-sm text-[var(--color-ink-muted)]">
          <summary className="cursor-pointer">Details for whoever fixes this</summary>
          <pre className="mt-2 overflow-x-auto rounded-md bg-[var(--color-surface-sunk)] p-3 text-xs">
            {error.message}
            {error.digest ? `\ndigest: ${error.digest}` : ''}
          </pre>
        </details>
      )}
    </div>
  )
}
