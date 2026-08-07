/**
 * Read-only access to aac.db for the dashboard.
 *
 * The database is built by tools/build.sh and owned by the pipeline in db/ and
 * tools/. Nothing in this application writes to it except the two explicitly
 * whitelisted tables in `writeDb()`.
 *
 * Uses node:sqlite (Node >= 22.5, builtin) for the same reason mcp/db.ts does:
 * no native module, no build step, and { readOnly: true } opens a WAL database
 * where Python's `mode=ro` URI cannot.
 */
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { connect } from './sqlite'

export type Row = Record<string, unknown>

const DB_PATH = process.env.AAC_DB ?? path.join(process.cwd(), 'aac.db')

/*
 * Handles are cached but re-checked against the file's inode on every call.
 * tools/build.sh replaces aac.db wholesale; a handle held across that rebuild
 * silently reads stale rows and writes into a deleted file.
 */
function readDb(): DatabaseSync {
  return connect('aac:read', DB_PATH, { readOnly: true, pragmas: ['PRAGMA busy_timeout = 5000'] })
}

function writeDb(): DatabaseSync {
  return connect('aac:write', DB_PATH, {
    pragmas: ['PRAGMA busy_timeout = 5000', 'PRAGMA foreign_keys = ON'],
  })
}

/*
 * node:sqlite returns rows with a null prototype. React refuses to serialise
 * those across the server/client boundary ("Only plain objects ... can be
 * passed to Client Components"), so every row is rebuilt as a plain object
 * here rather than at each call site that happens to hand data to a component.
 */
function plain<T>(row: unknown): T {
  return { ...(row as object) } as T
}

export function all<T = Row>(sql: string, params: unknown[] = []): T[] {
  return (readDb().prepare(sql).all(...(params as never[])) as unknown[]).map((r) => plain<T>(r))
}

export function one<T = Row>(sql: string, params: unknown[] = []): T | undefined {
  const row = readDb().prepare(sql).get(...(params as never[]))
  return row === undefined ? undefined : plain<T>(row)
}

export function scalar<T>(sql: string, params: unknown[] = []): T | undefined {
  const row = one(sql, params)
  return row ? (Object.values(row)[0] as T) : undefined
}

/**
 * The only writes this application performs. A human action in the dashboard is
 * behind every one of them:
 *   fired_rules       — a teacher dismissing an insight
 *   board_change_proposals — a teacher approving or rejecting a proposal
 *
 * Layout is never applied here. Applying a proposal writes a board_revisions
 * row through the pipeline, so I8 can measure the effect of our own advice.
 */
// `reports` is on this list because a report is a DERIVED artifact — a frozen
// copy of eight numbers the dashboard already computed, plus prose about them.
// Writing one changes nothing about the child's record. Nothing here may touch
// events, utterances or cards, which remain owned by the pipeline in db/ and tools/.
const WRITABLE = /^\s*(update\s+fired_rules|insert\s+into\s+board_change_proposals|update\s+board_change_proposals|insert\s+into\s+reports)\b/i

export function write(sql: string, params: unknown[] = []): void {
  if (!WRITABLE.test(sql)) {
    throw new Error(
      `Refused: the dashboard may only write fired_rules dismissals, board_change_proposals and reports. Got: ${sql.slice(0, 60)}`,
    )
  }
  writeDb().prepare(sql).run(...(params as never[]))
}

/** Latest day present in the event log — "today" for every relative window. */
export function latestDay(): string {
  return scalar<string>('SELECT MAX(day_local) FROM events') ?? new Date().toISOString().slice(0, 10)
}

export type Window = { start: string; end: string; days: number }

export function windowOf(days: number, endDay = latestDay()): Window {
  const end = new Date(`${endDay}T00:00:00Z`)
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - (days - 1))
  return { start: start.toISOString().slice(0, 10), end: endDay, days }
}

export function previousWindow(w: Window): Window {
  const start = new Date(`${w.start}T00:00:00Z`)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() - 1)
  start.setUTCDate(start.getUTCDate() - w.days)
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), days: w.days }
}
