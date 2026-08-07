/**
 * Cached SQLite handles that notice when the file underneath them is replaced.
 *
 * `tools/build.sh` rebuilds `aac.db` from scratch, which unlinks the file and
 * writes a new one. A handle opened before that keeps working — against the
 * deleted inode. Reads return stale data and writes report success while going
 * nowhere. We hit exactly that: `POST /api/events` answered `accepted: 1` and
 * the row was not in the database.
 *
 * Every connection here is keyed on the file's inode. When the inode changes,
 * the handle is closed and reopened. The check is a `stat` per call — about a
 * microsecond, against the alternative of silently losing a child's data.
 */
import { DatabaseSync } from 'node:sqlite'
import { statSync } from 'node:fs'

type Entry = { db: DatabaseSync; ino: number; dev: number }

const open = new Map<string, Entry>()

function identity(path: string): { ino: number; dev: number } | null {
  try {
    const s = statSync(path)
    return { ino: Number(s.ino), dev: Number(s.dev) }
  } catch {
    return null
  }
}

export type ConnectOptions = {
  readOnly?: boolean
  /** Statements run once whenever the connection is (re)opened. */
  pragmas?: string[]
}

/**
 * A connection to `path`, reopened if the file has been replaced.
 *
 * `key` separates connections to the same file with different options — a
 * read-only handle and a writable one must not share a cache slot.
 */
export function connect(key: string, path: string, opts: ConnectOptions = {}): DatabaseSync {
  const now = identity(path)
  const cached = open.get(key)

  if (cached) {
    if (now && cached.ino === now.ino && cached.dev === now.dev) return cached.db
    // Replaced underneath us. Close the stale handle so its WAL files can be
    // released, then fall through and reopen.
    try {
      cached.db.close()
    } catch {
      /* already gone */
    }
    open.delete(key)
  }

  // node:sqlite rejects an explicit `undefined` second argument, so the two
  // cases are constructed separately rather than passing a maybe-options.
  const db = opts.readOnly ? new DatabaseSync(path, { readOnly: true }) : new DatabaseSync(path)
  for (const p of opts.pragmas ?? []) db.exec(p)

  const id = identity(path)
  if (id) open.set(key, { db, ino: id.ino, dev: id.dev })
  return db
}

/** Drop every cached handle. For tests and for a clean shutdown. */
export function closeAll(): void {
  for (const [key, entry] of open) {
    try {
      entry.db.close()
    } catch {
      /* ignore */
    }
    open.delete(key)
  }
}
