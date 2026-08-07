# Adult Sign-In

## Function
Stores adult dashboard credentials as scrypt hashes in `aac_app.db`, verifies a
username/password pair in constant time, and issues/reads an HMAC-signed `aac_adult` session
cookie that identifies the signed-in adult for the rest of the dashboard.

## Purpose
Children never come through this path. The header comment on `lib/auth.ts` is explicit about
why: *"A typed password would exclude the person the board is for — many AAC users cannot type
— so the kid surface keeps its picture sign-in and this covers adults on the dashboard only."*
The kid surface has its own picture sign-in (see [Kid session](../kid-app/child-sign-in.md)); this
module exists purely so that a teacher, parent or SLT reaching the analytics dashboard can be
identified before any child's data is rendered.

Credentials deliberately live in `aac_app.db`, **not** `aac.db`. The `adults` table is defined
in `db/schema.sql`, which the analytics pipeline owns and rebuilds wholesale; adding a
`password_hash` column there would collide with the pipeline. So the credential row is a
side table in the app-owned database, joined by `adult_id`.

## Source Files
| File | Role |
|------|------|
| `lib/auth.ts` | Core module: credential table bootstrap, scrypt hashing, account creation, authentication, session mint/read/verify, cookie set/delete/read |
| `app/dashboard/user-chip.tsx` | The sign-out control: the header's `name · role` chip, which calls `DELETE /api/auth` |

## Implementation

### Constants and environment

| Name | Value | Notes |
|---|---|---|
| `APP_DB` | `process.env.AAC_APP_DB ?? path.join(process.cwd(), 'aac_app.db')` | Same file used by `lib/session.ts`, `lib/overrides.ts`, `lib/visuals/store.ts`, `lib/categories/store.ts`, `lib/chat/settings.ts` |
| `COOKIE` | `'aac_adult'` | Cookie name; also hard-coded as the literal `'aac_adult'` in `middleware.ts` |
| `MAX_AGE` | `60 * 60 * 12` (43200 s = 12 hours) | Used for both the cookie `maxAge` and the token expiry stamp |
| `AAC_SESSION_SECRET` | env var, **no default** | HMAC key. Missing value throws, it does not fall back |

Environment variables read: `AAC_APP_DB`, `AAC_SESSION_SECRET`. (`AAC_VIEWER` is read by
[Role and consent scoping](role-consent-scoping.md), not here.)

### Database handle and table bootstrap

`db()` caches a `node:sqlite` `DatabaseSync` on `globalThis.__aacAuth` (declared via
`declare global { var __aacAuth: DatabaseSync | undefined }`). On first open it runs:

```
PRAGMA journal_mode = WAL
PRAGMA busy_timeout = 5000
CREATE TABLE IF NOT EXISTS adult_credentials (
  adult_id      TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,      -- scrypt: salt:derived, both hex
  created_at    INTEGER NOT NULL,
  last_login    INTEGER
) STRICT
```

This module opens its own handle rather than going through `connect()` in `lib/sqlite.ts`, so
it does **not** re-check the file's inode per call. That inode check exists because
`tools/build.sh` replaces `aac.db` wholesale; `aac_app.db` is app-owned and is not rebuilt, so
the plain cached handle holds.

### Password hashing

- `hashPassword(password: string): string`
  - `salt = randomBytes(16)`
  - `derived = scryptSync(password, salt, 64)` — 64-byte key length, default scrypt cost
  - returns `` `${saltHex}:${derivedHex}` `` (both hex)
  - The header comment states the intent: *"Deliberately slow, so a stolen database cannot be
    brute-forced at speed — the cost parameter is the whole point of it."*
- `verifyPassword(password: string, stored: string): boolean`
  - splits `stored` on `':'`; returns `false` if either half is missing
  - re-derives with the stored salt and `timingSafeEqual`s the two buffers, guarded by a
    length equality check first (`timingSafeEqual` throws on unequal lengths)
  - any throw inside the `try` returns `false`

### Accounts

- `type Account = { adult_id: string; username: string }`
- `accountCount(): number` — `SELECT COUNT(*) AS n FROM adult_credentials`, coerced with
  `Number(row?.n ?? 0)`. This is the switch that opens/closes the first-run setup form; see
  [Login page and first-run setup](login-page.md).
- `createAccount(adultId, username, password): void`
  1. `SELECT adult_id FROM adults WHERE adult_id = ?` **against `aac.db`** via `one()` from
     `lib/db`. Missing → `throw new Error("No adult '<adultId>' in the roster")`.
  2. `username.trim().length < 3` → `throw new Error('Username must be at least 3 characters')`
  3. `password.length < 8` → `throw new Error('Password must be at least 8 characters')`
  4. `INSERT INTO adult_credentials (adult_id, username, password_hash, created_at) VALUES (?,?,?,?)`
     with `ON CONFLICT(adult_id) DO UPDATE SET username = excluded.username, password_hash = excluded.password_hash`
  - Username is normalised on write: `username.trim().toLowerCase()`.
  - `created_at` is `Date.now()` (ms) and is **not** refreshed by the upsert branch.
  - The conflict target is `adult_id` only. `username` carries a separate `UNIQUE` constraint,
    so reusing another adult's username raises a SQLite constraint error rather than upserting.
- `authenticate(username, password): Account | null`
  1. `SELECT adult_id, username, password_hash FROM adult_credentials WHERE username = ?` with
     `username.trim().toLowerCase()`
  2. **Unknown username still runs a hash**: `verifyPassword(password, hashPassword('decoy-so-timing-matches'))`
     then `return null`. The comment explains why: *"'no such user' and 'wrong password' take
     the same time. Without this, the response time tells an attacker which usernames exist."*
  3. Wrong password → `null`
  4. Success → `UPDATE adult_credentials SET last_login = ? WHERE adult_id = ?` with `Date.now()`,
     then returns `{ adult_id, username }`

### Session token

- `secret()` reads `process.env.AAC_SESSION_SECRET` and throws
  `'AAC_SESSION_SECRET is not set — the dashboard cannot sign sessions'` when unset. There is
  no default, on purpose: *"A predictable signing key means anyone can mint a session, so
  failing to start is the correct behaviour."*
- `sign(value)` = `createHmac('sha256', secret()).update(value).digest('base64url')`
- `mint(adultId)` produces `adultId.expiry.signature` where `expiry = Date.now() + MAX_AGE * 1000`
  and the signature covers `` `${adultId}.${expiry}` ``.
- `read(token)`:
  1. `token.split('.')` must yield exactly 3 parts, else `null`
  2. recompute expected signature; if `sig.length !== expected.length` → `null`
  3. `timingSafeEqual(Buffer.from(sig), Buffer.from(expected))` must pass, else `null`
  4. `Number(expiry) < Date.now()` → `null`
  5. returns `adultId`

### Cookie

`isHttps()` reads the request headers and returns
`h.get('x-forwarded-proto')?.split(',')[0].trim() === 'https'`. The header comment records a
real bug this fixed:

> Keyed on the request's actual protocol, not on `NODE_ENV`. Behind the Cloudflare tunnel the
> browser speaks HTTPS but the origin hop is plain HTTP, so `x-forwarded-proto` is the only
> honest signal. Keying on `NODE_ENV` instead set `Secure` on every production response, and
> the cookie was then never sent back over the local HTTP connection — a session that could be
> created and never used.

- `signIn(adultId)` — `cookies().set('aac_adult', mint(adultId), { httpOnly: true, sameSite: 'lax', secure: await isHttps(), path: '/', maxAge: 43200 })`
- `signOut()` — `cookies().delete('aac_adult')`
- `currentAdultId()` — reads the cookie value; absent → `null`; otherwise `read(token)` inside a
  `try/catch` whose `catch` returns `null`, so a missing `AAC_SESSION_SECRET` renders as
  "signed out" rather than crashing the page.

### Callers

`app/api/auth/route.ts` is the only route that calls `authenticate`, `signIn`, `signOut`,
`accountCount` and `createAccount`:

- `POST /api/auth` with `{ username, password }` → `authenticate` → `signIn` → `{ ok: true }`,
  or `401 { error: 'Those details do not match' }` (one message for both failure modes).
- `POST /api/auth` with `{ username, password, adultId, setup: true }` → re-checks
  `accountCount() > 0` (→ `409 { error: 'Setup is closed — an account already exists' }`),
  then `createAccount` → `signIn` → `{ ok: true }`.
- `DELETE /api/auth` → `signOut()` → `{ ok: true }`. The caller is
  `app/dashboard/user-chip.tsx` — the "name · role" chip `DashHeader` places in the page
  header, with `title="Sign out"` so the label-looking control says what it does. Clicking it
  sends the `DELETE`, then `router.push('/login')` + `router.refresh()` in a `finally`, so a
  failed fetch does not block the redirect — the server-side cookie check stays the authority
  either way.
- `GET /api/auth` → `{ setupOpen: false }` once any account exists, otherwise
  `{ setupOpen: true, adults }`.

## Dependencies & Connections

### Depends On
- [Database schema](../database/schema.md) — `createAccount` validates `adult_id` against the
  `adults` table in `aac.db`; `adult_credentials` in `aac_app.db` is keyed to it.
- [Query layer](../database/connection-layer.md) — imports `one` from `lib/db` for the roster check.
- Next.js `next/headers` (`cookies`, `headers`) — Node runtime only. This module cannot run on
  the Edge runtime, which is exactly why `middleware.ts` does a presence-only cookie check.

### Depended On By
- [Role and consent scoping](role-consent-scoping.md) — `currentViewer()` calls
  `currentAdultId()` as the first and authoritative source of viewer identity.
- [Login page and first-run setup](login-page.md) — `app/login/page.tsx` calls
  `accountCount()` server-side to decide whether to render the setup branch.
- [Auth endpoint](../api/sign-in-endpoints.md) — `app/api/auth/route.ts` wraps every exported
  function except `hashPassword`/`verifyPassword`.
- [Host and surface routing](host-surface-routing.md) — `middleware.ts` tests for the
  presence of the `aac_adult` cookie this module sets.
- [Dashboard shell](../dashboard/dashboard-shell.md) — `DashHeader` renders the `UserChip`
  (`app/dashboard/user-chip.tsx`), whose sign-out calls `DELETE /api/auth` and returns the
  browser to `/login`.

### Shared Resources
- `aac_app.db` — shared with `lib/session.ts`, `lib/overrides.ts`, `lib/visuals/store.ts`,
  `lib/categories/store.ts` and `lib/chat/settings.ts` (`ai_settings` — provider selection and
  API keys, write-only), each of which opens its own handle to the same file. WAL plus a
  5000 ms busy timeout is what keeps the concurrent writers from colliding. Note the file now
  holds credentials for two different things: hashed adult passwords in `adult_credentials`
  and provider API keys in `ai_settings`.
- Cookie name `aac_adult` — the string is duplicated in `middleware.ts` (twice) rather than
  imported, because middleware runs on the Edge runtime and cannot import this module.
- `AAC_SESSION_SECRET` — see the environment table in [deploy](../deploy/production-web-service.md).

## Change Risks
- **Renaming `COOKIE`** silently breaks `middleware.ts`, which hard-codes `'aac_adult'` in the
  root rewrite branch and in the `needsSession` guard. The dashboard would redirect to `/login`
  in a loop: the cookie is set under the new name, middleware never finds it.
- **Rotating `AAC_SESSION_SECRET`** invalidates every live token instantly — `read()` fails the
  signature check, `currentAdultId()` returns `null`, and every dashboard page throws
  `NOT_SIGNED_IN` from `currentViewer()`. Users see `app/dashboard/error.tsx`'s "You need to
  sign in" card. That is the intended behaviour, but it is a fleet-wide logout.
- **An `adult_id` containing a `.`** breaks `read()`, which requires `token.split('.')` to yield
  exactly 3 parts. Current ids (`adult_patel`) are safe; a future id scheme using dots would
  make every session unreadable while still minting successfully.
- **Changing the scrypt key length (64) or the `salt:derived` hex format** invalidates every
  stored `password_hash`. `verifyPassword` returns `false` for all of them and, because
  `accountCount()` is still > 0, the first-run setup branch stays closed — leaving no path back
  in short of deleting rows from `adult_credentials`.
- **Dropping the decoy hash in `authenticate`** reintroduces a username-enumeration oracle: the
  unknown-user path would return in microseconds while the known-user path pays the full scrypt
  cost.
- **Reverting `isHttps()` to a `NODE_ENV` check** reproduces the documented tunnel bug: `Secure`
  set on the cookie, browser never returns it over the plain-HTTP origin hop, sign-in appears to
  succeed and the next request is signed out.
- **Moving credentials into `aac.db`** puts them in the file `tools/build.sh` rebuilds from
  scratch — every account would be destroyed on the next pipeline run. See
  [Pipeline build](../pipeline/build-pipeline.md).
- **Removing the user chip or its `DELETE` call** leaves no way to end a session from the UI —
  on a shared classroom machine the session then survives the full 12 hours. The chip in the
  page header is the only sign-out control.
