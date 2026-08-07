# Dashboard Shell & Primitives

## Function
The `/dashboard` route-group chrome — header, four-item nav, analysis-freshness indicator, viewer identity, footer disclaimer — plus the shared presentation primitives (`Panel`, `Bar`, `EmptyState`, `NotCollected`, `Pill`, `Sparkline`) and the status chrome (`AnalysisFreshness`, `ConsentLock`, `BaselineBanner`, `StudentTabs`) every dashboard page composes from.

## Purpose
Two problems, both stated in the source headers.

**Staleness must be visible.** Analysis runs in batch on a separate device (`TECH_STACK.md`: Gemma 3 4B on dedicated hardware, nightly SQL rules), so "stale" is a *normal operating state*, not an error. `AnalysisFreshness` is rendered on every dashboard page unconditionally — a dashboard that only mentions freshness when something is wrong teaches people not to look for it, and a silently stale insight panel is worse than an empty one.

**One error boundary per audience.** `app/error.tsx` is written for a child holding a tablet: it says "The board stopped working" and renders six words that speak through the Web Speech API with no application state behind them. Before `app/dashboard/error.tsx` existed, that fallback caught dashboard failures too, and a teacher signing in was shown an AAC board. The header comment generalises the lesson: *a boundary written for one audience will happily catch another's errors; any app with two distinct audiences needs one per segment.*

The primitives exist to make clinical constraints structural rather than editorial. `Bar` defaults to `tone="neutral"` so a bar only becomes coloured when the caller has a catalogue polarity to justify it (constraint C1 — a neutral metric must never be styled as a warning). `NotCollected` exists because "this is not collected yet" and "this is zero" are different statements, and rendering an uninstrumented metric as 0% is lying quietly.

## Source Files
| File | Role |
|------|------|
| `app/dashboard/layout.tsx` | Server-component shell: header, nav, freshness, viewer identity, footer |
| `app/dashboard/error.tsx` | Dashboard error boundary — signed-out / not-authorised / generic |
| `app/error.tsx` | Root error boundary — the six-word speaking fallback for the child |
| `components/status.tsx` | `AnalysisFreshness`, `ConsentLock`, `BaselineBanner`, `StudentTabs` |
| `components/ui.tsx` | `Panel`, `Bar`, `EmptyState`, `NotCollected`, `Pill`, `Sparkline` |

## Implementation

### Layout (`app/dashboard/layout.tsx`)
Async server component. Calls `currentViewer()` (throws `NOT_SIGNED_IN`, caught by the boundary below) and `analysisFreshness()`.

- Brand link → `/dashboard`, text `AAC · communication analytics`
- Nav, in order: **AAC users** → `/dashboard`, **Sessions** → `/dashboard/sessions`, **Reports** → `/dashboard/reports`, **Ask** → `/dashboard/ask`
- `<AnalysisFreshness lastRun ageHours rollupThrough={rollupThrough()} />`
- Right-aligned: `{viewer.display_name} · {viewer.role}`
- `<main>` and header are both `max-w-6xl px-6`; main is `py-8`
- Footer, always: *"Findings are hypotheses with their evidence attached, never diagnoses. Thresholds are starting values tuned per child, not clinical cut-offs."*

### `AnalysisFreshness`
| Input | Source |
|---|---|
| `lastRun`, `ageHours` | `analysisFreshness()` — `MAX(fired_at) FROM fired_rules` |
| `rollupThrough` | `rollupThrough()` — `MAX(day_local) FROM agg_daily_metric` |

- `lastRun === null` → `<Pill tone="warn">analysis has never run</Pill>` and nothing else
- **`stale = ageHours > 36`**
- Wording: `ageHours < 24` → `` `${Math.max(1, Math.round(ageHours))} h ago` ``; otherwise `` `${Math.round(ageHours / 24)} days ago` ``
- Pill tone `warn` when stale, `good` otherwise; label `analysis {when}` when stale, `analysed {when}` when fresh
- `rollupThrough` renders as `figures complete through {YYYY-MM-DD}`
- When stale, appends `· findings below may not reflect the last two days`

### `ConsentLock`
Props: `child: ChildSummary`, `tier: ConsentTier`, `title`, `youCanSee`. Renders a locked panel (🔒 + `title`), the prose from `lockReason(child, tier)`, then a two-row `<dl>`: **You can see** → the `youCanSee` string, **You cannot see** → `what {firstName} actually said`.

A gated panel is shown *locked rather than hidden*: hiding it makes people ask for access they do not need; showing the boundary usually ends the conversation. Currently used by [Reach & Errors](reach-and-errors.md) for the `partner_speech` tier.

### `BaselineBanner`
Props: `name`, `activeDays`, `targetDays`, `progress` (0–1), `reason`. Heading *"Still learning what is normal for {name}"*, body *"The numbers below are real. Nothing will be flagged yet — thresholds tuned to a different child would be worse than no thresholds at all."*, then a progress bar at `width: ${Math.round(progress * 100)}%` and the caption `reason ?? '{activeDays} of {targetDays} active days'`.

### `StudentTabs`
Five tabs, in render order. `active` matches on `key`; the active tab gets `bg-[var(--color-accent)] text-white`.

| key | href | label |
|---|---|---|
| `report` | `/dashboard/student/{childId}/report` | Progress |
| `overview` | `/dashboard/student/{childId}` | Overview |
| `access` | `/dashboard/student/{childId}/access` | Reach & errors |
| `ai-impact` | `/dashboard/student/{childId}/ai-impact` | AI impact |
| `ask` | `/dashboard/student/{childId}/ask` | Ask |

There is no tab for `/dashboard/sessions` or `/dashboard/reports` — those are class-level and live in the header nav.

### `components/ui.tsx` primitives
- **`Panel({ title, subtitle, right, children, className })`** — bordered section; header rendered only when `title || right`.
- **`Bar({ value, max, tone = 'neutral' })`** — `pct = max > 0 ? Math.max(2, Math.round(value / max * 100)) : 0`. The 2% floor keeps a non-zero value visible. Tones map to `--color-neutral | accent | good | warn | alert`.
- **`EmptyState({ title, children, tone = 'quiet' })`** — dashed border; `tone="good"` switches to `--color-good` border on `--color-good-soft`.
- **`NotCollected({ what, why })`** — renders *"{what} is not being recorded yet"*, the `why`, and the fixed footnote *"Shown as unavailable rather than zero — a zero here would read as 'this never happens'."*
- **`Pill({ tone = 'neutral', children })`** — tones `neutral | good | warn | alert | accent`.
- **`Sparkline({ points, height = 36 })`** — returns `null` for fewer than 2 points; `max = Math.max(...points, 0.0001)`; viewBox `0 0 100 {height}`, `preserveAspectRatio="none"`, stroke `--color-accent`, `vectorEffect="non-scaling-stroke"`.

### `app/dashboard/error.tsx` (client component)
Classifies the thrown error by string match:

```ts
const signedOut     = error.message.includes('NOT_SIGNED_IN')
const notAuthorised = error.message.startsWith('NOT_AUTHORISED')
```

| Case | Heading | Body | Primary action |
|---|---|---|---|
| `signedOut` | You need to sign in | Your session has expired or was never started. | **Sign in** → `/login` |
| `notAuthorised` | That child is not on your roster | You can only see children shared with your account… | **Try again** → `reset()` |
| otherwise | Something went wrong | The dashboard failed to load this page. Nothing was changed, and no data was lost. | **Try again** → `reset()` |

A secondary **Back to the dashboard** link → `/dashboard` is always present. The `<details>` block containing `error.message` and `error.digest` renders only in the generic case — a signed-out or unauthorised user is shown no stack detail. `console.error('Dashboard error:', error)` runs in a `useEffect` and carries an eslint-disable comment: *the only place a runtime failure surfaces*.

### `app/error.tsx` (client component, root boundary)
Constant `FALLBACK`, six entries, rendered as `minHeight: 88` buttons in a 2-column (3 at `sm`) grid:

| label | spoken text |
|---|---|
| `help` | I need help. |
| `stop` | Stop. |
| `yes` | Yes. |
| `no` | No. |
| `toilet` | I need the toilet. |
| `hurt` | It hurts. |

`say(text)` guards on `typeof window === 'undefined' || !('speechSynthesis' in window)`, then `window.speechSynthesis.cancel()` followed by `speak(new SpeechSynthesisUtterance(text))`. No store, no fetch, no application state — the point is that these still work when everything else has thrown. Below them, **Try the board again** calls `reset()`, and the same `<details>` diagnostics block is shown.

### Design tokens consumed
`--color-ink`, `--color-ink-muted`, `--color-ink-faint`, `--color-line`, `--color-surface`, `--color-surface-sunk`, `--color-accent`, `--color-accent-soft`, `--color-neutral`, `--color-neutral-soft`, `--color-good(-soft)`, `--color-warn(-soft)`, `--color-alert(-soft)`, `--radius-card`.

## Dependencies & Connections

### Depends On
- [Access control](../auth/role-consent-scoping.md) — `currentViewer()`, `ChildSummary`, `ConsentTier`, `lockReason()`
- [Attention queue](attention-queue.md) — `analysisFreshness()` and `rollupThrough()` are exported from `lib/queue.ts`
- [Insight rules](../analytics/fired-rules-and-evidence.md) — freshness reads `fired_rules.fired_at`
- [Database schema](../database/schema.md) — `fired_rules`, `agg_daily_metric`

### Depended On By
- [Attention queue](attention-queue.md) — `Panel`, `EmptyState`, `Pill`
- [Student overview & AI impact](student-overview.md) — `Panel`, `Bar`, `Sparkline`, `EmptyState`, `NotCollected`, `StudentTabs`, `BaselineBanner`
- [Reach & errors](reach-and-errors.md) — `Panel`, `EmptyState`, `Pill`, `StudentTabs`, `ConsentLock`
- [Sittings (Sessions)](sittings.md) — `Panel`, `EmptyState`
- [Progress reports](progress-reports.md) — `Panel`, `EmptyState`, `StudentTabs`
- [Ask panel](ask-panel.md) — `Panel`, `EmptyState`
- [Insight cards](insight-cards.md) — `Pill`, `EmptyState`

### Shared Resources
- `fired_rules.fired_at` (freshness) and `agg_daily_metric.day_local` (rollup completeness)
- The CSS custom-property palette listed above
- Next.js error-boundary segment convention: `app/error.tsx` catches anything below it that no nested boundary claims

## Change Risks
- **Deleting or renaming `app/dashboard/error.tsx`** re-introduces the exact bug its header documents: dashboard exceptions fall through to `app/error.tsx` and a teacher is shown six AAC buttons. This is a silent regression — nothing fails, the wrong UI simply appears.
- **The error classification is string matching on `error.message`.** Renaming the `NOT_SIGNED_IN` or `NOT_AUTHORISED` throw sites in `lib/access.ts` silently degrades every one of those cases to "Something went wrong" *and* starts exposing `error.message` in the `<details>` block to users who should not see it.
- **Adding a nav item** without adding the route produces a dead link; the header nav is a hardcoded list, not derived from the filesystem.
- **Raising or lowering the 36-hour `stale` threshold** changes what every page claims about its own data. Below the nightly cron interval, every page would permanently read "stale".
- **Giving `Bar` a non-neutral default tone** would colour every unaudited bar in the product, breaking constraint C1's guarantee that neutral metrics (`repeat_tap_rate`) are never styled as warnings.
- **Replacing `NotCollected` with a zero** on the [AI impact](student-overview.md) page turns "we do not log this yet" into "the AI never helps" — a different and false claim.
- **Adding a sixth `StudentTabs` entry** requires the page to exist; every student page passes its own `active` key, so a typo there silently renders all tabs inactive.

> **2026-08-08:** The rail carries a theme toggle (black default / white /
> warm). `.dash` alone stays the approved dark; `[data-theme=white|warm] .dash`
> re-token it. The toggle takes `unsetAs="black"` so its label matches the
> fixed-dark default before any choice is stored.
