# Sign-in Endpoints

## Function
Two cookie-setting endpoints for two different people: `POST/GET/DELETE /api/auth` signs an
adult into the dashboard with a username and password, and `POST/DELETE /api/session` records
which child is holding the tablet — with a picture passcode instead of typing.

## Purpose
The two surfaces have opposite requirements, which is why they are separate endpoints rather
than one.

`/api/auth` guards named children's disability profiles and communication records, so it is a
real credential check: scrypt hashes, constant-time comparison, an HMAC-signed cookie, and a
single indistinguishable error message for both "no such user" and "wrong password".

`/api/session` is explicitly **not** a security feature (see the header of `lib/session.ts`).
It is a data-integrity fix. `?child=` in the URL meant a shared classroom iPad credited every
press to whoever last opened the tab, so three children's presses landed under one id — and the
dashboard then described a child who talks 200 times a day, whose mis-tap rate was three
children's motor abilities averaged together, and whose silence streak could never fire.
A typed password would exclude the person the board is for; many AAC users cannot type.

## Source Files
| File | Role |
|------|------|
| `app/api/auth/route.ts` | Adult sign-in, sign-out, and the one-shot first-run setup branch |
| `app/api/session/route.ts` | Child sign-in / sign-out, and the `session_start` / `session_end` events that bracket a sitting |

## Implementation

### `POST /api/auth` — sign in, or claim the first account

Body: `{ username?, password?, adultId?, setup? }`. Both routes are `dynamic = 'force-dynamic'`.

| Condition | Status | Response |
|---|---|---|
| body is not JSON | 400 | `{ "error": "Body must be JSON" }` |
| `username` or `password` missing | 400 | `{ "error": "Username and password are required" }` |
| `setup: true` **and** `accountCount() > 0` | 409 | `{ "error": "Setup is closed — an account already exists" }` |
| `setup: true` and no `adultId` | 400 | `{ "error": "Choose which person this account is for" }` |
| `setup: true`, `createAccount` throws | 400 | `{ "error": "<message>" }` (`No adult '<id>' in the roster`, `Username must be at least 3 characters`, `Password must be at least 8 characters`) |
| credentials do not match | 401 | `{ "error": "Those details do not match" }` |
| success | 200 | `{ "ok": true }` + `Set-Cookie: aac_adult` |

The 401 message is one string for both failure modes on purpose: saying which was wrong tells
an attacker which usernames exist.

The `setup` branch re-runs `accountCount()` server-side rather than trusting the page, because
the page could be loaded while zero accounts exist and submitted after one was created. Once
any account exists the branch is dead forever.

### `GET /api/auth` — first-run roster

Returns `{ setupOpen: false }` when `accountCount() > 0`. Otherwise
`{ setupOpen: true, adults: [{ adult_id, display_name, role }] }` from
`SELECT adult_id, display_name, role FROM adults ORDER BY display_name` — the list of people an
account can be claimed for. Consumed by `app/login/page.tsx` → `components/login-form.tsx`.

### `DELETE /api/auth` — sign out

Calls `signOut()` (deletes the `aac_adult` cookie) and returns `{ ok: true }`. No body, no
guard: deleting a cookie you already hold is not a privileged action.

### `POST /api/session` — a child picks their photo

Body: `{ childId?, passcode?: string[], sessionId? }`.

| Condition | Status | Response |
|---|---|---|
| body is not JSON | 400 | `{ "error": "Body must be JSON" }` |
| `childId` missing | 400 | `{ "error": "childId is required" }` |
| `childProfile(childId)` is null | 404 | `{ "error": "Unknown child '<id>'" }` |
| child has a passcode and `checkPasscode` fails | **200** | `{ "ok": false, "reason": "passcode" }` |
| success | 200 | `{ "ok": true, "child": { child_id, display_name } }` + `Set-Cookie: aac_child` |

A wrong passcode answers **200 with `ok: false`**, not 401. There is no lockout and no attempt
counter — this catches a mis-tap, it is not guarding a secret, and an error that reads as
failure to a child is worse than the mistake it catches. `components/kid/who-picker.tsx` simply
clears the attempt and asks again; it submits after 3 symbols.

On success the route writes a `session_start` event through `ingestEvents`:

```jsonc
{ event_id: crypto.randomUUID(), child_id, ts: Date.now(),
  day_local: <local YYYY-MM-DD>, tz_offset_min: -new Date().getTimezoneOffset(),
  session_id: body.sessionId ?? crypto.randomUUID(),
  scene: 'unknown', actor: 'child', type: 'session_start',
  payload: '{"via":"sign_in"}' }
```

Written here rather than in the browser because this is the moment the identity is actually
resolved — logging it client-side would record whatever the page thought before sign-in
completed. The whole `ingestEvents` call is wrapped in `try {} catch {}`: a missing audit event
must never block a child from reaching their board.

### `DELETE /api/session?child=<id>` — sign out

Reads `child` from the query string. When present, writes a `session_end` event
(`payload: '{"endReason":"normal","via":"sign_out"}'`, `actor: 'child'`, `scene: 'unknown'`)
with a **freshly generated `session_id`** — it does not correlate with the `session_id` of the
matching `session_start`. Then calls `clearCurrentChild()` and returns `{ ok: true }`.
Errors from the event write are swallowed (`/* best effort */`).

Note there is no authorisation on either verb: any caller reaching the kid hostname can sign a
child in, or write a `session_end` for any `child` id. That is consistent with the stated scope
— attribution, not access control — but it means the `session_end` stream is forgeable.

### `today()` (`app/api/session/route.ts`)

```ts
day    = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
offset = -now.getTimezoneOffset()
```

Server-local day and offset. `app/api/cards/route.ts` and `lib/visuals/ladder.ts` inline the
same two expressions.

### Cookies and constants (from the libraries these routes call)

| Name | Value | Set by |
|---|---|---|
| `aac_adult` | `<adultId>.<expiry>.<HMAC-SHA256 base64url>` | `signIn()` in `lib/auth.ts` |
| `aac_child` | the raw `child_id` | `setCurrentChild()` in `lib/session.ts` |
| `MAX_AGE` (both) | `60 * 60 * 12` seconds — a school day | `lib/auth.ts`, `lib/session.ts` |

`aac_adult` is `httpOnly`, `sameSite: 'lax'`, `path: '/'`, and `secure` only when
`x-forwarded-proto` is `https`. `aac_child` is `httpOnly`, `sameSite: 'lax'`, `path: '/'`, and
is never marked `secure`.

### Routing

`middleware.ts` puts `/api/auth` in `DASH_PREFIXES` **and** in `PUBLIC_DASH` (reachable without
a session, since it is the endpoint the login page posts to). `/api/session` is in
`KID_PREFIXES`. On the `aac-dashboard.*` hostname `/api/session` 404s, and on `aac.*`
`/api/auth` 404s.

## Dependencies & Connections

### Depends On
- [Adult authentication](../auth/adult-sign-in.md) — `authenticate`, `signIn`, `signOut`,
  `accountCount`, `createAccount`, scrypt hashing and the signed-cookie mint/read.
- [Child session](../kid-app/child-sign-in.md) — `setCurrentChild`, `clearCurrentChild`,
  `checkPasscode`, `childProfile`, and the `child_passcodes` table in `aac_app.db`.
- [Event ingest](event-ingest.md) — `ingestEvents` for `session_start` / `session_end`.
- [Database schema](../database/schema.md) — `adults` and `children` in `aac.db`.
- [Host routing middleware](../auth/host-surface-routing.md) — which hostname may reach which endpoint.

### Depended On By
- [Login form](../auth/login-page.md) — `components/login-form.tsx` posts to `/api/auth` and
  branches on `setupOpen`.
- [Who picker](../kid-app/child-sign-in.md) — `components/kid/who-picker.tsx` posts to
  `/api/session`.
- [Board app](../kid-app/communication-board.md) — `components/kid/board-app.tsx` calls
  `DELETE /api/session?child=<id>` when signing out.
- [Access scoping](../auth/role-consent-scoping.md) — every dashboard read resolves `currentViewer()`
  from the cookie this endpoint sets.

### Shared Resources
- Cookies `aac_adult` and `aac_child`.
- `aac_app.db` tables `adult_credentials` and `child_passcodes`.
- `aac.db` tables `adults`, `children`, `events`.
- Environment: `AAC_SESSION_SECRET` (required — `lib/auth.ts` throws if unset), `AAC_APP_DB`,
  `AAC_DB`, `AAC_VIEWER` (development-only fallback, ignored in production).

## Change Risks
- **Rotating `AAC_SESSION_SECRET`** invalidates every issued `aac_adult` cookie at once. There
  is no revocation list, so this is also the only way to revoke a leaked session.
- **Turning the passcode failure into a 4xx** would surface as an error state in the kid UI,
  which the `who-picker` design deliberately avoids. It would also break the
  `data.ok === false` branch in `who-picker.tsx`, which never inspects the status code.
- **Adding a real authorisation check to `/api/session`** changes the classroom-tablet flow: the
  board has no adult session, so any check must be device-level, not viewer-level.
- **Removing `/api/auth` from `PUBLIC_DASH`** locks out sign-in entirely: the login page could
  reach nothing, and `middleware.ts` would redirect to `/login` forever.
- **Making the `setup` branch trust a client flag** re-opens permanent account creation — the
  server-side `accountCount()` re-check is the only thing closing it.
- **Changing the `session_start` payload or `session_id` semantics** affects sitting
  reconstruction in [sittings](../dashboard/sittings.md); note that `session_end` already
  carries an unrelated `session_id`, so anything joining start to end on that column will
  find nothing.
