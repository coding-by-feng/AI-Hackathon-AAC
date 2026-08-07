import type { ReactNode } from 'react'

/**
 * Built-in AAC symbol set.
 *
 * Inline SVG rather than image files, for four reasons that all matter here:
 *  - crisp at every cell size across the four breakpoints, with no sprite sheet
 *  - works with no network, which the board must
 *  - inherits colour, so the same symbol reads correctly in light and dark
 *  - nothing to 404, and no per-card request
 *
 * One drawing style throughout: 24×24 box, no fill, 2px round strokes. Symbol
 * sets fail when each icon is drawn to its own taste — a child learning to scan
 * a grid is reading shape and weight before they read meaning.
 *
 * Colour follows the Fitzgerald key, which most AAC systems and most speech
 * therapists already use: word class is the grouping, so the colours a child
 * learns here transfer to other boards rather than competing with them.
 */

export type WordClass = 'pronoun' | 'verb' | 'descriptor' | 'noun' | 'social' | 'urgent'

export const CLASS_STYLE: Record<WordClass, { bg: string; fg: string; border: string; name: string }> = {
  pronoun: { bg: '#fff8db', fg: '#7a5c00', border: '#e8c95a', name: 'people' },
  verb: { bg: '#e6f6ea', fg: '#1c6b3a', border: '#7bc396', name: 'doing' },
  descriptor: { bg: '#e8f0fd', fg: '#1f4f9c', border: '#8bb0e8', name: 'describing' },
  noun: { bg: '#fdeee0', fg: '#8a4a12', border: '#e5a76a', name: 'things' },
  social: { bg: '#fbe9f2', fg: '#8c2b5c', border: '#e08cb4', name: 'social' },
  urgent: { bg: '#fdeaea', fg: '#9c1f1f', border: '#e08585', name: 'important' },
}

type Symbol = { wordClass: WordClass; art: ReactNode }

const s = (wordClass: WordClass, art: ReactNode): Symbol => ({ wordClass, art })

/**
 * Keyed by card label, lowercased. Falls back to the card's initial letter when
 * nothing matches — never to a broken image.
 */
export const SYMBOLS: Record<string, Symbol> = {
  /* ---- important / urgent ------------------------------------------------ */
  yes: s('social', <><path d="M4 13l5 5L20 7" /></>),
  no: s('urgent', <><path d="M6 6l12 12M18 6L6 18" /></>),
  stop: s('urgent', <><path d="M8 2h8l6 6v8l-6 6H8l-6-6V8z" /><path d="M12 8v5" /><circle cx="12" cy="16.5" r=".6" fill="currentColor" /></>),
  help: s('urgent', <><path d="M12 3a5 5 0 0 1 5 5c0 3-3 3.5-3 6" /><circle cx="12" cy="19" r=".8" fill="currentColor" /><path d="M3 20a9 9 0 0 1 4-7" /></>),
  hurt: s('urgent', <><path d="M12 21s-7-4.5-7-9.5A4 4 0 0 1 12 9a4 4 0 0 1 7 2.5c0 5-7 9.5-7 9.5z" /><path d="M9.5 12h5M12 9.5v5" /></>),
  not: s('urgent', <><circle cx="12" cy="12" r="9" /><path d="M6 18L18 6" /></>),

  /* ---- people / pronouns ------------------------------------------------- */
  i: s('pronoun', <><circle cx="12" cy="6" r="3" /><path d="M6 21v-2a6 6 0 0 1 12 0v2" /><path d="M12 12v3" /></>),
  you: s('pronoun', <><circle cx="16" cy="6" r="3" /><path d="M10 21v-2a6 6 0 0 1 12 0v2" /><path d="M2 12h6M5 9l-3 3 3 3" /></>),
  my: s('pronoun', <><circle cx="9" cy="6" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2" /><path d="M18 9l3 3-3 3" /></>),
  this: s('pronoun', <><path d="M12 3v12" /><path d="M8 11l4 4 4-4" /><path d="M5 20h14" /></>),
  dad: s('pronoun', <><circle cx="12" cy="6" r="3" /><path d="M6 21v-3a6 6 0 0 1 12 0v3" /><path d="M9 12h6" /></>),
  mum: s('pronoun', <><circle cx="12" cy="6" r="3" /><path d="M6 21l2-7h8l2 7" /><path d="M9 21v-4M15 21v-4" /></>),
  teacher: s('pronoun', <><rect x="3" y="4" width="12" height="9" rx="1" /><path d="M6 8h6" /><circle cx="19" cy="7" r="2" /><path d="M16 20v-3a3 3 0 0 1 6 0v3" /></>),

  /* ---- doing words ------------------------------------------------------- */
  want: s('verb', <><path d="M8 13V5a1.5 1.5 0 0 1 3 0v6" /><path d="M11 11V4a1.5 1.5 0 0 1 3 0v7" /><path d="M14 11V6a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-7 7 7 7 0 0 1-6-6l-1-4a1.5 1.5 0 0 1 3-1z" /></>),
  go: s('verb', <><path d="M4 12h14" /><path d="M13 6l6 6-6 6" /></>),
  like: s('verb', <><path d="M12 20s-7-4.5-7-9.5A3.5 3.5 0 0 1 12 8a3.5 3.5 0 0 1 7 2.5c0 5-7 9.5-7 9.5z" /></>),
  look: s('verb', <><path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>),
  do: s('verb', <><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></>),
  turn: s('verb', <><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /></>),
  swimming: s('verb', <><circle cx="17" cy="6" r="2" /><path d="M4 11l4-2 4 3 3-2" /><path d="M2 17c2 0 2 1.5 4 1.5S8 17 10 17s2 1.5 4 1.5S16 17 18 17s2 1.5 4 1.5" /></>),
  finished: s('descriptor', <><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></>),
  'all done': s('descriptor', <><path d="M3 6h18M3 12h18M3 18h18" /><path d="M5 4l14 16" /></>),

  /* ---- describing words -------------------------------------------------- */
  more: s('descriptor', <><path d="M12 5v14M5 12h14" /></>),
  again: s('descriptor', <><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></>),
  different: s('descriptor', <><circle cx="7" cy="12" r="4" /><rect x="14" y="8" width="8" height="8" /></>),
  good: s('descriptor', <><path d="M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6L3.4 9.4l6-.8z" /></>),
  what: s('descriptor', <><path d="M9 9a3 3 0 1 1 4 2.8c-.7.3-1 1-1 1.7v.5" /><circle cx="12" cy="18" r=".8" fill="currentColor" /><circle cx="12" cy="12" r="9" /></>),
  where: s('descriptor', <><path d="M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11z" /><circle cx="12" cy="10" r="2.2" /></>),
  here: s('descriptor', <><path d="M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11z" /><circle cx="12" cy="10" r="1" fill="currentColor" /></>),

  /* ---- social ------------------------------------------------------------ */
  please: s('social', <><path d="M12 3v8" /><path d="M8 7l4-4 4 4" /><path d="M5 13a7 7 0 0 0 14 0" /><path d="M5 13v3a7 7 0 0 0 14 0v-3" /></>),
  'thank you': s('social', <><path d="M12 4v7" /><path d="M9 8l3 3 3-3" /><path d="M6 21a6 6 0 0 1 12 0" /><circle cx="12" cy="15" r="1.6" /></>),

  /* ---- things ------------------------------------------------------------ */
  water: s('noun', <><path d="M7 3h10l-1 18H8z" /><path d="M7.6 11h8.8" /></>),
  toilet: s('noun', <><path d="M6 3v7a6 6 0 0 0 12 0V3" /><path d="M8 16l-1 5h10l-1-5" /></>),
  biscuit: s('noun', <><circle cx="12" cy="12" r="9" /><circle cx="9" cy="10" r=".9" fill="currentColor" /><circle cx="14" cy="9" r=".9" fill="currentColor" /><circle cx="12" cy="15" r=".9" fill="currentColor" /></>),
  cookie: s('noun', <><circle cx="12" cy="12" r="9" /><circle cx="9" cy="9" r="1" fill="currentColor" /><circle cx="15" cy="11" r="1" fill="currentColor" /><circle cx="11" cy="15" r="1" fill="currentColor" /></>),
  milkshake: s('noun', <><path d="M7 8h10l-1.2 12H8.2z" /><path d="M9 8V5h6v3" /><path d="M14 8l3-5" /></>),
  snack: s('noun', <><path d="M12 8c-3-3-8-1-8 4s5 9 8 9 8-4 8-9-5-7-8-4z" /><path d="M12 8V4M12 4c1.5 0 2.5-1 2.5-2" /></>),
  ball: s('noun', <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></>),
  book: s('noun', <><path d="M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4z" /><path d="M20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z" /></>),
  home: s('noun', <><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></>),
  tooth: s('noun', <><path d="M7 3c-2 0-3 2-3 4 0 4 1 5 1.5 9 .3 2.5 2.5 2.5 3-1 .3-2 .7-3 1.5-3s1.2 1 1.5 3c.5 3.5 2.7 3.5 3 1 .5-4 1.5-5 1.5-9 0-2-1-4-3-4-1.5 0-2 .8-3 .8S8.5 3 7 3z" /></>),
  helicopter: s('noun', <><path d="M3 6h18" /><path d="M12 6v3" /><path d="M6 12a4 4 0 0 1 4-3h5l4 4v2h-9a4 4 0 0 1-4-3z" /><path d="M15 15v3M12 18h6" /></>),
  music: s('noun', <><path d="M9 18V6l11-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="16" r="2.5" /></>),
  outside: s('noun', <><circle cx="8" cy="7" r="3" /><path d="M8 1v1.5M8 11.5V13M2 7h1.5M12.5 7H14M4 3l1 1M11 10l1 1M12 3l-1 1M5 10l-1 1" /><path d="M17 21v-6" /><path d="M14 15a3 3 0 0 1 6 0z" /><path d="M4 21h16" /></>),

  /* ---- feelings ----------------------------------------------------------
   * Faces, because a feeling word is the hardest thing to find by reading. All
   * six share one head shape and differ only in the mouth and brows, so they
   * read as a family and a child learns the set rather than six pictures.
   * ---------------------------------------------------------------------- */
  happy: s('descriptor', <><circle cx="12" cy="12" r="9" /><path d="M8 14a5 5 0 0 0 8 0" /><circle cx="9" cy="10" r=".8" fill="currentColor" /><circle cx="15" cy="10" r=".8" fill="currentColor" /></>),
  sad: s('descriptor', <><circle cx="12" cy="12" r="9" /><path d="M8 16a5 5 0 0 1 8 0" /><circle cx="9" cy="10" r=".8" fill="currentColor" /><circle cx="15" cy="10" r=".8" fill="currentColor" /></>),
  angry: s('descriptor', <><circle cx="12" cy="12" r="9" /><path d="M8 16a5 5 0 0 1 8 0" /><path d="M7 8l3 1.5M17 8l-3 1.5" /><circle cx="9.5" cy="11.5" r=".8" fill="currentColor" /><circle cx="14.5" cy="11.5" r=".8" fill="currentColor" /></>),
  scared: s('descriptor', <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="15.5" rx="2.5" ry="2" /><circle cx="9" cy="10" r="1.2" /><circle cx="15" cy="10" r="1.2" /></>),
  tired: s('descriptor', <><circle cx="12" cy="12" r="9" /><path d="M7 10.5h4M13 10.5h4" /><path d="M9.5 15.5h5" /></>),
  excited: s('descriptor', <><circle cx="12" cy="12" r="9" /><path d="M8 13a5 5 0 0 0 8 0z" /><path d="M7 9l2-1.5 2 1.5M13 9l2-1.5 2 1.5" /></>),

  /* ---- behaviour and turn-taking ---------------------------------------- */
  wait: s('verb', <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  'my turn': s('pronoun', <><circle cx="8" cy="7" r="2.5" /><path d="M3 20v-2a5 5 0 0 1 10 0v2" /><path d="M17 8v8M14 13l3 3 3-3" /></>),
  'your turn': s('pronoun', <><circle cx="16" cy="7" r="2.5" /><path d="M11 20v-2a5 5 0 0 1 10 0v2" /><path d="M7 8v8M4 11l3-3 3 3" /></>),
  share: s('verb', <><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6" /></>),
  sorry: s('social', <><circle cx="12" cy="12" r="9" /><path d="M9 15.5h6" /><circle cx="9" cy="10" r=".8" fill="currentColor" /><circle cx="15" cy="10" r=".8" fill="currentColor" /><path d="M7 7l1.5 1M17 7l-1.5 1" /></>),
  listen: s('verb', <><path d="M8 8a4 4 0 1 1 6 3.5c-1 .8-1.5 1.5-1.5 3" /><circle cx="12" cy="19" r=".8" fill="currentColor" /><path d="M3 12a9 9 0 0 1 4-7" /></>),
  gentle: s('descriptor', <><path d="M12 20s-7-4.5-7-9.5A3.5 3.5 0 0 1 12 8a3.5 3.5 0 0 1 7 2.5c0 5-7 9.5-7 9.5z" /><path d="M9.5 12.5l1.8 1.8 3.2-3.4" /></>),
  break: s('verb', <><rect x="3" y="7" width="12" height="9" rx="2" /><path d="M15 10h3a2.5 2.5 0 0 1 0 5h-3" /><path d="M6 4v1.5M10 4v1.5" /></>),

  /* ---- more food and drink ----------------------------------------------- */
  hungry: s('noun', <><path d="M6 3v8a2 2 0 0 0 4 0V3" /><path d="M8 11v10" /><path d="M16 3c-1.5 2-2 4-2 6a2 2 0 0 0 4 0c0-2-.5-4-2-6z" /><path d="M16 11v10" /></>),
  thirsty: s('noun', <><path d="M12 3s5 6 5 9.5A5 5 0 0 1 7 12.5C7 9 12 3 12 3z" /></>),
  apple: s('noun', <><path d="M12 8c-3-3-8-1-8 4s5 9 8 9 8-4 8-9-5-7-8-4z" /><path d="M12 8V4" /><path d="M12 5c1.5 0 3-1 3-2.5" /></>),
  juice: s('noun', <><path d="M7 6h10l-1 15H8z" /><path d="M9 6V3h6v3" /><path d="M7.6 12h8.8" /></>),

  /* ---- more activities ---------------------------------------------------- */
  play: s('verb', <><circle cx="12" cy="12" r="9" /><path d="M10 8.5l6 3.5-6 3.5z" /></>),
  draw: s('verb', <><path d="M16 3l5 5L9 20l-6 1 1-6z" /><path d="M14 5l5 5" /></>),
  sing: s('verb', <><path d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z" /><path d="M6 11a6 6 0 0 0 12 0" /><path d="M12 17v4M9 21h6" /></>),
  dance: s('verb', <><circle cx="13" cy="4.5" r="2" /><path d="M13 7l-2 5 3 3 1 6" /><path d="M11 12l-4 2M14 15l-3 6" /><path d="M17 6l3 2" /></>),
  walk: s('verb', <><circle cx="13" cy="4.5" r="2" /><path d="M13 7l-1.5 5 3 3 1.5 6" /><path d="M11.5 12L8 15l-1 5" /></>),
  garden: s('noun', <><path d="M12 21V9" /><path d="M12 12c0-3-2-5-5-5 0 3 2 5 5 5z" /><path d="M12 15c0-3 2-5 5-5 0 3-2 5-5 5z" /><path d="M4 21h16" /></>),
}

/**
 * Numbers render as digits rather than drawings.
 *
 * A picture of four apples means "apple" as readily as it means "four". The
 * numeral is unambiguous, and it is also what the child will meet everywhere
 * else — on a clock, a page, a lift button.
 */
export function isNumeral(label: string): boolean {
  return /^\d{1,2}$/.test(label.trim())
}

/**
 * A representative symbol for each category folder.
 *
 * The chips were text-only, which makes the bar a row of words to read — the
 * one thing an AAC user may not be able to do. Each folder now carries a
 * picture drawn from its own contents, so it can be recognised by shape.
 */
export const CATEGORY_ICON: Record<string, string> = {
  feelings: 'happy',
  food: 'apple',
  activities: 'play',
  behaviour: 'wait',
  numbers: 'more',
  people: 'i',
  places: 'home',
  body: 'hurt',
  describing: 'good',
}

/** Falls back to the first word in the folder, then to nothing. */
export function categoryIcon(categoryId: string, firstWord?: string): string | null {
  const direct = CATEGORY_ICON[categoryId]
  if (direct && SYMBOLS[direct]) return direct
  if (firstWord && SYMBOLS[firstWord.toLowerCase()]) return firstWord.toLowerCase()
  return null
}

export function symbolFor(label: string): Symbol | null {
  return SYMBOLS[label.trim().toLowerCase()] ?? null
}

export function wordClassFor(label: string): WordClass | null {
  return symbolFor(label)?.wordClass ?? null
}

/** Every symbol name, for the picker in the edit sheet. */
export function allSymbolNames(): string[] {
  return Object.keys(SYMBOLS).sort()
}

export function SymbolArt({ label, size = 32 }: { label: string; size?: number }) {
  const sym = symbolFor(label)
  if (!sym) return null
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      {sym.art}
    </svg>
  )
}
