'use client'

import { CardFace, faceColours } from './card-face'
import { isNumeral, categoryIcon } from '@/lib/icons/symbols'
import type { Category, DrawerWord } from '@/lib/vocabulary/categories'

/**
 * A category folder.
 *
 * Slides over the board rather than replacing it, so the grid underneath keeps
 * every position. Words already on the grid appear here too, marked — a child
 * who finds "water" in Food and then sees it on the board next time is learning
 * where it lives, which is the whole argument for a stable layout.
 */
export function CategoryDrawer({
  category,
  words,
  onPick,
  onClose,
}: {
  category: Category
  words: DrawerWord[]
  onPick: (word: DrawerWord) => void
  onClose: () => void
}) {
  const numbersOnly = category.key === 'numbers'

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col justify-end bg-black/30"
      role="dialog"
      aria-modal="true"
      aria-label={category.name}
      onClick={onClose}
    >
      <div
        className="max-h-[78dvh] overflow-y-auto rounded-t-2xl border-t border-[var(--color-line)] bg-[var(--color-surface)] p-4"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">{category.name}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--color-line)] px-4 py-2 text-base font-medium"
            style={{ minHeight: 48 }}
          >
            Back to board
          </button>
        </div>

        {words.length === 0 ? (
          <p className="py-8 text-center text-[var(--color-ink-muted)]">
            No words in here yet.
          </p>
        ) : (
          <div
            className="grid gap-2"
            style={{
              gridTemplateColumns: numbersOnly
                ? 'repeat(auto-fill, minmax(84px, 1fr))'
                : 'repeat(auto-fill, minmax(112px, 1fr))',
            }}
          >
            {words.map((w) => (
              <button
                key={`${w.card_id ?? 'x'}-${w.label}`}
                type="button"
                onClick={() => onPick(w)}
                className="relative flex flex-col items-center justify-center rounded-[var(--radius-card)] border-2 p-2 text-center"
                style={{ minHeight: 84, ...faceColours(w.label) }}
              >
                {isNumeral(w.label) ? (
                  <span className="text-3xl font-bold">{w.label}</span>
                ) : (
                  <CardFace label={w.label} size={32} />
                )}
                {w.onBoard && (
                  <span
                    className="absolute top-1 right-1 text-[10px] font-semibold text-[var(--color-ink-faint)]"
                    title="This word is also on the board"
                  >
                    on board
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        <p className="mt-3 text-xs text-[var(--color-ink-faint)]">
          Words used often from here can be added to the main board — the dashboard flags them.
        </p>
      </div>
    </div>
  )
}

export function CategoryBar({
  categories,
  onOpen,
  firstWords = {},
  leading,
}: {
  categories: Category[]
  onOpen: (c: Category) => void
  /** First word of each folder, used when a category has no icon of its own. */
  firstWords?: Record<string, string>
  /**
   * A chip rendered before the folders — the ABC keyboard toggle lives here,
   * mirroring TouchChat's ABC/123 cell in the top category row. Passed in so
   * the bar stays a dumb list and the board owns the keyboard state.
   */
  leading?: React.ReactNode
}) {
  return (
    <div className="flex gap-2 overflow-x-auto border-b border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2">
      {leading}
      {categories.map((c) => {
        const icon = categoryIcon(c.key, firstWords[c.key])
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => onOpen(c)}
            className="flex shrink-0 items-center gap-2 rounded-full border border-[var(--color-line)] bg-[var(--color-surface-sunk)] px-4 py-2 text-sm font-semibold"
            style={{ minHeight: 44 }}
          >
            {/* Recognisable by shape, not only by reading. */}
            {icon && <CardFace label={icon} size={20} showLabel={false} />}
            <span>{c.name}</span>
          </button>
        )
      })}
    </div>
  )
}
