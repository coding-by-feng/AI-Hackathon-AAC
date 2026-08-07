/**
 * Who is holding the tablet.
 *
 * This is a data-integrity fix, not a security feature. `?child=` in the URL
 * meant a shared classroom iPad credited every press to whoever last opened the
 * tab, so three children's presses landed under one id — and the dashboard then
 * described a child who talks 200 times a day, whose mis-tap rate is three
 * children's motor abilities averaged together, and whose silence streak can
 * never fire because someone else keeps using "their" device.
 *
 * Nothing in the schema changes. `events` already has `child_id` and
 * `session_id`; the application simply never knew which child to write.
 */
import { cookies } from 'next/headers'
import { one, all } from './db'

const COOKIE = 'aac_child'
const MAX_AGE = 60 * 60 * 12 // a school day

export type ChildProfile = {
  child_id: string
  display_name: string
  year_group: string | null
  /** Optional picture passcode, as an ordered list of symbol keys. */
  passcode: string[] | null
}

export async function currentChildId(): Promise<string | null> {
  const jar = await cookies()
  return jar.get(COOKIE)?.value ?? null
}

export async function setCurrentChild(childId: string): Promise<void> {
  const jar = await cookies()
  jar.set(COOKIE, childId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE,
  })
}

export async function clearCurrentChild(): Promise<void> {
  const jar = await cookies()
  jar.delete(COOKIE)
}

/** Everyone who can sign in on this device. */
export function signInRoster(): ChildProfile[] {
  const rows = all<{ child_id: string; display_name: string; year_group: string | null }>(
    `SELECT child_id, display_name, year_group FROM children ORDER BY display_name`,
  )
  return rows.map((r) => ({ ...r, passcode: passcodeFor(r.child_id) }))
}

export function childProfile(childId: string): ChildProfile | null {
  const r = one<{ child_id: string; display_name: string; year_group: string | null }>(
    `SELECT child_id, display_name, year_group FROM children WHERE child_id = ?`,
    [childId],
  )
  if (!r) return null
  return { ...r, passcode: passcodeFor(r.child_id) }
}

/*
 * Picture passcodes live in the app store, not the analytics database.
 *
 * Off by default, and opt-in per child: for many AAC users any barrier between
 * them and speech is the wrong trade. It exists for the cases where attribution
 * genuinely matters — a device several children share unsupervised.
 */
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'

const APP_DB = process.env.AAC_APP_DB ?? path.join(process.cwd(), 'aac_app.db')

declare global {
  var __aacSession: DatabaseSync | undefined
}

function db(): DatabaseSync {
  if (!globalThis.__aacSession) {
    const d = new DatabaseSync(APP_DB)
    d.exec('PRAGMA journal_mode = WAL')
    d.exec('PRAGMA busy_timeout = 5000')
    d.exec(`
      CREATE TABLE IF NOT EXISTS child_passcodes (
        child_id  TEXT PRIMARY KEY,
        symbols   TEXT NOT NULL,   -- JSON array of symbol keys, in order
        set_at    INTEGER NOT NULL
      ) STRICT
    `)
    globalThis.__aacSession = d
  }
  return globalThis.__aacSession
}

export function passcodeFor(childId: string): string[] | null {
  const row = db()
    .prepare(`SELECT symbols FROM child_passcodes WHERE child_id = ?`)
    .get(childId) as { symbols?: string } | undefined
  if (!row?.symbols) return null
  try {
    const parsed = JSON.parse(row.symbols) as string[]
    return parsed.length ? parsed : null
  } catch {
    return null
  }
}

export function setPasscode(childId: string, symbols: string[] | null): void {
  if (!symbols || symbols.length === 0) {
    db().prepare(`DELETE FROM child_passcodes WHERE child_id = ?`).run(childId)
    return
  }
  db()
    .prepare(
      `INSERT INTO child_passcodes (child_id, symbols, set_at) VALUES (?,?,?)
       ON CONFLICT(child_id) DO UPDATE SET symbols = excluded.symbols, set_at = excluded.set_at`,
    )
    .run(childId, JSON.stringify(symbols), Date.now())
}

/**
 * A passcode check is not a security boundary and is not treated as one.
 *
 * It stops a child tapping the wrong photo by accident, on a device several
 * children share. It is not protecting anything from someone determined —
 * hence no lockout, no attempt counter, and no error state that reads as
 * failure to the child.
 */
export function checkPasscode(childId: string, attempt: string[]): boolean {
  const expected = passcodeFor(childId)
  if (!expected) return true
  if (attempt.length !== expected.length) return false
  return expected.every((s, i) => s === attempt[i])
}
