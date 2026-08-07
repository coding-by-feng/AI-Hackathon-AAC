# Student Overview & AI Impact

## Function
The two per-child metric tabs: **Overview** (`/dashboard/student/[id]`) with four KPI tiles, a words-per-minute caption, the open-findings list and three trend panels; and **AI impact** (`/dashboard/student/[id]/ai-impact`) which argues the product claim in one number — presses the child did not have to make. Both are driven by `KpiTile`/`lib/metrics` readers rather than by hardcoded numbers.

## Purpose
The Overview is the per-child answer to the [Attention Queue](attention-queue.md)'s "who". It carries the four P0 metrics from `analytics-metrics.md` §9 (`taps_per_utterance`, `silence_streak`, `independence_rate`, plus `repeat_tap_rate`) and the findings that have fired.

Three constraints are enforced structurally, not editorially:

- **`words_per_minute` is caption text and never a tile.** The inline comment: AAC output runs at 2–15 wpm against 150+ for speech, so a headline tile invites a comparison against typing that is both meaningless and demoralising (`analytics-metrics.md` §6).
- **`repeat_tap_rate` is neutral.** It carries an explicit hint — *"Exploration, motor practice or self-regulation — recorded, never treated as a fault"* — and `KpiTile` refuses to colour it. This is clinical constraint **C1**: trying to reduce repetitive tapping leads to less overall communication, so no surface may pathologise it.
- **Nothing is flagged during the baseline window.** `BASELINE_ACTIVE_DAYS = 14`; below that the findings panel is replaced with an explanation and every tile suppresses its delta.

The AI-impact page has its own header comment: *one screen, one argument.* F2 (`taps_saved`) is the whole claim in the unit that matters to someone with cerebral palsy — presses not made. F1, F3 and F4 depend on `suggestion_shown`, `suggestion_tap` and `gap_detected` events that **no client emits yet**, so they render as "not recorded" rather than as zeroes: a 0% acceptance rate would read as "the suggestions are useless", which is a different and false claim.

## Source Files
| File | Role |
|------|------|
| `app/dashboard/student/[id]/page.tsx` | Overview tab — tiles, caption, findings, three panels |
| `app/dashboard/student/[id]/ai-impact/page.tsx` | AI impact tab — taps saved, suggestion funnel, visual sourcing, vocabulary gaps |
| `components/kpi-tile.tsx` | The headline-number tile with its three enforced rules |

## Implementation

Both pages: `export const dynamic = 'force-dynamic'`, `await params` for `{ id }`, `currentViewer()` then `requireChild(viewer, id)` (throws `NOT_AUTHORISED…`, caught by the dashboard boundary).

### Overview — data reads
| Call | Window |
|---|---|
| `readMetric('taps_per_utterance' \| 'independence_rate' \| 'words_per_minute' \| 'repeat_tap_rate', id, w)` | `windowOf(7)` |
| `silenceStreak(id)` | point-in-time — read directly, *not* through the aggregate reader, because it is not a windowed average |
| `topCards(id, w)` | 7 days |
| `newWords(id, windowOf(14))` | 14 days |
| `abandonmentTrend(id, windowOf(14))` | 14 days |
| `openInsights(id)` | all open, undismissed, unsuperseded |

### Overview — building `InsightCardData`
Each `FiredRule` is mapped for [the insight card](insight-cards.md):

```ts
const ev = f.evidence[0] ?? {}          // ONLY the first evidence row is rendered
const split = splitEvidence(ev)
```
`split.values` and `split.thresholds` are passed through `humanKey(k)` and `humanEvidenceValue(k, v)` into `[string, string]` pairs. Missing catalogue metadata falls back to: `name → insight_id`, `plain_statement → ''`, `recommended_actions → []`, `forbidden_actions → []`, `action_kind → 'informational'`, `target_audience → 'adult'`, `safety_note → null`. The `informational` default is the safe one — it suppresses the action list entirely.

### Overview — layout, in render order
1. Header: `← class` link → `/dashboard`, `{display_name}`, `{year_group} · {profile_note} · last 7 days`, `<StudentTabs active="overview">`
2. `<BaselineBanner>` when `!base.ready`, passing `BASELINE_ACTIVE_DAYS`
3. Four-column tile grid:
   - `KpiTile` — `taps` / **"Presses per sentence"**
   - A hand-rolled **"Last spoke"** tile (not a `KpiTile`, because `silenceStreak` returns a plain number): value is `today` / `yesterday` / `{n}d`; sub-line `Worth checking in.` when `silence >= 2`, else `Talking regularly.`; footnote *"Days since the last spoken sentence."*
   - `KpiTile` — `independence` / **"Her own words"**
   - `KpiTile` — `repeat` / **"Repeat runs per sentence"** with the neutral `hint` quoted above
4. Caption paragraph: `{formatValue('words_per_minute', v)} this week.` or *"Speaking rate is not available for this window."*, followed by *"Typical AAC output is 2–15 words per minute. Compare {firstName} only against her own history, never against speech or another child."*
5. `Panel "Needs your attention"`, subtitle `{n} open` → `<InsightList>` when `base.ready`, otherwise `EmptyState` *"No findings during the settling-in period"*
6. Three-column panel row:
   - **"Her go-to words" / "Last 7 days"** — `topCards` as label + tap count + `<Bar>`; `tone="accent"` when `c.is_core`, else `neutral`; `maxTaps = Math.max(1, ...cards.map(c => c.taps))`; footnote *"Blue marks core words — the flexible ones that work in any situation."* (constraint **C5**)
   - **"New words" / "First ever use, last 14 days"** — label + `first_day`; empty state points at the AI-impact tab's vocabulary gaps
   - **"Giving up on sentences" / "Built, then never spoken · 14 days"** — `<Sparkline points={trend.map(t => t.rate)} height={60} />`, first day on the left, `{round(last.rate * 100)}% now` on the right, footnote *"The quietest failure: she composed something and gave up, so nothing was said and nobody noticed."*

### `KpiTile` — the three rules it exists to enforce
```ts
const dir     = inBaseline ? 'flat' : direction(m.metric_id, m.delta)
const neutral = m.meta?.polarity === 'neutral'
```
1. **`n` is always visible** when `m.n > 0`. 38% from 121 impressions and 38% from 8 are not the same claim.
2. **Colour comes from the catalogue's polarity, never from the sign of the delta.** `direction()` returns `'flat'` for any `neutral` metric, so `repeat_tap_rate` is never green or red (constraint C1). Tones: `better → --color-good`, `worse → --color-alert`, `flat → --color-ink-muted`.
3. **During the baseline window the delta is suppressed entirely.** "Down 4 points" against three days of history is noise dressed as a finding.

Sub-line state machine, in priority order:

| Condition | Text |
|---|---|
| `suppressed === 'not_collected'` | `not recorded yet` |
| `suppressed === 'small_sample'` | `too few to report (needs {meta.min_n})` |
| `inBaseline` | `still learning what is normal` |
| `delta !== null && !neutral` | `{+}{formatValue(delta)} vs last week` |
| `neutral` | `not a target` |
| otherwise | `no comparison yet` |

The headline shows `—` whenever `suppressed` is set. The footer line is `hint ?? meta.plain_explanation`, i.e. the catalogue's own plain-language sentence unless the caller overrides it.

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
- [Metric readers](../analytics/metric-readers.md) — `readMetric`, `silenceStreak`, `topCards`, `newWords`, `abandonmentTrend`, `tapsSaved`, `suggestionFunnel`, `vocabularyGaps`, `visualSourceSplit`, `eventTypeCollected`
- [Metric catalogue](../analytics/metric-readers.md) — `formatValue`, `direction`, `MetricMeta.polarity`, `min_n`, `plain_explanation`
- [Baseline gating](../analytics/baseline-gating.md) — `baseline()`, `BASELINE_ACTIVE_DAYS`
- [Insight rules](../analytics/fired-rules-and-evidence.md) — `openInsights`, `splitEvidence`, `humanKey`, `humanEvidenceValue`
- [Insight cards](insight-cards.md) — `InsightList` / `InsightCardData`
- [Dashboard shell](dashboard-shell.md) — `Panel`, `Bar`, `Sparkline`, `EmptyState`, `NotCollected`, `StudentTabs`, `BaselineBanner`
- [Event ingest](../api/event-ingest.md) — the missing `suggestion_shown` / `suggestion_tap` / `gap_detected` events the AI-impact page is waiting on

### Depended On By
- [Attention queue](attention-queue.md) — every queue row and roster row links to the Overview
- [Sittings (Sessions)](sittings.md) — links to the sibling Progress tab
- [Dashboard shell](dashboard-shell.md) — `StudentTabs` assumes both routes exist

### Shared Resources
- `agg_daily_metric` (scalar metrics), `utterances` (`tapsSaved`, `suggestionFunnel`), `events` (`vocabularyGaps`, `visualSourceSplit`, `eventTypeCollected`)
- `metrics_catalog` — supplies polarity, `min_n` and `plain_explanation` to every tile

### Change Risks
- **Promoting `words_per_minute` to a `KpiTile`** re-introduces the comparison `analytics-metrics.md` §6 cut it to avoid. The caption placement is the decision, not a layout accident.
- **Removing the `hint` on the repeat-runs tile, or changing `repeat_tap_rate`'s catalogue polarity away from `neutral`**, makes `direction()` start returning `better`/`worse` and paints stimming red — a direct violation of constraint C1 and of `metrics_catalog.polarity`'s stated purpose.
- **Rendering `saved.saved` without the `perSentence < 0.05` guard** would headline a rounding artefact as a product result.
- **Replacing `NotCollected` with zeroes** on the suggestion funnel or the visuals split turns an instrumentation gap into a false claim about the AI; the `eventTypeCollected` check is the only thing distinguishing the two.
- **Wiring the "Add to her board" button** must go through a server action with `requireChild` — the pattern already used by `dismissAction` and `generateReportAction` — and should also make `unreviewedGapCount` review-aware, or the queue will keep scoring resolved gaps.
- **Only `f.evidence[0]` is rendered.** A rule that fires with multiple evidence rows (e.g. I5 word pairs, I3 buried cards) shows only the first; widening this changes what every insight card displays.
- **Changing `KpiTile`'s suppressed-state ordering** would let a small-sample value display as a real number, breaking the `n < min_n ⇒ null` contract that `mcp-api.md` §2 also depends on.
