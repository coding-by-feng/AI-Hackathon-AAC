/**
 * A printable report.
 *
 * Server-rendered HTML with a print stylesheet rather than a PDF library.
 * Every browser can already turn this into a PDF, and jsPDF/puppeteer would be
 * a large dependency (and, for puppeteer, a whole Chromium) to reproduce what
 * Cmd-P already does well.
 *
 * Scoped through requireChild — a report is a child's data.
 */
import { currentViewer, requireChild } from '@/lib/access'
import { readReport } from '@/lib/report-store'

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

  const rows = report.metrics
    .map(
      (m) => `<tr>
        <td class="n">${esc(m.name)}</td>
        <td class="v">${esc(m.headline)}</td>
        <td class="s">${esc(m.sub ?? '')}</td>
      </tr>`,
    )
    .join('')

  // Caveats print in full. On paper there is no hover and no expander, and a
  // number that travels to a meeting without its caveat is how "60% positive"
  // becomes a statement about how a child feels.
  const caveats = report.metrics
    .filter((m) => m.caveat)
    .map((m) => `<p class="cav"><b>${esc(m.name)}.</b> ${esc(m.caveat!)}</p>`)
    .join('')

  const html = `<!doctype html>
<meta charset="utf-8">
<title>${esc(report.display_name)} — ${report.period_start} to ${report.period_end}</title>
<style>
  @page { margin: 18mm; }
  body { font: 12pt/1.55 Georgia, serif; color: #1a1a1a; max-width: 46em; margin: 0 auto; }
  h1 { font-size: 18pt; margin: 0 0 2pt; }
  .meta { color: #666; font-size: 10pt; margin-bottom: 18pt; }
  table { width: 100%; border-collapse: collapse; margin: 12pt 0 18pt; }
  th { text-align: left; font-size: 9pt; text-transform: uppercase; letter-spacing: .04em;
       color: #666; border-bottom: 1px solid #ddd; padding-bottom: 4pt; }
  td { padding: 5pt 0; border-bottom: 1px solid #f0f0f0; vertical-align: baseline; }
  td.v { font-weight: 600; white-space: nowrap; padding-right: 10pt; }
  td.s, .cav { color: #555; font-size: 10pt; }
  h2 { font-size: 11pt; text-transform: uppercase; letter-spacing: .04em; color: #666;
       margin: 20pt 0 6pt; }
  .cav { margin: 0 0 6pt; }
  footer { margin-top: 22pt; padding-top: 8pt; border-top: 1px solid #ddd;
           font-size: 9pt; color: #777; }
  @media print { .noprint { display: none } }
</style>
<h1>${esc(report.display_name)}</h1>
<p class="meta">
  ${report.period_start} to ${report.period_end} ·
  written ${new Date(report.generated_at).toLocaleDateString()}
</p>

<table>
  <thead><tr><th>Measure</th><th>Result</th><th></th></tr></thead>
  <tbody>${rows}</tbody>
</table>

<h2>In plain words</h2>
<p>${esc(report.summary)}</p>
<p>${esc(report.guidance)}</p>

<h2>How to read these numbers</h2>
${caveats}

<footer>
  Written from ${report.metricsUsed.length} of the ${report.metrics.length} measures above and nothing else.
  Findings are hypotheses with their evidence attached, never diagnoses.
</footer>
<p class="noprint" style="margin-top:16pt;font:11pt sans-serif;color:#666">
  Use your browser's Print dialog and choose “Save as PDF”.
</p>`

  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}
