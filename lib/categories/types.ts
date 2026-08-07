/**
 * Shapes shared between the server store and the client editor.
 *
 * Separate from store.ts because that file opens SQLite, and anything a client
 * component imports gets bundled for the browser.
 */
export type Category = {
  category_id: string
  name: string
  sort: number
  built_in: number
}

export type CategoryWord = {
  word_id: string
  category_id: string
  label: string
  spoken_text: string
  word_form: string | null
  symbol: string | null
  card_id: string | null
  sort: number
}

export type ChildCategory = Category & { shown: boolean; words: CategoryWord[] }
