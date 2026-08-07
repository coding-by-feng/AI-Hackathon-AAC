/**
 * Turning a concept into an image prompt.
 *
 * One template for every card, because a board where each symbol is drawn in a
 * different style is harder to scan — a child learning to find a word is
 * reading shape and weight before they read meaning. Consistency matters more
 * than any individual picture looking good.
 *
 * The constraints below are not stylistic preferences. No text, because the
 * user may not read. One subject, because two objects in a frame is two
 * meanings. Plain background, because detail competes with the thing that
 * carries the meaning.
 */

export type StyleConfig = {
  illustration: string
  background: string
  detail: string
}

export const HOUSE_STYLE: StyleConfig = {
  illustration: 'flat vector illustration with clean bold outlines and simple shapes',
  background: 'plain solid off-white background',
  detail: 'minimal detail, no shading, no gradients, no texture',
}

export function buildPrompt(concept: string, detail: string | null): string {
  const subject = detail ? `${concept} — ${detail}` : concept

  return [
    `A single AAC communication symbol representing: ${subject}.`,
    '',
    `Style: ${HOUSE_STYLE.illustration}. ${HOUSE_STYLE.background}. ${HOUSE_STYLE.detail}.`,
    'One clear subject, centred, filling most of the frame.',
    'Instantly recognisable at the size of a thumbnail.',
    '',
    'Must not contain: any text, letters, numbers, words or labels;',
    'speech bubbles; logos or watermarks; borders or frames;',
    'more than one main object; background scenery; people unless the concept',
    'itself is a person.',
    '',
    'This is a picture a child who cannot read will use to speak.',
    'It has to be understood without any words at all.',
  ].join('\n')
}
