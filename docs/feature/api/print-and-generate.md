# Reporting Endpoints

## Function
`POST /api/reports` generates one stored report per child programmatically, and
`GET /api/reports/[id]/print` renders a stored report as server-side HTML with a print
stylesheet, ready for the browser's "Save as PDF".

## Purpose
The dashboard's own "Generate" button goes through a Server Action
(`app/dashboard/reports/actions.ts`). `POST /api/reports` exists for the case a Server Action
cannot serve: a scheduled job writing end-of-month reports for a whole class without anyone
clicking. Same scoping, same store.

The print route is server-rendered HTML rather than a PDF library on purpose. Every browser can
already turn this into a PDF, and jsPDF/puppeteer would be a large dependency — and, for
puppeteer, a whole Chromium — to reproduce what Cmd-P already does well.

Caveats print **in full**. On paper there is no hover and no expander, and a number that travels
to a meeting without its caveat is how "60% positive" becomes a statement about how a child
feels.

## Source Files
| File | Role |
|------|------|
| `app/api/reports/route.ts` | `POST` — roster-scoped generation, single child or whole roster |
| `app/api/reports/[id]/print/route.ts` | `GET` — the printable HTML document, its stylesheet and HTML escaping |

## Implementation

Both routes declare `export const runtime = 'nodejs'` and `export const dynamic = 'force-dynamic'`.

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

Response: `text/html; charset=utf-8`, `cache-control: no-store`.

### The printed document

Built as one template string, no framework:

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
- A `.noprint` line: `Use your browser's Print dialog and choose "Save as PDF".`

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
- [Reports pages](../dashboard/progress-reports.md) — `app/dashboard/reports/[id]/page.tsx` links to
  `/api/reports/{report_id}/print` with `target="_blank" rel="noopener"`.
- Any scheduled job wanting class-wide output — the documented reason `POST` exists.

### Shared Resources
- `aac.db` `reports` table, shared with the dashboard's `generateReportAction` Server Action,
  which calls the same `generateReport` with the same `[7, 28, 90]` clamp.
- The `aac_adult` session cookie.

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
- **Adding user-controlled content to the printed HTML without `esc()`** injects markup into a
  document that is opened in a browser; `esc()` covers `& < > "` only.
- **Dropping caveats from the print output** re-introduces the "60% positive" misreading the
  full-caveat rule exists to stop, and conflicts with the copy rules in
  `docs/aac-clinical-constraints.md`.
- **Loosening `body.all`** (e.g. accepting it from a query string) makes it trivial to generate
  output for every child on a roster in one call; the roster scope is the only limit.
