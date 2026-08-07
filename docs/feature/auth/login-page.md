# Login Page and First-Run Setup

## Function
The `/login` route: a server component that decides whether any adult account exists yet, and a
client form that either signs an adult in or — while zero accounts exist — claims the first
account against a chosen row in the `adults` roster.

## Purpose
This is the only page a signed-out visitor to the dashboard hostname can reach, and it is
deliberately outside the `/dashboard` route group. `app/dashboard/layout.tsx` no longer calls
`currentViewer()` — the signed-out throw now comes from the pages themselves: every
`/dashboard` page calls `currentViewer()`, and `DashHeader` (`app/dashboard/header.tsx`),
which the class view, settings and student pages render for the shared header row, calls it
too and throws `NOT_SIGNED_IN` with no session (see
[Host and surface routing](host-surface-routing.md)).

The setup branch solves the bootstrap problem: `db/schema.sql` seeds the `adults` roster, but
credentials live in a separate `adult_credentials` table in `aac_app.db` that starts empty.
Rather than shipping a seeded password, the first visitor claims an account. The form's own
header comment: *"While no account exists at all this becomes a setup form instead. That window
is open only until the first account is claimed, after which the setup branch is refused
server-side and never returns."* The page says so out loud, in a warning banner.

## Source Files
| File | Role |
|------|------|
| `app/login/page.tsx` | Server component: calls `accountCount()`, loads the `adults` roster when setup is open, renders `<LoginForm>` |
| `components/login-form.tsx` | Client component: the form itself, both modes, validation, `POST /api/auth`, error display, navigation on success |

## Implementation

### `app/login/page.tsx`

```ts
export const dynamic = 'force-dynamic'
```

Forced dynamic so `accountCount()` is re-evaluated per request — a statically cached "setup is
open" page would keep offering the setup branch after the first account was claimed.

1. `const setupOpen = accountCount() === 0` — from `lib/auth`, counts rows in
   `adult_credentials`.
2. When `setupOpen`, loads the roster:
   `SELECT adult_id, display_name, role FROM adults ORDER BY display_name` via `all()` from
   `lib/db` (typed `{ adult_id: string; display_name: string; role: string }`). When setup is
   closed the array is `[]`, so no adult names are ever sent to a signed-out visitor.
3. Returns `<LoginForm setupOpen={setupOpen} adults={adults} />`.

### `components/login-form.tsx` — state

`'use client'`. `type Adult = { adult_id: string; display_name: string; role: string }`.

| State | Initial value |
|---|---|
| `username` | `''` |
| `password` | `''` |
| `confirm` | `''` |
| `adultId` | `adults[0]?.adult_id ?? ''` |
| `error` | `null` |
| `busy` | `false` |

### Submit flow, in order

1. `e.preventDefault()`, `setError(null)`
2. Setup mode only: `password !== confirm` → `setError('The two passwords do not match')` and
   return without a request.
3. `setBusy(true)`
4. `fetch('/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: … })`
   - setup mode body: `{ username, password, adultId, setup: true }`
   - normal mode body: `{ username, password }`
5. `const data = await res.json() as { ok?: boolean; error?: string }`
6. `!res.ok || !data.ok` → `setError(data.error ?? 'Could not sign in')` and return
7. Success → `router.push('/dashboard')` then `router.refresh()`
8. `catch` → `setError('Could not reach the server')`
9. `finally` → `setBusy(false)`

The redirect target is hard-coded `/dashboard`; there is no return-path handling, matching
`middleware.ts` which clears `url.search` when it redirects to `/login`.

### `POST /api/auth` responses this form renders

Handled by `app/api/auth/route.ts` (see [Auth endpoint](../api/sign-in-endpoints.md)); the messages
below are what land in the red error box:

| Condition | Status | `error` string |
|---|---|---|
| Body is not JSON | 400 | `Body must be JSON` |
| Missing username or password | 400 | `Username and password are required` |
| `setup: true` but an account already exists | 409 | `Setup is closed — an account already exists` |
| `setup: true` with no `adultId` | 400 | `Choose which person this account is for` |
| `createAccount` threw | 400 | `No adult '<id>' in the roster` / `Username must be at least 3 characters` / `Password must be at least 8 characters` |
| Bad credentials | 401 | `Those details do not match` |
| Success | 200 | — (`{ ok: true }`, `Set-Cookie: aac_adult=…`) |

The 401 message is deliberately identical for an unknown username and a wrong password: *"Saying
which was wrong tells an attacker which usernames exist."*

### UI elements

| Element | Setup mode | Sign-in mode |
|---|---|---|
| `<h1>` | `Set up the dashboard` | `Sign in` |
| Subtitle | `No account exists yet. Create the first one — after this, sign-in is required.` | `The dashboard shows children’s communication records.` |
| `<select>` labelled **This account is for** | shown, options rendered as `{display_name} — {role}` | hidden |
| Select helper text | `Which children you can see is decided by the roster, not by this account.` | — |
| `<input>` **Username** | `autoComplete="username"`, `autoCapitalize="none"`, `required` | same |
| `<input type="password">` **Password** | `autoComplete="new-password"`, `required`, `minLength={8}`, helper `At least 8 characters.` | `autoComplete="current-password"`, `required`, no `minLength` |
| `<input type="password">` **Password again** | shown, `autoComplete="new-password"`, `required` | hidden |
| Error box | `bg-[var(--color-alert-soft)]` / `text-[var(--color-alert)]` | same |
| Submit `<button>` | `Working…` while `busy`, else `Create account and sign in` | `Working…` / `Sign in` |
| Warning banner | `This page is reachable by anyone until the first account is created. Claim it now.` (left border `--color-warn`, `bg-[var(--color-warn-soft)]`) | hidden |

The submit button is `disabled={busy}` with `disabled:opacity-50`.

The select helper text is load-bearing copy, not decoration: the account chosen here only sets
*which* `adult_id` the session carries. What that adult can see comes entirely from the `roster`
and `consent` tables — see [Role and consent scoping](role-consent-scoping.md).

### Layout

`<main className="dash flex min-h-[100dvh] flex-col justify-center p-6">` wraps an inner card
`<div className="mx-auto w-full max-w-md rounded-[var(--radius-card)] border
border-[var(--color-line)] bg-[var(--color-surface)] p-6">` — a single centred column capped
at `max-w-md`, `100dvh` tall so the form is vertically centred on a phone with browser
chrome. The `.dash` class on `<main>` scopes the dashboard's fixed dark theme tokens onto
this page: as the component's own comment puts it, the page belongs to the dashboard surface
even though it renders outside its layout, so it picks up the same palette and the shared
`--radius-card` corner radius rather than the kid app's adaptive theme. All colours come from
CSS custom properties (`--color-ink-muted`, `--color-line`, `--color-surface`,
`--color-accent`, `--color-alert`, `--color-alert-soft`, `--color-warn`,
`--color-warn-soft`).

### Client-side vs server-side validation

Only two checks are client-side: the `confirm` match and the browser-native `required` /
`minLength={8}` attributes. Everything else — username length ≥ 3, password length ≥ 8, whether
the `adult_id` exists in the roster, and whether setup is still open — is re-checked in
`app/api/auth/route.ts` and `lib/auth.ts`. The route's comment explains why the setup check is
repeated: *"the page could be loaded while zero accounts exist and submitted after one was
created. Once any account exists this branch is dead forever."*

### Reachability

`/login` is in both `DASH_PREFIXES` and `PUBLIC_DASH` in `middleware.ts`. On the `aac.` (kid)
hostname it returns **404**; on `aac-dashboard.` it returns **200** with no session; on
localhost (`surface === 'any'`) it is always reachable.

## Dependencies & Connections

### Depends On
- [Adult sign-in](adult-sign-in.md) — `accountCount()` drives the setup/sign-in branch; the
  endpoint the form posts to calls `authenticate`, `createAccount` and `signIn`.
- [Query layer](../database/connection-layer.md) — `all()` from `lib/db` for the roster select.
- [Database schema](../database/schema.md) — the `adults` table supplies the select options.
- [Auth endpoint](../api/sign-in-endpoints.md) — `POST /api/auth`, the only network call this form
  makes.
- [Host and surface routing](host-surface-routing.md) — makes `/login` reachable without a
  session, and is what redirects here in the first place.

### Depended On By
- [Host and surface routing](host-surface-routing.md) — redirects cookie-less `/dashboard/*`
  and the dashboard-hostname root here.
- [Dashboard error boundary](../dashboard/dashboard-shell.md) — the "You need to sign in" card in
  `app/dashboard/error.tsx` links to `/login`.
- [Adult sign-in](adult-sign-in.md) — `app/dashboard/user-chip.tsx` lands here after sign-out:
  `DELETE /api/auth`, then `router.push('/login')`.

### Shared Resources
- `/api/auth` — shared with the `DELETE` sign-out handler (called by
  `app/dashboard/user-chip.tsx`) and the `GET` setup probe.
- The `adults` table — the same rows that `currentViewer()` resolves against.
- Theme CSS custom properties shared with the rest of the dashboard shell.

## Change Risks
- **Removing `export const dynamic = 'force-dynamic'`** lets Next.js cache the page. A cached
  `setupOpen === true` render would keep showing the setup form (and the full list of adult names
  and roles) to anyone after the first account was claimed. The `409` from the route would still
  block the account creation, so this is an information-disclosure risk rather than a takeover
  one — but the roster leak is the point.
- **Loading `adults` unconditionally** (dropping the `setupOpen ?` guard) sends every adult's
  display name and role to any signed-out visitor of `/login`. Today the array is `[]` once setup
  closes.
- **Relaxing `minLength={8}`** in the form changes nothing server-side — `createAccount` still
  throws `Password must be at least 8 characters` — but the failure moves from an inline browser
  hint to a red server error box.
- **Changing `router.push('/dashboard')`** to a `window.location` assignment would skip
  `router.refresh()`, which is what forces the server components to re-render with the new
  session cookie; without it the dashboard can render from a stale, signed-out RSC payload.
- **Renaming the `setup` flag or `adultId` field** in the request body silently breaks the
  first-run path: the route falls through to `authenticate()`, which returns `null` for a
  username with no credential row, and the visitor sees `Those details do not match` on a
  database that has no accounts at all — an unrecoverable state without shell access.
- **Adding `/login` back under `/dashboard`** breaks it entirely; see
  [Host and surface routing](host-surface-routing.md).
- **There is no rate limiting on this form.** Each attempt costs one scrypt derivation
  server-side, which bounds throughput — but nothing counts failures and nothing locks an
  account out.
