import { SymbolArt, symbolFor, CLASS_STYLE, type WordClass } from '@/lib/icons/symbols'
import { aiIconFor } from '@/lib/icons/ai-manifest'

export type CardFaceProps = {
  label: string
  /** Overrides the symbol looked up from the label. */
  symbolKey?: string | null
  /** A photo replaces the symbol entirely — preferred for personal things. */
  imageData?: string | null
  /** A number is pixels; a string is any CSS length (e.g. clamp()) so the icon can scale with the card. */
  size?: number | string
  showLabel?: boolean
}

/**
 * What a card looks like.
 *
 * Four tiers, in priority order:
 *   1. a photo, if one has been set — a real picture of *their* cup beats any
 *      generic drawing of a cup
 *   2. the AI-generated icon for the word (pre-generated, served from
 *      public/icons/ai/ — a static asset, never a runtime API call)
 *   3. the built-in symbol for the word — the offline fallback set
 *   4. the first letter, when nothing matches
 *
 * The last tier is the point. A missing symbol must degrade to something
 * legible, never to an empty box or a broken image icon: the child still needs
 * to find the word.
 *
 * COLOUR IS OWNED HERE, not inherited.
 *
 * Card backgrounds are fixed pale pastels carrying the Fitzgerald key — yellow
 * for people, green for doing words, and so on. Those must not change between
 * light and dark mode, or a child re-learns the colour code every time the
 * theme flips. But the page's ink colour *does* flip, and a near-white label on
 * pale yellow is invisible: the word disappears and only the picture is left.
 *
 * So the face sets its own foreground from the word class, and both the symbol
 * and the label inherit it.
 */
export function CardFace({
  label,
  symbolKey,
  imageData,
  size = 40,
  showLabel = true,
}: CardFaceProps) {
  const lookup = symbolKey ?? label
  const sym = symbolFor(lookup)
  const aiIcon = aiIconFor(lookup)
  const cls: WordClass | null = sym?.wordClass ?? null
  const style = cls ? CLASS_STYLE[cls] : null

  // SVG width/height attributes need a number; CSS sizes go through style.
  // A CSS size is capped at the card's own width and keeps aspect-ratio 1 —
  // otherwise flex squeezes the img narrower than its height on small cards
  // and object-cover crops the sides of the picture.
  const px = typeof size === 'number' ? size : undefined
  const box =
    px !== undefined
      ? { width: px, height: px }
      : { width: `min(${size}, 100%)`, height: 'auto', aspectRatio: '1' }

  // With a word class the card is a pale pastel, so the dark class colour is
  // correct in both themes. Without one the card uses the surface colour, where
  // the theme's own ink is the right choice.
  const ink = style?.fg ?? 'var(--color-ink)'

  return (
    // min-w-0/max-w-full: without them a long label ("different") sets this
    // column's min-content width wider than the card button, the icon sized at
    // 100% follows it past the borders, and neighbouring labels collide.
    <span className="flex min-w-0 max-w-full flex-col items-center justify-center gap-1" style={{ color: ink }}>
      {imageData ? (
        // eslint-disable-next-line @next/next/no-img-element -- a data: URL, already downscaled client-side
        <img src={imageData} alt="" width={px} height={px} className="rounded-md object-cover" style={box} />
      ) : aiIcon ? (
        // eslint-disable-next-line @next/next/no-img-element -- small static asset, no next/image pipeline needed
        <img src={aiIcon} alt="" width={px} height={px} className="rounded-md object-cover" style={box} />
      ) : sym ? (
        <SymbolArt label={lookup} size={size} />
      ) : (
        <span
          aria-hidden
          className="flex items-center justify-center rounded-md font-bold"
          style={{
            ...box,
            fontSize: px !== undefined ? px * 0.55 : `calc(${size} * 0.55)`,
            background: 'var(--color-surface-sunk)',
            color: 'var(--color-ink-muted)',
          }}
        >
          {label.trim().charAt(0).toUpperCase()}
        </span>
      )}
      {showLabel && (
        <span className="max-w-full text-sm leading-tight font-semibold [overflow-wrap:anywhere] sm:text-lg">
          {label}
        </span>
      )}
    </span>
  )
}

/**
 * Background and border for a card, from its word class.
 *
 * `color` travels with them so anything rendered inside the card — including
 * text the face does not own, like an edit badge — is legible against it.
 */
export function faceColours(label: string, symbolKey?: string | null) {
  const sym = symbolFor(symbolKey ?? label)
  if (!sym) {
    return {
      background: 'var(--color-surface)',
      borderColor: 'var(--color-line)',
      color: 'var(--color-ink)',
    }
  }
  const style = CLASS_STYLE[sym.wordClass]
  return { background: style.bg, borderColor: style.border, color: style.fg }
}
