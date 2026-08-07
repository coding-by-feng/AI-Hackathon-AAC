import { NextResponse } from 'next/server'
import { ingestEvents, type IncomingEvent } from '@/lib/ingest'

export const dynamic = 'force-dynamic'

/**
 * Event ingest.
 *
 * Idempotent on event_id (INSERT OR IGNORE), so the client can retry a partial
 * failure without duplicating rows — which is what makes the offline queue
 * safe to flush aggressively.
 */
export async function POST(req: Request) {
  let body: { events?: IncomingEvent[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 })
  }

  const events = body.events
  if (!Array.isArray(events) || events.length === 0) {
    return NextResponse.json({ error: 'events[] required' }, { status: 400 })
  }
  if (events.length > 500) {
    return NextResponse.json({ error: 'At most 500 events per request' }, { status: 413 })
  }

  try {
    const result = ingestEvents(events)
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}
