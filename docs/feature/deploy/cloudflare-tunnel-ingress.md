# Cloudflare Tunnel Ingress

## Function
Publishes the single local Next.js origin on three public hostnames — `aac.kason.app`,
`aac-dashboard.kason.app` and `aac-mcp.kason.app` — through one named Cloudflare Tunnel (`aac`),
supervised by the launchd job `app.kason.aac.tunnel`.

## Purpose
Three audiences with very different risk profiles (a nonspeaking child, a teacher/SLT, and an
analysis model) need three separate origins, but the data layer cannot be split: both databases
are SQLite in **WAL mode**, and as the config's header says, *"One Next.js process serves all
three because both databases are SQLite in WAL mode, and a WAL writer and its readers must share
a filesystem."*

So the tunnel does the publishing and `middleware.ts` does the separating, *"using the Host header
that cloudflared passes through"*. A tunnel also means **no inbound ports** on the machine — the
same property `docs/TECH_STACK.md` relies on for the analysis device, which "connects outbound to
the MCP server over HTTPS with an analyst-role token, so it needs no inbound ports and can sit on
any network."

## Source Files
| File | Role |
|------|------|
| `deploy/aac.yml` | Tunnel identity, credentials path, and the ordered ingress rules |
| `deploy/app.kason.aac.tunnel.plist` | launchd job that runs `cloudflared` with an explicit `--config` |

## Implementation

### `deploy/aac.yml`
```yaml
tunnel: aac
credentials-file: /Users/kasonzhan/.cloudflared/f50f1ef0-ea82-4ec2-953b-93404512a766.json
```

Ingress rules, **evaluated in order**:
| # | Hostname | Service | Notes from the config's own comments |
|---|---|---|---|
| 1 | `aac.kason.app` | `http://localhost:3000` | The communication board. **No Access policy** — *"a child cannot complete an email one-time-code, and a login between someone and their voice is the wrong trade. It holds one child's own vocabulary and nothing about anyone else."* |
| 2 | `aac-dashboard.kason.app` | `http://localhost:3000` | Teacher and SLT analytics. |
| 3 | `aac-mcp.kason.app` | `http://localhost:3000` | MCP analytics tools. *"Guarded by a bearer token checked in the route itself (`AAC_MCP_TOKEN`), so this hostname is never open even without Access."* |
| 4 | *(catch-all)* | `http_status:404` | *"Anything else that resolves here."* |

All three hostnames resolve to the **same** origin and the same process. There is no
port-per-surface split.

### Always pass `--config`
The header carries a specific warning: *"Always run with an explicit `--config`. A
`~/.cloudflared/config.yml`, if one is ever created, overrides the tunnel named on the command
line without saying so."*

Documented invocation:
```bash
cloudflared tunnel --config deploy/aac.yml run aac
```

### `deploy/app.kason.aac.tunnel.plist`
| Key | Value |
|---|---|
| `Label` | `app.kason.aac.tunnel` |
| `ProgramArguments` | `/opt/homebrew/bin/cloudflared`, `tunnel`, `--config`, `/Users/kasonzhan/Documents/AI-Hackathon-AAC/deploy/aac.yml`, `run`, `aac` |
| `WorkingDirectory` | `/Users/kasonzhan/Documents/AI-Hackathon-AAC` |
| `RunAtLoad` | `true` |
| `KeepAlive` | `true` |
| `ThrottleInterval` | `10` |
| `StandardOutPath` | `/Users/kasonzhan/Documents/AI-Hackathon-AAC/deploy/logs/tunnel.log` |
| `StandardErrorPath` | `/Users/kasonzhan/Documents/AI-Hackathon-AAC/deploy/logs/tunnel.err.log` |

The `--config` flag is baked into `ProgramArguments`, which is how the "always pass `--config`"
rule is actually enforced at run time. `cloudflared` is referenced by absolute Homebrew path
(`/opt/homebrew/bin/cloudflared`) because launchd supplies no useful `PATH` — the same problem
`deploy/run-web.sh` solves for the web job.

`deploy/*.plist` and `deploy/logs/` are both gitignored; `deploy/aac.yml` is not.

### Where the hostname split is actually enforced
`middleware.ts` maps the `Host` header to a `Surface` (`'kid' | 'dashboard' | 'mcp' | 'any'`):

| Host prefix | Surface | Allowed paths |
|---|---|---|
| `aac-dashboard.` | `dashboard` | `/`, plus `/dashboard`, `/login`, `/api/dashboard`, `/api/auth`, `/api/chat`, `/api/reports` |
| `aac-mcp.` | `mcp` | `/api/mcp` only — shared assets are explicitly excluded (`SHARED.includes(pathname)` returns `surface !== 'mcp'`) |
| `aac.` | `kid` | `/`, plus `/who`, `/api/session`, `/api/events`, `/api/cards`, `/api/visuals`, `/api/categories` |
| anything else (localhost, LAN, previews) | `any` | everything — *"so development is unchanged"* |

Shared assets allowed on both browser surfaces: `/manifest.webmanifest`, `/icon.svg`, `/sw.js`,
`/favicon.ico`, `/robots.txt`.

A path that does not belong to its hostname returns a bare **404**, not a redirect, because *"a
redirect confirms the route exists somewhere, which is a small thing to give away for nothing."*
On the dashboard hostname, `/` is **rewritten** to `/dashboard` (rewrite, not redirect, so the
URL stays `https://aac-dashboard.kason.app/`), and dashboard responses carry
`X-Robots-Tag: noindex, nofollow, noarchive, nosnippet` — the comment notes a robots file alone
cannot stop a crawler retaining children's names and profiles.

Because host mapping is prefix-based (`h.startsWith('aac-dashboard.')` etc. after lowercasing and
stripping the port), the tunnel hostnames and the middleware prefixes are a **coupled contract**.

## Dependencies & Connections

### Depends On
- [Production Web Service](production-web-service.md) — every ingress rule targets `http://localhost:3000`, the port that job binds; with the web job down, `cloudflared` reports the origin unreachable.
- [Host Routing](../auth/host-surface-routing.md) — `middleware.ts` turns three hostnames on one origin into three isolated surfaces.
- [MCP HTTP Endpoint](../mcp/stdio-server.md) — `aac-mcp.kason.app` is only safe because `app/api/mcp/route.ts` checks `AAC_MCP_TOKEN` and refuses everything when it is unset.

### Depended On By
- [Kid Board](../kid-app/communication-board.md) — reachable at `aac.kason.app`, deliberately without any login.
- [Dashboard Shell](../dashboard/dashboard-shell.md) — reachable at `aac-dashboard.kason.app`, root rewritten to `/dashboard`.
- [MCP Server](../mcp/stdio-server.md) — the analysis device connects outbound to `aac-mcp.kason.app`.

### Shared Resources
- **Port 3000 on localhost** — the single origin behind all three hostnames.
- **The `Host` header** — the only signal distinguishing the three surfaces; `cloudflared` passes it through unchanged.
- **`AAC_MCP_TOKEN`** — set by `deploy/app.kason.aac.web.plist` (and overridable from `.env.local`), read by `app/api/mcp/route.ts`. The tunnel itself does not check it.
- **`deploy/logs/`** — shared log directory with the web job.

## Change Risks
- **Renaming a hostname without updating `middleware.ts`.** `surfaceFor()` matches the prefixes `aac-dashboard.`, `aac-mcp.` and `aac.` in that order. A new host that matches none of them falls through to `'any'`, which allows **every** path — so `aac2.kason.app/dashboard` would serve the whole class's analytics to whoever has the link. This is a silent, fail-open failure.
- **Prefix-ordering mistakes.** `aac-dashboard.` and `aac-mcp.` must be tested before `aac.`; note that `startsWith('aac.')` does not match `aac-dashboard.`, so the current set is safe, but any new `aac.`-prefixed host inherits the kid surface's no-login posture.
- **Adding a Cloudflare Access policy to `aac.kason.app`.** This is an explicit clinical/product decision, not an oversight: a child cannot complete an email one-time code, so an Access policy would put a login between a nonspeaking child and their voice.
- **Removing the `http_status:404` catch-all.** Any other hostname routed to this tunnel would reach the origin, arrive as surface `'any'` in `middleware.ts`, and bypass the entire host split.
- **Pointing a rule at a different port or a second process.** Two Next processes over the same WAL databases breaks the single-writer assumption behind `lib/sqlite.ts` and `tools/concurrency_test.py`.
- **Dropping `--config` from `ProgramArguments`.** A stray `~/.cloudflared/config.yml` would then silently take over and route the tunnel somewhere else — the exact scenario the config header warns about.
- **Moving or rotating the credentials file.** `credentials-file` is an absolute path; if the tunnel UUID `f50f1ef0-ea82-4ec2-953b-93404512a766` changes, `cloudflared` fails at startup and `KeepAlive` retries it every 10 seconds with the only evidence in `deploy/logs/tunnel.err.log`.
- **Leaving `AAC_MCP_TOKEN` unset in production.** `aac-mcp.kason.app` has no Access policy, so the route's own refusal is the only barrier; it fails closed, but a *weak or leaked* token fails open to the analytics of every child on the roster.
