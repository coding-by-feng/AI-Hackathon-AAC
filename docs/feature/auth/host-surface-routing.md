# Host and Surface Routing

## Function
Next.js middleware that maps the request's `Host` header to one of four surfaces — `kid`,
`dashboard`, `mcp`, `slides` — 404s any path that does not belong to that surface, rewrites `/` to
`/dashboard` on the dashboard hostname and to `/architecture.html` on the slides hostname,
redirects cookie-less `/dashboard/*` requests to `/login`, and stamps
`X-Robots-Tag: noindex, nofollow, noarchive, nosnippet` on dashboard responses.

## Purpose
The kid board and the dashboard are one Next.js app on one port, published on separate
hostnames. The header comment states the stakes:

> Without this, `aac.kason.app/dashboard` would serve the whole class's analytics to a child's
> tablet, and `aac-dashboard.kason.app` would accept event ingest from anywhere.

It also explains the choice of status code: *"A path that does not belong to the hostname
returns 404 rather than a redirect: a redirect confirms the route exists somewhere, which is a
small thing to give away for nothing."*

The session gate lives here for the same reason the scoping lives in the query layer — so a new
route cannot forget: *"a new route under `/dashboard` is protected the moment it exists, rather
than when someone remembers to add a check to it."*

## Source Files
| File | Role |
|------|------|
| `middleware.ts` | Surface detection, path allow-lists, root rewrite, session redirect, noindex header, matcher config |

## Implementation

### Surface detection

```ts
type Surface = 'kid' | 'dashboard' | 'mcp' | 'slides' | 'any'
```

`surfaceFor(host)` lowercases the header and strips the port (`host.toLowerCase().split(':')[0]`),
then matches prefixes **in this order**:

| Test | Surface |
|---|---|
| `h.startsWith('aac-dashboard.')` | `'dashboard'` |
| `h.startsWith('aac-mcp.')` | `'mcp'` |
| `h.startsWith('aac-slides.')` | `'slides'` |
| `h.startsWith('aac.')` | `'kid'` |
| anything else | `'any'` |

`'any'` covers *"localhost, LAN addresses, previews: everything, so development is unchanged."*
This is why `docs/deploy.md` insists on testing with an explicit `Host` header — on localhost
the surface logic never runs, and it notes this *"has bitten twice"* (`/api/reports` worked on
localhost and would have 404'd on the real hostname).

### Path allow-lists

```ts
const SHARED = ['/manifest.webmanifest', '/icon.svg', '/sw.js', '/favicon.ico', '/robots.txt']

const SHARED_PREFIXES = ['/icons/']

const KID_PREFIXES = ['/who', '/api/session', '/api/events', '/api/cards', '/api/visuals', '/api/categories']

const DASH_PREFIXES = [
  '/dashboard', '/login',
  '/api/dashboard', '/api/auth', '/api/chat', '/api/reports',
]

const PUBLIC_DASH = ['/login', '/api/auth']
```

`allowed(surface, pathname)`:

1. `surface === 'any'` → `true` (everything)
2. `SHARED.includes(pathname)` → `surface !== 'mcp'` (both browser surfaces get the PWA assets;
   the MCP host does not)
3. `SHARED_PREFIXES` prefix match → `surface !== 'mcp'` — static image directories under
   `public/`. Added 2026-08-08: card faces load `/icons/ai/<slug>.png`, and before this rule
   every icon 404'd on the public hostnames while localhost (surface `'any'`) served them —
   the third instance of the "worked on localhost, dead on the real hostname" trap.
   `tools/test-api.sh` K1–K4 pin it with Host-header spoofing.
4. `'kid'` → `pathname === '/'` or any `KID_PREFIXES` prefix match
5. `'dashboard'` → `pathname === '/'` or any `DASH_PREFIXES` prefix match
6. `'mcp'` → `pathname.startsWith('/api/mcp')`
7. `'slides'` → `pathname === '/'` or `pathname === '/architecture.html'` — a static
   presentation page from `public/`; no data, no session.

`SHARED` uses exact equality; `SHARED_PREFIXES` / `KID_PREFIXES` / `DASH_PREFIXES` / the MCP
rule use `startsWith`.

### `PUBLIC_DASH` and why `/login` sits outside `/dashboard`

The comment above `PUBLIC_DASH` preserves the bug that shaped the route layout:

> `/login` sits OUTSIDE `/dashboard` on purpose. It used to be `/dashboard/login`, rendered
> inside the dashboard route group — whose layout then called `currentViewer()`, which throws
> `NOT_SIGNED_IN` when there is no session (that call now lives in `DashHeader`,
> `app/dashboard/header.tsx`, and in the pages themselves, not the layout). So the one page a
> signed-out visitor could reach was the one page guaranteed to crash, and the root error
> boundary showed them the AAC board's child-facing fallback.

Note that as written, `PUBLIC_DASH` never changes the outcome: `needsSession` already requires
`pathname.startsWith('/dashboard')`, and neither `/login` nor `/api/auth` starts with
`/dashboard`, so `!PUBLIC_DASH.some(...)` is always `true` when it is evaluated. The constant
documents the intent and would matter again the moment a public path is nested under
`/dashboard`.

### Request flow

`middleware()` runs, in order: the surface allow-list 404, the slides-root rewrite
(`'/'` → `/architecture.html`, unconditional — the page is public), the dashboard-root
rewrite-or-redirect, the session redirect, then the `X-Robots-Tag` stamp on the response that
passes through.

The root handling on the dashboard hostname is a **rewrite, not a redirect** when the
`aac_adult` cookie is present: *"the URL stays clean at `https://aac-dashboard.kason.app/`
instead of bouncing to `/dashboard`, and every existing `/dashboard/...` link keeps working
unchanged."* It runs before the session check so an unauthenticated visitor to the root still
lands on `/login`.

The session redirect (`needsSession` — a path starting `/dashboard` and outside
`PUBLIC_DASH`, with no `aac_adult` cookie) clears the query string (`url.search = ''`) before
redirecting — no `?next=` return path is preserved, so a signed-out deep link always lands on
the dashboard root after sign-in (`components/login-form.tsx` pushes `/dashboard`
unconditionally).

### Presence-only cookie check

Middleware tests `request.cookies.get('aac_adult')` — existence only. The comment says why:
*"The cookie's signature is verified in `lib/auth.ts`; this only asks whether one is present,
because middleware runs on the Edge runtime and cannot open SQLite."*

The consequence is a two-stage gate. A forged, tampered or expired `aac_adult` value passes
middleware, then `currentAdultId()` → `read()` fails the HMAC or expiry check and returns
`null`, `currentViewer()` throws `NOT_SIGNED_IN`, and `app/dashboard/error.tsx` renders "You need
to sign in" with a link to `/login`. Middleware is a convenience redirect; the real check is in
[Adult sign-in](adult-sign-in.md) and [Role and consent scoping](role-consent-scoping.md).

Also note what is **not** gated by the session redirect: `/api/dashboard`, `/api/chat` and
`/api/reports` are in `DASH_PREFIXES` (reachable on the dashboard hostname) but do not start
with `/dashboard`, so `needsSession` is `false` for them. Those routes enforce access
themselves by calling `currentViewer()` / `requireChild()`. The AI-settings pair splits
exactly along this line and needed no new prefix: `/dashboard/settings` **is** session-gated
through the `/dashboard` prefix, while `/api/dashboard/settings` is not — that route enforces
its own 401 (a `currentViewer()` throw) and 403 (a role outside `teacher`/`slt`/`admin`).

### `X-Robots-Tag`

Set to `noindex, nofollow, noarchive, nosnippet` when `surface === 'dashboard'` **or**
`pathname.startsWith('/dashboard')` — so it also applies on localhost and LAN hosts, where the
surface is `'any'`. The rationale comment is now partly stale: it opens *"The dashboard is
published without a login for the demo"*, which the session redirect immediately above it
contradicts. The operative part still holds: *"it only prevents children's names and profiles
being archived somewhere that outlives the demo."* `robots.txt` alone cannot do this — only a
response header stops a crawler retaining the page.

### Matcher

```ts
export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
}
```

*"Static chunks and images are exempt; they carry no data of their own and running middleware on
every one of them is wasted work."*

### Expected behaviour by hostname

From `docs/deploy.md`'s verification table (`curl -H "Host: <name>.kason.app" localhost:3000<path>`):

| Host | `/` | `/login` | `/dashboard` | `/api/reports` | `/api/mcp` |
|---|---|---|---|---|---|
| `aac` | 307 | 404 | 404 | 404 | 404 |
| `aac-dashboard` | 307 | **200** | 307 | **405** | 404 |
| `aac-mcp` | 404 | 404 | 404 | 404 | **200** |
| `aac-slides` | **200** (rewritten to `/architecture.html`) | 404 | 404 | 404 | 404 |

The `307`s are the redirect to `/login` with no session cookie. `405` on `/api/reports` is
correct — the route exists and only accepts POST; a `404` there means the prefix is missing from
`DASH_PREFIXES`.

## Dependencies & Connections

### Depends On
- [Adult sign-in](adult-sign-in.md) — for the `aac_adult` cookie's existence and its 12-hour
  `maxAge`. The name is duplicated as a literal here because Edge middleware cannot import a
  module that uses `node:sqlite` / `node:crypto`.
- [Login page and first-run setup](login-page.md) — the redirect target `/login` and its
  `POST /api/auth` companion are both listed in `DASH_PREFIXES` and `PUBLIC_DASH`.
- [Deployment and tunnel](../deploy/cloudflare-tunnel-ingress.md) — the four hostnames (`aac.`, `aac-dashboard.`,
  `aac-mcp.`, `aac-slides.`) are created by the Cloudflare tunnel config; this file is the
  server-side half of that split.

### Depended On By
- [Kid board](../kid-app/communication-board.md) and the kid API routes — reachable on `aac.` only because
  their prefixes are in `KID_PREFIXES`.
- [Dashboard shell](../dashboard/dashboard-shell.md) and every `/dashboard/*` page — the session
  redirect is their first line of defence and the reason a signed-out visitor never renders the
  pages (and their `DashHeader`) that call `currentViewer()`.
- [MCP HTTP transport](../api/mcp-http-transport.md) — `/api/mcp` is the only path reachable on the
  `aac-mcp.` hostname.
- [Event ingest](../api/event-ingest.md) — `/api/events` is kid-surface-only, so the dashboard
  hostname cannot be used to inject events.

### Shared Resources
- The literal cookie name `'aac_adult'`, duplicated from `lib/auth.ts`'s `COOKIE` constant.
- `SHARED` overlaps the PWA assets served by the kid surface (`/manifest.webmanifest`,
  `/sw.js`, `/icon.svg`).
- The prefix lists are effectively a route manifest: adding a route without adding its prefix
  makes it invisible on the production hostname while working perfectly on localhost.

## Change Risks
- **Adding a new API route and forgetting its prefix** produces the exact failure `docs/deploy.md`
  says has happened twice: 200 on localhost (`surface === 'any'`), 404 on the real hostname. This
  cannot be caught by local testing — only by a request with an explicit `Host` header.
- **Reordering `surfaceFor`'s prefix tests** matters if a future hostname shares a prefix.
  `aac-dashboard.`, `aac-mcp.` and `aac-slides.` are checked before `aac.`; a host like
  `aac-something.` falls through to `'any'` and gets **everything**, which is the permissive
  branch.
- **Moving `/login` back under `/dashboard`** re-creates the trap the `PUBLIC_DASH` comment
  records, now at the middleware layer: a `/dashboard/login` not listed in `PUBLIC_DASH` is
  session-gated by the session redirect itself, so the signed-out visitor is redirected away
  from the very page that signs them in. (The original crash came from the then-layout's
  `currentViewer()` call — a throw that now lives in `DashHeader` and the pages, not the
  layout.)
- **Trusting the presence check as authentication** is a mistake waiting to happen. Any code that
  concludes "middleware let it through, so the viewer is valid" is wrong — the cookie's signature
  is never checked here. Every data path must still call `currentViewer()` / `requireChild()`.
- **Changing the 404 to a redirect** leaks route existence across surfaces, which the header
  comment rejects explicitly.
- **Removing the `X-Robots-Tag` branch** allows children's names and profile notes to be indexed
  and archived; `robots.txt` alone does not prevent retention.
- **Widening the matcher to include `_next/static`** costs a middleware invocation per chunk with
  no security benefit; narrowing it further (e.g. excluding `/api`) would silently disable
  surface isolation for the API routes, letting the kid hostname reach `/api/reports`.
- **Adding a public page under `/dashboard`** requires adding it to `PUBLIC_DASH` — which is the
  only situation where that currently-inert constant starts doing work.
