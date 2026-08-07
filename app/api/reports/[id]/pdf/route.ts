/**
 * GET /api/reports/[id]/pdf — the report as a direct PDF download.
 *
 * Renders the same HTML as ../print through headless Chrome on this machine
 * (`--print-to-pdf`), so the downloaded file and the printed page can never
 * disagree. No PDF library: Chrome is already installed on the box that serves
 * everything, and its print engine is the one the print route was designed
 * for. If the binary is missing (another deployment), the response says to use
 * the print view — degraded, never broken.
 *
 * Scoped through requireChild — a report is a child's data.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { currentViewer, requireChild } from '@/lib/access'
import { readReport } from '@/lib/report-store'
import { reportPrintHtml } from '@/lib/report-html'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const run = promisify(execFile)

const CHROME =
  process.env.AAC_CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

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

  if (!existsSync(CHROME)) {
    return new Response(
      'PDF rendering is not available on this server (no Chrome found). ' +
        `Open /api/reports/${id}/print and use the browser's own Save as PDF.`,
      { status: 501, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    )
  }

  // Fresh directory per request: two teachers downloading at once must not
  // race on file names, and rm -rf of the directory cleans everything.
  const dir = await mkdtemp(path.join(tmpdir(), 'aac-report-'))
  const htmlPath = path.join(dir, 'report.html')
  const pdfPath = path.join(dir, 'report.pdf')

  try {
    await writeFile(htmlPath, reportPrintHtml(report, { printHint: false }), 'utf8')
    await run(
      CHROME,
      [
        '--headless',
        '--disable-gpu',
        '--no-first-run',
        '--no-pdf-header-footer',
        `--print-to-pdf=${pdfPath}`,
        `file://${htmlPath}`,
      ],
      { timeout: 30_000 },
    )
    const pdf = await readFile(pdfPath)

    const first = report.display_name.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '')
    const filename = `aac-report-${first || 'child'}-${report.period_start}-to-${report.period_end}.pdf`

    return new Response(new Uint8Array(pdf), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
      },
    })
  } catch (err) {
    console.error('PDF render failed:', err)
    return new Response(
      'The PDF could not be rendered. ' +
        `Open /api/reports/${id}/print and use the browser's own Save as PDF.`,
      { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    )
  } finally {
    void rm(dir, { recursive: true, force: true })
  }
}
