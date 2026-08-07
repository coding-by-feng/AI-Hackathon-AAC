# Student Overview & AI Impact

## Function
The per-child landing page (`/dashboard/student/[id]`) — which **is** the report, per its own header comment: four sections of metric cards rendered from the report set, the open findings, the deterministic prose report block, the collected caveats and a docked Ask panel, in one scroll — plus the **AI impact** tab (`/dashboard/student/[id]/ai-impact`), which argues the product claim in one number: presses the child did not have to make.

## Purpose
The Overview is the per-child answer to the [Attention Queue](attention-queue.md)'s "who": the queue ranks, this page shows the evidence. Since the dark-report redesign it renders the same 13-metric report set as [the report pages](progress-reports.md) — "one scroll, nothing hidden behind tabs" — so a teacher clicking through from the queue reads real numbers, the findings that fired with their evidence and forbidden actions, and what to try, without visiting a second page.

Three clinical decisions shape the page. The redesign moved their surfaces, not their meaning:

- **`words_per_minute` is never a headline.** The rationale stands from `analytics-metrics.md` §6: AAC output runs at 2–15 wpm against 150+ for speech, so a headline number invites a comparison against speech that is both meaningless and demoralising. It now holds structurally — the report set contains no wpm metric, so the rebuilt page simply shows none.
- **`repeat_tap_rate` is neutral** (constraint **C1** — trying to reduce repetitive tapping leads to less overall communication, so no surface may pathologise it). Enforcement lives in the catalogue's `neutral` polarity — `catalog.direction()` returns `'flat'` regardless of delta — and in the report card's sub-line, which states "this is normal" unconditionally. Nothing on this page colours it.
- **Baseline gating lives where flagging happens.** Nothing is *flagged* before 14 active days and 40 own utterances, and that gate is applied in the [attention queue](attention-queue.md)'s scoring ([baseline gating](../analytics/baseline-gating.md)). This page renders real numbers and open findings without a banner — `BaselineBanner` is currently unmounted product-wide ([dashboard shell](dashboard-shell.md)).

The AI-impact page has its own header comment: *one screen, one argument.* F2 (`taps_saved`) is the whole claim in the unit that matters to someone with cerebral palsy — presses not made. F1, F3 and F4 depend on `suggestion_shown`, `suggestion_tap` and `gap_detected` events that **no client emits yet**, so they render as "not recorded" rather than as zeroes: a 0% acceptance rate would read as "the suggestions are useless", which is a different and false claim.

## Source Files
| File | Role |
|------|------|
| `app/dashboard/student/[id]/page.tsx` | The student page — metric sections, findings, report block, docked Ask; `metricN()` |
| `app/dashboard/student/[id]/ai-impact/page.tsx` | AI impact tab — taps saved, suggestion funnel, visual sourcing, vocabulary gaps |
| `app/dashboard/header.tsx` | `DashHeader` — name, `{year_group} · {profile_note}`, period chip, freshness, user chip |
| `components/metric-card.tsx` | `MetricCard` + `MetricCaveats` — every number on the page |
| `lib/insights.ts` | `openInsights()` + `toCardData()` — the findings section's data |
| `lib/report-store.ts` | `listReports()` — resolves the latest frozen report for Save as PDF |
| `components/kpi-tile.tsx` | **Unmounted** — zero importers since the redesign; see below |

## Implementation

Both pages: `export const dynamic = 'force-dynamic'`, `await params` for `{ id }`, `currentViewer()` then `requireChild(viewer, id)` (throws `NOT_AUTHORISED…`, caught by the dashboard boundary).

### Overview — window and data reads
- `period = [7, 14, 28, 90].includes(Number(days)) ? Number(days) : 14` — **default 14 days**. The whitelist is reachable only via `?days=`; the page renders no period selector.
- `reportMetrics(id, windowOf(period))` and `plainSummary(first, metrics)` — the same builders the [report pages](progress-reports.md) use
- `metricN(id, m, w)` per metric — sample-size attribution, below
- `openInsights(id).map(toCardData)` — the findings
- `listReports([id], 1)[0]` — the latest frozen report, if any

### `metricN` — per-shape n attribution
`ReportMetric` does not carry `n`, and the card contract requires it, so the page attributes a sample size per metric shape: the scalar metrics (`taps_per_utterance`, `correction_adjacent_rate`, `core_fringe_ratio`, `repeat_tap_rate`, `teacher_modeling`, `partner_wait_time`, `keyboard_use`) sum `agg_daily_metric.n` over the window; `silence_streak` counts spoken utterances; `card_frequency` sums `agg_card_stats.taps`; `cell_heat` sums `agg_cell_heat.taps + mistaps`; `new_words` reuses its own headline count; `word_pairs` and `nav_depth_by_card` count their rows. **A metric whose n cannot be attributed gets none rendered, never `n = 0`** — the `default` branch returns `null`, and `MetricCard` prints `n = {n}` only when `n` is a positive number.

### Overview — render order
1. `DashHeader` — title `display_name`, subtitle `{year_group} · {profile_note}`, period **`Last {period} days`**
2. Four metric-card sections mapping the catalogue's group codes: **Effort & speed** (A) · **Errors & reach** (B) · **Vocabulary** (C) · **Layout & voice** (D, E, G, H — grouped together "because all three describe the environment around the child rather than the child's own output"). Layout is wrap-and-grow flex: each card wrapper is `basis-[300px] grow min-w-[min(280px,100%)]` inside a `max-w-[1400px]` page, so one-card sections and orphan cards on a last row stretch to fill — no empty tracks at any width. Sections with no items are filtered out.
3. **Findings — {n} open** → `<InsightList items={findings} />`. The source comment states why the mount matters: the card contract carries two clinical invariants (informational ⇒ no action button; `forbidden_actions` displayed), *"so this list being mounted is itself a safety property, not decoration."* It sits below the numbers by request — the queue already surfaces urgency; these cards are guidance to read after the metrics.
4. **Report block** — heading `Report — {start} to {end}` (en-GB day-month dates), then **Summary:** and **What to try:** from `plainSummary`, the provenance line *"Written from {metrics.length} numbers, nothing else."*, and two actions: **Save as PDF** (below) and **Ask about this** → the `#ask` anchor.
5. `MetricCaveats` — the collected caveats disclosure ([progress-reports.md](progress-reports.md)).
6. **`#ask` section** — `AskPanel childId={id}` with role-switched suggestions (quoted in [ask-panel.md](ask-panel.md); their "fortnight" phrasing tracks the 14-day default) under the note that answers come from the same data as the cards above and that it cannot read what the child actually said.
7. More-detail links: `reach & errors` · `AI impact` · `progress view`.

### Save as PDF resolves a frozen report
`latest = listReports([id], 1)[0]`. When one exists, the button is a plain `<a>` to **`/api/reports/{report_id}/pdf`** — a same-tab download of the **latest frozen report**, which can cover a different period than the live numbers on screen; the source comment is explicit that the live page is "not silently passed off as a frozen artifact". When none exists, it renders as a `Link` to `/dashboard/reports` titled *"No frozen report yet — generate one first"*.

### Findings mapping
The `FiredRule → InsightCardData` shaping lives in `toCardData()` (`lib/insights.ts`) — first-evidence-row split, `humanKey`/`humanEvidenceValue` formatting, and fallbacks chosen for safety (a missing catalogue row renders as `informational`, i.e. no action list). See [insight-cards.md](insight-cards.md); this page just maps over it.

### `KpiTile` — unmounted since the redesign
`components/kpi-tile.tsx` has zero importers. The three rules its header enforced did not die with it — they moved:
- *n is always visible* → `MetricCard` renders `n = {n}` whenever a positive n is attributed by `metricN`, and nothing otherwise
- *colour comes from catalogue polarity, never the delta's sign* → `catalog.direction()` still returns `'flat'` for neutral metrics; `MetricCard` colours nothing by delta at all
- *suppressed states are words, not zeroes* → `MetricCard` renders `m.suppressed` ("too few corrections to tell") in place of a headline number

Deleting the file is safe today; re-mounting it must re-verify those rules against `metrics_catalog`.

### AI impact — data reads and derived values
```ts
const w = windowOf(7)
tapsSaved(id, w) · suggestionFunnel(id, w) · vocabularyGaps(id, w) · visualSourceSplit(id, w)
const hasSuggestionEvents = eventTypeCollected('suggestion_shown')
const hasGapEvents        = eventTypeCollected('gap_detected')

const perSentence  = (saved.withoutAi ?? 0) - (saved.withAi ?? 0)
const maxArm       = Math.max(saved.withoutAi ?? 0, saved.withAi ?? 0, 1)
const totalVisuals = sources.reduce((n, s) => n + s.count, 0)
const freeVisuals  = sources.filter(s => s.resolved_by !== 'generated' && s.resolved_by !== 'failed')
                            .reduce((n, s) => n + s.count, 0)
```

Header: a `← {display_name}` link back to the Overview, `AI impact`, `Last 7 days`, `<StudentTabs active="ai-impact">`.

**Panel — "Presses she did not have to make" / "The whole claim, in one number"**
- Empty when `saved.saved === null || saved.uses === 0`: *"No suggestions were used this week — every sentence {firstName} spoke was built from the board herself."*
- Two bars: *Building it herself* (`withoutAi`, `n = nWithout`, tone neutral) and *Taking a suggestion* (`withAi`, `n = nWith`, tone accent), both to one decimal.
- **`perSentence < 0.05` prints "No measurable difference yet."** The comment explains why: a difference that rounds to zero per sentence is not a result, and multiplying it by the number of sentences turns a rounding artefact into a headline.
- Otherwise: `{perSentence.toFixed(1)} fewer presses × {saved.uses} sentences = {Math.round(saved.saved)} presses {firstName} did not have to make this week.`
- Footnote: *"Both figures count spoken sentences only, so the two arms describe the same population."*

**Panel — "Are the suggestions any good?"**
`NotCollected` when `!hasSuggestionEvents`, reason *"The board is not yet logging when a suggestion is shown or tapped, so there is no denominator to divide by."* Otherwise three `FunnelRow`s — **Shown to her** (`funnel.shown`), **Tapped** (`funnel.tapped`), **Actually spoken** (`funnel.spoken`) — all scaled against `funnel.shown`, then `{round(acceptance*100)}% accepted.` with the cut-off copy: **below 0.2**, *"the strip is costing her more scanning than it saves — show it less often"*; at or above, *"Worth the space it takes on screen."* (matches `analytics-metrics.md` §5 F1's ~20% guidance.)

**Panel — "Where her pictures come from"**
`NotCollected` when `!hasGapEvents`. Otherwise one bar per `resolved_by` value (underscores replaced with spaces), `tone="warn"` only for `generated`, everything else `accent`; then `{round(freeVisuals/totalVisuals*100)}% reused.` and *"The target is 90% or better — the AI is meant to fill gaps in her vocabulary, not to draw every symbol."* (F4 target ≥ 90%.)

**Panel — "Words she reached for that do not exist" / "This list is the teaching to-do"**
`NotCollected` (with the strongest justification text in the file: *"This is the single most useful thing the dashboard can tell you, so it is worth wiring first"*), or `EmptyState tone="good"`, or a list of `{concept}` + `reached for {asked}× · {scenes}`.

> **Stub:** the per-gap **"Add to her board"** and **"Not needed"** buttons have no `onClick` and no `form action`. They render and do nothing. Nothing in the codebase writes a gap-review state today, which is also why [the queue's](attention-queue.md) `unreviewedGapCount` counts all generated gaps.

## Dependencies & Connections

### Depends On
- [Access control](../auth/role-consent-scoping.md) — `currentViewer`, `requireChild`
- [Progress reports](progress-reports.md) — `reportMetrics` / `plainSummary` (`lib/report.ts`), `MetricCard` / `MetricCaveats`, and the `/api/reports/[id]/pdf` download the Save-as-PDF button resolves to
- [Metric readers](../analytics/metric-readers.md) — the AI-impact reads: `tapsSaved`, `suggestionFunnel`, `vocabularyGaps`, `visualSourceSplit`, `eventTypeCollected`
- [Metric catalogue](../analytics/metric-readers.md) — `name`, `plain_explanation`, `caveat`, `chart`, `group_code` per card (through `lib/report.ts`); polarity semantics via `catalog.direction()`
- [Insight rules](../analytics/fired-rules-and-evidence.md) — `openInsights`, `toCardData`, `splitEvidence`
- [Insight cards](insight-cards.md) — `InsightList` / `InsightCardData`
- [Ask panel](ask-panel.md) — the docked `#ask` section
- [Dashboard shell](dashboard-shell.md) — `DashHeader` on the Overview; `Panel`, `Bar`, `EmptyState`, `NotCollected`, `StudentTabs` on the AI-impact tab
- [Event ingest](../api/event-ingest.md) — the missing `suggestion_shown` / `suggestion_tap` / `gap_detected` events the AI-impact page is waiting on
- [Database schema](../database/schema.md) — `agg_daily_metric`, `agg_card_stats`, `agg_cell_heat`, `utterances` (for `metricN`); `reports` (for `listReports`)

### Depended On By
- [Attention queue](attention-queue.md) — every queue row and roster row links to the Overview
- [Sittings (Sessions)](sittings.md) — the Who column links to the sibling Progress view
- [Insight cards](insight-cards.md) — this page's Findings section is the only mount of `InsightList`

### Shared Resources
- `metrics_catalog` — name, explanation, caveat, chart and grouping for every card, shared with all report surfaces
- `agg_daily_metric`, `agg_card_stats`, `agg_cell_heat` — read by both `lib/report.ts` and `metricN`
- `utterances` (`tapsSaved`, `suggestionFunnel`), `events` (`vocabularyGaps`, `visualSourceSplit`, `eventTypeCollected`)

### Change Risks
- **Re-adding a `words_per_minute` headline** (promoting it into the report set) re-introduces the comparison `analytics-metrics.md` §6 cut it to avoid — its absence from this page is the decision, not an oversight.
- **Changing `repeat_tap_rate`'s catalogue polarity away from `neutral`** turns `direction()` judgement back on wherever deltas render, and contradicts the report card's unconditional "this is normal" — a direct violation of constraint C1.
- **Dropping the Findings section** repeats the pre-2026-08-08 regression in which `InsightList` was mounted nowhere and its two clinical invariants existed only in unreachable code — see the history note in [insight-cards.md](insight-cards.md).
- **The Save-as-PDF button downloads the *latest frozen report*, not the page.** With `?days=7` on screen and a 90-day report stored, the download covers a different period than the numbers the teacher is reading. And removing Chrome (`AAC_CHROME_BIN` unset, binary absent) degrades the click to the `/pdf` route's 501 plain-text answer.
- **Making `metricN` return `0` instead of `null`** for unattributable metrics puts a false `n = 0` badge on cards — "no sample recorded" and "sample of zero" are different claims.
- **Only `fr.evidence[0]` is rendered** — `toCardData` splits the first evidence row. A rule that fires with multiple evidence rows (e.g. I5 word pairs, I3 buried cards) shows only the first; widening this changes what every insight card displays.
- **Replacing `NotCollected` with zeroes** on the suggestion funnel or the visuals split turns an instrumentation gap into a false claim about the AI; the `eventTypeCollected` check is the only thing distinguishing the two.
- **Wiring the "Add to her board" button** must go through a server action with `requireChild` — the pattern used by `dismissAction` and `generateReportAction` — and should make `unreviewedGapCount` review-aware, or the queue will keep scoring resolved gaps.
- **Rendering `saved.saved` without the `perSentence < 0.05` guard** would headline a rounding artefact as a product result.
