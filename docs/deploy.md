# Deploying behind a Cloudflare Tunnel

Three hostnames, one machine, one Next.js process.

| Hostname | Serves | Protected by |
|---|---|---|
| `aac.kason.app` | the communication board | nothing — deliberately |
| `aac-dashboard.kason.app` | teacher / SLT analytics | username + password, signed session cookie |
| `aac-mcp.kason.app` | MCP analytics tools | bearer token (`AAC_MCP_TOKEN`) |

## Why one process

Both databases are SQLite in WAL mode, and a WAL writer and its readers must share a
filesystem. Splitting these across machines means replacing SQLite first. So all three
hostnames point at `localhost:3000` and the split happens in `middleware.ts`, using the
`Host` header that `cloudflared` passes through.

```
  aac.*            aac-dashboard.*      aac-mcp.*
      \                  |                  /
       \                 |                 /
        +----------- cloudflared ---------+        outbound only, no open ports
                         |
                  next start :3000
                         |
                  middleware.ts           reads Host, 404s anything that
                         |                does not belong to that hostname
              +----------+----------+
              |                     |
          aac.db (WAL)         aac_app.db
       analytics, rebuilt      accounts, card edits,
       by tools/build.sh       passcodes — NEVER rebuilt
```

The split matters operationally: `tools/build.sh` deletes and recreates `aac.db`.
Accounts live in `aac_app.db` precisely so a reseed does not sign everyone out.

## First-time setup

```bash
# 1. Create the tunnel and point the three names at it
cloudflared tunnel create aac
cloudflared tunnel route dns aac aac.kason.app
cloudflared tunnel route dns aac aac-dashboard.kason.app
cloudflared tunnel route dns aac aac-mcp.kason.app

# 2. Put the credentials path into the config
#    `tunnel create` prints it, e.g. ~/.cloudflared/<uuid>.json
sed -i '' "s|CREDENTIALS_FILE_PATH|$HOME/.cloudflared/<uuid>.json|" deploy/aac.yml

# 3. Build
npm run build:web

# 4. Install both services
cp deploy/app.kason.aac.web.plist    ~/Library/LaunchAgents/
cp deploy/app.kason.aac.tunnel.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/app.kason.aac.web.plist
launchctl load ~/Library/LaunchAgents/app.kason.aac.tunnel.plist

# 5. Create the first account
#    /login shows a setup form while `adult_credentials` is empty, and closes it
#    permanently once a row exists. Pick which row in `adults` the account is for.
open https://aac-dashboard.kason.app/login
```

Adding a second account later is deliberately not self-service — setup is closed once the
first exists. Insert the row directly:

```bash
node -e "
const { randomBytes, scryptSync } = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')
const salt = randomBytes(16)
const hash = salt.toString('hex') + ':' + scryptSync(process.argv[1], salt, 64).toString('hex')
new DatabaseSync('aac_app.db').prepare(
  'INSERT INTO adult_credentials (adult_id, username, password_hash, created_at) VALUES (?,?,?,?)'
).run(process.argv[2], process.argv[3], hash, Date.now())
" '<password>' '<adult_id>' '<username>'
```

There is deliberately **no** `~/.cloudflared/config.yml`. When one exists, `cloudflared`
reads the tunnel name from it and silently ignores the one given on the command line —
which is how three `route dns` calls once pointed these hostnames at an unrelated tunnel.
Always pass `--config deploy/aac.yml`.

## Adding a route

`middleware.ts` 404s anything that does not belong to the requesting hostname, so a new
route is invisible in production until its prefix is listed:

```ts
const KID_PREFIXES  = ['/who', '/api/session', '/api/events', …]
const DASH_PREFIXES = ['/dashboard', '/login', '/api/dashboard', '/api/auth',
                       '/api/chat', '/api/reports']
const PUBLIC_DASH   = ['/login', '/api/auth']   // reachable without a session
```

This has bitten twice. `/api/reports` worked perfectly on localhost — where `surfaceFor()`
returns `any` — and would have 404'd on the real hostname. **Test with a `Host` header, not
against localhost**, or the surface logic never runs.

`/login` sits OUTSIDE `/dashboard` deliberately. It used to be `/dashboard/login`, which
rendered it inside `app/dashboard/layout.tsx` — and that layout calls `currentViewer()`,
which throws when there is no session. The one page a signed-out visitor could reach was
the one page guaranteed to crash, and the root error boundary then showed them the AAC
board's child-facing fallback: *"The board stopped working."* Anything public must live
outside a layout that requires a session.

## Checking it works

```bash
# Host routing — each name should reach only its own surface
for h in aac aac-dashboard aac-mcp; do
  for p in / /login /dashboard /api/reports /api/mcp; do
    printf "%-12s %-12s %s\n" "$h" "$p" \
      "$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $h.kason.app" localhost:3000$p)"
  done
done
```

Expected:

| | `/` | `/login` | `/dashboard` | `/api/reports` | `/api/mcp` |
|---|---|---|---|---|---|
| `aac` | 307 | 404 | 404 | 404 | 404 |
| `aac-dashboard` | 307 | **200** | 307 | **405** | 404 |
| `aac-mcp` | 404 | 404 | 404 | 404 | **200** |

`405` is correct for `/api/reports` — the route exists and only accepts POST. A `404`
there means the prefix is missing from `DASH_PREFIXES`. The `307`s are the redirect to
`/login` when there is no session cookie.

```bash
# MCP over HTTP
curl -s -X POST https://aac-mcp.kason.app/api/mcp \
  -H "Authorization: Bearer $AAC_MCP_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools | length'
# -> 20
```

## Day to day

```bash
launchctl kickstart -k gui/$(id -u)/app.kason.aac.web      # restart after a deploy
tail -f deploy/logs/web.log deploy/logs/tunnel.log
launchctl unload ~/Library/LaunchAgents/app.kason.aac.*.plist   # take it all down
```

A code change needs `npm run build:web` and then a `kickstart` — `next start` serves a
build, it does not watch files.

## Environment

`.env.local`, never committed:

| Variable | Purpose |
|---|---|
| `AAC_MCP_TOKEN` | Bearer token for `/api/mcp`. **With this unset the route refuses everything** — forgetting to configure it fails closed rather than open. |
| `AAC_SESSION_SECRET` | HMAC key for the session cookie. **No default** — a predictable key lets anyone mint a session, so an unset value fails at startup rather than falling back to something guessable. |
| `AAC_VIEWER` | **Development only.** Which row in `adults` to treat as signed in when there is no session. Ignored entirely when `NODE_ENV=production`, so it cannot become a way past the login. Its main effect now is that auth cannot be meaningfully tested with `next dev`. |
| `AAC_DB` | Path to `aac.db`. Defaults to the working directory. |
| `AAC_APP_DB` | Path to `aac_app.db` (card customisations, passcodes). |

Rotate the MCP token with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## The MCP server has two transports

`mcp/server.ts` speaks JSON-RPC over **stdio** and is what Claude Desktop uses. A tunnel
forwards HTTP to a port, and stdio has no port, so `app/api/mcp/route.ts` is the same
protocol over **POST**.

Both import the tool implementations from `mcp/tools.ts` unchanged, so the two transports
expose an identical surface. The stdio server is untouched and still works locally.

Client config for the HTTP transport:

```json
{
  "mcpServers": {
    "aac-analytics": {
      "url": "https://aac-mcp.kason.app/api/mcp",
      "headers": { "Authorization": "Bearer <AAC_MCP_TOKEN>" }
    }
  }
}
```

## Authentication

Username and password, added after the first version of this document said there was none.

| | |
|---|---|
| Passwords | scrypt, per-user salt, stored as `salt:derived` hex in `aac_app.db` |
| Comparison | `timingSafeEqual` — a wrong guess cannot be narrowed by timing |
| Session | HMAC-signed cookie `aac_adult`, key from `AAC_SESSION_SECRET` |
| Enforcement | `middleware.ts` — presence of the cookie; `lib/auth.ts` — its signature |
| Scoping | `lib/access.ts` `requireChild()` — an adult only ever reaches their roster |

Middleware checks only that a cookie is *present*, because it runs on the Edge runtime and
cannot open SQLite. The signature is verified server-side on every page. That is the right
split: the cheap check keeps unauthenticated traffic off the app, and the real check
happens where the key lives.

A new route under `/dashboard` is protected the moment it exists rather than when someone
remembers to add a check — which is why anything public has to be listed in `PUBLIC_DASH`
explicitly.

### What this does not do

- **No rate limiting on `/api/auth`.** Nothing slows down repeated guesses. scrypt makes
  each attempt expensive, which is not the same thing.
- **No session expiry, no revocation list.** Signing out clears the cookie in that browser;
  a copied cookie stays valid until the signing key changes.
- **No password reset.** Losing one means editing `aac_app.db`.
- **Auth cannot be tested with `next dev`,** because `AAC_VIEWER` fills in outside
  production. Verify the signed-out paths against `next build && next start`.

## Before this stops being a demo

Three things are knowingly deferred. Recording them so the decision is deliberate rather
than forgotten.

**The dashboard is behind a password, not behind an identity provider.** Anyone holding a
username and password reads named children, their disability profiles and their
communication records. That is a real improvement on the earlier state — where the link
alone was enough — but it is one shared secret per adult with no expiry and no audit of
who looked at what. It is acceptable while the seeded data is fictional, generated by
`tools/seed/personas.py`. It stops being acceptable the moment a real child's events land
in that database.

Mitigation in place: `middleware.ts` sets `X-Robots-Tag: noindex, nofollow, noarchive` on
every dashboard response, and `public/robots.txt` disallows `/dashboard` and `/api`. That
blocks nobody who has credentials. It only prevents search engines archiving the pages
somewhere that outlives the demo, which is the part that cannot be undone afterwards.

The upgrade, when it is time — about five minutes and free:

1. Cloudflare Zero Trust → Access → Applications → Add
2. Application domain `aac-dashboard.kason.app`
3. Policy: allow, `emails` = the specific adults
4. In `lib/access.ts`, prefer the `Cf-Access-Authenticated-User-Email` header over the
   local session. The header is signed by Cloudflare and cannot be forged from outside,
   it expires on its own, and it can be revoked for one person without touching anyone
   else. The password login stays as the fallback for local use.

Deliberately no Access on `aac.kason.app`: a child cannot complete an email one-time-code,
and a login between someone and their voice is the wrong trade. That surface holds one
child's own vocabulary and nothing about anyone else.

**The MCP token is fixed and shared.** One value, no rotation, no per-caller identity, no
revocation short of changing it everywhere. It is compared in constant time so a wrong
guess cannot be narrowed by timing, and the route fails closed when unset — but it is a
shared secret, not authentication. Cloudflare Access **service tokens** are the upgrade:
per-client credentials, revocable individually, verified at the edge before a request
reaches this machine.

**One machine, no backup.** `aac.db` is regenerable from `tools/build.sh`. `aac_app.db` is
not — it holds the accounts, the card customisations and the passcodes, and nothing copies
it anywhere. A disk failure loses it.
