# Web app — dashboard and communication board

**Status:** built, running against the seeded `aac.db` (analytics) and `aac_app.db` (app state)
**Owns:** `app/`, `components/`, `lib/`, `public/`, `next.config.ts`, `tsconfig.json`
**Reads but never modifies:** `db/*.sql`, `tools/`, `mcp/` — those belong to the data pipeline
**Per-feature detail:** [`docs/feature/README.md`](./feature/README.md) is the authoritative index; this file is the overview.

Two surfaces (plus the MCP endpoint) on one Next.js app, split across three public
hostnames by `middleware.ts` (see [`deploy.md`](./deploy.md)):

| Route | Who | What |
|---|---|---|
| `/` | the AAC user | Communication board, sentence bar, speech, categories, offline-capable |
| `/who` | the AAC user | Picture-based child sign-in → httpOnly session cookie |
| `/login` | adults | Adult sign-in (username + password, scrypt), with first-run account setup |
| `/dashboard` | teacher / SLT | Attention Queue + roster |
| `/dashboard/student/[id]` | teacher / SLT | Overview, findings, vocabulary; `/report` and `/ask` tabs per child |
| `/dashboard/student/[id]/access` | teacher / SLT | Reach vs. meaning — the heat-map pair |
| `/dashboard/student/[id]/ai-impact` | teacher / SLT | Presses saved, suggestion funnel, vocabulary gaps |
| `/dashboard/sessions`, `/dashboard/reports`, `/dashboard/ask` | teacher / SLT | Sittings, stored reports, streaming Ask panel |
| `POST /api/events` | the board | Event ingest, idempotent on `event_id` |
| `POST /api/mcp` | models | MCP over HTTP (bearer token), 20 analytics tools |

## Running it

```bash
./tools/build.sh aac.db     # build + seed the database (pipeline, not this app)
npm install
npm run dev                 # board at /, dashboard at /dashboard
```

Environment:

| Variable | Default | Purpose |
|---|---|---|
| `AAC_DB` | `./aac.db` | Path to the analytics SQLite database |
| `AAC_APP_DB` | `./aac_app.db` | App-state database (accounts, overrides, categories, generated pictures) |
| `AAC_VIEWER` | `adult_patel` | **Development-only** fallback viewer when no adult session exists; ignored in production |

The full variable table (session secrets, MCP token, image/chat provider keys) is in
[`deploy.md`](./deploy.md). There **is** real auth now: adults sign in at `/login`
(scrypt-hashed credentials in `aac_app.db`, signed httpOnly session cookie, first-run
setup when no account exists), and children sign in with pictures at `/who`. Every
dashboard query still runs through the roster and consent scoping in `lib/access.ts`;
`AAC_VIEWER` only fills in for `next dev` convenience, which also means auth cannot be
meaningfully tested with `next dev`.

## How data flows

```
board (browser)                          dashboard (server components)
  │  tap / speak / undo / clear                    ▲
  ▼                                                │ read-only
IndexedDB queue  ──POST /api/events──▶  aac.db  ───┘
  (offline-safe)      idempotent          ▲
                                          │ nightly
                       tools/rollup.py ───┘  agg_daily_metric
                       tools/run_rules.py ──▶ fired_rules
```

The board never blocks on the network. Events queue locally and flush every 15
seconds, on reconnect, and on page hide. If the flush never succeeds, the child
can still talk.

## Constraints enforced in code, not in copy

Each of these is a place where the obvious implementation would have produced
harmful behaviour. They are listed here because they look like details and are
not.

| Where | Rule |
|---|---|
| `lib/catalog.ts` `direction()` | A metric whose catalogue polarity is `neutral` can never render as good or bad. `repeat_tap_rate` exists to stop the system pathologising stimming; this function is what stops the UI undoing that. |
| `components/insight-card.tsx` | `action_kind === 'informational'` renders **no action button**. I4 case B is a child refusing something — offering an intervention there teaches them their "no" does not count. |
| `components/insight-card.tsx` | `forbidden_actions` is displayed, not merely obeyed. |
| `components/heat-grid.tsx` | Offers *mask* and *add a copy*. Never *resize* or *move* — relocating a learned button destroys the motor plan (C2/C3). |
| `components/kid/board-app.tsx` | A mode highlights and dims; it never moves a card (C4). |
| `components/kid/board-app.tsx` | Modeling Mode auto-exits after 90 s idle, so adult presses are never silently attributed to the child. |
| `lib/baseline.ts` | Nothing is flagged until a child has 14 active days **and** 40 sentences of their own. Gated on activity, not the calendar, so a child who barely uses the app does not sit permanently exempt from the flags meant to catch them. |
| `lib/ingest.ts` | A `card_tap` without `grid_row`/`grid_col`/`grid_rows`/`grid_cols`/`nav_depth` is **rejected**. Those five cannot be reconstructed later. |
| `lib/access.ts` | Consent and role are filtered in the query layer. A teacher cannot see utterance text however consent is configured. |
| `lib/metrics.ts` `ROLLUP` | Explicit per-metric roll-up. The catalogue's `unit` cannot distinguish a daily tally from a per-sentence median, and summing seven medians reports a child pressing 21 buttons per sentence. |

## Known gaps

Honest list of what is not finished.

1. ~~No sign-in.~~ **Resolved.** Child identity comes from the `/who` picture sign-in
   (httpOnly cookie — `?child=` is no longer identity, it just sets the session and
   redirects), and adult identity from `/login`. See
   [`feature/kid-app/child-sign-in.md`](./feature/kid-app/child-sign-in.md) and
   [`feature/auth/adult-sign-in.md`](./feature/auth/adult-sign-in.md).
2. **F1, F3 and F4 have no source data.** `suggestion_shown`, `suggestion_tap`
   and `gap_detected` are not emitted by any client yet, so suggestion
   acceptance, vocabulary gaps and the visual-source split render as
   "not recorded yet" rather than as zeroes. The queries are written and will
   populate the moment those events start arriving.
3. **The AI suggestion strip is not built.** The board logs `used_suggestion`
   as false for everything, so `taps_saved` reflects seed data only.
4. **Board-change proposals are display-only.** The "mask these cells" and
   "add a copy" buttons on `/access`, and "add to her board" on `/ai-impact`,
   have no write path yet. Applying one must create a `board_revisions` row so
   I8 can measure whether our own advice helped.
5. **`mistap_threshold_ms` is fixed at 1500 ms** in the views. Per-child tuning
   (2500 ms is often truer for athetoid CP) needs a column on `children`, which
   is a schema change and therefore the pipeline's call, not this app's.
