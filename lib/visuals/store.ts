/**
 * The generated-picture cache.
 *
 * Every picture ever made is kept and reused. Two lookups:
 *
 *   exact     the normalised concept, hashed — 'a drink of water' and 'Water!'
 *             collapse to the same key, so wording never costs a generation
 *   semantic  cosine over stored embeddings, for concepts that mean the same
 *             thing without normalising to the same string
 *
 * Lives in `aac_app.db`. `db/schema.sql` belongs to the analytics pipeline.
 */
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { normalizeConcept } from './sanitize'
import { cosine } from './openai'

const APP_DB = process.env.AAC_APP_DB ?? path.join(process.cwd(), 'aac_app.db')

declare global {
  var __aacVisuals: DatabaseSync | undefined
}

function db(): DatabaseSync {
  if (!globalThis.__aacVisuals) {
    const d = new DatabaseSync(APP_DB)
    d.exec('PRAGMA journal_mode = WAL')
    d.exec('PRAGMA busy_timeout = 5000')
    d.exec(`
      CREATE TABLE IF NOT EXISTS generated_visuals (
        visual_id          TEXT PRIMARY KEY,
        concept            TEXT NOT NULL,   -- as the adult typed it
        normalized_concept TEXT NOT NULL,   -- the cache key
        prompt             TEXT NOT NULL,
        model              TEXT NOT NULL,
        image_data         TEXT NOT NULL,   -- data: URL
        embedding          TEXT,            -- JSON array, for semantic lookup
        created_by         TEXT,
        created_at         INTEGER NOT NULL,
        used_count         INTEGER NOT NULL DEFAULT 0
      ) STRICT
    `)
    d.exec(`CREATE INDEX IF NOT EXISTS ix_visuals_norm ON generated_visuals (normalized_concept)`)
    globalThis.__aacVisuals = d
  }
  return globalThis.__aacVisuals
}

export type StoredVisual = {
  visual_id: string
  concept: string
  normalized_concept: string
  image_data: string
  model: string
  created_at: number
}

function row(r: unknown): StoredVisual {
  const o = { ...(r as object) } as StoredVisual
  return o
}

/** Step 3 of the ladder: exact match on the normalised concept. */
export function findExact(concept: string): StoredVisual | null {
  const key = normalizeConcept(concept)
  if (!key) return null
  const r = db()
    .prepare(
      `SELECT visual_id, concept, normalized_concept, image_data, model, created_at
       FROM generated_visuals WHERE normalized_concept = ?
       ORDER BY used_count DESC, created_at DESC LIMIT 1`,
    )
    .get(key)
  return r ? row(r) : null
}

/** Step 4: nearest stored concept by embedding, if it clears the threshold. */
export function findSemantic(
  embedding: number[],
  threshold = 0.88,
): { visual: StoredVisual; score: number } | null {
  const rows = db()
    .prepare(
      `SELECT visual_id, concept, normalized_concept, image_data, model, created_at, embedding
       FROM generated_visuals WHERE embedding IS NOT NULL`,
    )
    .all() as unknown[]

  let best: { visual: StoredVisual; score: number } | null = null
  for (const r of rows) {
    const o = { ...(r as object) } as StoredVisual & { embedding: string }
    let stored: number[]
    try {
      stored = JSON.parse(o.embedding) as number[]
    } catch {
      continue
    }
    const score = cosine(embedding, stored)
    if (score >= threshold && (!best || score > best.score)) {
      best = { visual: row(o), score }
    }
  }
  return best
}

export function save(v: {
  concept: string
  prompt: string
  model: string
  imageData: string
  embedding: number[] | null
  createdBy: string | null
}): StoredVisual {
  const id = `vis_${crypto.randomUUID().slice(0, 12)}`
  db()
    .prepare(
      `INSERT INTO generated_visuals
         (visual_id, concept, normalized_concept, prompt, model, image_data, embedding, created_by, created_at, used_count)
       VALUES (?,?,?,?,?,?,?,?,?,0)`,
    )
    .run(
      id,
      v.concept,
      normalizeConcept(v.concept),
      v.prompt,
      v.model,
      v.imageData,
      v.embedding ? JSON.stringify(v.embedding) : null,
      v.createdBy,
      Date.now(),
    )
  return {
    visual_id: id,
    concept: v.concept,
    normalized_concept: normalizeConcept(v.concept),
    image_data: v.imageData,
    model: v.model,
    created_at: Date.now(),
  }
}

/** A reuse is the signal that a cached picture is worth keeping. */
export function markUsed(visualId: string): void {
  db()
    .prepare(`UPDATE generated_visuals SET used_count = used_count + 1 WHERE visual_id = ?`)
    .run(visualId)
}

export function stats(): { total: number; reused: number } {
  const r = db()
    .prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN used_count > 0 THEN 1 ELSE 0 END) AS reused
       FROM generated_visuals`,
    )
    .get() as { total: number; reused: number | null }
  return { total: Number(r?.total ?? 0), reused: Number(r?.reused ?? 0) }
}
