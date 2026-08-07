# Event Logging & Private Mode

## Function
An offline-first client event logger that writes every board interaction to IndexedDB and flushes it to `POST /api/events` in the background, plus Private Mode — a child-reachable switch that stops anything being recorded at all.

## Purpose
Two absolute rules from the file's own header:

1. **Logging never blocks speech.** Every write goes to IndexedDB and returns immediately; the network flush happens later on its own schedule. *"If the flush fails forever, the child can still talk."*
2. **The five starred fields — `grid_row`, `grid_col`, `grid_rows`, `grid_cols`, `nav_depth` — are captured on every `card_tap` from the first version.** They cannot be reconstructed later, and without them the reach-versus-vocabulary diagnosis on the dashboard is permanently impossible.

`day_local` and `tz_offset_min` are computed on the device rather than the server, "because the server does not know which day it was where the child is, and every day-boundary bug in analytics starts with computing that centrally."

Private Mode is the third rule. It is reachable by the child in the board header, not buried in adult settings, and while it is on **nothing is written at all** — not queued for later, not written and hidden. "That is the only version of the promise worth making."

## Source Files
| File | Role |
|------|------|
| `lib/kid/log.ts` | `EventLogger` class, `LoggedEvent`/`Scene`/`Actor` types, `localDay`, Private Mode (`isPrivate`/`setPrivate`), IndexedDB queue and flush. |

## Implementation

### Types
```ts
type Scene = 'therapy' | 'classroom' | 'free_play' | 'home' | 'community' | 'unknown'
type Actor = 'child' | 'adult'

type LoggedEvent = {
  event_id, child_id, ts, day_local, tz_offset_min, session_id, scene, actor, type,
  utterance_id?, board_id?, card_id?, label?,
  grid_row?, grid_col?, grid_rows?, grid_cols?, nav_depth?,
  source?, ms_delta?, payload?
}
```

### Constants and storage keys
| Name | Value |
|---|---|
| `DB_NAME` | `'aac-events'` (IndexedDB) |
| `STORE` | `'queue'`, `keyPath: 'event_id'` |
| `VERSION` | `1` |
| `PRIVATE_KEY` | `'aac.private-mode'` (localStorage, `'1'` = on) |
| flush interval | `15_000` ms |
| flush endpoint | `POST /api/events`, body `{ events: LoggedEvent[] }` |

### Envelope construction
`log(partial)`:
1. **`if (isPrivate()) return`** — the very first statement. Nothing is queued, persisted or counted.
2. `event_id = crypto.randomUUID()`, `ts = now.getTime()`, `day_local = localDay(now)`, `tz_offset_min = -now.getTimezoneOffset()`, `session_id` = the logger's own UUID.
3. `scene`/`actor` default to the logger's current values, overridable per call.
4. The event is pushed onto the in-memory `queue` **and** `void this.persist(event)` writes it to IndexedDB.

`localDay(d)` shifts by `-getTimezoneOffset() * 60_000` and slices `toISOString()` to `YYYY-MM-DD`.

### `logTap(args)`
Emits `type: 'card_tap'` carrying `utterance_id`, `board_id`, `card_id`, `label`, all five starred fields, `source`, and `ms_delta = tapDelta()`.

`tapDelta()` returns `null` when `lastTapAt` is null (first tap of an utterance) and otherwise `Date.now() - lastTapAt`, then updates `lastTapAt`. `resetTapClock()` sets it back to `null` and is called by the board after every Speak and Clear.

### Lifecycle wiring (constructor, browser only)
- `window.addEventListener('online', () => void this.flush())`
- `window.addEventListener('pagehide', () => this.flushBeacon())` — "a closing tab must not take the last few taps with it"
- `setInterval(() => void this.flush(), 15_000)`

The interval is never cleared, so a new `EventLogger` (one per `child_id`, memoised in the board) leaves its timer running for the life of the page.

### Flush
```
flush():
  if (flushing || !navigator.onLine) return
  pending = drain()                       // getAll() from IndexedDB, falls back to in-memory queue
  if (pending.length === 0) return
  POST /api/events { events: pending }
  if (res.ok) clear(pending.map(e => e.event_id))
```
Ingest is idempotent on `event_id` (`INSERT OR IGNORE`), "so a retry after a partial failure cannot duplicate rows." Any throw is swallowed: *"Offline or server down. Events stay queued; the board is unaffected."*

`flushBeacon()` uses `navigator.sendBeacon('/api/events', Blob)` with the **in-memory** `queue` only — the IndexedDB copy is not read during teardown, because a beacon cannot await a transaction.

`persist`, `drain` and `clear` each swallow IndexedDB failures: *"IndexedDB unavailable (private browsing, quota). The in-memory queue still flushes; we simply lose durability across a reload."*

### Event types produced by the kid app
| Type | Emitted by | Key fields |
|---|---|---|
| `session_start` / `session_end` | board mount / unmount (also written server-side on sign-in and sign-out) | — |
| `card_tap` | `tap()` (`source: 'board' \| 'essential'`) and `pickFromCategory` (`source: 'search'`, `nav_depth: 1`) | five starred fields, `ms_delta` |
| `speak` | Speak button | `payload {cardIds, labels, symbolCount, wordCount, assembly, msCompose, usedSuggestion}` |
| `delete_last` | Undo button | `ms_delta` = ms between tap and delete |
| `abandon` | Clear button | `payload {cardIds, msAlive, reason: 'cleared'}` |
| `board_switch` | mode chips | `payload {from, to, trigger: 'manual'}` |
| `scene_change` | scene `<select>` | `payload {from, to, setBy: 'manual'}` |
| `card_created` | written server-side by `PUT /api/cards` | `payload {origin, changed}` |

`lib/ingest.ts` validates against a closed set of types, scenes, actors and sources (`board`, `suggestion`, `essential`, `recent`, `search`, `keyboard`), and **rejects** a `card_tap` from `board`/`essential` that is missing any of the five starred fields with `"...it cannot be reconstructed later"`. A `card_tap` from `search` only needs `nav_depth`, because a folder word has no cell and inventing `(0,0)` would corrupt the heat map.

## Dependencies & Connections

### Depends On
- ../api/event-ingest.md — `POST /api/events`, idempotent on `event_id`, max 500 events per request (`413` beyond that).
- ../database/schema.md — the `events` table these rows land in.
- Browser IndexedDB, `navigator.onLine`, `navigator.sendBeacon`, `localStorage`.

### Depended On By
- [Communication Board](communication-board.md) — instantiates one `EventLogger` per `child_id` and calls `log`, `logTap`, `setScene`, `setActor`, `resetTapClock`, `flush`.
- ../analytics/metric-readers.md — every metric in `docs/analytics-metrics.md` is derived from these rows. `mistap_rate` needs `delete_last.ms_delta`; `repeat_tap_rate` needs consecutive `card_tap` rows; `nav_depth_by_card` needs `nav_depth`.
- ../pipeline/rule-materialisation.md — the nightly SQL rules read `events` only.

### Shared Resources
- IndexedDB database `aac-events`, object store `queue`.
- `localStorage['aac.private-mode']` — read by `isPrivate()` inside `log()` and mirrored into the board's `priv` state on mount.
- `POST /api/events`.

## Change Risks
- **Awaiting a flush inside a tap handler** violates rule 1 — a slow or dead network would delay speech, which is the one thing that must never happen.
- **Moving the Private Mode check anywhere later than the first line of `log()`** means events get queued (and eventually sent) during a session a child was promised was private.
- **Dropping any of the five starred fields from `logTap`** silently kills the position heat map, `mistap_rate` adjacency and `nav_depth_by_card` — and the loss is unrecoverable, not backfillable. `lib/ingest.ts` will start rejecting those taps outright.
- **Computing `day_local` on the server** re-introduces the day-boundary class of bug the header warns about, mis-bucketing every late-evening session.
- **Making ingest non-idempotent** makes `flush()` retries duplicate rows, inflating every count-based metric.
- **Adding a new event type client-side without adding it to `TYPES` in `lib/ingest.ts`** causes the whole batch to be rejected with `unknown event type`, so unrelated events are lost too — the request fails as a unit.
- **Emitting `card_tap` with `source: 'search'` and a null `nav_depth`** is rejected by the validator; the folder-word path in the board must keep sending `nav_depth: 1`.
