# Sittings (Sessions Page)

## Function
`/dashboard/sessions` — one row per **sitting** at the device across every child on the viewer's roster, with sort and child filters, four summary stats, and a per-row fatigue reading.

## Purpose
From both file headers, the same argument: **a bad DAY is very often one bad sitting.** Maya's worst sitting runs a 22% unintended-press rate against a 9% daily average; a day-level row averages that away and nobody ever sees it. Everything on the [student pages](student-overview.md) is day-grained or window-grained, so this is the only surface where a single hard stretch is visible.

**Naming.** The code says "sittings" because `lib/session.ts` already means something else — which child is holding the tablet. The UI says "sessions", because that is what a teacher calls it. Both names are load-bearing; do not unify them.

**Derivation.** Rows come from splitting the event stream on **20-minute idle gaps**, not from trusting a session id. The header is explicit that this is also how it has to work against real data, where nothing announces that a child put the tablet down. (The split itself happens upstream in the rollup; `lib/sittings.ts` reads the materialised `sessions` table.)

**Tone.** The "worst" sort is labelled **"Hardest going"** in the UI, deliberately: *a sitting where a child kept trying through a lot of missed presses is not a failure on their part.*

**Fatigue is not a layout problem.** `sittingStats` counts fatigued sittings separately from anything that looks like a layout issue, because the answer to fatigue is a break, never a board change — moving buttons a child has already learned undoes the motor pattern they built (constraints C2/C3).

## Source Files
| File | Role |
|------|------|
| `app/dashboard/sessions/page.tsx` | The page — filters, stat tiles, table, `Stat` helper |
| `lib/sittings.ts` | `sittings`, `sitting`, `sittingUtterances`, `sittingStats` and their types |

## Implementation

### Types
```ts
type Sitting = {
  session_id, child_id, display_name, day_local, started_at,
  minutes: number | null, scene: string,
  utterances, taps, mistaps, abandoned,
  mistap_rate: number | null,     // ROUND(mistaps / NULLIF(taps,0), 3)
  fatigue_ratio: number | null,   // mis-tap rate in the last third ÷ the first third
}
type SittingFilter = { childId?, days?, order?: 'recent' | 'worst' | 'longest', limit? }
```
`fatigue_ratio` is a stored column on `sessions`; the schema comment says above ~1.5 it suggests fatigue rather than a layout problem.

### `sittings(childIds, filter)`
- Returns `[]` immediately for an empty `childIds`.
- **Scope narrowing is authorisation-safe:** `f.childId` is honoured only when `childIds.includes(f.childId)`; otherwise the query falls back to the full roster list. A forged `?child=` in the URL cannot widen access.
- Date floor: `s.day_local >= date((SELECT MAX(day_local) FROM events), '-{(days ?? 14) - 1} days')` — relative to the latest day in the event log, not to wall-clock today.
- **`AND s.taps >= 10`**, with the reason in a SQL comment: *below ~10 taps a rate is noise, and a list of one-tap sittings buries the ones worth looking at.*
- `LIMIT Math.min(f.limit ?? 40, 200)`.

| `order` | `ORDER BY` |
|---|---|
| `'worst'` | `mistap_rate DESC NULLS LAST, s.taps DESC` |
| `'longest'` | `s.minutes DESC` |
| default / `'recent'` | `s.started_at DESC` |

### `sittingStats(childIds, days = 14): SittingStats`
```sql
WITH s AS (SELECT *, CAST(mistaps AS REAL) / NULLIF(taps, 0) AS rate
           FROM sessions
           WHERE child_id IN (…) AND day_local >= date((SELECT MAX(day_local) FROM events), ?)
             AND taps >= 10)
SELECT COUNT(*) AS count,
       ROUND(AVG(minutes), 1) AS median_minutes,
       ROUND(AVG(taps))       AS median_taps,
       ROUND(MAX(rate), 3)    AS worst_rate,
       SUM(CASE WHEN fatigue_ratio >= 1.5 THEN 1 ELSE 0 END) AS fatigued
FROM s
```
> **The fields named `median_minutes` and `median_taps` are means, not medians** — the SQL computes `AVG`. The UI labels them "Typical length" and "Typical presses", which is at least not a false claim, but the type names are misleading. `worst_rate` is computed and returned but is **not rendered anywhere**.

### Unused exports
`sitting(sessionId)` and `sittingUtterances(s, limit = 40)` are exported and have no callers anywhere in the repo — there is no per-sitting detail page. `sittingUtterances` reads `utterances` between `started_at` and `started_at + minutes*60000 + 1000`, selecting **labels only, never utterance text** (`analytics-metrics.md` §11 tier 3).

### Page (`app/dashboard/sessions/page.tsx`)
`export const dynamic = 'force-dynamic'`. `searchParams`: `{ child?, order?, days? }`.

- No roster children → `EmptyState "No children shared with you"`.
- **Window whitelist:** `Number(days) === 7 ? 7 : Number(days) === 42 ? 42 : 14`. Anything else becomes 14. (Only 7 and 42 are reachable via the code path; the UI exposes no day switcher, so the parameter is URL-only today.)
- **Sort whitelist:** `ORDERS.find(o => o.key === order)?.key ?? 'recent'`.
- `rows = sittings(ids, { childId: child, days: window, order: sortKey, limit: 60 })`
- `stats = sittingStats(child ? [child] : ids, window)` — note this passes the raw `child` param without the roster check `sittings()` performs internally; a non-roster id here yields an empty stat block rather than another child's data.
- `qs(over)` merges `{ child, order, days }` with an override object and drops falsy values, producing the filter links.

**`ORDERS`**
| key | label |
|---|---|
| `recent` | Most recent |
| `worst` | Hardest going |
| `longest` | Longest |

**Stat tiles** (4-up): **Sittings** (`stats.count`, sub `last {window} days`), **Typical length** (`{median_minutes} min` or `—`), **Typical presses** (`median_taps` or `—`), **Tiring sittings** (`stats.fatigued`, sub `errors rose towards the end` / `none`).

**Filter chips:** the three sort chips, then `Everyone` plus one chip per roster child. The active chip gets `border-[var(--color-accent)] bg-[var(--color-accent-soft)]`.

**Table** (`min-w-[46rem]`, horizontally scrollable), columns in order:

| Column | Content |
|---|---|
| When | `day_local` + `new Date(started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })` |
| Who | `display_name`, linked to **`/dashboard/student/{child_id}/report`** — the Progress tab, not the Overview |
| Where | `scene.replace('_', ' ')` (replaces the first underscore only — `free_play` → `free play`) |
| Length | `{Math.round(minutes)} min` or `—` |
| Said | `utterances` |
| Presses | `taps` |
| Not meant | `{mistaps} ({round(rate*100)}%)`, coloured `--color-warn` when **`rate > 0.12`** |
| Towards the end | `fatigue_ratio === null` → *too short to tell*; `>= 1.5` → *harder ({ratio}×)* in warn; else *steady* |

The `> 0.12` threshold matches `THRESHOLD.mistap` in [the attention queue](attention-queue.md).

Empty result: *"Nothing in this period with more than ten presses."*

Page footnote: *"A sitting where presses got harder towards the end usually means tiredness, and the answer is a break — not a change to the board. Moving buttons a child has already learned undoes the motor pattern they built."*

## Dependencies & Connections

### Depends On
- [Access control](../auth/role-consent-scoping.md) — `currentViewer`, `visibleChildren`; the roster list is what bounds every query
- [Dashboard shell](dashboard-shell.md) — `Panel`, `EmptyState`, and the header nav entry
- [Database schema](../database/schema.md) — `sessions` (`fatigue_ratio`, `minutes`, `taps`, `mistaps`, `abandoned`, `utterances`), `children`, `events` (for the `MAX(day_local)` anchor), `utterances` (for the unused `sittingUtterances`)
- [Rollup pipeline](../pipeline/l2-rollup.md) — materialises `sessions` rows by splitting the event stream on 20-minute idle gaps and computes `fatigue_ratio`

### Depended On By
- [Progress reports](progress-reports.md) — the Who column links into `/dashboard/student/{id}/report`

### Shared Resources
- The `sessions` table, shared with the rollup job
- The `0.12` mis-tap threshold, duplicated here and in `lib/queue.ts`
- `MAX(day_local) FROM events` as "today", shared with `lib/db.ts`'s `latestDay()`

### Change Risks
- **Renaming "sittings" to "sessions" in code** collides with `lib/session.ts` (which child holds the tablet) — the two concepts would become indistinguishable at the import site.
- **Removing `AND s.taps >= 10`** floods the list with one-tap sittings whose rates are pure noise, and changes `sittingStats` in the same breath — both the count and the "typical" figures would shift.
- **Changing the `0.12` highlight** without changing `lib/queue.ts` makes the Sessions table and the Attention Queue disagree about what a hard day looks like.
- **Widening the `f.childId` check** (dropping `childIds.includes(f.childId)`) turns the `?child=` query parameter into a way to read any child's sittings — the roster check is the only authorisation on that parameter.
- **Renaming `median_minutes` / `median_taps` to what they actually are (means)** touches `SittingStats`, the SQL and both call sites; leaving them is a documented misnomer, not a bug in output.
- **Changing `fatigue_ratio`'s 1.5 threshold** in the rollup without updating the page leaves the "Tiring sittings" tile and the "harder" badge disagreeing with the stored data.
- **`sitting()` and `sittingUtterances()` are dead code today.** Building a per-sitting detail page on them must add a `requireChild` scope check — neither function performs one, unlike `sittings()`.
