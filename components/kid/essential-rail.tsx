'use client'

import { CardFace, faceColours } from './card-face'
import type { BoardCard } from './board-app'

/**
 * The six always-available words, extracted so every layer can carry them.
 *
 * The clinical rule is that help / stop / yes / no are never more than one tap
 * away — including from the keyboard layer, which slides over the board. So the
 * rail is a component, not markup welded into the board, and any overlay that
 * covers the bottom of the screen renders its own copy.
 */
export function EssentialRail({
  essentials,
  onTap,
}: {
  essentials: BoardCard[]
  onTap: (card: BoardCard) => void
}) {
  return (
    <div className="flex gap-2 overflow-x-auto">
      {essentials.map((card) => (
        <button
          key={card.card_id}
          type="button"
          onClick={() => onTap(card)}
          className="flex-1 shrink-0 rounded-[var(--radius-card)] border-2 border-[var(--color-ink)] px-2 py-2"
          style={{ minHeight: 64, minWidth: 84, ...faceColours(card.label, card.symbol) }}
        >
          <CardFace
            label={card.label}
            symbolKey={card.symbol}
            imageData={card.image_data}
            size="clamp(32px, 6.5vh, 68px)"
          />
        </button>
      ))}
    </div>
  )
}
