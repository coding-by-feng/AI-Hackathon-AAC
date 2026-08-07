# Connection Layer

## Function
Provides the Next.js application's access to `aac.db`: an inode-keyed SQLite connection cache that reopens a handle when the file underneath it is replaced, plus a read-mostly query API (`all` / `one` / `scalar`) and a `write()` guard that rejects any statement outside a four-pattern allowlist.

## Purpose

**`lib/sqlite.ts` exists because of a real, observed data-loss bug.** Its header:

> *"`tools/build.sh` rebuilds `aac.db` from scratch, which unlinks the file and writes a new one. A handle opened before that keeps working — against the deleted inode. Reads return stale data and writes report success while going nowhere. We hit exactly that: `POST /api/events` answered `accepted: 1` and the row was not in the database."*
>
> *"The check is a `stat` per call — about a microsecond, against the alternative of silently losing a child's data."*

**`lib/db.ts` exists to keep ownership clear.** The analytics database is built by `tools/build.sh` and owned by the pipeline in `db/` and `tools/`; the dashboard is a reader. The four writes it is allowed to make are each behind a human action:

> *"`fired_rules` — a teacher dismissing an insight; `board_change_proposals` — a teacher approving or rejecting a proposal… Layout is never applied here. Applying a proposal writes a `board_revisions` row through the pipeline, so I8 can measure the effect of our own advice."*

`reports` is on the list because *"a report is a DERIVED artifact — a frozen copy of eight numbers the dashboard already computed, plus prose about them. Writing one changes nothing about the child's record. Nothing here may touch `events`, `utterances` or `cards`, which remain owned by the pipeline."*

Both files use `node:sqlite` (built in, Node >= 22.5) rather than `better-sqlite3`: *"no native module, no build step, and `{ readOnly: true }` opens a WAL database where Python's `mode=ro` URI cannot."*

## Source Files
| File | Role |
|------|------|
| `lib/sqlite.ts` | `connect(key, path, opts)` — inode-keyed handle cache with reopen-on-replace; `closeAll()` |
| `lib/db.ts` | `aac.db` query helpers (`all`, `one`, `scalar`), the `write()` allowlist guard, and the window helpers (`latestDay`, `windowOf`, `previousWindow`) |

## Implementation

### `lib/sqlite.ts`

```ts
type Entry = { db: DatabaseSync; ino: number; dev: number }
const open = new Map<string, Entry>()

export type ConnectOptions = {
  readOnly?: boolean
  /** Statements run once whenever the connection is (re)opened. */
  pragmas?: string[]
}

export function connect(key: string, path: string, opts: ConnectOptions = {}): DatabaseSync
export function closeAll(): void
```

Flow of `connect()`, in order:
1. `identity(path)` — `statSync(path)` returning `{ ino, dev }` as `Number`s, or `null` if the stat throws.
2. Look up `open.get(key)`.
3. If cached **and** `now` is non-null **and** both `ino` and `dev` match → return the cached handle.
4. Otherwise close the stale handle inside `try/catch` ("Close the stale handle so its WAL files can be released"), `open.delete(key)`, fall through.
5. Construct: `opts.readOnly ? new DatabaseSync(path, { readOnly: true }) : new DatabaseSync(path)`. The two cases are written separately because "node:sqlite rejects an explicit `undefined` second argument".
6. `db.exec(p)` for each string in `opts.pragmas ?? []`.
7. `identity(path)` again; cache only if it returns non-null.

Consequences of the exact code:
- The cache key is `key` alone, **not** `path`. Two call sites using the same key against different paths would share one slot. `key` is documented as separating "a read-only handle and a writable one" to the same file.
- If `statSync` fails at step 7 (file missing), the handle is returned but **never cached**, so the next call reopens. There is no error thrown for a missing file at this layer.
- If `statSync` fails at step 1 while a handle is cached (`now === null`), the cached handle is closed and a new one opened.
- Pragmas run only on (re)open, never on a cache hit.

`closeAll()` iterates the map, closes each handle in `try/catch`, and deletes the entry — "For tests and for a clean shutdown."

**Keys in use across the repo:**
| Key | Path | Options |
|---|---|---|
| `aac:read` | `AAC_DB` | `readOnly: true`, `PRAGMA busy_timeout = 5000` |
| `aac:write` | `AAC_DB` | `PRAGMA busy_timeout = 5000`, `PRAGMA foreign_keys = ON` |
| `aac:ingest` | `AAC_DB` (`lib/ingest.ts`) | `PRAGMA busy_timeout = 5000`, `PRAGMA foreign_keys = ON` |
| `app:categories` | `AAC_APP_DB` (`lib/categories/store.ts`) | `PRAGMA journal_mode = WAL`, `PRAGMA busy_timeout = 5000` |

### `lib/db.ts`

```ts
export type Row = Record<string, unknown>
const DB_PATH = process.env.AAC_DB ?? path.join(process.cwd(), 'aac.db')
```

**Handles**
- `readDb()` → `connect('aac:read', DB_PATH, { readOnly: true, pragmas: ['PRAGMA busy_timeout = 5000'] })`
- `writeDb()` → `connect('aac:write', DB_PATH, { pragmas: ['PRAGMA busy_timeout = 5000', 'PRAGMA foreign_keys = ON'] })`

Both mirror the `busy_timeout = 5000` that `db/schema.sql` sets, because that PRAGMA is per-connection. `journal_mode = WAL` is persistent in the file and is not re-set here.

**`plain<T>(row)`** — `{ ...(row as object) }`. Required because *"node:sqlite returns rows with a null prototype. React refuses to serialise those across the server/client boundary ('Only plain objects … can be passed to Client Components')"*. Done centrally "rather than at each call site that happens to hand data to a component."

**Query API**
| Function | Signature | Behaviour |
|---|---|---|
| `all<T>` | `(sql: string, params: unknown[] = []) => T[]` | `readDb().prepare(sql).all(...params)`, each row through `plain` |
| `one<T>` | `(sql, params) => T \| undefined` | `.get(...)`; returns `undefined` unchanged, otherwise `plain` |
| `scalar<T>` | `(sql, params) => T \| undefined` | `one()` then `Object.values(row)[0]` — the **first column of the first row** |

**The write guard**
```ts
const WRITABLE = /^\s*(update\s+fired_rules|insert\s+into\s+board_change_proposals|update\s+board_change_proposals|insert\s+into\s+reports)\b/i

export function write(sql: string, params: unknown[] = []): void {
  if (!WRITABLE.test(sql)) {
    throw new Error(
      `Refused: the dashboard may only write fired_rules dismissals, board_change_proposals and reports. Got: ${sql.slice(0, 60)}`,
    )
  }
  writeDb().prepare(sql).run(...(params as never[]))
}
```
Four permitted statement shapes: `UPDATE fired_rules`, `INSERT INTO board_change_proposals`, `UPDATE board_change_proposals`, `INSERT INTO reports`. Everything else — including any `INSERT INTO fired_rules`, any `DELETE`, and every statement against `events`, `utterances`, `cards` or `boards` — throws. The error message truncates the offending SQL to 60 characters.

The guard is a **prefix match on the statement text**, not a parser: it anchors at the start (`^\s*`) and matches case-insensitively with a word boundary. It does not inspect anything after the table name, so a permitted prefix followed by additional clauses passes.

**Window helpers**
```ts
export function latestDay(): string
export type Window = { start: string; end: string; days: number }
export function windowOf(days: number, endDay = latestDay()): Window
export function previousWindow(w: Window): Window
```
- `latestDay()` — `SELECT MAX(day_local) FROM events`, falling back to `new Date().toISOString().slice(0, 10)` when the table is empty. Documented as *"Latest day present in the event log — 'today' for every relative window."* This is the TypeScript twin of `v_window.w_end` in `db/views_insights.sql`.
- `windowOf(days, endDay)` — builds the range `[endDay - (days - 1), endDay]` inclusive. All arithmetic uses `Date` in **UTC** (`new Date(`${endDay}T00:00:00Z`)`, `setUTCDate`, `toISOString().slice(0,10)`), so it never drifts with the server's local timezone — consistent with `events.day_local` being written by the client, never computed in SQL.
- `previousWindow(w)` — the immediately preceding block of the same length: `end = w.start - 1 day`, `start = end - (days - 1)`.

### Environment variables
| Variable | Default | Used by |
|---|---|---|
| `AAC_DB` | `path.join(process.cwd(), 'aac.db')` | `lib/db.ts`, `lib/ingest.ts` |
| `AAC_APP_DB` | `path.join(process.cwd(), 'aac_app.db')` | `lib/categories/store.ts` (separate application database) |

### Current call sites
`app/actions.ts`, `app/page.tsx`, `app/login/page.tsx`, `app/api/auth/route.ts`, `app/api/cards/route.ts`, `app/api/reports/route.ts`, `app/dashboard/reports/actions.ts`, `app/dashboard/student/[id]/page.tsx`, `.../access/page.tsx`, `.../ai-impact/page.tsx`, `.../report/page.tsx`, `lib/ingest.ts`, `lib/categories/store.ts`.

### Not this layer
The MCP server has its own connection module (`mcp/db.ts`) with a stricter guard — a `SELECT_ONLY` prefix test plus a `BANNED` keyword regex covering `attach|detach|pragma|insert|update|delete|drop|alter|create|replace|vacuum|reindex|begin|commit|rollback|savepoint`, because "ATTACH is still permitted on a read-only handle, and node:sqlite exposes no authorizer callback." It does not use `lib/sqlite.ts`.

## Dependencies & Connections

### Depends On
- [Analytics Schema and Indices](schema.md) — `latestDay()` reads `events.day_local`; the `WRITABLE` allowlist names `fired_rules`, `board_change_proposals` and `reports` by table
- Node `>= 22.5` for the built-in `node:sqlite` `DatabaseSync`

### Depended On By
- [../analytics/metric-readers.md](../analytics/metric-readers.md) — `lib/metrics.ts` imports `all`, `one`, `Window`, `previousWindow`
- [../analytics/data-dictionary.md](../analytics/data-dictionary.md) — `lib/catalog.ts` imports `all`, `one`
- [../api/event-ingest.md](../api/event-ingest.md) — `lib/ingest.ts` uses `connect()` under its own `aac:ingest` key with `foreign_keys = ON`; this is the layer whose absence caused the `accepted: 1` bug
- [../dashboard/insight-cards.md](../dashboard/insight-cards.md) — insight dismissal goes through `write('UPDATE fired_rules …')`
- [../dashboard/reach-and-errors.md](../dashboard/reach-and-errors.md) — proposal create/decide go through `write('INSERT INTO board_change_proposals …')` / `write('UPDATE board_change_proposals …')`
- [../dashboard/progress-reports.md](../dashboard/progress-reports.md) — report generation goes through `write('INSERT INTO reports …')`
- [../kid-app/category-folders.md](../kid-app/category-folders.md) — `lib/categories/store.ts` reuses `connect()` for `aac_app.db`

### Shared Resources
- The module-level `Map` in `lib/sqlite.ts` is **per Node process**. In Next.js dev with module reloading, more than one map can exist; handles leak until `closeAll()` or process exit.
- `aac.db` is open concurrently from this layer (read + narrow write), `lib/ingest.ts` (write), `mcp/db.ts` (read-only) and the Python pipeline. WAL plus `busy_timeout = 5000` is the entire concurrency strategy; `tools/concurrency_test.py` exercises it.
- `AAC_DB` is the shared path env var across `lib/db.ts` and `lib/ingest.ts`.

## Change Risks

- **Removing the inode check reintroduces the original bug**: after `tools/build.sh` replaces `aac.db`, every cached handle points at a deleted inode. Reads look plausible and writes report success. This is not theoretical — it shipped once.
- **Reusing an existing `key` for a different path or different options** silently returns the wrong handle: a read-only handle where a writer was expected (writes throw `SQLITE_READONLY`), or a handle whose pragmas were never applied for the new caller.
- **Widening `WRITABLE`** is the only thing preventing the dashboard from mutating `events`, `utterances`, `cards` or `boards`. Adding `insert into board_revisions` in particular would let the UI apply a layout change without going through the pipeline, which is exactly the path I8 relies on to attribute disruption to our own advice.
- **The guard is textual.** It cannot see through a statement built by string concatenation, and it only checks the prefix. It is a policy fence, not a sandbox — `mcp/db.ts` documents the same limitation for its own guard ("Deliberately blunt. A false positive costs one retry; a false negative costs a child's entire communication history").
- **Dropping `plain()`** makes every row a null-prototype object; React Server Components will throw "Only plain objects … can be passed to Client Components" at the first component boundary, and the failure surfaces far from this file.
- **Changing `latestDay()`'s fallback or its source table** desynchronises the TypeScript windows from `v_window` in SQL, so a dashboard tile and a fired rule can describe different 14-day periods.
- **Making `windowOf` timezone-local** would reintroduce the day-boundary class of bug `db/schema.sql` warns about ("every day-boundary bug in analytics comes from computing this here").
- **Raising or removing `busy_timeout = 5000`** changes behaviour under the concurrent write pressure of ingest + nightly rollup + MCP reads; the pragma is per-connection, so it must be set on every `connect()` call site, not just this one.
