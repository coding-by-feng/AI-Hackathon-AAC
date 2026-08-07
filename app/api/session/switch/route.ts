import { NextResponse } from 'next/server'
import { childProfile, setCurrentChild } from '@/lib/session'

export const dynamic = 'force-dynamic'

/**
 * GET /api/session/switch?child=<id> — set the child session, then land on the board.
 *
 * Exists because a Server Component may not modify cookies: the previous design
 * called setCurrentChild() inside the page render, which `next dev` tolerated
 * and a production build rejects — every `?child=` link answered 500 and the
 * board fell to its error screen. Cookie writes belong here, in a Route
 * Handler, which is the one place Next allows them on a GET.
 *
 * No passcode check on this path: it is the dev/QA and dashboard "view as"
 * convenience. A child with a picture passcode still goes through /who — this
 * only shortcuts WHICH board loads, and the boards hold nothing about other
 * children.
 */
export async function GET(req: Request) {
  try {
    const childId = new URL(req.url).searchParams.get('child')
    if (childId && childProfile(childId)) {
      await setCurrentChild(childId)
    }
  } catch {
    // A broken switch (db unreachable mid-rebuild, malformed id) must never
    // 500 the board — land on `/`, which falls back to /who when no session
    // survives. This route exists because the board crashing here once
    // already is the bug it replaces.
  }
  return NextResponse.redirect(new URL('/', req.url))
}
