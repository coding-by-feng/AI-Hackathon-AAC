/**
 * A printable report, as a page.
 *
 * Server-rendered HTML with a print stylesheet. The same document, rendered to
 * an actual PDF download, lives at ../pdf — this route stays for "view it in
 * the browser first" and as the fallback wherever headless Chrome is absent.
 *
 * Scoped through requireChild — a report is a child's data.
 */
import { currentViewer, requireChild } from '@/lib/access'
import { readReport } from '@/lib/report-store'
import { reportPrintHtml } from '@/lib/report-html'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  const report = readReport(id)
  if (!report) return new Response('Not found', { status: 404 })

  try {
    const viewer = await currentViewer()
    requireChild(viewer, report.child_id)
  } catch {
    return new Response('Not authorised', { status: 403 })
  }

  return new Response(reportPrintHtml(report, { printHint: true }), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}
