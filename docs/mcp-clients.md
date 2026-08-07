# Connecting to the MCP server

**Status:** working config, tested against `aac.db`
**Prerequisite:** `./tools/build.sh aac.db` — the server refuses to start without a database.

---

## 1. The MCP server is not the backend, and does not talk to it

This is worth stating plainly because "connect the MCP server to the BE APIs" implies a
client/server relationship that does not exist here.

```
   browser (dashboard + kid board)
        │  RSC render          │  POST /api/events
        ▼                      ▼
   Server Components ──▶ lib/*.ts ──┐
   app/api/*/route.ts               │
                                    ├──▶  aac.db   (SQLite, WAL)
   Gemma / Claude Code / Codex      │
        │  MCP stdio                │
        ▼                           │
   mcp/server.ts ──▶ mcp/tools.ts ──┘
```

Two **peer readers** of one file. Neither should call the other:

- **MCP → backend** would add an HTTP hop to reach data the server already has open, and
  there is no HTTP API to call — the dashboard is React Server Components, so its "backend"
  is a function call inside the same process.
- **Backend → MCP** would mean the dashboard pays JSON-RPC overhead to read its own database.

The one thing that must be shared *is* already shared: **the catalogue tables**.
`metrics_catalog` and `insights_catalog` hold every threshold, `min_n`, polarity and
`forbidden_actions`, and both `lib/catalog.ts` and `mcp/tools.ts` read them at runtime.
Neither hardcodes a threshold. Change `min_n` in the database and both sides pick it up on
the next query, with no code change and no possibility of disagreement.

What *is* duplicated is SQL plumbing — two functions that both write
`SELECT AVG(value) FROM agg_daily_metric WHERE …`. That is untidy but low-risk, and merging
it is not free: `tsconfig.json` deliberately excludes `mcp/`, and `lib/` uses extensionless
imports (`from './db'`) that Next's bundler resolves and plain Node ESM does not. Making
`mcp/` import `lib/` means either adding `.ts` extensions across `lib/` or adding a resolver
hook. Worth doing when it starts to hurt; not worth doing today.

### What genuinely does need building

| Gap | Why it needs an API |
|---|---|
| **`/api/cron/rules`** | rule evaluation runs as `tools/run_rules.py`. `TECH_STACK.md` wants it as a route handler so it can be triggered on a schedule by the host. |
| **Streamable HTTP transport for MCP** | the Gemma analysis device is a separate machine. stdio only works locally. |
| **Dashboard "ask" panel** | a free-text question box in the dashboard would have the *backend* act as an MCP client against a model. That is the only place the two layers legitimately meet. |

---

## 2. Claude Code

`.mcp.json` in the project root — already committed:

```json
{
  "mcpServers": {
    "aac-analytics": {
      "command": "node",
      "args": ["mcp/server.ts", "--db", "aac.db"],
      "env": {}
    }
  }
}
```

Claude Code launches it with the project root as the working directory, so the relative
paths resolve. Start a new session in this directory and approve the server when prompted;
`/mcp` lists it.

Verified working:

```
initialize   → { name: 'aac-analytics', version: '1.0.0' }
resources    → schema://ddl, schema://dictionary, schema://insights, schema://interpretation-guide
tools/call   → get_attention_queue → Jonah K. score=4 SILENCE · Maya T. score=3 MISTAPS …
```

**Read-only by default.** `--allow-writes` opens a second connection limited to `insights`
and `board_change_proposals`; leave it off unless you want the model recording narrations.

---

## 3. Codex CLI

Codex reads `~/.codex/config.toml` — a global file, so it needs absolute paths:

```toml
[mcp_servers.aac-analytics]
command = "node"
args = [
  "/Users/kasonzhan/Documents/AI-Hackathon-AAC/mcp/server.ts",
  "--db",
  "/Users/kasonzhan/Documents/AI-Hackathon-AAC/aac.db",
]
```

Then `codex mcp list` should show `aac-analytics`.

If you would rather not put a project path in a global config, set `AAC_DB` in the
environment and pass only the script path — the server falls back to `<repo>/aac.db`
relative to its own location.

---

## 4. Gemma on the analysis device

Not built yet. `mcp/server.ts` speaks stdio only, and the analysis device is a separate
machine connecting outbound over HTTPS.

What it needs:

1. **Streamable HTTP transport** alongside stdio — same `tools` and `RESOURCES` objects,
   different framing. `mcp/server.ts` already separates protocol handling (`handle()`) from
   transport (`readline`), so this is a second entry point rather than a rewrite.
2. **Bearer-token auth with a role**, resolved in the tool handler and never in a prompt.
   `list_children` already scopes through `roster`; the token has to supply the `adult_id`
   instead of the caller passing it.
3. **A `analyst` role** that can read aggregates for its caseload and write `insights`.

Until then, run Gemma on the same machine as the database and use stdio.

---

## 5. Confirming it works

```bash
./tools/build.sh aac.db          # required first

printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | node mcp/server.ts --db aac.db
```

Fourteen tools and four resources. If `initialize` returns but `tools/call` fails with an
empty result, the database exists but has not been through `tools/run_rules.py` — the
insight tools read the materialised `fired_rules` table, not the live views.
