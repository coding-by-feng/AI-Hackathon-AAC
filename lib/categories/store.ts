/**
 * Category folders, as data rather than code.
 *
 * They used to be a constant in `lib/vocabulary/categories.ts`, so adding
 * "Swimming club" meant a deploy. That constant is now only a seed: on first
 * run its eleven entries become ordinary rows, and from then on they are
 * editable, hideable and reorderable like anything an adult adds.
 *
 * Two layers, deliberately:
 *
 *   categories + category_words   SHARED. Build a folder once and any child
 *                                 can use it.
 *   child_categories              PER CHILD. Maya needs Numbers, Jonah is not
 *                                 there yet.
 *
 * Hiding is not deleting. A folder a child is not ready for disappears from
 * their board and keeps its words, so turning it back on restores exactly what
 * was there — nobody has to rebuild it from memory.
 *
 * Lives in `aac_app.db`; `db/schema.sql` belongs to the analytics pipeline.
 */
import path from 'node:path'
import { connect } from '../sqlite'
import { all } from '../db'
import { CATEGORIES } from '../vocabulary/categories'

const APP_DB = process.env.AAC_APP_DB ?? path.join(process.cwd(), 'aac_app.db')

function db() {
  const d = connect('app:categories', APP_DB, {
    pragmas: ['PRAGMA journal_mode = WAL', 'PRAGMA busy_timeout = 5000'],
  })
  d.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      category_id TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      sort        INTEGER NOT NULL DEFAULT 0,
      built_in    INTEGER NOT NULL DEFAULT 0,
      created_by  TEXT,
      created_at  INTEGER NOT NULL
    ) STRICT
  `)
  d.exec(`
    CREATE TABLE IF NOT EXISTS category_words (
      word_id     TEXT PRIMARY KEY,
      category_id TEXT NOT NULL,
      label       TEXT NOT NULL,
      spoken_text TEXT NOT NULL,
      word_form   TEXT,
      symbol      TEXT,
      card_id     TEXT,          -- set when the word exists in the shared catalogue
      sort        INTEGER NOT NULL DEFAULT 0
    ) STRICT
  `)
  d.exec(`
    CREATE TABLE IF NOT EXISTS child_categories (
      child_id    TEXT NOT NULL,
      category_id TEXT NOT NULL,
      shown       INTEGER NOT NULL DEFAULT 1,
      sort        INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (child_id, category_id)
    ) STRICT
  `)
  d.exec(`CREATE INDEX IF NOT EXISTS ix_catwords ON category_words (category_id, sort)`)
  return d
}

import type { Category, CategoryWord, ChildCategory } from './types'
export type { Category, CategoryWord, ChildCategory }

function plain<T>(r: unknown): T {
  return { ...(r as object) } as T
}

/* -------------------------------------------------------------------------- *
 * Seeding
 * -------------------------------------------------------------------------- */

/**
 * Turn the built-in constant into rows, once.
 *
 * The constant expresses a category two ways: `dbCategories` matching
 * `cards.category`, and `extras` the catalogue does not contain. Both are
 * resolved to concrete words here, so afterwards a category is simply a list
 * and there is one thing to edit rather than two.
 */
export function seedIfEmpty(): void {
  const d = db()
  const existing = d.prepare(`SELECT COUNT(*) AS n FROM categories`).get() as { n: number }
  if (Number(existing?.n ?? 0) > 0) return

  CATEGORIES.forEach((c, i) => {
    d.prepare(
      `INSERT INTO categories (category_id, name, sort, built_in, created_by, created_at)
       VALUES (?,?,?,1,'system',?)`,
    ).run(c.key, c.name, i, Date.now())

    let sort = 0
    const insert = d.prepare(
      `INSERT INTO category_words (word_id, category_id, label, spoken_text, word_form, symbol, card_id, sort)
       VALUES (?,?,?,?,?,?,?,?)`,
    )

    if (c.dbCategories.length) {
      const rows = all<{ card_id: string; label: string; spoken_text: string }>(
        `SELECT card_id, label, spoken_text FROM cards
         WHERE category IN (${c.dbCategories.map(() => '?').join(',')}) ORDER BY label`,
        c.dbCategories,
      )
      for (const r of rows) {
        insert.run(`w_${crypto.randomUUID().slice(0, 12)}`, c.key, r.label, r.spoken_text, r.label, null, r.card_id, sort++)
      }
    }
    for (const e of c.extras) {
      insert.run(`w_${crypto.randomUUID().slice(0, 12)}`, c.key, e.label, e.spoken, e.label, null, null, sort++)
    }
  })
}

/* -------------------------------------------------------------------------- *
 * Reading
 * -------------------------------------------------------------------------- */

export function listCategories(): Category[] {
  seedIfEmpty()
  return (db().prepare(`SELECT category_id, name, sort, built_in FROM categories ORDER BY sort, name`).all() as unknown[])
    .map((r) => plain<Category>(r))
}

export function wordsIn(categoryId: string): CategoryWord[] {
  return (
    db()
      .prepare(`SELECT * FROM category_words WHERE category_id = ? ORDER BY sort, label`)
      .all(categoryId) as unknown[]
  ).map((r) => plain<CategoryWord>(r))
}

/**
 * Categories for one child, in their order.
 *
 * A category with no `child_categories` row is shown by default — a folder
 * added for the class should appear for everyone without someone having to
 * enable it child by child.
 */
export function categoriesForChild(childId: string): ChildCategory[] {
  seedIfEmpty()
  const rows = db()
    .prepare(
      `SELECT c.category_id, c.name, c.built_in,
              COALESCE(cc.sort, c.sort)  AS sort,
              COALESCE(cc.shown, 1)      AS shown
       FROM categories c
       LEFT JOIN child_categories cc
         ON cc.category_id = c.category_id AND cc.child_id = ?
       ORDER BY sort, c.name`,
    )
    .all(childId) as unknown[]

  return rows.map((r) => {
    const c = plain<Category & { shown: number }>(r)
    return { ...c, shown: c.shown === 1, words: wordsIn(c.category_id) }
  })
}

/* -------------------------------------------------------------------------- *
 * Writing
 * -------------------------------------------------------------------------- */

export function createCategory(name: string, createdBy: string | null): Category {
  if (!name.trim()) throw new Error('A category needs a name')
  const id = `cat_${crypto.randomUUID().slice(0, 10)}`
  const next = db().prepare(`SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM categories`).get() as { s: number }
  db()
    .prepare(
      `INSERT INTO categories (category_id, name, sort, built_in, created_by, created_at)
       VALUES (?,?,?,0,?,?)`,
    )
    .run(id, name.trim(), Number(next?.s ?? 0), createdBy, Date.now())
  return { category_id: id, name: name.trim(), sort: Number(next?.s ?? 0), built_in: 0 }
}

export function renameCategory(categoryId: string, name: string): void {
  if (!name.trim()) throw new Error('A category needs a name')
  db().prepare(`UPDATE categories SET name = ? WHERE category_id = ?`).run(name.trim(), categoryId)
}

/**
 * Deleting removes the folder for every child, so it is refused for the
 * built-in set. Hiding is the reversible option and is what the UI offers
 * first — a folder deleted by mistake takes its whole word list with it.
 */
export function deleteCategory(categoryId: string): void {
  const row = db().prepare(`SELECT built_in FROM categories WHERE category_id = ?`).get(categoryId) as
    | { built_in: number }
    | undefined
  if (!row) return
  if (row.built_in === 1) {
    throw new Error('Built-in categories can be hidden but not deleted')
  }
  db().prepare(`DELETE FROM category_words WHERE category_id = ?`).run(categoryId)
  db().prepare(`DELETE FROM child_categories WHERE category_id = ?`).run(categoryId)
  db().prepare(`DELETE FROM categories WHERE category_id = ?`).run(categoryId)
}

export function addWord(
  categoryId: string,
  word: { label: string; spokenText?: string; wordForm?: string; symbol?: string | null },
): CategoryWord {
  const label = word.label.trim()
  if (!label) throw new Error('A word needs a label')

  const id = `w_${crypto.randomUUID().slice(0, 12)}`
  const next = db()
    .prepare(`SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM category_words WHERE category_id = ?`)
    .get(categoryId) as { s: number }

  const spoken = word.spokenText?.trim() || `${label.charAt(0).toUpperCase()}${label.slice(1)}.`

  db()
    .prepare(
      `INSERT INTO category_words (word_id, category_id, label, spoken_text, word_form, symbol, card_id, sort)
       VALUES (?,?,?,?,?,?,NULL,?)`,
    )
    .run(id, categoryId, label, spoken, word.wordForm?.trim() || label, word.symbol ?? null, Number(next?.s ?? 0))

  return {
    word_id: id,
    category_id: categoryId,
    label,
    spoken_text: spoken,
    word_form: word.wordForm?.trim() || label,
    symbol: word.symbol ?? null,
    card_id: null,
    sort: Number(next?.s ?? 0),
  }
}

export function updateWord(
  wordId: string,
  patch: { label?: string; spokenText?: string; wordForm?: string; symbol?: string | null },
): void {
  const sets: string[] = []
  const args: unknown[] = []
  if (patch.label !== undefined) {
    if (!patch.label.trim()) throw new Error('A word needs a label')
    sets.push('label = ?')
    args.push(patch.label.trim())
  }
  if (patch.spokenText !== undefined) {
    sets.push('spoken_text = ?')
    args.push(patch.spokenText.trim())
  }
  if (patch.wordForm !== undefined) {
    sets.push('word_form = ?')
    args.push(patch.wordForm.trim())
  }
  if (patch.symbol !== undefined) {
    sets.push('symbol = ?')
    args.push(patch.symbol)
  }
  if (!sets.length) return
  args.push(wordId)
  db().prepare(`UPDATE category_words SET ${sets.join(', ')} WHERE word_id = ?`).run(...(args as never[]))
}

export function removeWord(wordId: string): void {
  db().prepare(`DELETE FROM category_words WHERE word_id = ?`).run(wordId)
}

/** Per-child visibility. The category and its words are untouched. */
export function setShown(childId: string, categoryId: string, shown: boolean): void {
  db()
    .prepare(
      `INSERT INTO child_categories (child_id, category_id, shown, sort)
       VALUES (?,?,?,COALESCE((SELECT sort FROM categories WHERE category_id = ?), 0))
       ON CONFLICT(child_id, category_id) DO UPDATE SET shown = excluded.shown`,
    )
    .run(childId, categoryId, shown ? 1 : 0, categoryId)
}

/** Per-child order — one child's arrangement never changes another's. */
export function reorderForChild(childId: string, orderedIds: string[]): void {
  const stmt = db().prepare(
    `INSERT INTO child_categories (child_id, category_id, shown, sort)
     VALUES (?,?,COALESCE((SELECT shown FROM child_categories WHERE child_id = ? AND category_id = ?), 1),?)
     ON CONFLICT(child_id, category_id) DO UPDATE SET sort = excluded.sort`,
  )
  orderedIds.forEach((id, i) => stmt.run(childId, id, childId, id, i))
}
