# Reach & Errors (Access Page)

## Function
The `/dashboard/student/[id]/access` tab: a pair of board heat maps (presses vs. undone presses) over a 14-day window, a hand-or-meaning classifier built from `correction_adjacent_rate`, and a timing panel that shows the adult's wait time beside the child's latency — or a consent lock where that number would be.

## Purpose
From the page header: *"The page exists to answer one question that no single number can: is this a vocabulary problem or a physical one? The two heat maps side by side are the only way to see the difference, and the intervention is completely different in each case."*

This is insight **I1** rendered as a screen rather than as a card. `analytics-metrics.md` §5 B2 calls `correction_adjacent_rate` "the discriminator of the whole system": high means the finger slipped, low means the mind changed. The safety note from I1 is baked into the copy — with cerebral palsy mis-taps are frequent and normal, so an ambiguous split defaults to the MOTOR reading, because recommending vocabulary work to a child whose hand is the problem costs far more than the reverse.

Three clinical constraints shape what the page will and will not offer:

- **C1** — a press only counts as unintended *if it was undone*. The page says so explicitly: repeated pressing with no delete is never counted here.
- **C2/C3** — the reach-suspect callout offers **mask** and **add a copy**, and states in prose that resizing the grid and moving a learned button are deliberately not offered. Both are in `forbidden_actions`; both would relocate buttons the child has already learned.
- **C7** — a long child latency may be the adult not waiting. `partner_wait_time` is shown *beside* `time_to_first_tap`, never instead of it, so the adult sees their own number next to the child's.

`HeatGridPair` is keyed to the robust board only: modes hold no coordinates of their own (constraint **C4**), and merging two grid sizes would make the same coordinate mean two different buttons.

## Source Files
| File | Role |
|------|------|
| `app/dashboard/student/[id]/access/page.tsx` | The page — grids, hand-or-meaning panel, timing panel, consent gate, `Row` helper |
| `components/heat-grid.tsx` | `HeatGridPair` and its `Grid` sub-component: dual heat maps, reach-suspect detection, resize warning |

## Implementation

`export const dynamic = 'force-dynamic'`. Scope: `currentViewer()` → `requireChild(viewer, id)`. Window: **`windowOf(14)`**.

### Reads
```ts
const grid        = cellHeat(id, w)                              // HeatGrid | null
const mistap      = readMetric('mistap_rate', id, w)
const adjacency   = readMetric('correction_adjacent_rate', id, w)
const compose     = readMetric('composition_time', id, w)
const firstTap    = readMetric('time_to_first_tap', id, w)
const partnerWait = readMetric('partner_wait_time', id, w)
```

### The hand-or-meaning classifier
```ts
const adjacent = adjacency.value ?? 0
const reading =
  adjacency.value === null ? null
  : adjacent >= 0.6  ? 'motor'
  : adjacent <= 0.35 ? 'semantic'
                     : 'ambiguous'
```
| `reading` | Copy |
|---|---|
| `motor` (≥ 0.60) | *"Most corrections land right next to the button she meant. That pattern is a hand that missed, not a meaning that changed — and with cerebral palsy it is the expected reading. Treat it as a reach problem unless you have seen otherwise."* |
| `semantic` (≤ 0.35) | *"Corrections mostly land elsewhere on the board, which points at the meaning rather than the reach. Check she can physically hit the target before reteaching anything."* |
| `ambiguous` (0.35 < x < 0.60) | *"The split is unclear. Default to the reach reading — recommending vocabulary work to a child whose hand is the problem costs far more than the reverse."* |
| `null` | nothing rendered |

The same 60 / 35 cut-offs are used by `lib/report.ts` for the `correction_adjacent_rate` report card, so the two surfaces agree.

### Panels
**"Where presses land"** — `<HeatGridPair grid={grid} />`, or `EmptyState "No board layout recorded for this child"` when `cellHeat` returns `null` (no `boards` row with `kind = 'robust'`).

**"Hand or meaning?"** — two `Row`s: *Presses undone straight away* (`mistap_rate`) and *Corrections landing on a neighbouring button* (`correction_adjacent_rate`), then the `reading` block, then the C1 footnote: *"A press only counts as unintended if she undid it. Repeated pressing with no delete is never counted here — it is exploration, motor learning, or self-regulation, and it appears on the overview as a neutral figure."*

**"Timing"** — two `Row`s: *Time to build a sentence* (`composition_time`) and *Pause before she starts answering* (`time_to_first_tap`). Then, gated on `canSee(child, 'partner_speech')`:

- **Granted** — a sunk-surface block headed *"And how long the adult waited"* with `formatValue('partner_wait_time', …)` at 2xl, and a reading that switches on **`partnerWait.value < 2000`** (ms):
  - under 2 s → *"Under two seconds. AAC output runs around 15 words per minute — a slow answer here is the adult's doing before it is the child's."*
  - otherwise → *"The adult is leaving processing time, so a slow answer is more likely to be about scanning than about being rushed."*
  - The 2000 ms cut-off is `mcp-api.md`'s `PARTNER_WAIT_SHORT` guidance code and C7's headline.
- **Denied** — `<ConsentLock tier="partner_speech" title="How long the adult waited" youCanSee="how long she takes to start, and how long a sentence takes to build" />`

### `Row({ label, value, n })`
`<dt>` label, `<dd>` with a large tabular value and `n = {n}` in faint text, rendered only when `n > 0`.

### `HeatGridPair`
Input is `HeatGrid` from `lib/metrics.ts`:
```ts
{ board_id, board_name, grid_rows, grid_cols,
  cells: { grid_row, grid_col, taps, mistaps, label, masked }[],
  resizedInWindow: boolean }
```

Derived, in order:
```ts
const maxTaps = Math.max(1, ...cells.map(c => c.taps))
const maxMis  = Math.max(1, ...cells.map(c => c.mistaps))
const dead     = cells.filter(c => c.taps === 0 && !c.masked)
const errorHot = cells.filter(c => c.mistaps >= Math.max(2, maxMis * 0.6))
// A dead cell that neighbours a high-error cell is the reach signature.
const reachSuspects = dead.filter(d => errorHot.some(e =>
  Math.abs(e.grid_row - d.grid_row) <= 1 && Math.abs(e.grid_col - d.grid_col) <= 1))
```
`errorHot` requires **at least 2 mis-taps** and at least **60% of the busiest error cell**. Adjacency is Chebyshev distance ≤ 1 — the same 8-neighbourhood definition `analytics-metrics.md` §3.3 uses for correction adjacency. Note that `dead` excludes masked cells (`!c.masked`), and Chebyshev ≤ 1 includes the cell itself: an unmasked cell with `taps === 0` and `mistaps >= Math.max(2, maxMis * 0.6)` is therefore **its own reach suspect**. That is intended — a button only ever pressed in error is the reach signature in its purest form.

**Resize banner** — when `grid.resizedInWindow`, an alert-bordered paragraph: *"The grid was resized inside this window. Cell positions before and after mean different buttons, so these two maps are not comparable across that date."* This is the UI form of `mcp-api.md`'s `GRID_RESIZED_MID_WINDOW`.

**The two grids**, always rendered as a pair:

| | Title | Caption | Hue | RGB base |
|---|---|---|---|---|
| left | Where she presses | Successful presses per cell | `accent` | `47, 95, 208` |
| right | Where presses go wrong | Pressed, then undone within 1.5 s | `alert` | `179, 38, 30` |

The "1.5 s" in the caption is `MISTAP_MS = 1500` from `analytics-metrics.md` §5 B1, hardcoded as prose here rather than read from config.

Each `Grid` builds `byPos = Map<'{row}:{col}', cell>` and renders `grid_rows × grid_cols` square divs via CSS grid (`gridTemplateColumns: repeat({grid_cols}, minmax(0, 1fr))`). Per cell: `alpha = Math.min(0.92, v / max)`; background `rgba({base}, {alpha})` when `v > 0`, else `--color-surface-sunk`; label text switches to white above `alpha > 0.55`; a masked cell renders `—` instead of its label; the value is printed only when `v > 0`; the `title` attribute is `{label ?? 'empty'} — {v}`. Footer: `{grid_rows}×{grid_cols} · <Pill>{board_name}</Pill>`.

**Reach-suspect callout** — warn-bordered, headed *"Read the two maps together"*, with count-aware prose (*"One cell has"* / *"{n} cells have"* no successful presses at all, with errors clustered right beside it/them — *"That pattern usually means she is reaching for those buttons and missing — not that she does not know the words."*) and two buttons:

- **"Mask the cells beside the errors"**
- **"Add a copy somewhere easier to reach"**

> **Stub:** neither button has an `onClick`. They render and do nothing. The intended write path is the MCP `propose_board_change` tool, whose `change_kind` enum accepts only `add · add_copy · mask · unmask` — `move`, `resize` and `remove` are excluded at the schema level.

Closing note under the buttons: *"Resizing the grid and moving a learned button are not offered — both would relocate buttons she has already learned."*

## Dependencies & Connections

### Depends On
- [Access control](../auth/role-consent-scoping.md) — `currentViewer`, `requireChild`, `canSee(child, 'partner_speech')`
- [Metric readers](../analytics/metric-readers.md) — `cellHeat`, `readMetric`, `formatValue`
- [Dashboard shell](dashboard-shell.md) — `Panel`, `EmptyState`, `Pill`, `StudentTabs`, `ConsentLock`
- [Database schema](../database/schema.md) — `boards` (`kind = 'robust'`), `board_cells`, `agg_cell_heat`, `board_revisions` (`change_kind = 'resize'`), `agg_daily_metric`

### Depended On By
- [Dashboard shell](dashboard-shell.md) — `StudentTabs` links here as `Reach & errors`
- [Progress reports](progress-reports.md) — the `cell_heat` report card renders the same board data through `GridHeat`, and the `correction_adjacent_rate` card reuses the same 60/35 thresholds

### Shared Resources
- `agg_cell_heat` — the only two consumers are this page and the `cell_heat` report card
- The 0.60 / 0.35 adjacency cut-offs, duplicated in `app/dashboard/student/[id]/access/page.tsx` and `lib/report.ts`
- The `partner_speech` consent tier, shared with [access control](../auth/role-consent-scoping.md)

### Change Risks
- **Changing the 0.60 / 0.35 cut-offs in one place only** makes the Access page and the Progress report disagree about whether the same child's corrections are motor or semantic — with opposite interventions attached.
- **Rendering only one heat map** re-creates the exact failure the pair exists to prevent: a cold cell in a totals table looks like an unknown word whether or not it is ringed by errors.
- **Merging modes into `cellHeat`** would violate C4 and make one coordinate mean two buttons; `cellHeat` currently pins to the first `kind = 'robust'` board by `created_at`.
- **Dropping the `resizedInWindow` banner** removes the only warning that the two maps span two different layouts — the same failure `mcp-api.md` calls `GRID_RESIZED_MID_WINDOW` critical.
- **Adding a "make the grid smaller" or "move this card" affordance** to the reach-suspect callout contradicts `forbidden_actions` (`resize_grid`, `move_card`) and constraint C2; the MCP layer would reject the equivalent proposal, so the UI would be offering something the system cannot execute.
- **Hiding the timing panel when `partner_speech` consent is absent** (rather than showing `ConsentLock`) removes the child's own timing numbers too — `composition_time` and `time_to_first_tap` sit above the gate deliberately.
- **The "1.5 s" caption is a literal string.** Raising `MISTAP_MS` (e.g. to 2500 for athetoid CP, as §5 B1 suggests) would leave this caption wrong.
