# Progress Reports

## Function
The report-set metric surface in four forms: the **student page itself** (`/dashboard/student/[id]` — "the student page IS the report", per its header comment; layout in [student-overview.md](student-overview.md)), the older grouped **Progress view** (`/dashboard/student/[id]/report`), the **frozen** stored report (`/dashboard/reports` list, `/dashboard/reports/[id]` detail), and the **print/PDF output** (`GET /api/reports/[id]/print` and `…/pdf`, one HTML builder) — all sharing the presentation layer, `MetricCard` plus nine hand-rolled SVG chart types.

## Purpose
Two decisions carry this feature.

**A report is an artifact, not a rendered page.** From `report-store.ts`: `metric_snapshot` is why the table exists rather than the page re-rendering from live data. The chat panel on a report is a conversation *about that report*; if the numbers were recomputed on every open, yesterday's conversation would quietly stop matching the prose above it while both looked fine. `/dashboard/reports/[id]` therefore renders the frozen JSON, and says so in a banner once the report is a week old.

**The prose may cite the report metrics and nothing else.** `proposed_metrics.docx` requires it, and `metrics_catalog.report_set` is what makes the rule *checkable* rather than merely requested: `generateReport` extracts which metrics the text actually names and throws if any fall outside the canonical set. The deterministic writer cannot trip this, but a model will replace it — *"this is where that gets caught rather than discovered by a therapist."*

Everything readable comes from `metrics_catalog`: the name, the one-line explanation, the caveat, and **the chart type**. Adding a fourteenth metric is a database change, not a component change.

`charts.tsx` is hand-rolled inline SVG on purpose: these are simple shapes, and Recharts would add ~500 KB of d3 internals to a dashboard that may be opened on school wifi. There are **no tooltips, deliberately** — every card states its number in text above the chart, and a therapist reading "3.2 words" should not have to point at a bar to learn it.

## Source Files
| File | Role |
|------|------|
| `lib/report.ts` | `reportMetrics()` — builds one `ReportMetric` per `report_set` row; `plainSummary()` — the deterministic prose writer |
| `lib/report-store.ts` | `generateReport`, `listReports`, `readReport`; the canonical-set citation check |
| `lib/report-html.ts` | `reportPrintHtml()` — the printable document as an HTML string; one builder, two consumers |
| `app/api/reports/[id]/print/route.ts` | `GET` — serves the HTML as a page; the in-browser view and the no-Chrome fallback |
| `app/api/reports/[id]/pdf/route.ts` | `GET` — renders the same HTML through headless Chrome, streams a PDF download |
| `app/dashboard/student/[id]/page.tsx` | The student page — renders the report set as its main body ([student-overview.md](student-overview.md)) |
| `app/dashboard/student/[id]/report/page.tsx` | Older grouped Progress view with a 7/28/90-day selector |
| `app/dashboard/reports/page.tsx` | Report list + the generate form |
| `app/dashboard/reports/actions.ts` | `generateReportAction` server action |
| `app/dashboard/reports/[id]/page.tsx` | One frozen report + embedded Ask panel |
| `components/metric-card.tsx` | `MetricCard` (chart dispatch) and `MetricCaveats` |
| `components/charts.tsx` | `LineChart`, `BarChart`, `DonutChart`, `SplitBar`, `CalendarHeat`, `ScatterChart`, `PairTable`, `GridHeat`, `RankedBars` |

## Implementation

### The report set
`reportMetrics(childId, w)` reads `SELECT … FROM metrics_catalog WHERE report_set = 1 ORDER BY report_rank`. `db/seed_catalogues.sql` sets **13 rows, ranks 1–13**:

| rank | `metric_id` | catalogue `name` | `chart` | headline / sub built by `lib/report.ts` |
|---|---|---|---|---|
| 1 | `taps_per_utterance` | Buttons to say one thing | `line` | `{v.toFixed(1)}` · "buttons per sentence, typical" · 8-week series |
| 2 | `correction_adjacent_rate` | Where corrections land | `split_bar` | `{n}% next door`; sub flips at **≥ 60** ("looks like reach, not confusion"), **≤ 35** ("looks like changing her mind, not her hand"), else "mixed" |
| 3 | `cell_heat` | Which buttons get reached | `grid` | `{rows}×{cols}` · "{n} cell(s) never reached" / "all cells in use" |
| 4 | `silence_streak` | Days since she last spoke | `calendar` | `spoke today` / `{d} day(s)`; sub "worth checking in" at **d ≥ 2** |
| 5 | `card_frequency` | Her go-to words | `ranked_bar` | `"{top label}"` · "used {n} times"; top 6, non-core rendered `muted` |
| 6 | `new_words` | New words | `line` | count in window; sub `+{pct}% on the {before} she had`, or "first period" |
| 7 | `word_pairs` | Words not yet paired | `table` | `{n} pair(s)` · "she uses both, never together" |
| 8 | `core_fringe_ratio` | Flexible words vs naming | `donut` | `{n}% flexible` · "about 200 core words carry most of everyday talk" |
| 9 | `nav_depth_by_card` | How deep words are buried | `scatter` | `"{label}"` · "used {n}×, {depth} screens deep" / "none buried" |
| 10 | `teacher_modeling` | Adult demonstrating | `bar` | `{n}/day` · "on {d} days" / **"Modeling Mode never switched on"** |
| 11 | `partner_wait_time` | How long the adult waits | `line` | `{s}s`; sub flips at **< 2 s** ("under two seconds — she may need longer") |
| 12 | `repeat_tap_rate` | Repeated pressing | `line` | `{n}%` · **"of sentences include a repeat — this is normal"** |
| 13 | `keyboard_use` | Spelling and the alphabet | `none` | `not set up`, permanently suppressed |

> The `lib/report.ts` header still says *"the eight-metric report set"*. `report-store.ts` explains the drift: *"the eight from proposed_metrics.docx became the thirteen in AAC_Filtered_Metric_Index.md"* — which is exactly why `canonicalIds()` reads the catalogue instead of a hardcoded array.

Notable per-metric logic:
- **`correction_adjacent_rate`** returns `suppressed: 'too few corrections to tell'` when the value is falsy. Its 60/35 cut-offs are the same ones [Reach & errors](reach-and-errors.md) uses.
- **`word_pairs`** joins `agg_word_pairs` to `cards` twice and requires an `EXISTS` match against `syntax_patterns.pos_sequence` in either order, with `together = 0 AND solo_a >= 10 AND solo_b >= 10`, ordered by `MIN(solo_a, solo_b) DESC LIMIT 8`. The comment gives the reason: ranking on frequency alone surfaced *"I + you"*, which is true and useless — the parts of speech have to form a structure we recognise.
- **`nav_depth_by_card`** flags `depth >= 3` as "buried" and the comment is explicit: *never "move it" — add a copy* (constraint C3).
- **`teacher_modeling`** distinguishes "nobody modelled" from "nobody switched Modeling Mode on" by counting `DISTINCT day_local FROM events WHERE actor = 'adult'`. This is `mcp-api.md`'s `MODELING_MODE_UNUSED` guidance rendered as a sub-line.
- **`repeat_tap_rate`**'s sub-line states "this is normal" unconditionally — constraint C1, so no reading of the number can present repetition as a fault.
- **`keyboard_use`** is a hardcoded stub: *"Her board has no keyboard yet, so there is nothing to measure. Alphabet access is one of the four things a robust AAC system needs."* This is constraint **C8** stated as a product gap rather than hidden.

### Helpers in `lib/report.ts`
```ts
windowValue(childId, metricId, w)  // ROUND(AVG(value),4), COALESCE(SUM(n),0) over agg_daily_metric
weekly(childId, metricId, weeks=8) // GROUP BY strftime('%Y-W%W'), label 'w{WW}', newest 8, reversed
monthly(childId, metricId, months=6) // defined but never called — dead code
```
`build()` returns `null` for any `metric_id` it has no `case` for, and `reportMetrics` filters those out — so a catalogue row flagged `report_set = 1` without a matching case silently vanishes from the page.

### `plainSummary(child, metrics)`
Deterministic, no model. Returns `{ summary, guidance }`.

**`summary` sentences**, appended in order when the metric is present:
1. `silence_streak` → "{child} has been communicating regularly." / "{child} has not said anything for {headline}."
2. `new_words` (when headline ≠ `'0'`) → "She used {n} new words this period, {sub}."
3. `card_frequency` (when headline ≠ `'—'`) → "Her most-used word is {headline}, {sub}."
4. `taps_per_utterance` → "It takes her about {headline} presses to say one thing."

**`guidance` sentences** — *reach before vocabulary*, per the inline comment:
1. `correction_adjacent_rate.split.left.value >= 60` → the reach reading, ending **"mask the neighbours of the hardest targets or change how the device is mounted. Do not move buttons she has learned."**
2. `nav_depth_by_card` when something is buried → **"Add a copy of it somewhere easy to reach — adding one costs nothing, and moving the original would undo the motor pattern she has built."**
3. `word_pairs[0]` → model that specific pair (insight I5's "target the named pair, not combining in general").
4. `partner_wait_time.sub` starts with "under two seconds" → tell the adult to wait (constraint C7).
5. `teacher_modeling.sub === 'Modeling Mode never switched on'` → *"That may mean nobody modelled, or that Modeling Mode was never switched on — worth checking which."*

Fallbacks: `'Not enough recorded this period to summarise.'` and `'Nothing in these numbers points at a specific next step.'`

Every guidance branch is phrased to avoid a `forbidden_action`; none proposes moving, resizing or reducing repetition.

### `lib/report-store.ts`
```ts
canonicalIds()  // SELECT metric_id FROM metrics_catalog WHERE report_set = 1
citedIn(text, metrics)  // matches m.name.toLowerCase(), OR the headline stripped of
                        // non-[\w\s%] chars — the prose says "24 new words", not "new_words"
```
`generateReport(childId, w, childName)`:
1. `reportMetrics` → `plainSummary`
2. `id = 'rep_' + randomUUID().slice(0, 12)`
3. `used = unique(citedIn(summary) ∪ citedIn(guidance))`
4. **`stray = used − canonical` → `throw new Error('Report cited metrics outside the canonical set: …')`**
5. `INSERT INTO reports (report_id, child_id, period_start, period_end, generated_at, model, summary, guidance, metric_snapshot, metrics_used)` with `model = null` and both JSON columns stringified

`listReports(childIds, limit = 30)` joins `children` and orders `generated_at DESC`. `readReport(reportId)` strips the two JSON columns and `safeParse`s them into `metrics` / `metricsUsed`, returning `[]` on malformed JSON rather than throwing — an old snapshot whose shape has changed degrades to an empty report instead of a 500.

### `generateReportAction` (server action)
```ts
const childId = String(formData.get('child_id') ?? '')
const days    = Number(formData.get('days') ?? 28)
const child   = requireChild(await currentViewer(), childId)     // scope check lives HERE
const period  = [7, 28, 90].includes(days) ? days : 28
const id      = generateReport(child.child_id, windowOf(period), child.display_name.split(' ')[0])
revalidatePath('/dashboard/reports'); redirect(`/dashboard/reports/${id}`)
```
The header states the rule: the check is in the action, not in the form that renders the button.

### Pages
**`/dashboard/reports`** — `EmptyState` when the roster is empty. A `Panel "Write a new one"` with a `<form action={generateReportAction}>`: a `child_id` `<select>` (required, one option per roster child), a `days` `<select>` defaulting to `28` with options **Last week (7) / Last month (28) / This term (90)**, and a **Generate** submit. Below, `Panel "{n} report(s)"` listing `display_name`, `{period_start} → {period_end} · written {date}` and a 2-line-clamped summary, each linking to `/dashboard/reports/{report_id}`.

**`/dashboard/reports/[id]`** — `readReport` → `notFound()` when missing, then `requireChild(viewer, report.child_id)` (*"Reading a report is reading a child's data. Scope it the same way."*). Header shows the period, the written date, and `({n} days ago)` when `ageDays > 0`. Two actions: **See live numbers** → `/dashboard/student/{child_id}/report`, and **Save as PDF** → `/api/reports/{report_id}/pdf` — a same-tab download (the route answers `content-disposition: attachment`, filename `aac-report-{first}-{period_start}-to-{period_end}.pdf`). When **`ageDays >= 7`** a banner explains the numbers are frozen *"— that is deliberate, so the words below still describe the figures beside them."* Then the grouped metric grid, the "In plain words" section (`summary`, `guidance`, and the provenance line `Written from {metricsUsed.length} of the {metrics.length} numbers above and nothing else · {model}` / `· no model — deterministic summary`), `MetricCaveats`, and a `Panel "Ask about this report"` wrapping [`AskPanel`](ask-panel.md) with suggestions *"What should I try next?" · "Which of these matters most?" · "What does the pairs number mean?"*.

**`/dashboard/student/[id]/report`** — the same grid computed **live**. `period = Number(days) === 7 ? 7 : Number(days) === 90 ? 90 : 28`, selected by a three-link nav (**This week / This month / This term**) that sets `?days=`. Renders `StudentTabs active="report"`. Its "This period in plain words" block has an **"Ask about this"** link → `/dashboard/student/{id}/ask` and a **Save as PDF** control that resolves `listReports([id], 1)[0]`: when a frozen report exists it is an `<a>` to `/api/reports/{report_id}/pdf` — the latest report's download — and when none exists it is a `Link` to `/dashboard/reports` titled *"No frozen report yet — generate one first"*. (The button shipped as a handler-less `<button>` — an inert stub — until 2026-08-08; the source comment records the history.)

**`/dashboard/student/[id]`** — the student page renders the same `reportMetrics` + `plainSummary` output as its main body, with per-metric `n` attribution and the identical Save-as-PDF resolution (`listReports([id], 1)[0]` → `/pdf` link, or the titled `Link` to `/dashboard/reports`). Full layout and render order: [student-overview.md](student-overview.md).

**Group headings** (the Progress view and the frozen report page use the identical map; the student page groups the same metrics into four sections of its own instead — see [student-overview.md](student-overview.md)):
```
A: Effort and speed · B: Errors and reach · C: Words she uses
D: How the board is laid out · E: Whose voice · G: The adult · H: How she communicates
```
Sections with no items are filtered out. **Group `F` (AI value) has no heading** — a `report_set` metric in group F would be built and then silently dropped from the page. No current report-set metric is in F.

### `components/metric-card.tsx`
`MetricCard({ m, n? })` renders the plain-language `name` at 13 px medium weight — **not** uppercase, and there is no rank corner — then the `headline` at 28 px semibold tabular, then `sub` and the optional `n` on one baseline row: `n = {n}` renders **only when `n` is a positive number**, because per the header comment "a card with no real n renders no n, never `n = 0`" (the student page attributes n per metric shape via its `metricN()` — [student-overview.md](student-overview.md)). A suppressed metric shows its suppression sentence *instead of* a number — *"'too few corrections to tell' is a different fact from 0, and rendering either as the other is how a dashboard lies."* The chart sits in a `min-h-[72px]` body, and the catalogue's `plain_explanation` is always visible at the bottom of the card.

`Chart` dispatches on `m.chart` — `line · bar · table · calendar · donut · scatter · grid · ranked_bar · split_bar · none`, defaulting to `null` for anything unrecognised. `split_bar` passes **one colour for both sides** (`color="var(--color-accent)"`); the dispatch-site comment states why: this is a classifier between two readings where neither is better, and *two colours would quietly rank them*.

`MetricCaveats` collects every metric with a `caveat` into a `<details>` labelled **"How these numbers can mislead ({n})"**. The header explains why they are here and not on the cards: *"They are not footnotes. 'Counts words used, not how she feels' is the difference between a useful metric and a wrong conclusion about a child, and hiding it behind a hover would put it where nobody reads it."*

### `components/charts.tsx`
Shared `scale(values, h, pad = 4)` maps values to y with `min = Math.min(0, …)` so a series is never drawn off a floating baseline. `AXIS = var(--color-line)`, `INK = var(--color-ink-faint)`. `Empty` renders the string **"not enough yet"**.

| Component | Behaviour |
|---|---|
| `LineChart(points, height=64)` | `null`-safe; returns `<Empty>` below 2 points; filled area at `opacity 0.12` plus a 2.5 r dot on the last point; `aria-label="Trend ending at {value}"` |
| `BarChart(points, height=64)` | gap 2, `bw = max(1, 100/n - 2)`; `value === null` bars drop to `opacity 0.15`; first and last labels printed beneath |
| `DonutChart(slices, size=88)` | `r = 32`, `strokeWidth 12`, rotated −90°, `stroke-dasharray` arcs; legend prints each slice's rounded percentage |
| `SplitBar(left, right, color = 'var(--color-accent)')` | **deliberately not a gauge** — a gauge has a good end and "answers vs starts a topic" does not; the single `color` prop paints **both** sides; always prints **"Neither one is better."** |
| `CalendarHeat(days, weeks=7)` | GitHub-contributions style; pads leading blanks to the first day's `getUTCDay()`; cell 11 px, gap 3; shade `color-mix(in oklab, var(--color-accent) {18 + t*82}%, transparent)`; legend "quiet → busy" |
| `ScatterChart(points, height=72)` | x = depth, y = frequency; radius `clamp(2.5 … 6)` by y; axis labels "simpler" / "more complex" |
| `PairTable(rows)` | first 4 pairs, columns **Pair** / **Used apart**; empty copy: *"No pairs like this right now — she is combining the words she uses most."* |
| `GridHeat(rows, cols, cells)` | board grid, cell 15 px, gap 3; fill `color-mix(… {12 + t*88}%)`; a cell is outlined in `--color-warn` when its error share **> 0.18**; a per-row "{n}% missed" summary sits on the right, with the worst row highlighted when it exceeds **0.12** |
| `RankedBars(items)` | first 6, horizontal because the labels are words; `muted` items use `--color-neutral` instead of `--color-accent` |

`GridHeat`'s header is emphatic that it is **not** `CalendarHeat` and not comparable across grid sizes, and that *a reach problem shows as a gradient down the rows, not as one hot cell* — which is why the row summary is the part worth reading.

### The print & PDF path
`lib/report-html.ts` exports `reportPrintHtml(report, { printHint })` — the printable document as a serif, print-stylesheet HTML string: metrics as a three-column table, the plain-words prose, **caveats printed in full** (*"On paper there is no hover and no expander, and a number that travels to a meeting without its caveat is how '60% positive' becomes a statement about how a child feels"*), and a provenance footer. Its header states the design: *one builder, two consumers — keeping them one function means the paper version and the downloaded version can never drift apart.*

- **`GET /api/reports/[id]/print`** — `readReport` → 404, `requireChild` → 403, else the HTML with `printHint: true` (a `noprint` hint: *"Use your browser's Print dialog and choose 'Save as PDF'."*). This is the in-browser view and the fallback wherever Chrome is absent.
- **`GET /api/reports/[id]/pdf`** — same scoping, then renders the same HTML (`printHint: false`) through headless Chrome: `CHROME = process.env.AAC_CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'`, run with `--headless --print-to-pdf` in a fresh `mkdtemp` directory (two teachers downloading at once must not race on file names), 30 s timeout. Streams `application/pdf` with `content-disposition: attachment; filename="aac-report-{first}-{period_start}-to-{period_end}.pdf"` and `cache-control: no-store`. Degradation is graceful, never broken: **no Chrome binary → 501** plain text pointing at `/print`; **failed render → 500** with the same pointer; the temp directory is removed in `finally`.

## Dependencies & Connections

### Depends On
- [Access control](../auth/role-consent-scoping.md) — `currentViewer`, `requireChild` on every page and in the action
- [Metric catalogue](../analytics/metric-readers.md) — `metrics_catalog` supplies `name`, `plain_explanation`, `caveat`, `chart`, `report_rank`, `group_code`, `min_n`, and the `report_set` flag
- [Dashboard shell](dashboard-shell.md) — `Panel`, `EmptyState`, `StudentTabs`
- [Ask panel](ask-panel.md) — embedded on the frozen report page
- [Database schema](../database/schema.md) — `reports`, `agg_daily_metric`, `agg_card_stats`, `agg_cell_heat`, `agg_word_pairs`, `boards`, `board_cells`, `cards`, `child_vocabulary`, `syntax_patterns`, `utterances`, `events`, `v_first_uses`
- [Print & generate routes](../api/print-and-generate.md) — `lib/report-html.ts` is the one builder with two consumers: `GET /api/reports/[id]/print` (in-browser view and fallback) and `GET /api/reports/[id]/pdf` (headless-Chrome download via `AAC_CHROME_BIN`, degrading to 501 without Chrome and 500 on a failed render)

### Depended On By
- [Student overview](student-overview.md) — the student page renders the report set as its main body and resolves the latest frozen report for its Save-as-PDF button
- [Sittings (Sessions)](sittings.md) — the Who column links to the live Progress view
- [Print & generate routes](../api/print-and-generate.md) — consume `readReport()` and the same `ReportMetric[]` shape
- [Dashboard shell](dashboard-shell.md) — the rail's **Reports** item and the `report` student tab

### Shared Resources
- `metrics_catalog.report_set` — the single definition of "the canonical set", read by both `reportMetrics()` and `canonicalIds()`
- `reports.metric_snapshot` — a serialised `ReportMetric[]`, read by both `/dashboard/reports/[id]` and the print route
- `charts.tsx` — used only through `MetricCard`; `Sparkline` in `components/ui.tsx` is a separate, older implementation of the same idea

### Change Risks
- **Changing the `ReportMetric` shape** breaks every already-stored `metric_snapshot`. `safeParse` prevents a crash but the report renders with no metrics at all, silently. Old reports are not migrated anywhere.
- **Adding a `report_set = 1` row without a `case` in `build()`** makes it vanish from every report with no error. Adding one in **group `F`** makes it vanish even with a case, because the `GROUPS` map has no `F` entry.
- **Loosening the `stray` check in `generateReport`** removes the only enforcement that the prose cites nothing outside the report set — the check exists specifically for when a model replaces `plainSummary`.
- **Recomputing metrics on `/dashboard/reports/[id]` instead of reading the snapshot** breaks the guarantee the whole table exists for: the embedded Ask conversation would drift away from the prose above it while both still looked correct.
- **`citedIn` matches on `name` and `headline` substrings.** A short headline (e.g. `—`, or a bare number) can match unrelated text; a longer or reworded catalogue `name` changes which metrics are recorded as cited, retroactively for new reports only.
- **`monthly()` is dead code** — deleting it is safe; wiring it in changes the x-axis of every `line` chart from 8 weeks to 6 months.
- **Both live views' Save-as-PDF buttons download the *latest frozen report*** (`listReports([id], 1)[0]`), which can cover a different period than the live numbers on screen — a teacher reading a 7-day view can download a 90-day artifact without noticing. And **removing Chrome** (unset `AAC_CHROME_BIN`, no binary at the default macOS path) degrades the click to the `/pdf` route's 501 plain-text answer; `/print` remains the working fallback.
- **Renaming a catalogue `name`** changes the report card heading *and* `citedIn`'s matching *and* the print output, all at once.
