# Dashboard Redesign (Dark Report Layout)

> **Status: being built in parallel this wave (team-plan W4) — this doc is written from the plan and the approved mockup, not from source. Verify against the shipped code after integration, then remove this banner.**

## Function
Restyles the teacher/SLT dashboard to the approved dark report mockup: a dark, print-adjacent report layout across the `/dashboard` surfaces, rendered from the existing report infrastructure in `lib/report.ts` — a visual redesign, not a data-layer change.

## Purpose
The generated design mockup was approved as the spec (team-plan W4: "the generated design is the spec; the report infrastructure it needs already exists"). The redesign lands on top of `lib/report.ts` because that module already reads the dimensional tables correctly — building the new layout against it, rather than against ad-hoc queries, was what resolved metric gaps N1/N2 before the fan-out.

## Source Files (planned — dashboard agent's boundary)
| File | Role |
|------|------|
| `app/dashboard/**` | The redesigned pages. |
| `components/metric-card.tsx` | Metric display primitive. |
| `components/charts.tsx` | Chart primitives. |
| `components/status.tsx`, `components/ui.tsx` | Shell/status primitives. |
| `app/globals.css` | An **appended scoped block only** — the kid board's tokens are untouched. |
| `lib/report.ts` | Read-only data source (lead-owned; the redesign consumes it, does not edit it). |

## Design constraints (non-negotiable, inherited from `docs/aac-clinical-constraints.md`)
The redesign changes pixels, never semantics:

- Neutral-polarity metrics are never styled good/bad — `direction()` from `lib/catalog.ts` still decides colouring, the theme does not.
- Every number carries its `n`; small-`n` handling is unchanged.
- A metric with no real source renders "not recorded", never `0` — dark styling must not make the empty state look like a zero state.
- No gauges; forbidden actions stay displayed.
- The kid board is out of scope: nothing in `components/kid/**` or the board's colour tokens changes (Fitzgerald-key pastels are a learned code, not a theme).

## Dependencies & Connections
- [Progress Reports](progress-reports.md) — `lib/report.ts`, the data spine of the redesign.
- [Dashboard Shell & Primitives](dashboard-shell.md) — the chrome being restyled.
- [Student Overview & AI Impact](student-overview.md), [Attention Queue](attention-queue.md), [Reach & Errors](reach-and-errors.md), [Sittings](sittings.md) — pages that inherit the new look.
- [Data Dictionary](../analytics/data-dictionary.md) — polarity/`min_n` metadata that constrains styling.

## Change Risks
- **Styling drift into judgement**: a dark palette invites red/green accents; applying them to neutral metrics reintroduces exactly the pathologising the catalogue polarity exists to prevent.
- **Editing `app/globals.css` outside the appended scoped block** collides with the kid surface's tokens (and, this wave, with another agent's ownership).
- **Reading metrics around `lib/report.ts`** re-opens the N1/N2 aggregation bugs it fixed.
