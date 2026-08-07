/**
 * Event logging for the communication board.
 *
 * Two absolute rules:
 *
 *  1. Logging never blocks speech. Every write goes to IndexedDB and returns;
 *     the network flush happens later, on its own schedule. If the flush fails
 *     forever, the child can still talk.
 *  2. The five starred fields — grid_row, grid_col, grid_rows, grid_cols,
 *     nav_depth — are captured on every card_tap from the first version.
 *     They cannot be reconstructed later, and without them the reach-versus-
 *     vocabulary diagnosis on the dashboard is permanently impossible.
 *
 * `day_local` and `tz_offset_min` are computed here rather than on the server,
 * because the server does not know which day it was where the child is, and
 * every day-boundary bug in analytics starts with computing that centrally.
 */

export type Scene = 'therapy' | 'classroom' | 'free_play' | 'home' | 'community' | 'unknown'
export type Actor = 'child' | 'adult'

export type LoggedEvent = {
  event_id: string
  child_id: string
  ts: number
  day_local: string
  tz_offset_min: number
  session_id: string
  scene: Scene
  actor: Actor
  type: string
  utterance_id?: string | null
  board_id?: string | null
  card_id?: string | null
  label?: string | null
  grid_row?: number | null
  grid_col?: number | null
  grid_rows?: number | null
  grid_cols?: number | null
  nav_depth?: number | null
  source?: string | null
  ms_delta?: number | null
  payload?: string | null
}

const DB_NAME = 'aac-events'
const STORE = 'queue'
const VERSION = 1

function uuid(): string {
  return crypto.randomUUID()
}

export function localDay(d = new Date()): string {
  const off = d.getTimezoneOffset()
  const local = new Date(d.getTime() - off * 60_000)
  return local.toISOString().slice(0, 10)
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'event_id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/**
 * Private Mode.
 *
 * Reachable by the child, not buried in an adult settings screen. While it is
 * on, nothing is written at all — not queued for later, not written and hidden.
 * That is the only version of the promise worth making.
 */
const PRIVATE_KEY = 'aac.private-mode'

export function isPrivate(): boolean {
  return typeof localStorage !== 'undefined' && localStorage.getItem(PRIVATE_KEY) === '1'
}

export function setPrivate(on: boolean): void {
  localStorage.setItem(PRIVATE_KEY, on ? '1' : '0')
}

export class EventLogger {
  private sessionId = uuid()
  private queue: LoggedEvent[] = []
  private flushing = false
  private lastTapAt: number | null = null

  constructor(
    private childId: string,
    private scene: Scene = 'classroom',
    private actor: Actor = 'child',
  ) {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => void this.flush())
      // A closing tab must not take the last few taps with it.
      window.addEventListener('pagehide', () => this.flushBeacon())
      setInterval(() => void this.flush(), 15_000)
    }
  }

  setScene(scene: Scene): void {
    this.scene = scene
  }

  setActor(actor: Actor): void {
    this.actor = actor
  }

  /** ms since the previous tap in this utterance — the input to mis-tap detection. */
  private tapDelta(): number | null {
    const now = Date.now()
    const delta = this.lastTapAt === null ? null : now - this.lastTapAt
    this.lastTapAt = now
    return delta
  }

  resetTapClock(): void {
    this.lastTapAt = null
  }

  log(partial: Omit<LoggedEvent, 'event_id' | 'child_id' | 'ts' | 'day_local' | 'tz_offset_min' | 'session_id' | 'scene' | 'actor'> & {
    scene?: Scene
    actor?: Actor
  }): void {
    if (isPrivate()) return

    const now = new Date()
    const event: LoggedEvent = {
      event_id: uuid(),
      child_id: this.childId,
      ts: now.getTime(),
      day_local: localDay(now),
      tz_offset_min: -now.getTimezoneOffset(),
      session_id: this.sessionId,
      scene: partial.scene ?? this.scene,
      actor: partial.actor ?? this.actor,
      ...partial,
    }

    this.queue.push(event)
    void this.persist(event)
  }

  logTap(args: {
    cardId: string
    label: string
    boardId: string
    row: number
    col: number
    gridRows: number
    gridCols: number
    navDepth: number
    source: string
    utteranceId: string
  }): void {
    this.log({
      type: 'card_tap',
      utterance_id: args.utteranceId,
      board_id: args.boardId,
      card_id: args.cardId,
      label: args.label,
      grid_row: args.row,
      grid_col: args.col,
      grid_rows: args.gridRows,
      grid_cols: args.gridCols,
      nav_depth: args.navDepth,
      source: args.source,
      ms_delta: this.tapDelta(),
    })
  }

  private async persist(event: LoggedEvent): Promise<void> {
    try {
      const db = await openDb()
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(event)
    } catch {
      // IndexedDB unavailable (private browsing, quota). The in-memory queue
      // still flushes; we simply lose durability across a reload.
    }
  }

  private async drain(): Promise<LoggedEvent[]> {
    try {
      const db = await openDb()
      return await new Promise((resolve) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
        req.onsuccess = () => resolve(req.result as LoggedEvent[])
        req.onerror = () => resolve([])
      })
    } catch {
      return this.queue
    }
  }

  private async clear(ids: string[]): Promise<void> {
    try {
      const db = await openDb()
      const store = db.transaction(STORE, 'readwrite').objectStore(STORE)
      ids.forEach((id) => store.delete(id))
    } catch {
      /* nothing durable to clear */
    }
    this.queue = this.queue.filter((e) => !ids.includes(e.event_id))
  }

  async flush(): Promise<void> {
    if (this.flushing || !navigator.onLine) return
    this.flushing = true
    try {
      const pending = await this.drain()
      if (pending.length === 0) return
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ events: pending }),
      })
      // Ingest is idempotent on event_id, so a retry after a partial failure
      // cannot duplicate rows.
      if (res.ok) await this.clear(pending.map((e) => e.event_id))
    } catch {
      // Offline or server down. Events stay queued; the board is unaffected.
    } finally {
      this.flushing = false
    }
  }

  private flushBeacon(): void {
    if (this.queue.length === 0) return
    try {
      navigator.sendBeacon(
        '/api/events',
        new Blob([JSON.stringify({ events: this.queue })], { type: 'application/json' }),
      )
    } catch {
      /* best effort on teardown */
    }
  }
}
