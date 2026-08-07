/**
 * Per-child card customisation.
 *
 * Kept in its own SQLite file (`aac_app.db`), not in aac.db.
 *
 * Two reasons. The analytics database is owned by the pipeline in db/ and
 * tools/ — adding a table there would collide with it and would put mutable UI
 * state inside an append-only analytics store. And `cards` is global: editing
 * `cards.label` would rename the word on every child's board at once, which is
 * exactly what a customisation feature must not do.
 *
 * An override changes how a card LOOKS and what it SAYS. It can never change
 * where the card sits — position lives in board_cells and moving a learned
 * button destroys the motor plan (clinical constraints C2/C3).
 */
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'

const APP_DB = process.env.AAC_APP_DB ?? path.join(process.cwd(), 'aac_app.db')

declare global {
  var __aacApp: DatabaseSync | undefined
}

function db(): DatabaseSync {
  if (!globalThis.__aacApp) {
    const d = new DatabaseSync(APP_DB)
    d.exec('PRAGMA journal_mode = WAL')
    d.exec('PRAGMA busy_timeout = 5000')
    d.exec(`
      CREATE TABLE IF NOT EXISTS card_overrides (
        child_id    TEXT NOT NULL,
        card_id     TEXT NOT NULL,
        label       TEXT,          -- NULL = keep the card's own label
        word_form   TEXT,          -- contribution to a multi-word sentence
        spoken_text TEXT,
        symbol      TEXT,          -- a key into lib/icons/symbols.tsx
        image_data  TEXT,          -- data: URL of a photo, already downscaled
        updated_at  INTEGER NOT NULL,
        updated_by  TEXT,
        PRIMARY KEY (child_id, card_id)
      ) STRICT
    `)
    globalThis.__aacApp = d
  }
  return globalThis.__aacApp
}

export type CardOverride = {
  child_id: string
  card_id: string
  label: string | null
  word_form: string | null
  spoken_text: string | null
  symbol: string | null
  image_data: string | null
  updated_at: number
  updated_by: string | null
}

export function overridesFor(childId: string): Record<string, CardOverride> {
  const rows = db()
    .prepare(`SELECT * FROM card_overrides WHERE child_id = ?`)
    .all(childId) as unknown[]
  const out: Record<string, CardOverride> = {}
  for (const r of rows) {
    const o = { ...(r as object) } as CardOverride
    out[o.card_id] = o
  }
  return out
}

export type OverrideInput = {
  childId: string
  cardId: string
  label?: string | null
  wordForm?: string | null
  spokenText?: string | null
  symbol?: string | null
  imageData?: string | null
  updatedBy?: string | null
}

/** A photo is stored inline, so it must arrive already downscaled by the client. */
const MAX_IMAGE_BYTES = 400_000

export function saveOverride(input: OverrideInput): void {
  if (input.imageData) {
    if (!/^data:image\/(png|jpeg|webp);base64,/.test(input.imageData)) {
      throw new Error('imageData must be a base64 data URL for a png, jpeg or webp')
    }
    if (input.imageData.length > MAX_IMAGE_BYTES) {
      throw new Error('Image too large — downscale it in the browser before sending')
    }
  }
  if (input.label !== undefined && input.label !== null && input.label.trim().length === 0) {
    throw new Error('A card cannot have an empty label')
  }

  db()
    .prepare(
      `
      INSERT INTO card_overrides (child_id, card_id, label, word_form, spoken_text, symbol, image_data, updated_at, updated_by)
      VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(child_id, card_id) DO UPDATE SET
        label       = COALESCE(excluded.label,       card_overrides.label),
        word_form   = COALESCE(excluded.word_form,   card_overrides.word_form),
        spoken_text = COALESCE(excluded.spoken_text, card_overrides.spoken_text),
        symbol      = COALESCE(excluded.symbol,      card_overrides.symbol),
        image_data  = COALESCE(excluded.image_data,  card_overrides.image_data),
        updated_at  = excluded.updated_at,
        updated_by  = excluded.updated_by
      `,
    )
    .run(
      input.childId,
      input.cardId,
      input.label ?? null,
      input.wordForm ?? null,
      input.spokenText ?? null,
      input.symbol ?? null,
      input.imageData ?? null,
      Date.now(),
      input.updatedBy ?? null,
    )
}

/** Back to the card's own label, phrase and built-in symbol. */
export function clearOverride(childId: string, cardId: string): void {
  db().prepare(`DELETE FROM card_overrides WHERE child_id = ? AND card_id = ?`).run(childId, cardId)
}

/** Drop just the photo, keeping any label or phrase edits. */
export function clearPhoto(childId: string, cardId: string): void {
  db()
    .prepare(`UPDATE card_overrides SET image_data = NULL, updated_at = ? WHERE child_id = ? AND card_id = ?`)
    .run(Date.now(), childId, cardId)
}
