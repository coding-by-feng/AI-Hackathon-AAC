'use client'

import { useState } from 'react'
import { EssentialRail } from './essential-rail'
import type { BoardCard } from './board-app'

/**
 * The keyboard layer — alphabet access for emergent spellers (clinical gap C8).
 *
 * Patterns taken from the two commercial manuals:
 *
 *  - TouchChat puts an ABC/123 cell in the top category row; the keyboard is a
 *    page you visit and come back from, and its phonics keyboard is a
 *    lowercase QWERTY. This layer opens from an "ABC" chip in the category bar
 *    and uses the same lowercase QWERTY.
 *  - Proloquo2Go's Typing View has a text pad above the keys with Clear and a
 *    way back to the grid; typed text is inserted into the Message Window. Here
 *    the buffer above the keys holds ONE word, and completing it (space or
 *    Done) inserts it into the sentence composer as a chip.
 *
 * Like the category drawer, this slides OVER the board: the grid underneath
 * never rearranges. Delete edits only the word being typed — it can never touch
 * the composed sentence, so nothing destructive happens without its own press.
 * The essential rail rides inside the layer, because help / stop / yes / no
 * must stay one tap away even while spelling.
 */

const ROWS: string[][] = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
]

export function KeyboardLayer({
  onWord,
  onClose,
  essentials,
  onEssential,
}: {
  /** A completed word, ready to join the sentence exactly like a card. */
  onWord: (word: string) => void
  onClose: () => void
  essentials: BoardCard[]
  onEssential: (card: BoardCard) => void
}) {
  const [buffer, setBuffer] = useState('')

  const commit = (): boolean => {
    const word = buffer.trim()
    setBuffer('')
    if (!word) return false
    onWord(word)
    return true
  }

  const keyClass =
    'flex-1 select-none rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-sunk)] text-xl font-semibold'

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col justify-end bg-black/30"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard"
      onClick={onClose}
    >
      <div
        className="rounded-t-2xl border-t border-[var(--color-line)] bg-[var(--color-surface)] p-3"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* The word being typed — Proloquo2Go's text pad, scoped to one word. */}
        <div className="mb-2 flex items-center gap-2">
          <div className="flex min-h-[3.25rem] flex-1 items-center overflow-x-auto rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-sunk)] px-3">
            {buffer ? (
              <span className="text-2xl font-semibold tracking-wide">{buffer}</span>
            ) : (
              <span className="text-sm text-[var(--color-ink-faint)]">
                Type a word — space adds it to the sentence
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              commit()
              onClose()
            }}
            className="rounded-[var(--radius-card)] bg-[var(--color-accent)] px-5 font-semibold text-white"
            style={{ minHeight: 52 }}
          >
            Done
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          {ROWS.map((row, i) => (
            <div key={i} className="flex gap-1.5" style={i === 1 ? { padding: '0 4%' } : undefined}>
              {row.map((letter) => (
                <button
                  key={letter}
                  type="button"
                  onClick={() => setBuffer((b) => b + letter)}
                  className={keyClass}
                  style={{ minHeight: 56 }}
                >
                  {letter}
                </button>
              ))}
              {i === 2 && (
                <button
                  type="button"
                  onClick={() => setBuffer((b) => b.slice(0, -1))}
                  aria-label="Delete letter"
                  className="flex-[1.5] select-none rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-sunk)] text-xl"
                  style={{ minHeight: 56 }}
                >
                  ⌫
                </button>
              )}
            </div>
          ))}
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => commit()}
              className="flex-1 select-none rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-sunk)] text-base font-medium"
              style={{ minHeight: 56 }}
            >
              space — add word
            </button>
          </div>
        </div>

        {/* Help, stop, yes, no: one tap away even mid-spelling. */}
        <div className="mt-2">
          <EssentialRail essentials={essentials} onTap={onEssential} />
        </div>
      </div>
    </div>
  )
}
