/**
 * Writing events into aac.db.
 *
 * Validation is not decoration here. `events` is a STRICT table with CHECK
 * constraints on scene, actor, type and source, so an invalid row throws from
 * SQLite with a message the client cannot act on. Rejecting it here, by name,
 * makes a bad client obvious immediately rather than at the next rollup.
 *
 * The five starred columns are accepted as-is and never defaulted. A card_tap
 * arriving without grid coordinates is a client bug worth failing loudly for —
 * silently writing NULL loses the data permanently.
 */
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { connect } from './sqlite'

const DB_PATH = process.env.AAC_DB ?? path.join(process.cwd(), 'aac.db')

function db(): DatabaseSync {
  // Re-checked against the file's inode: a rebuild of aac.db must not leave
  // this writing into a deleted file while reporting success.
  return connect('aac:ingest', DB_PATH, {
    pragmas: ['PRAGMA busy_timeout = 5000', 'PRAGMA foreign_keys = ON'],
  })
}

export type IncomingEvent = {
  event_id: string
  child_id: string
  ts: number
  day_local: string
  tz_offset_min: number
  session_id: string
  scene: string
  actor: string
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

const SCENES = new Set(['therapy', 'classroom', 'free_play', 'home', 'community', 'unknown'])
const ACTORS = new Set(['child', 'adult'])
const TYPES = new Set([
  'card_tap',
  'speak',
  'delete_last',
  'abandon',
  'board_switch',
  'scene_change',
  'listen',
  'suggestion_shown',
  'suggestion_tap',
  'gap_detected',
  'card_created',
  'keyboard_input',
  'session_start',
  'session_end',
])
const SOURCES = new Set(['board', 'suggestion', 'essential', 'recent', 'search', 'keyboard'])

function validate(e: IncomingEvent, i: number): void {
  const at = `events[${i}]`
  if (!e.event_id || !e.child_id) throw new Error(`${at}: event_id and child_id are required`)
  if (!Number.isFinite(e.ts)) throw new Error(`${at}: ts must be epoch ms`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.day_local)) throw new Error(`${at}: day_local must be YYYY-MM-DD`)
  if (!SCENES.has(e.scene)) throw new Error(`${at}: unknown scene '${e.scene}'`)
  if (!ACTORS.has(e.actor)) throw new Error(`${at}: unknown actor '${e.actor}'`)
  if (!TYPES.has(e.type)) throw new Error(`${at}: unknown event type '${e.type}'`)
  if (e.source && !SOURCES.has(e.source)) throw new Error(`${at}: unknown source '${e.source}'`)

  /*
   * The unbackfillable set. A grid tap without coordinates is worse than no
   * tap: it inflates every rate while contributing nothing to the heat maps.
   *
   * Only presses on a cell can carry coordinates. A word reached through a
   * category folder, a suggestion or search has no cell — requiring a position
   * there would mean inventing one, and a fabricated (0,0) would quietly
   * corrupt the very heat map this check exists to protect. nav_depth is
   * required in every case, because that is what says how far the child had to
   * go to find the word.
   */
  if (e.type === 'card_tap') {
    const onGrid = e.source === 'board' || e.source === 'essential'
    const required = onGrid
      ? (['grid_row', 'grid_col', 'grid_rows', 'grid_cols', 'nav_depth'] as const)
      : (['nav_depth'] as const)
    for (const k of required) {
      if (e[k] === null || e[k] === undefined) {
        throw new Error(`${at}: card_tap from '${e.source}' requires ${k} — it cannot be reconstructed later`)
      }
    }
  }
}

export function ingestEvents(events: IncomingEvent[]): { accepted: number; duplicates: number } {
  events.forEach(validate)

  const stmt = db().prepare(`
    INSERT OR IGNORE INTO events (
      event_id, child_id, ts, day_local, tz_offset_min, session_id, scene, actor, type,
      utterance_id, board_id, card_id, label,
      grid_row, grid_col, grid_rows, grid_cols, nav_depth,
      source, ms_delta, payload
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `)

  let accepted = 0
  for (const e of events) {
    const res = stmt.run(
      e.event_id,
      e.child_id,
      Math.round(e.ts),
      e.day_local,
      Math.round(e.tz_offset_min),
      e.session_id,
      e.scene,
      e.actor,
      e.type,
      e.utterance_id ?? null,
      e.board_id ?? null,
      e.card_id ?? null,
      e.label ?? null,
      e.grid_row ?? null,
      e.grid_col ?? null,
      e.grid_rows ?? null,
      e.grid_cols ?? null,
      e.nav_depth ?? null,
      e.source ?? null,
      e.ms_delta ?? null,
      e.payload ?? null,
    )
    accepted += Number(res.changes ?? 0)
  }

  return { accepted, duplicates: events.length - accepted }
}
