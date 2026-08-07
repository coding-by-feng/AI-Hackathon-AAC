/**
 * POST /api/reports — generate a report programmatically.
 *
 * The dashboard button goes through a Server Action; this exists for the case a
 * Server Action cannot serve: a scheduled job writing end-of-month reports for
 * a whole class without anyone clicking. Same scoping, same store.
 */
import { currentViewer, requireChild, visibleChildren } from '@/lib/access'
import { windowOf } from '@/lib/db'
import { generateReport } from '@/lib/report-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request): Promise<Response> {
  let body: { child_id?: unknown; days?: unknown; all?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body must be JSON.' }, 400)
  }

  const days = [7, 28, 90].includes(Number(body.days)) ? Number(body.days) : 28

  try {
    const viewer = await currentViewer()
    const roster = visibleChildren(viewer)
    if (!roster.length) return json({ error: 'No children shared with your account.' }, 403)

    // `all` is the scheduled-job path: one report per child on the roster.
    const targets = body.all
      ? roster
      : [requireChild(viewer, String(body.child_id ?? ''))]

    const w = windowOf(days)
    const created = targets.map((c) => ({
      child_id: c.child_id,
      report_id: generateReport(c.child_id, w, c.display_name.split(' ')[0]),
    }))
    return json({ period: w, created }, 201)
  } catch (err) {
    const msg = (err as Error).message
    return json({ error: msg }, msg.startsWith('NOT_AUTHORISED') ? 403 : 400)
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })
}
