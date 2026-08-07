# Event Ingest

## Function
`POST /api/events` accepts a batch of board events from the browser, validates every row by
name against the closed enums the `events` table enforces, and writes them into `aac.db` with
`INSERT OR IGNORE` so a retry cannot duplicate a row.

## Purpose
The board is the only producer of behavioural data in the system, and it produces it on a
device that is frequently offline. The client therefore queues events in IndexedDB and flushes
them aggressively — which is only safe if the server is idempotent on `event_id`. That is the
whole reason this endpoint exists in the shape it does.

Validation is not decoration here, per the header of `lib/ingest.ts`: `events` is a `STRICT`
table with `CHECK` constraints on `scene`, `actor`, `type` and `source`, so an invalid row
throws from SQLite with a message the client cannot act on. Rejecting it here, by name, makes
a bad client obvious immediately rather than at the next rollup.

The five starred columns (`grid_row`, `grid_col`, `grid_rows`, `grid_cols`, `nav_depth`) are
accepted as-is and never defaulted. A `card_tap` arriving without grid coordinates is a client
bug worth failing loudly for — silently writing `NULL` loses the data permanently, and a
fabricated `(0,0)` would corrupt the cell heat map that clinical constraint C2 depends on.

## Source Files
| File | Role |
|------|------|
| `app/api/events/route.ts` | The HTTP surface: JSON parse, batch-size cap, error mapping |
| `lib/ingest.ts` | `IncomingEvent` type, per-row validation, the `INSERT OR IGNORE` statement |

## Implementation

### Endpoint

`POST /api/events` — `export const dynamic = 'force-dynamic'`

Request body:

```jsonc
{ "events": [ /* IncomingEvent, 1..500 */ ] }
```

| Condition | Status | Response |
|---|---|---|
| body is not JSON | 400 | `{ "error": "Body must be JSON" }` |
| `events` missing, not an array, or empty | 400 | `{ "error": "events[] required" }` |
| `events.length > 500` | 413 | `{ "error": "At most 500 events per request" }` |
| any row fails `validate()` | 400 | `{ "error": "<the validator's message>" }` |
| accepted | 200 | `{ "accepted": <n>, "duplicates": <events.length - n> }` |

The whole batch is validated before anything is written (`events.forEach(validate)` runs first),
so one bad row rejects the batch rather than half-writing it.

### `IncomingEvent`

Required: `event_id`, `child_id`, `ts` (epoch ms), `day_local` (`YYYY-MM-DD`), `tz_offset_min`,
`session_id`, `scene`, `actor`, `type`.
Optional, written as `NULL` when absent: `utterance_id`, `board_id`, `card_id`, `label`,
`grid_row`, `grid_col`, `grid_rows`, `grid_cols`, `nav_depth`, `source`, `ms_delta`, `payload`.

### Closed enums (`lib/ingest.ts`)

| Set | Values |
|---|---|
| `SCENES` | `therapy · classroom · free_play · home · community · unknown` |
| `ACTORS` | `child · adult` |
| `TYPES` | `card_tap · speak · delete_last · abandon · board_switch · scene_change · listen · suggestion_shown · suggestion_tap · gap_detected · card_created · keyboard_input · session_start · session_end` (14) |
| `SOURCES` | `board · suggestion · essential · recent · search · keyboard` (checked only when `source` is truthy) |

### `validate(e, i)` — in order, error prefix `events[<i>]`

1. `event_id` and `child_id` truthy — `event_id and child_id are required`
2. `Number.isFinite(ts)` — `ts must be epoch ms`
3. `day_local` matches `/^\d{4}-\d{2}-\d{2}$/` — `day_local must be YYYY-MM-DD`
4. `scene` ∈ `SCENES` — `unknown scene '<x>'`
5. `actor` ∈ `ACTORS` — `unknown actor '<x>'`
6. `type` ∈ `TYPES` — `unknown event type '<x>'`
7. `source`, if present, ∈ `SOURCES` — `unknown source '<x>'`
8. **The unbackfillable set**, for `type === 'card_tap'` only:
   - `onGrid = source === 'board' || source === 'essential'`
   - on grid → `grid_row`, `grid_col`, `grid_rows`, `grid_cols`, `nav_depth` all required
   - off grid (suggestion, recent, search, keyboard, or no `source`) → only `nav_depth` required
   - missing → `card_tap from '<source>' requires <key> — it cannot be reconstructed later`

   A word reached through a category folder, a suggestion or search has no cell, so requiring a
   position there would mean inventing one. `nav_depth` is required in every case because that
   is what records how far the child had to go to find the word.

### Write

```sql
INSERT OR IGNORE INTO events (
  event_id, child_id, ts, day_local, tz_offset_min, session_id, scene, actor, type,
  utterance_id, board_id, card_id, label,
  grid_row, grid_col, grid_rows, grid_cols, nav_depth,
  source, ms_delta, payload
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
```

- `ts` and `tz_offset_min` are passed through `Math.round()`; every other value is written as given.
- `accepted` accumulates `Number(res.changes ?? 0)` per row, so a row ignored as a duplicate
  contributes 0 and lands in `duplicates`.

### Connection

- `DB_PATH = process.env.AAC_DB ?? path.join(process.cwd(), 'aac.db')`
- Opened through `connect('aac:ingest', DB_PATH, { pragmas: ['PRAGMA busy_timeout = 5000', 'PRAGMA foreign_keys = ON'] })`.
  `lib/sqlite.ts` re-`stat`s the file on every call and reopens when the inode changes — this
  route is the exact case that motivated it: after `tools/build.sh` replaced `aac.db`,
  `POST /api/events` answered `accepted: 1` while writing into a deleted inode.

### Callers

| Caller | How |
|---|---|
| `lib/kid/log.ts` `flush()` | `fetch('/api/events', { method: 'POST' })` with the whole drained IndexedDB queue; clears the queue only when `res.ok` |
| `lib/kid/log.ts` `flushBeacon()` | `navigator.sendBeacon('/api/events', Blob)` on page teardown |
| `app/api/session/route.ts` | in-process `ingestEvents([...])` for `session_start` / `session_end` |
| `app/api/cards/route.ts` | in-process `ingestEvents([...])` for `card_created` |
| `lib/visuals/ladder.ts` `logGap()` | in-process `ingestEvents([...])` for `gap_detected` |

`middleware.ts` lists `/api/events` in `KID_PREFIXES`, so it is reachable on the `aac.*`
hostname and 404s on `aac-dashboard.*` and `aac-mcp.*`.

## Dependencies & Connections

### Depends On
- [Database schema](../database/schema.md) — the `events` table is `STRICT` with `CHECK`
  constraints; the enums above mirror it deliberately.
- [SQLite connection cache](../database/connection-layer.md) — `connect('aac:ingest', …)` and its
  inode re-check.

### Depended On By
- [Kid event log](../kid-app/event-logging.md) — the offline queue's only drain.
- [Child sign-in endpoint](sign-in-endpoints.md) — writes `session_start` / `session_end`
  through `ingestEvents`.
- [Board content endpoints](board-content-endpoints.md) — writes `card_created` through
  `ingestEvents`.
- [Visual resolution endpoint](visual-resolution-endpoint.md) — every ladder step writes
  `gap_detected`.
- [Analytics rollups](../pipeline/l2-rollup.md) and every metric read downstream — nothing enters
  `aac.db` any other way.

### Shared Resources
- `aac.db` `events` table (append-only, keyed on `event_id`).
- `AAC_DB` environment variable.
- The `connect()` cache key `aac:ingest`.

## Change Risks
- **Adding an event type in the client without adding it to `TYPES`** rejects the whole batch
  with a 400. Because `flush()` only clears the IndexedDB queue on `res.ok`, one unknown type
  poisons every subsequent flush: the queue grows and no events land at all. Add to `TYPES`
  *and* to the `CHECK` constraint in `db/schema.sql` in the same change.
- **Relaxing the `card_tap` coordinate requirement** (e.g. defaulting to 0) silently corrupts
  `get_cell_heat`, `mistap_rate` and `correction_adjacent_rate` — the exact analyses clinical
  constraint C2 relies on. The failure would be invisible: plausible numbers, wrong cells.
- **Changing the response shape** away from `{ accepted, duplicates }` breaks nothing in the
  client today (it only checks `res.ok`), but `tools/test-api.sh` asserts on `accepted`.
- **Raising the 500-event cap** changes the memory profile of a single request; the queue
  flushes everything pending in one body, so a device offline for a day sends one large batch.
- **Dropping `INSERT OR IGNORE` for a plain `INSERT`** makes retries fail on the primary key and
  turns every partial flush into a permanent 400 loop.
