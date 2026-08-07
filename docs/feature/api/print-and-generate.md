# Reporting Endpoints

## Function
`POST /api/reports` generates one stored report per child programmatically,
`GET /api/reports/[id]/print` renders a stored report as server-side HTML with a print
stylesheet for the browser's own "Save as PDF", and `GET /api/reports/[id]/pdf` renders that
same HTML through headless Chrome and returns a real PDF download.

## Purpose
The dashboard's own "Generate" button goes through a Server Action
(`app/dashboard/reports/actions.ts`). `POST /api/reports` exists for the case a Server Action
cannot serve: a scheduled job writing end-of-month reports for a whole class without anyone
clicking. Same scoping, same store.

The print route is server-rendered HTML rather than a PDF library on purpose. Every browser can
already turn this into a PDF, and jsPDF/puppeteer would be a large dependency — and, for
puppeteer, a whole Chromium — to reproduce what Cmd-P already does well. The download route
keeps that decision: still no PDF library and no bundled Chromium. It drives the system Chrome
already installed on the machine that serves everything, and where no binary exists it answers
501 pointing at `/print` — degraded, never broken.

Caveats print **in full**. On paper there is no hover and no expander, and a number that travels
to a meeting without its caveat is how "60% positive" becomes a statement about how a child
feels.

## Source Files
| File | Role |
|------|------|
| `app/api/reports/route.ts` | `POST` — roster-scoped generation, single child or whole roster |
| `app/api/reports/[id]/print/route.ts` | `GET` — the auth gate plus the shared HTML served as a page, with the Cmd-P hint |
| `app/api/reports/[id]/pdf/route.ts` | `GET` — the same HTML rendered through headless system Chrome and streamed back as a download |
| `lib/report-html.ts` | `reportPrintHtml()` — the single document builder, its print stylesheet and `esc()`; one function shared by both GET routes so the paper version and the download can never drift |

## Implementation

All three routes declare `export const runtime = 'nodejs'` and `export const dynamic = 'force-dynamic'`.

### `POST /api/reports`

Body: `{ child_id?: unknown, days?: unknown, all?: unknown }`.

```ts
const days = [7, 28, 90].includes(Number(body.days)) ? Number(body.days) : 28
```

Anything outside `{7, 28, 90}` — including a missing value — silently becomes **28**. The window
is `windowOf(days)` from `lib/db.ts`, which counts back `days - 1` from the latest day that has
data, not from today.

| Condition | Status | Response |
|---|---|---|
| body is not JSON | 400 | `{ "error": "Body must be JSON." }` |
| `visibleChildren(viewer)` is empty | 403 | `{ "error": "No children shared with your account." }` |
| error message starts with `NOT_AUTHORISED` | 403 | `{ "error": "<message>" }` |
| any other thrown error | 400 | `{ "error": "<message>" }` |
| ok | **201** | `{ "period": { start, end, days }, "created": [ { "child_id", "report_id" } ] }` |

Targets:

```ts
const targets = body.all
  ? roster                                        // the scheduled-job path: one per child
  : [requireChild(viewer, String(body.child_id ?? ''))]
```

`body.all` is truthy-checked, so any non-empty value selects the whole roster. Without it,
`requireChild` throws `NOT_AUTHORISED: <adult> has no active roster row for <child>` → 403.

Each target calls `generateReport(child_id, window, firstName)` where the name passed is
`display_name.split(' ')[0]`. That function is where the content is produced and validated: it
refuses to store anything citing a metric outside the canonical set
(`SELECT metric_id FROM metrics_catalog WHERE report_set = 1`), throwing
`Report cited metrics outside the canonical set: …` — which this route surfaces as a 400.

### `GET /api/reports/[id]/print`

`params` is a `Promise<{ id: string }>` (Next.js 15 async params) and is awaited.

Order of operations:

1. `readReport(id)` → `404` with the plain-text body `Not found` when it does not exist.
2. `currentViewer()` then `requireChild(viewer, report.child_id)`; **any** throw (including
   `NOT_SIGNED_IN`) → `403` with the plain-text body `Not authorised`.

The existence check runs before the authorisation check, so an unknown id is distinguishable
from an unauthorised one by status code.

Response: `reportPrintHtml(report, { printHint: true })` as `text/html; charset=utf-8`,
`cache-control: no-store`.

### `GET /api/reports/[id]/pdf`

Same order of checks as `/print`: `readReport(id)` → **404** plain-text `Not found`, then
`currentViewer()` + `requireChild(viewer, report.child_id)` with **any** throw → **403**
plain-text `Not authorised`.

The Chrome binary is
`process.env.AAC_CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'`
— the default is the stock macOS install path on the machine that serves everything. When
`existsSync` finds no binary there, the route answers **501** with a plain-text body pointing
at `/api/reports/<id>/print` and the browser's own Save as PDF.

Otherwise:

1. `mkdtemp` under the OS temp dir (`aac-report-` prefix) — a fresh directory per request, so
   two teachers downloading at once cannot race on file names.
2. `reportPrintHtml(report, { printHint: false })` is written to `report.html` inside it.
3. Chrome runs via `execFile` with `--headless --disable-gpu --no-first-run
   --no-pdf-header-footer --print-to-pdf=<pdfPath> file://<htmlPath>` and a
   `timeout` of 30 000 ms.
4. Any render failure → **500**, plain text again pointing at `/print`.
5. Success → the PDF bytes with `content-type: application/pdf`,
   `content-disposition: attachment; filename="aac-report-<first>-<start>-to-<end>.pdf"`
   (`<first>` is the child's first name lowercased and stripped to `[a-z0-9]`, falling back
   to `child`), and `cache-control: no-store`.
6. `rm -rf` of the temp directory runs in `finally`, on every path.

### The printed document (`lib/report-html.ts`)

Built by `reportPrintHtml(report, opts: { printHint: boolean })` as one template string, no
framework:

- `<title>{display_name} — {period_start} to {period_end}</title>`
- `<h1>{display_name}</h1>` and a `.meta` line:
  `{period_start} to {period_end} · written {generated_at as toLocaleDateString()}`
- A table with header `Measure | Result | ` (the third header cell is empty) and one row per
  entry in `report.metrics`: `td.n` = `m.name`, `td.v` = `m.headline`, `td.s` = `m.sub ?? ''`
- `<h2>In plain words</h2>` — `report.summary` then `report.guidance`, one `<p>` each
- `<h2>How to read these numbers</h2>` — one `<p class="cav">` per metric that has a `caveat`,
  bolded metric name followed by the caveat text
- `<footer>`: `Written from {metricsUsed.length} of the {metrics.length} measures above and
  nothing else. Findings are hypotheses with their evidence attached, never diagnoses.`
- Gated on `opts.printHint` — `true` from `/print`, `false` from `/pdf` — a `.noprint` line:
  `Use your browser's Print dialog and choose “Save as PDF”.` (curly quotes in the copy). The
  pdf route omits it, so the downloaded document carries no instruction about a dialog that
  was never opened.

Print styles (exact values):

| Rule | Value |
|---|---|
| `@page` | `margin: 18mm` |
| `body` | `font: 12pt/1.55 Georgia, serif`, `color: #1a1a1a`, `max-width: 46em`, centred |
| `h1` | `18pt` |
| `.meta`, `td.s`, `.cav` | `10pt`, `#666` / `#555` |
| `h2` | `11pt`, uppercase, `letter-spacing: .04em` |
| `td.v` | `font-weight: 600`, `white-space: nowrap` |
| `footer` | `9pt`, `#777`, top border |
| `@media print` | `.noprint { display: none }` |

`esc(s)` replaces `& < > "` with entities. `'` is **not** escaped — safe for the element text and
double-quoted attributes used here, but it is not a general-purpose escaper.

The metrics rendered come from `report.metric_snapshot`, frozen at generation time and
deliberately not recomputed: the chat panel is a conversation *about* a report, and recomputing
would make yesterday's conversation quietly stop matching the prose above it.

### Routing

`/api/reports` is in `DASH_PREFIXES` in `middleware.ts` and not in `PUBLIC_DASH`.
`docs/deploy.md` records that a `405` on `POST`-only `/api/reports` is the correct smoke-test
result and a `404` means the hostname routing is wrong — this has bitten twice.

## Dependencies & Connections

### Depends On
- [Access scoping](../auth/role-consent-scoping.md) — `currentViewer`, `visibleChildren`,
  `requireChild`; a report is a child's data.
- [Report store](../dashboard/progress-reports.md) — `generateReport`, `readReport`, the
  `metric_snapshot` / `metrics_used` freeze, and the canonical-metric guard.
- [Report writer](../dashboard/progress-reports.md) — `reportMetrics` and `plainSummary` supply
  `name`, `headline`, `sub` and `caveat`.
- [Window helpers](../database/connection-layer.md) — `windowOf(days)`.
- [Database schema](../database/schema.md) — the `reports` table and `metrics_catalog.report_set`.

### Depended On By
- [Reports pages](../dashboard/progress-reports.md) — three dashboard pages link "Save as PDF"
  to `/api/reports/{report_id}/pdf` with plain `<a>` tags (no `target`/`rel`):
  `app/dashboard/reports/[id]/page.tsx`, plus `app/dashboard/student/[id]/page.tsx` and
  `app/dashboard/student/[id]/report/page.tsx`, which use the child's latest frozen report.
  No in-app link to `/print` remains — it is reached only through the pdf route's 501/500
  fallback text.
- Any scheduled job wanting class-wide output — the documented reason `POST` exists.

### Shared Resources
- `aac.db` `reports` table, shared with the dashboard's `generateReportAction` Server Action,
  which calls the same `generateReport` with the same `[7, 28, 90]` clamp.
- The `aac_adult` session cookie.
- `AAC_CHROME_BIN` — the pdf route's Chrome binary path; unset, it falls back to the stock
  macOS install path.

## Change Risks
- **Changing the accepted `days` values** must be done in both places: this route and
  `app/dashboard/reports/actions.ts` independently hardcode `[7, 28, 90]` with a fallback of 28,
  so they can silently drift apart.
- **Reordering the print route's existence and authorisation checks** changes observable
  behaviour: today an unknown id is 404 and an unauthorised one is 403, which leaks whether an
  id exists.
- **Recomputing metrics at print time instead of reading `metric_snapshot`** would make printed
  output disagree with the on-screen page and with any chat conversation about it — the precise
  failure `lib/report-store.ts` was written to prevent.
- **Adding user-controlled content to `lib/report-html.ts` without `esc()`** injects markup
  into both consumers of the shared builder — the page a browser opens and the HTML Chrome
  renders to PDF; `esc()` covers `& < > "` only.
- **An absent Chrome binary** turns every "Save as PDF" click into a 501 — the fallback text
  keeps the print view reachable, but the one-click download is gone until `AAC_CHROME_BIN`
  points at a real binary. And `existsSync` only proves the file exists: a present-but-broken
  binary passes the check, and every download then 500s from the render step instead.
- **Dropping caveats from the print output** re-introduces the "60% positive" misreading the
  full-caveat rule exists to stop, and conflicts with the copy rules in
  `docs/aac-clinical-constraints.md`.
- **Loosening `body.all`** (e.g. accepting it from a query string) makes it trivial to generate
  output for every child on a roster in one call; the roster scope is the only limit.
