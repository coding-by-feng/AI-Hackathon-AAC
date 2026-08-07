import { redirect } from 'next/navigation'
import Link from 'next/link'
import { all, one } from '@/lib/db'
import { currentChildId, setCurrentChild } from '@/lib/session'
import { seededWordForm } from '@/lib/kid/sentence'
import { overridesFor } from '@/lib/overrides'
import { type DrawerWord } from '@/lib/vocabulary/categories'
import { categoriesForChild } from '@/lib/categories/store'
import { BoardApp, type BoardData, type BoardCard } from '@/components/kid/board-app'

export const dynamic = 'force-dynamic'

/**
 * The communication board — the product itself. The dashboard exists to explain
 * what happens here, not the other way round.
 *
 * `?child=` picks the profile. A shared classroom device needs a real
 * picture-based sign-in before this ships anywhere near a school: without one,
 * every event is attributed to whoever last opened the tab, and the analytics
 * describe a child who does not exist.
 */
export default async function KidPage({
  searchParams,
}: {
  searchParams: Promise<{ child?: string }>
}) {
  /*
   * Identity comes from the session, not the URL.
   *
   * `?child=` previously WAS the identity, so a shared classroom tablet
   * credited every press to whoever last opened the tab — and with no param at
   * all it silently fell back to the alphabetically first child. It now SETS
   * the session and redirects, so a refresh keeps the same child and the data
   * describes the person who actually spoke.
   */
  const { child: requested } = await searchParams
  if (requested) {
    await setCurrentChild(requested)
    redirect('/')
  }

  const childId = await currentChildId()
  if (!childId) redirect('/who')

  const child = one<{ child_id: string; display_name: string }>(
    `SELECT child_id, display_name FROM children WHERE child_id = ?`,
    [childId],
  )
  // A stale cookie (a child removed from the roster) must not dead-end.
  if (!child) redirect('/who')

  const board = one<{ board_id: string; grid_rows: number; grid_cols: number }>(
    `SELECT board_id, grid_rows, grid_cols FROM boards
     WHERE child_id = ? AND kind = 'robust' ORDER BY created_at LIMIT 1`,
    [child.child_id],
  )
  if (!board) return <Fallback message={`${child.display_name} has no robust board.`} />

  const cards = all<BoardCard>(
    `
    SELECT c.card_id, c.label, c.spoken_text, c.is_essential, c.is_core,
           bc.grid_row, bc.grid_col, bc.masked, bc.nav_depth
    FROM board_cells bc
    JOIN cards c ON c.card_id = bc.card_id
    WHERE bc.board_id = ?
    ORDER BY bc.grid_row, bc.grid_col
    `,
    [board.board_id],
  )

  // The essential rail is its own list, not a filter of the grid. These six must
  // be reachable even when a mode has dimmed everything else on the board.
  const essentials = all<BoardCard>(
    `
    SELECT c.card_id, c.label, c.spoken_text, c.is_essential, c.is_core,
           COALESCE(bc.grid_row, -1) AS grid_row,
           COALESCE(bc.grid_col, -1) AS grid_col,
           0 AS masked,
           COALESCE(bc.nav_depth, 0) AS nav_depth
    FROM cards c
    LEFT JOIN board_cells bc ON bc.card_id = c.card_id AND bc.board_id = ?
    WHERE c.is_essential = 1
    ORDER BY c.card_id
    `,
    [board.board_id],
  )

  // A mode is a lens over the robust board: it names cards to highlight and
  // holds no coordinates of its own, so nothing ever moves.
  const modeRows = all<{ board_id: string; name: string; card_id: string }>(
    `
    SELECT b.board_id, b.name, ms.card_id
    FROM boards b
    JOIN mode_selection ms ON ms.board_id = b.board_id
    WHERE b.child_id = ? AND b.kind = 'mode' AND ms.emphasis = 'highlight'
    ORDER BY b.name, ms.rank
    `,
    [child.child_id],
  )
  const modes = Object.values(
    modeRows.reduce<Record<string, { board_id: string; name: string; highlighted: string[] }>>(
      (acc, r) => {
        acc[r.board_id] ??= { board_id: r.board_id, name: r.name, highlighted: [] }
        acc[r.board_id].highlighted.push(r.card_id)
        return acc
      },
      {},
    ),
  )

  /*
   * Customisations are applied over the shared card definitions, never into
   * them. `cards` is global — editing a row there would rename the word on
   * every child's board at once.
   */
  const overrides = overridesFor(child.child_id)
  const applyOverride = (c: BoardCard): BoardCard => {
    // Every card gets a word form; adults can override it in the edit sheet.
    const withWord: BoardCard = { ...c, word_form: seededWordForm(c.card_id, c.label) }
    const o = overrides[c.card_id]
    if (!o) return withWord
    /*
     * Renaming a card must not strip its picture.
     *
     * Symbols are looked up by label, so calling "water" something personal
     * like "my bottle" would find nothing and fall back to the letter M — the
     * child loses a picture they already recognise purely because an adult
     * reworded the caption. When no symbol was explicitly chosen, keep the
     * original word's symbol.
     */
    return {
      ...withWord,
      label: o.label ?? c.label,
      spoken_text: o.spoken_text ?? c.spoken_text,
      word_form: o.word_form ?? (o.label ? o.label : withWord.word_form),
      symbol: o.symbol ?? (o.label && o.label !== c.label ? c.label : null),
      image_data: o.image_data,
    }
  }

  /*
   * Category folders combine two sources: words already in the catalogue,
   * matched on cards.category, and vocabulary the seeded set simply lacks —
   * feelings and numbers, neither of which exists in `cards` at all.
   *
   * Extras are defined in the app rather than inserted into `cards`, which the
   * analytics pipeline owns.
   */
  const onGrid = new Set(cards.map((c) => c.card_id))
  const editableCategories = categoriesForChild(child.child_id)
  const categories = editableCategories
    .filter((c) => c.shown && c.words.length > 0)
    .map((c) => ({
      category: { key: c.category_id, name: c.name, dbCategories: [], extras: [] },
      words: c.words.map<DrawerWord>((w) => ({
        card_id: w.card_id,
        label: w.label,
        spoken_text: w.spoken_text,
        onBoard: w.card_id ? onGrid.has(w.card_id) : false,
      })),
    }))

  const data: BoardData = {
    child_id: child.child_id,
    child_name: child.display_name,
    board_id: board.board_id,
    grid_rows: board.grid_rows,
    grid_cols: board.grid_cols,
    cards: cards.map(applyOverride),
    essentials: essentials.map(applyOverride),
    modes,
    categories,
    editableCategories,
  }

  return <BoardApp data={data} />
}

function Fallback({ message }: { message: string }) {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="text-lg">{message}</p>
      <Link href="/dashboard" className="text-[var(--color-accent)] underline">
        Go to the dashboard
      </Link>
    </div>
  )
}
