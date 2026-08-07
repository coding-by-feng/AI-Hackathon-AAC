# Dashboard Shell & Primitives

## Function
The `/dashboard` route-group chrome: a fixed-dark `.dash` wrapper holding the slim left icon rail (**Class · Sessions · Reports · Settings**, plus the theme toggle), the per-page `DashHeader` row (title, subtitle, period chip, analysis-freshness chip, user chip), and the footer disclaimer — plus the shared presentation primitives (`Panel`, `Bar`, `EmptyState`, `NotCollected`, `Pill`, `Sparkline`) and the status chrome (`AnalysisFreshness`, `ConsentLock`, `BaselineBanner`, `StudentTabs`) dashboard pages compose from.

## Purpose
Two problems, both stated in the source headers.

**Staleness must be visible.** Analysis runs in batch on a separate device (`TECH_STACK.md`: Gemma 3 4B on dedicated hardware, nightly SQL rules), so "stale" is a *normal operating state*, not an error. The design rule in `components/status.tsx` is that `AnalysisFreshness` is shown on every page, always — a dashboard that only mentions freshness when something is wrong teaches people not to look for it, and a silently stale insight panel is worse than an empty one. **That rule is currently broken** — see the `DashHeader` section below.

**One error boundary per audience.** `app/error.tsx` is written for a child holding a tablet: it says "The board stopped working" and renders six words that speak through the Web Speech API with no application state behind them. Before `app/dashboard/error.tsx` existed, that fallback caught dashboard failures too, and a teacher signing in was shown an AAC board. The header comment generalises the lesson: *a boundary written for one audience will happily catch another's errors; any app with two distinct audiences needs one per segment.*

The primitives exist to make clinical constraints structural rather than editorial. `Bar` defaults to `tone="neutral"` so a bar only becomes coloured when the caller has a catalogue polarity to justify it (constraint C1 — a neutral metric must never be styled as a warning). `NotCollected` exists because "this is not collected yet" and "this is zero" are different statements, and rendering an uninstrumented metric as 0% is lying quietly.

## Source Files
| File | Role |
|------|------|
| `app/dashboard/layout.tsx` | The `.dash` shell: rail on the left, `max-w-[1440px]` main + footer on the right |
| `app/dashboard/rail.tsx` | `Rail` — logo mark, the four nav items, theme toggle |
| `app/dashboard/header.tsx` | `DashHeader` — per-page title row: title/subtitle/period + freshness + user chip |
| `app/dashboard/user-chip.tsx` | `UserChip` — viewer identity chip that signs out on click |
| `components/theme-toggle.tsx` | `ThemeToggle` — black → white → warm cycle; mounted in the rail with `unsetAs="black"` |
| `app/dashboard/error.tsx` | Dashboard error boundary — signed-out / not-authorised / generic |
| `app/error.tsx` | Root error boundary — the six-word speaking fallback for the child |
| `components/status.tsx` | `AnalysisFreshness`, `ConsentLock`, `BaselineBanner`, `StudentTabs` |
| `components/ui.tsx` | `Panel`, `Bar`, `EmptyState`, `NotCollected`, `Pill`, `Sparkline` |

## Implementation

### Layout (`app/dashboard/layout.tsx`)
A plain server component that resolves nothing itself: `<div className="dash flex min-h-dvh">` wrapping `<Rail />` and a `min-w-0 flex-1` column holding `<main className="mx-auto max-w-[1440px] px-6 py-6">` and the footer (same width, `pb-10`), always: *"Findings are hypotheses with their evidence attached, never diagnoses. Thresholds are starting values tuned per child, not clinical cut-offs."*

Viewer identity and freshness moved out of the layout into `DashHeader`, "because the title belongs to the page, not the shell" (layout header comment) — with the consequence flagged in the `DashHeader` section.

**The `.dash` theme scope.** `app/globals.css` carries an appended scoped block: `.dash { … }` fixes the dashboard dark regardless of OS preference; `[data-theme='white'] .dash` and `[data-theme='warm'] .dash` re-token it when the toggle has stored a choice (`black` needs no block — `.dash` already is black). The kid surface's tokens are untouched, and the board's Fitzgerald-key card colours follow no theme — they are a learned colour code.

### `Rail` (`app/dashboard/rail.tsx`, client component)
A sticky `h-dvh w-[76px]` aside reading `usePathname()`. The logo mark is a **four-cell symbol grid with one cell filled**, linking to `/dashboard`. Per the source comment, the previous speech bubble read as a messenger app, "which is the one thing an AAC board is not: the child speaks, the software just holds the words still."

`Item.href` is non-nullable and every item has a destination — an earlier version allowed `href: null` for a disabled item, which the header comment calls "a nav that lies about what exists". `ITEMS`, in render order:

| key | label | `href` | `active(path)` |
|---|---|---|---|
| `class` | Class | `/dashboard` | `p === '/dashboard'`, or starts with `/dashboard/student` or `/dashboard/ask` |
| `sessions` | Sessions | `/dashboard/sessions` | starts with `/dashboard/sessions` |
| `reports` | Reports | `/dashboard/reports` | starts with `/dashboard/reports` |
| `settings` | Settings | `/dashboard/settings` | starts with `/dashboard/settings` |

- **Class covers the roster and the per-student pages.** A separate "Children" item used to point at the same `/dashboard` href and differed only in its `active()` predicate — which read as two tabs doing the same thing — so it was removed: one destination gets one item.
- **Sessions is `/dashboard/sessions`' first link from anywhere in the app.** The page was live but reachable only by typed URL until the rail gained this item on 2026-08-08 — the orphan-route finding is resolved ([sittings.md](sittings.md)).
- **Settings** opens the AI-provider page — see [ai-settings.md](ai-settings.md).
- The active item gets `bg-[var(--color-surface)] text-[var(--color-ink)]` and `aria-current="page"`; inactive items render muted ink with a hover.
- Note `/dashboard/ask` makes Class light up but no item links *to* it — the class-level Ask page remains reachable only by URL ([attention-queue.md](attention-queue.md)).
- At the bottom (`mt-auto`): `<ThemeToggle unsetAs="black" />`. The toggle cycles black → white → warm, writes `data-theme` on `<html>` and persists to `localStorage('aac-theme')` (re-applied pre-paint by `app/layout.tsx` so a reload never flashes); `unsetAs="black"` makes its label match the dashboard's fixed-dark default before any choice is stored.

### `DashHeader` (`app/dashboard/header.tsx`)
An async server component: `DashHeader({ title, subtitle?, period? })`. It calls `currentViewer()` and `analysisFreshness()` itself "so every page gets the pill without re-plumbing it". Left: `<h1>` title (2xl semibold) with the muted subtitle beside it. Right: the `period` chip (rendered only when given), `<AnalysisFreshness lastRun ageHours rollupThrough={rollupThrough()} />`, and `<UserChip name role />`.

**Regression against the stated design rule.** `components/status.tsx` still asserts freshness "is shown on every page, always" — but `DashHeader` is mounted by exactly **three** pages: `/dashboard` (title `classesFor(children)`), `/dashboard/student/[id]`, and `/dashboard/settings`. `/dashboard/reports`, `/dashboard/reports/[id]`, `/dashboard/sessions`, `/dashboard/ask` and the student sub-tabs (`/report`, `/access`, `/ai-impact`, `/ask`) render **no freshness chip and no viewer identity at all**. Until those pages mount `DashHeader` (or the rule is consciously retired), a teacher can read the Sessions table or a report with no indication the analysis behind it is stale.

### `UserChip` (`app/dashboard/user-chip.tsx`, client component)
"{name} · {role}" beside an initial avatar. Clicking signs out: `DELETE /api/auth`, then `router.push('/login')` + `router.refresh()`; the label reads "Signing out…" while busy, and `title="Sign out"` says what the click will do — per the header comment, "a control that looks like a label should not surprise". A failed fetch still proceeds to `/login`: the server-side session-cookie check is the authority either way.

### `AnalysisFreshness`
| Input | Source |
|---|---|
| `lastRun`, `ageHours` | `analysisFreshness()` — `MAX(fired_at) FROM fired_rules` |
| `rollupThrough` | `rollupThrough()` — `MAX(day_local) FROM agg_daily_metric` |

- `lastRun === null` → a warn-toned chip reading **"analysis has never run"** and nothing else
- **`stale = ageHours > 36`**
- Wording: `ageHours < 24` → `` `${Math.max(1, Math.round(ageHours))} h ago` ``; otherwise `` `${Math.round(ageHours / 24)} days ago` ``
- Visible label: `analysed {when}` when fresh (muted ink); `analysis {when} · stale` when stale (warn ink)
- `figures complete through {YYYY-MM-DD}` and the stale hint `findings may not reflect the last two days` render in the chip's `title` tooltip, not inline

### `ConsentLock`
Props: `child: ChildSummary`, `tier: ConsentTier`, `title`, `youCanSee`. Renders a locked panel (🔒 + `title`), the prose from `lockReason(child, tier)`, then a two-row `<dl>`: **You can see** → the `youCanSee` string, **You cannot see** → `what {firstName} actually said`.

A gated panel is shown *locked rather than hidden*: hiding it makes people ask for access they do not need; showing the boundary usually ends the conversation. Currently used by [Reach & Errors](reach-and-errors.md) for the `partner_speech` tier.

### `BaselineBanner`
Props: `name`, `activeDays`, `targetDays`, `progress` (0–1), `reason`. Heading *"Still learning what is normal for {name}"*, body *"The numbers below are real. Nothing will be flagged yet — thresholds tuned to a different child would be worse than no thresholds at all."*, then a progress bar at `width: ${Math.round(progress * 100)}%` and the caption `reason ?? '{activeDays} of {targetDays} active days'`.

**Currently unmounted** — no page imports it since the student overview was rebuilt as the report page ([student-overview.md](student-overview.md)). The baseline gate itself still operates in the [attention queue](attention-queue.md)'s scoring; what disappeared is the per-child explanatory banner.

### `StudentTabs`
Five tabs, in render order. `active` matches on `key`; the active tab gets `bg-[var(--color-accent)] text-white`.

| key | href | label |
|---|---|---|
| `report` | `/dashboard/student/{childId}/report` | Progress |
| `overview` | `/dashboard/student/{childId}` | Overview |
| `access` | `/dashboard/student/{childId}/access` | Reach & errors |
| `ai-impact` | `/dashboard/student/{childId}/ai-impact` | AI impact |
| `ask` | `/dashboard/student/{childId}/ask` | Ask |

Rendered by the four student sub-tab pages (`report`, `access`, `ai-impact`, `ask`); the Overview page itself no longer mounts it, so the `overview` tab is the way back from a sub-tab. There is no tab for `/dashboard/sessions` or `/dashboard/reports` — those are class-level and live in the rail.

### `components/ui.tsx` primitives
- **`Panel({ title, subtitle, right, children, className })`** — bordered section; header rendered only when `title || right`.
- **`Bar({ value, max, tone = 'neutral' })`** — `pct = max > 0 ? Math.max(2, Math.round(value / max * 100)) : 0`. The 2% floor keeps a non-zero value visible. Tones map to `--color-neutral | accent | good | warn | alert`.
- **`EmptyState({ title, children, tone = 'quiet' })`** — dashed border; `tone="good"` switches to `--color-good` border on `--color-good-soft`.
- **`NotCollected({ what, why })`** — renders *"{what} is not being recorded yet"*, the `why`, and the fixed footnote *"Shown as unavailable rather than zero — a zero here would read as 'this never happens'."*
- **`Pill({ tone = 'neutral', children })`** — tones `neutral | good | warn | alert | accent`.
- **`Sparkline({ points, height = 36 })`** — returns `null` for fewer than 2 points; `max = Math.max(...points, 0.0001)`; viewBox `0 0 100 {height}`, `preserveAspectRatio="none"`, stroke `--color-accent`, `vectorEffect="non-scaling-stroke"`. **Currently unmounted** — its last consumer was the old overview's abandonment panel; `components/charts.tsx` mentions it only in a comment, and its `LineChart` is the same idea with an area fill.

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
- [Access control](../auth/role-consent-scoping.md) — `currentViewer()` (in `DashHeader`), `ChildSummary`, `ConsentTier`, `lockReason()`
- [Attention queue](attention-queue.md) — `analysisFreshness()`, `rollupThrough()` and `classesFor()` are exported from `lib/queue.ts`
- [Insight rules](../analytics/fired-rules-and-evidence.md) — freshness reads `fired_rules.fired_at`
- [Database schema](../database/schema.md) — `fired_rules`, `agg_daily_metric`

### Depended On By
- [Attention queue](attention-queue.md) — `DashHeader`, `Panel`, `EmptyState`, `Pill`
- [Student overview & AI impact](student-overview.md) — `DashHeader` on the overview; the AI-impact tab uses `Panel`, `Bar`, `EmptyState`, `NotCollected`, `StudentTabs`
- [Reach & errors](reach-and-errors.md) — `Panel`, `EmptyState`, `StudentTabs`, `ConsentLock` (and `Pill` inside `heat-grid.tsx`)
- [Sittings (Sessions)](sittings.md) — `Panel`, `EmptyState`, and the rail's Sessions item
- [Progress reports](progress-reports.md) — `Panel`, `EmptyState`, `StudentTabs`, and the rail's Reports item
- [Ask panel](ask-panel.md) — `Panel`, `EmptyState`, `StudentTabs`
- [Insight cards](insight-cards.md) — `Pill`, `EmptyState`
- [AI settings](ai-settings.md) — the rail's Settings item is its entry point; the settings page renders `DashHeader`

### Shared Resources
- `fired_rules.fired_at` (freshness) and `agg_daily_metric.day_local` (rollup completeness)
- The CSS custom-property palette listed above; the `.dash` scope, the `data-theme` attribute on `<html>` and `localStorage('aac-theme')` — shared with the kid surface's compact toggle mount
- Next.js error-boundary segment convention: `app/error.tsx` catches anything below it that no nested boundary claims

## Change Risks
- **Deleting or renaming `app/dashboard/error.tsx`** re-introduces the exact bug its header documents: dashboard exceptions fall through to `app/error.tsx` and a teacher is shown six AAC buttons. This is a silent regression — nothing fails, the wrong UI simply appears.
- **The error classification is string matching on `error.message`.** Renaming the `NOT_SIGNED_IN` or `NOT_AUTHORISED` throw sites in `lib/access.ts` silently degrades every one of those cases to "Something went wrong" *and* starts exposing `error.message` in the `<details>` block to users who should not see it.
- **Editing `ITEMS` in `app/dashboard/rail.tsx`** — the rail is a hardcoded list, not derived from the filesystem. An item without a route is a dead link; a route without an item is invisible chrome (exactly how `/dashboard/sessions` shipped unreachable). Two items must never share an `href` (why "Children" was removed), and a new top-level route that belongs to a student context needs Class's `active()` predicate extended, or no rail item lights while it is open.
- **`DashHeader` is opt-in per page.** A new page that forgets to mount it ships with no freshness chip and no sign-out — the current state of five routes — and nothing fails, so the regression grows silently.
- **Raising or lowering the 36-hour `stale` threshold** changes what every page claims about its own data. Below the nightly cron interval, every page would permanently read "stale".
- **Giving `Bar` a non-neutral default tone** would colour every unaudited bar in the product, breaking constraint C1's guarantee that neutral metrics (`repeat_tap_rate`) are never styled as warnings.
- **Replacing `NotCollected` with a zero** on the [AI impact](student-overview.md) page turns "we do not log this yet" into "the AI never helps" — a different and false claim.
- **Adding a sixth `StudentTabs` entry** requires the page to exist; every student page passes its own `active` key, so a typo there silently renders all tabs inactive.
