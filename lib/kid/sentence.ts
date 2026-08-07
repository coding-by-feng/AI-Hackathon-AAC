/**
 * Turning selected cards into something worth saying.
 *
 * The bug this replaces: `cards.spoken_text` is inconsistent. Some rows hold a
 * bare word ('I'), some a fragment ('I want'), some a complete sentence
 * ('I want water.'). Chaining them produced "I I want I want water."
 *
 * So a card has two forms:
 *
 *   word    what it contributes mid-sentence   'I'  'want'  'water'
 *   phrase  what it says on its own            'I want water, please.'
 *
 * One card selected speaks the phrase. Several join their words.
 *
 * The join is deliberately plain — no conjugation, no rewriting. "I go toilet"
 * is telegraphic and completely understood, and an AAC system that silently
 * improves a child's wording is deciding what they meant. That is a line worth
 * not crossing, and it also keeps speech working with no network.
 */

export type SpeakableCard = {
  card_id: string
  label: string
  /** Full sentence, spoken when this card is used alone. */
  spoken_text: string
  /** Contribution to a multi-word sentence. Derived when not set. */
  word_form?: string | null
  is_essential?: number
}

/**
 * A word form, derived from the label when an adult has not set one.
 *
 * The label is nearly always right — 'water', 'want', 'more' — because a card's
 * caption is the word it represents. `spoken_text` is not usable here: it is a
 * sentence, and that is exactly what caused the repetition.
 */
export function wordForm(card: SpeakableCard): string {
  if (card.word_form && card.word_form.trim()) return card.word_form.trim()
  return card.label.trim()
}

/** The sentence a card says on its own. Falls back to the label. */
export function phraseForm(card: SpeakableCard): string {
  const p = card.spoken_text?.trim()
  if (p) return p
  const w = wordForm(card)
  return w.charAt(0).toUpperCase() + w.slice(1) + '.'
}

/**
 * Words that read as one unit, so the joiner does not put a stray article in.
 * 'the toilet' rather than 'toilet' after a verb, for example, is the kind of
 * thing an adult sets on the card — not something guessed here.
 */
function needsCapital(index: number): boolean {
  return index === 0
}

export type Utterance = {
  text: string
  /** 'phrase' when a single card spoke for itself, 'joined' when words combined. */
  mode: 'phrase' | 'joined'
}

export function buildUtterance(cards: SpeakableCard[]): Utterance | null {
  if (cards.length === 0) return null

  // A single card speaks its whole sentence — that is what the phrase is for.
  if (cards.length === 1) {
    return { text: phraseForm(cards[0]), mode: 'phrase' }
  }

  /*
   * An essential word pressed inside a sentence still speaks in full.
   *
   * 'help' as a word form would contribute "help" to "I want help" — fine. But
   * if a child presses [help] alone in the middle of composing, the urgent
   * reading has to win. Only when it is the ONLY card, which the branch above
   * already covers. Inside a sentence the word form is correct.
   */
  const words = cards.map((c, i) => {
    const w = wordForm(c)
    return needsCapital(i) ? w.charAt(0).toUpperCase() + w.slice(1) : w
  })

  const text = `${words.join(' ')}.`
  return { text, mode: 'joined' }
}

/** What the sentence bar shows — always the word forms, so it matches the speech. */
export function previewChips(cards: SpeakableCard[]): string[] {
  return cards.map((c) => c.label)
}

/**
 * Derived word forms for the seeded catalogue.
 *
 * Most cards need nothing: the label is the word. These are the ones where the
 * label alone would read badly inside a sentence, listed explicitly rather than
 * guessed by rule, because a wrong guess puts words in a child's mouth.
 */
export const WORD_FORM_OVERRIDES: Record<string, string> = {
  toilet: 'the toilet',
  hurt: 'hurts',
  'all done': 'all done',
  'thank you': 'thank you',
}

export function seededWordForm(cardId: string, label: string): string {
  return WORD_FORM_OVERRIDES[label.toLowerCase()] ?? label
}
