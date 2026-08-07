# Dashboard Design — reusable spec

**What this is:** the UI structure, the data structures behind it, and the rules that make it work — written so it can be applied to another project without reading the code.

**What it is not:** a style guide. The visual choices here are ordinary. The parts worth copying are the *contracts* — how a metric describes itself, why a null is not a zero, and which rules are enforced in data rather than in copywriting.

---

## 1. The governing idea

**Every readable thing about a metric lives in the database, not in the component.**

A card renders `name`, `plain_explanation`, `caveat`, `polarity` and `chart` — all columns. Adding a metric is an `INSERT`. Renaming one for a non-technical reader is an `UPDATE`. No component knows a metric exists.

This matters more than it sounds. The metric set here changed twice mid-build — 32 signals → 8 → 13 — and both times the UI needed no changes at all.

---

## 2. Data structures

### 2.1 The catalogue — one row per metric

```sql
metrics_catalog (
  metric_id          TEXT PK,   -- stable slug; code references this, never a name
  name               TEXT,      -- what a teacher reads. "Buttons to say one thing"
  group_code         TEXT,      -- A..H; drives the section a card appears in
  plain_explanation  TEXT,      -- one sentence, on every card
  formula            TEXT,      -- human-readable derivation
  unit               TEXT,      -- count | ratio | ms | days | wpm
  polarity           TEXT,      -- higher_better | lower_better | neutral
  min_n              INTEGER,   -- below this the value is suppressed
  caveat             TEXT,      -- how this metric misleads. Shown, not hidden.
  status             TEXT,      -- shown | logged | cut
  report_set         INTEGER,   -- in the report? 0/1
  report_rank        INTEGER,   -- display order
  chart              TEXT       -- which visualisation
)
```

**`polarity` is load-bearing.** It is the only thing stopping the UI colouring a neutral signal as a warning. In this domain, styling "repeated pressing" red would push an adult to suppress something that is normal and often necessary.

**`caveat` is not a footnote.** It ships on the card, in the print output, and in the API response.

### 2.2 The card contract

Every metric resolves to one object. The chart-specific payload is optional; only one applies.

```ts
type ReportMetric = {
  metric_id: string
  rank: number
  group: string          // A..H
  name: string
  plain: string
  caveat: string | null
  chart: ChartKind

  headline: string       // the one number, pre-formatted. "2.5" · "8 pairs" · "4x4"
  sub?: string           // one line: a delta, a denominator, a ceiling
  suppressed?: string    // why there is no number, in words

  series?:   { label: string; value: number | null }[]        // line, bar
  pairs?:    { word_a, word_b, solo_a, solo_b }[]             // table
  calendar?: { day: string; value: number }[]                 // calendar heat
  slices?:   { label: string; value: number; color: string }[] // donut
  scatter?:  { x: number; y: number; label: string }[]        // scatter
  split?:    { left: {label,value}; right: {label,value} }    // split bar
  grid?:     { rows, cols, cells: {row,col,taps,mistaps}[] }  // board heat
  ranked?:   { label: string; value: number; muted?: boolean }[] // ranked bars
}
```

`headline` is **pre-formatted on the server**. Units, rounding and pluralisation are domain decisions, and a component that formats them will get one wrong.

### 2.3 Two shapes of metric — the trap

Not every metric is a daily scalar. Some are **dimensional** and live in their own tables.

```
  daily_scalar   agg_daily_metric (child, day, metric_id, value, n)
  dimensional    agg_cell_heat · agg_card_stats · agg_word_pairs · …
```

This bit us twice. A reader that only knows about `agg_daily_metric` reports every dimensional metric as "no data" — while confidently telling its consumer not to treat a missing value as zero. **Any code that enumerates metrics must know which shape each one is.**

### 2.4 Null semantics — three different things

| | Means | Never render as |
|---|---|---|
| `value = null`, `n > 0` | measured, below `min_n` | 0 |
| `value = null`, `n = 0` | never observed; the feature is not in use | 0, or a decline |
| `direction = not_applicable` | the metric is neutral | good, or bad |

Every surface carries `n` alongside `value`, and a `status` of `ok | below_min_n | not_collected`. CSV export writes an empty cell **plus** a status column, because a spreadsheet sums an empty cell as zero and nobody notices.

---

## 3. View structure

```
┌──────────────────────────────────────────────────────────────────┐
│  header: person · period selector · role                         │
├──────────────────────────────────────────────────────────────────┤
│  GROUP A — Effort and speed                                      │
│  ┌────────┐┌────────┐┌────────┐┌────────┐   4-up, wraps to 2, 1  │
│  │ NAME   ││        ││        ││        │                        │
│  │ 2.5    │  <- headline, 2xl, tabular-nums                      │
│  │ sub    │  <- one line of context                              │
│  │ ▁▃▅▇   │  <- chart, ~64px, flex-1 so cards align              │
│  │ plain  │  <- the one-sentence explanation, always visible     │
│  └────────┘                                                      │
│  GROUP B — Errors and reach     … one section per group present  │
├──────────────────────────────────────────────────────────────────┤
│  PROSE  summary + guidance + "written from N numbers, nothing    │
│         else"                        [ Save as PDF ] [ Ask ]     │
├──────────────────────────────────────────────────────────────────┤
│  CAVEATS  collapsed <details>, one entry per metric that has one │
├──────────────────────────────────────────────────────────────────┤
│  CHAT  docked under the report, scoped to THIS report            │
└──────────────────────────────────────────────────────────────────┘
```

Sections are generated from the groups actually present, so removing a metric removes its section with no code change.

---

## 4. Charts — nine types, hand-rolled SVG

No charting library. These are simple shapes; a library would add ~500 KB of d3 internals to a page that may open on school wifi.

| Chart | Shape | Data | Use when |
|---|---|---|---|
| `line` | polyline + area | `series[]` | a trend over time |
| `bar` | rects | `series[]` | discrete periods |
| `donut` | 2 circles, `stroke-dasharray` | `slices[]` | parts of a whole |
| `split_bar` | two divs | `split` | **two options where neither is better** |
| `calendar` | rect grid, GitHub-style | `calendar[]` | day × intensity, shows gaps |
| `grid` | rect grid + row summary | `grid` | position on a physical layout |
| `scatter` | circles | `scatter[]` | two dimensions at once |
| `ranked_bar` | horizontal bars | `ranked[]` | ranked items with word labels |
| `table` | rows | `pairs[]` | a short list of pairs |
| `none` | — | — | defined but not yet instrumented |

**No tooltips, deliberately.** Every card states its number in text above the chart. Hiding the value behind a hover is worse for this audience and impossible on paper.

**`split_bar` vs a gauge is a real decision, not a style choice.** A gauge has a good end. If a metric genuinely has no better direction, a gauge silently reintroduces a judgement you removed when you named it neutral.

**Two heatmaps, different subjects.** `calendar` is day × intensity. `grid` is rows × columns of a physical layout. They share no code and must never be compared across different grid sizes, because the coordinates mean different things.

---

## 5. Copy rules that are enforced, not suggested

These are the part most worth stealing. Each exists because a plausible-looking UI would otherwise cause harm.

| Rule | Enforced by |
|---|---|
| A neutral metric is never styled good or bad | `polarity` column; `direction` returns `not_applicable` |
| Certain advice must never be recommended | `forbidden_actions` JSON on the rule; checked **after** generation, not only asked for in a prompt |
| A percentage always shows its denominator | `sub` line — "3 feeling words on her board" |
| A number never appears without its caveat | caveat ships on the card, in print, and in the API |
| The prose may cite only the selected metrics | `report_set` in the database; citations recorded and validated |
| Plain words, not engineer's words | `name` is a column — "Buttons to say one thing", not `taps_per_utterance` |

The forbidden-action check is the pattern to copy generally: **a system-prompt instruction is a request; a post-generation check is a control.**

---

## 6. Reports are artifacts, not renders

A report **freezes** its metric values into a row at generation time.

```sql
reports (report_id, child_id, period_start, period_end, generated_at,
         model, summary, guidance,
         metric_snapshot TEXT,   -- JSON: the values, frozen
         metrics_used   TEXT)    -- JSON: which ones the prose actually cited
```

Without the snapshot, a chat panel attached to a report drifts: the conversation is about numbers that have since changed while the prose above it stays put, and both look fine. `metrics_used` makes "the model cited only the selected metrics" checkable after the fact.

Print is **HTML with a print stylesheet**, not a PDF library. Every browser already does Save as PDF. Caveats print in full — on paper there is no expander.

---

## 7. Applying this elsewhere

The transferable parts, roughly in order of value:

1. **Put the human-readable metadata in the database.** Name, explanation, unit, polarity, caveat, chart. The UI becomes a renderer.
2. **Distinguish the three nulls.** Too-few, never-measured, and zero are different facts, and conflating them is the most common way a dashboard lies.
3. **Give every metric a polarity, including `neutral`.** Then make the UI physically unable to colour a neutral one.
4. **Ship the caveat with the number,** everywhere the number goes.
5. **Check the forbidden output after generation.** Prompts are requests.
6. **Freeze the numbers into any artifact that gets discussed later.**
7. **Pre-format headlines server-side.** Units and pluralisation are domain knowledge.
8. **Know which metrics are dimensional.** Any enumerator that assumes one table will silently under-report.

### Files

```
db/schema.sql              metrics_catalog · reports · sessions
db/seed_catalogues.sql     the metric definitions and the selected set
lib/report.ts              ReportMetric builders — one case per metric
lib/report-store.ts        generate · list · read; snapshot freezing
components/charts.tsx      the nine chart types
components/metric-card.tsx the card; dispatches on `chart`
app/dashboard/student/[id]/report/page.tsx   live view
app/dashboard/reports/[id]/page.tsx          frozen view
app/api/reports/[id]/print/route.ts          print
```
