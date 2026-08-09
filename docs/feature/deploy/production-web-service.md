# Production Web Service (launchd)

## Function
Runs the single Next.js production server on `localhost:3000` as a macOS launchd job:
`app.kason.aac.web` invokes `deploy/run-web.sh`, which fixes the environment, sources
`.env.local`, refuses to start without a production build, and `exec`s
`node node_modules/next/dist/bin/next start --port 3000`.

## Purpose
Everything the project serves — the kid board, the dashboard and the MCP HTTP surface — comes
out of **one** Next.js process, because both SQLite databases run in WAL mode and, as
`deploy/aac.yml` puts it, *"a WAL writer and its readers must share a filesystem."*

The wrapper script exists because of a concrete failure, recorded in its own header: *"launchd
gives a job a minimal environment and no shell. Invoking node directly from the plist produced a
process that started but never bound a port, with empty logs."* The plist records a second
failure with the same symptom: invoking `npm run start` instead of node directly, because *"npm
adds a shell wrapper that launchd cannot signal cleanly, and a failure inside it produced a
running-but-idle job with empty logs."* Both fixes are load-bearing, not stylistic.

## Source Files
| File | Role |
|------|------|
| `deploy/run-web.sh` | Wrapper: working directory, `PATH`, `NODE_ENV`, `.env.local` sourcing, build guard, `exec next start` |
| `deploy/app.kason.aac.web.plist` | launchd job definition: program, env, restart policy, log paths |

## Implementation

### `deploy/run-web.sh`, in execution order
1. `set -euo pipefail` — any failing step aborts the job rather than leaving an idle process.
2. `cd "$(dirname "$0")/.."` — the repo root, regardless of how the script was invoked. `lib/db.ts` resolves its default database path from `process.cwd()`, so this is what makes `aac.db` findable.
3. `export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"`
4. `export NODE_ENV=production`
5. **Source secrets** — if `.env.local` exists:
   ```bash
   if [ -f .env.local ]; then
     set -a; . ./.env.local; set +a
   fi
   ```
   `set -a` exports every variable the file defines. The header's stated reason: *"Secrets live in .env.local, which is gitignored. `next start` does not read it."*
6. **Build guard** — if `.next/BUILD_ID` is missing:
   ```
   [run-web] No production build. Run: npx next build
   ```
   written to stderr, `exit 1`. Stated reason: *"`next start` serves a build; without one it exits immediately and the tunnel reports the origin as unreachable. Fail loudly instead."*
7. Log the start line: `[run-web] starting next on :3000 (build $(cat .next/BUILD_ID))`
8. `exec node node_modules/next/dist/bin/next start --port 3000` — `exec` replaces the shell so launchd's PID is Node's PID and signals reach the server directly.

Note the message in step 6 says **`npx next build`**, not `npm run build`: `npm run build` runs
`tools/build.sh`, which deletes and rebuilds `aac.db`. See [Package Manifest and npm Scripts](npm-scripts.md).

### `deploy/app.kason.aac.web.plist`
| Key | Value |
|---|---|
| `Label` | `app.kason.aac.web` |
| `ProgramArguments` | `["/Users/kasonzhan/Documents/AI-Hackathon-AAC/deploy/run-web.sh"]` |
| `WorkingDirectory` | `/Users/kasonzhan/Documents/AI-Hackathon-AAC` |
| `RunAtLoad` | `true` |
| `KeepAlive` | `true` |
| `ThrottleInterval` | `10` (seconds — comment: *"A restart loop should not spin."*) |
| `StandardOutPath` | `/Users/kasonzhan/Documents/AI-Hackathon-AAC/deploy/logs/web.log` |
| `StandardErrorPath` | `/Users/kasonzhan/Documents/AI-Hackathon-AAC/deploy/logs/web.err.log` |

`EnvironmentVariables`:
| Variable | Value |
|---|---|
| `PATH` | `/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin` |
| `NODE_ENV` | `production` |
| `AAC_MCP_TOKEN` | *(a 43-character bearer token, in plaintext — value intentionally not reproduced here; read it from the plist)* |
| `AAC_VIEWER` | `adult_patel` |

`AAC_MCP_TOKEN` is the bearer token checked in `app/api/mcp/route.ts` (`const expected =
process.env.AAC_MCP_TOKEN`); with none set *"the route refuses everything rather than running"*.
`AAC_VIEWER` selects the demo viewer — `.env.example` documents `adult_patel` (teacher) and
`adult_parent_maya` as the options, and notes *"The demo has no login. This picks the viewer so
every page still runs through the real roster-scoping path."*

Both `PATH` and `NODE_ENV` are set **twice** (plist and script), so running
`./deploy/run-web.sh` by hand behaves identically to the launchd job.

### Environment precedence (order matters)
1. launchd applies `EnvironmentVariables` from the plist.
2. `run-web.sh` then sources `.env.local` with `set -a`.

**`.env.local` therefore wins.** If `.env.local` defines `AAC_VIEWER`, `AAC_MCP_TOKEN`, `AAC_DB`,
`CHAT_PROVIDER`, `CHAT_MODEL`, `OPENAI_API_KEY` or `GEMINI_API_KEY`, its values override the
plist's. Per `.env.example`, `AAC_DB` defaults to `./aac.db` and keys must **never** be prefixed
`NEXT_PUBLIC_`.

### Operating it
```bash
launchctl load   ~/Library/LaunchAgents/app.kason.aac.web.plist   # RunAtLoad starts it
launchctl unload ~/Library/LaunchAgents/app.kason.aac.web.plist
npx next build                                                    # required before start
tail -f deploy/logs/web.log deploy/logs/web.err.log
```

`deploy/logs/` and `deploy/*.plist` are both listed in `.gitignore` — the plist because it
contains `AAC_MCP_TOKEN` in plaintext, the logs because they are runtime output.

### Why `next start`, not `next dev`
Plist comment: *"`next start`, not `next dev`. Dev mode recompiles on every request and leaks
memory over days; it is not something to leave running."* `package.json` still provides
`npm run dev` for local work.

## Dependencies & Connections

### Depends On
- [Package Manifest and npm Scripts](npm-scripts.md) — supplies `node_modules/next/dist/bin/next` and the `engines.node >= 24` floor the `node:sqlite` data layer needs.
- [Next.js Build Configuration](next-build-config.md) — `next build` produces the `.next/BUILD_ID` this script gates on.
- [Build Pipeline](../pipeline/build-pipeline.md) — `aac.db` must exist in the working directory before any dashboard page can render.

### Depended On By
- [Cloudflare Tunnel Ingress](cloudflare-tunnel-ingress.md) — all three ingress rules point at `http://localhost:3000`, the port hardcoded here.
- [Host Routing](../auth/host-surface-routing.md) — `middleware.ts` runs inside this process and is what separates the three hostnames.
- [MCP stdio Server](../mcp/stdio-server.md) — `/api/mcp` authenticates against `AAC_MCP_TOKEN`, injected here.
- [Dashboard Shell](../dashboard/dashboard-shell.md) — `AAC_VIEWER` selects which adult the demo renders as.

### Shared Resources
- **Port 3000** — shared contract with the three `service: http://localhost:3000` entries in `deploy/aac.yml`.
- **`.env.local`** — sourced here, gitignored, the only place API keys exist.
- **`aac.db`, `aac.db-wal`, `aac.db-shm`, `aac_app.db*`** — opened by this process via `lib/sqlite.ts`, which re-`stat`s each file's inode per call because `tools/build.sh` replaces `aac.db` wholesale.
- **`deploy/logs/web.log`, `deploy/logs/web.err.log`** — the only observability the job has.

## Change Risks
- **Changing `--port 3000`.** All three `deploy/aac.yml` ingress rules break simultaneously; the tunnel reports the origin unreachable for the kid board, the dashboard and MCP at once.
- **Running `npm run build` when you meant `npx next build`.** `aac.db` is deleted and reseeded. Every dismissal, card override and ingested event is gone, while the web server keeps serving — `lib/sqlite.ts` will notice the inode change and reopen, so there is no crash to warn you.
- **Dropping the `.next/BUILD_ID` guard.** `next start` exits immediately, `KeepAlive` restarts it every 10 seconds forever, and the only symptom outside the logs is a tunnel-level "origin unreachable".
- **Removing `exec` from the final line.** launchd then supervises the shell, not Node; `launchctl unload` signals the wrapper and can leave an orphaned server holding port 3000, so the next start fails to bind.
- **Reverting to `npm run start` in `ProgramArguments`.** Reintroduces the documented failure: a running-but-idle job with empty logs.
- **Committing `deploy/app.kason.aac.web.plist`.** It carries `AAC_MCP_TOKEN` in plaintext; that token is the *only* thing guarding `aac-mcp.kason.app`, which has no Cloudflare Access policy. If it leaks, rotate it in both the plist and `.env.local`.
- **Running a second copy of the app against the same database.** Two writers on `aac_app.db` in WAL mode across processes is exactly the scenario `tools/concurrency_test.py` exists to check; the single-process design is intentional.
- **Assuming the plist's `EnvironmentVariables` are authoritative.** `.env.local` is sourced afterwards and silently overrides them — a stale `AAC_VIEWER` there will make the dashboard render as the wrong adult no matter what the plist says.

### Host: macmini2 (cutover 2026-08-09)

All four hostnames are served from **macmini2** (`macmini2.local`, user
`kasonzhan_md_test`), not the laptop. What differs from the original host, and
why — each of these was a failure before it was a setting:

| Concern | On macmini2 |
|---|---|
| Install root | **`~/aac`, not `~/Documents`.** launchd-spawned processes are blocked by TCC from reading *or writing* anything under `~/Documents`: jobs bootstrapped fine, then never ran and produced no logs at all. Nothing about the app requires Documents. |
| Toolchain | No Homebrew and no admin rights, so everything is a userland tarball in `~/.local`: Node 26.5.0, `cloudflared`, Google Cloud SDK, plus a standalone **Python 3.12** (`~/.local/opt/python312`) because gcloud rejects the system's Python 3.9. |
| `run-web.sh` | PATH is `$HOME/.local/bin` first, and it exports `CLOUDSDK_PYTHON` — without it `gcloud auth print-access-token` fails and every Vertex call dies. |
| Starting jobs | `RunAtLoad` did **not** start them on bootstrap (`runs = 0`, never exited). `launchctl kickstart -p gui/$UID/<label>` starts them; they then behave normally, including `KeepAlive` restarts. |
| Credentials | `~/.cloudflared/f50f1ef0…json` (same tunnel, so the connector is interchangeable) and a copy of `~/.config/gcloud` — which is why no interactive `gcloud auth login` was needed. |

`deploy/aac.yml`'s `credentials-file` and all three plists carry macmini2's home
path. Run **one connector at a time**: two connectors on one tunnel makes
Cloudflare load-balance between them, so half the requests would hit whichever
machine, each with its own database.
