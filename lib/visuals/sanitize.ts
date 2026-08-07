/**
 * What may leave the device.
 *
 * An image request is built from a concept string and nothing else. The child's
 * name, year group, profile note, board, metrics and anything they have ever
 * said stay here — not because the calling code remembers to omit them, but
 * because this is the only way to construct a request and it accepts nothing
 * else.
 *
 * Preventing the leak by the shape of the function beats preventing it by
 * discipline, because discipline is where these things fail.
 */

export type VisualSpec = {
  /** The word the picture is for: 'milkshake'. */
  concept: string
  /** Optional description an adult typed: 'tall cup with a straw'. */
  detail?: string
}

/** Words that would identify a person if they reached an external service. */
const IDENTIFYING = /\b(mr|mrs|ms|miss|dr|mum|mummy|mom|dad|daddy|nan|nana|grandma|grandad)\b/gi

/**
 * Strip anything that could identify a person, then cap the length.
 *
 * A card called "Mrs Patel" must not send a real teacher's name to an image
 * API. The concept becomes 'teacher', which is also the better picture: a
 * generated stranger's face standing in for someone the child knows is worse
 * than a generic symbol. For a real person, a photo is the right answer, and
 * the edit sheet says so.
 */
export function sanitizeConcept(raw: string): string {
  return raw
    .toLowerCase()
    .replace(IDENTIFYING, ' ')
    // A proper noun following a title is gone with it; any remaining
    // capitalised name is already lowercased and carries no more signal than
    // an ordinary word.
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

/**
 * The cache key.
 *
 * 'a drink of water', 'Water!' and 'the water' must all collapse to the same
 * key, or the cache misses on wording rather than meaning and every phrasing
 * costs a fresh generation.
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'to', 'for', 'my', 'his', 'her', 'their', 'some', 'this', 'that',
  'i', 'want', 'need', 'like', 'please', 'can', 'have', 'get', 'is', 'are', 'and',
])

export function normalizeConcept(raw: string): string {
  return sanitizeConcept(raw)
    .split(' ')
    .filter((w) => w && !STOPWORDS.has(w))
    .sort()
    .join(' ')
}

/** Everything the outside world is allowed to see about a request. */
export function toRequest(spec: VisualSpec): { concept: string; detail: string | null } {
  return {
    concept: sanitizeConcept(spec.concept),
    detail: spec.detail ? sanitizeConcept(spec.detail) : null,
  }
}
