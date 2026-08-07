/**
 * Adult sign-in.
 *
 * Children never come through here. A typed password would exclude the person
 * the board is for — many AAC users cannot type — so the kid surface keeps its
 * picture sign-in and this covers adults on the dashboard only.
 *
 * Credentials live in `aac_app.db`, not `aac.db`. The `adults` table is defined
 * in `db/schema.sql`, which the analytics pipeline owns; adding a column there
 * would collide with it.
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { cookies, headers } from 'next/headers'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { one } from './db'

const APP_DB = process.env.AAC_APP_DB ?? path.join(process.cwd(), 'aac_app.db')
const COOKIE = 'aac_adult'
const MAX_AGE = 60 * 60 * 12

declare global {
  var __aacAuth: DatabaseSync | undefined
}

function db(): DatabaseSync {
  if (!globalThis.__aacAuth) {
    const d = new DatabaseSync(APP_DB)
    d.exec('PRAGMA journal_mode = WAL')
    d.exec('PRAGMA busy_timeout = 5000')
    d.exec(`
      CREATE TABLE IF NOT EXISTS adult_credentials (
        adult_id      TEXT PRIMARY KEY,
        username      TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,      -- scrypt: salt:derived, both hex
        created_at    INTEGER NOT NULL,
        last_login    INTEGER
      ) STRICT
    `)
    globalThis.__aacAuth = d
  }
  return globalThis.__aacAuth
}

/* -------------------------------------------------------------------------- *
 * Password hashing
 * -------------------------------------------------------------------------- */

/**
 * scrypt with a per-user salt. Deliberately slow, so a stolen database cannot
 * be brute-forced at speed — the cost parameter is the whole point of it.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const derived = scryptSync(password, salt, 64)
  return `${salt.toString('hex')}:${derived.toString('hex')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':')
  if (!saltHex || !hashHex) return false
  try {
    const derived = scryptSync(password, Buffer.from(saltHex, 'hex'), 64)
    const expected = Buffer.from(hashHex, 'hex')
    // Constant time: a wrong password must not be distinguishable by how long
    // the comparison took.
    return derived.length === expected.length && timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}

/* -------------------------------------------------------------------------- *
 * Accounts
 * -------------------------------------------------------------------------- */

export type Account = { adult_id: string; username: string }

export function accountCount(): number {
  const row = db().prepare(`SELECT COUNT(*) AS n FROM adult_credentials`).get() as { n: number }
  return Number(row?.n ?? 0)
}

export function createAccount(adultId: string, username: string, password: string): void {
  const adult = one<{ adult_id: string }>(`SELECT adult_id FROM adults WHERE adult_id = ?`, [adultId])
  if (!adult) throw new Error(`No adult '${adultId}' in the roster`)
  if (username.trim().length < 3) throw new Error('Username must be at least 3 characters')
  if (password.length < 8) throw new Error('Password must be at least 8 characters')

  db()
    .prepare(
      `INSERT INTO adult_credentials (adult_id, username, password_hash, created_at)
       VALUES (?,?,?,?)
       ON CONFLICT(adult_id) DO UPDATE SET
         username = excluded.username, password_hash = excluded.password_hash`,
    )
    .run(adultId, username.trim().toLowerCase(), hashPassword(password), Date.now())
}

export function authenticate(username: string, password: string): Account | null {
  const row = db()
    .prepare(`SELECT adult_id, username, password_hash FROM adult_credentials WHERE username = ?`)
    .get(username.trim().toLowerCase()) as
    | { adult_id: string; username: string; password_hash: string }
    | undefined

  /*
   * An unknown username still runs a hash, so "no such user" and "wrong
   * password" take the same time. Without this, the response time tells an
   * attacker which usernames exist.
   */
  if (!row) {
    verifyPassword(password, hashPassword('decoy-so-timing-matches'))
    return null
  }
  if (!verifyPassword(password, row.password_hash)) return null

  db().prepare(`UPDATE adult_credentials SET last_login = ? WHERE adult_id = ?`).run(Date.now(), row.adult_id)
  return { adult_id: row.adult_id, username: row.username }
}

/* -------------------------------------------------------------------------- *
 * Session
 * -------------------------------------------------------------------------- */

function secret(): string {
  const s = process.env.AAC_SESSION_SECRET
  // No default. A predictable signing key means anyone can mint a session, so
  // failing to start is the correct behaviour.
  if (!s) throw new Error('AAC_SESSION_SECRET is not set — the dashboard cannot sign sessions')
  return s
}

function sign(value: string): string {
  return createHmac('sha256', secret()).update(value).digest('base64url')
}

/** `adultId.expiry.signature` — the signature covers both other parts. */
function mint(adultId: string): string {
  const payload = `${adultId}.${Date.now() + MAX_AGE * 1000}`
  return `${payload}.${sign(payload)}`
}

function read(token: string): string | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [adultId, expiry, sig] = parts
  const expected = sign(`${adultId}.${expiry}`)
  if (sig.length !== expected.length) return null
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  if (Number(expiry) < Date.now()) return null
  return adultId
}

/**
 * Whether to mark the session cookie Secure.
 *
 * Keyed on the request's actual protocol, not on NODE_ENV. Behind the
 * Cloudflare tunnel the browser speaks HTTPS but the origin hop is plain HTTP,
 * so `x-forwarded-proto` is the only honest signal. Keying on NODE_ENV instead
 * set Secure on every production response, and the cookie was then never sent
 * back over the local HTTP connection — a session that could be created and
 * never used.
 */
async function isHttps(): Promise<boolean> {
  const h = await headers()
  const proto = h.get('x-forwarded-proto') ?? ''
  return proto.split(',')[0].trim() === 'https'
}

export async function signIn(adultId: string): Promise<void> {
  const jar = await cookies()
  jar.set(COOKIE, mint(adultId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: await isHttps(),
    path: '/',
    maxAge: MAX_AGE,
  })
}

export async function signOut(): Promise<void> {
  const jar = await cookies()
  jar.delete(COOKIE)
}

export async function currentAdultId(): Promise<string | null> {
  const jar = await cookies()
  const token = jar.get(COOKIE)?.value
  if (!token) return null
  try {
    return read(token)
  } catch {
    // A missing secret must not render as "signed in".
    return null
  }
}
