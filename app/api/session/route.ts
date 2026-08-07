import { NextResponse } from 'next/server'
import { setCurrentChild, clearCurrentChild, checkPasscode, childProfile } from '@/lib/session'
import { ingestEvents } from '@/lib/ingest'

export const dynamic = 'force-dynamic'

function today(): { day: string; offset: number } {
  const now = new Date()
  return {
    day: new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10),
    offset: -now.getTimezoneOffset(),
  }
}

/**
 * Sign a child in.
 *
 * The session_start event is written here rather than in the browser, because
 * this is the moment the identity is actually resolved — logging it client-side
 * would record whatever the page thought before the sign-in completed.
 */
export async function POST(req: Request) {
  let body: { childId?: string; passcode?: string[]; sessionId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 })
  }

  const { childId } = body
  if (!childId) return NextResponse.json({ error: 'childId is required' }, { status: 400 })

  const child = childProfile(childId)
  if (!child) return NextResponse.json({ error: `Unknown child '${childId}'` }, { status: 404 })

  if (child.passcode && !checkPasscode(childId, body.passcode ?? [])) {
    // No lockout and no attempt counter — this prevents a mis-tap, it is not
    // guarding a secret. An error that reads as failure to a child is worse
    // than the mistake it catches.
    return NextResponse.json({ ok: false, reason: 'passcode' }, { status: 200 })
  }

  await setCurrentChild(childId)

  try {
    const { day, offset } = today()
    ingestEvents([
      {
        event_id: crypto.randomUUID(),
        child_id: childId,
        ts: Date.now(),
        day_local: day,
        tz_offset_min: offset,
        session_id: body.sessionId ?? crypto.randomUUID(),
        scene: 'unknown',
        actor: 'child',
        type: 'session_start',
        payload: JSON.stringify({ via: 'sign_in' }),
      },
    ])
  } catch {
    // A missing audit event must never block a child from reaching their board.
  }

  return NextResponse.json({ ok: true, child: { child_id: child.child_id, display_name: child.display_name } })
}

/** Sign out, bracketing the session so a device switch is visible in the data. */
export async function DELETE(req: Request) {
  const childId = new URL(req.url).searchParams.get('child')
  if (childId) {
    try {
      const { day, offset } = today()
      ingestEvents([
        {
          event_id: crypto.randomUUID(),
          child_id: childId,
          ts: Date.now(),
          day_local: day,
          tz_offset_min: offset,
          session_id: crypto.randomUUID(),
          scene: 'unknown',
          actor: 'child',
          type: 'session_end',
          payload: JSON.stringify({ endReason: 'normal', via: 'sign_out' }),
        },
      ])
    } catch {
      /* best effort */
    }
  }
  await clearCurrentChild()
  return NextResponse.json({ ok: true })
}
