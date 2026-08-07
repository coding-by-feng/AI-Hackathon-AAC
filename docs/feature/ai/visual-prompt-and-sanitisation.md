# Visual Prompt & Concept Sanitisation

## Function
Two small modules that together decide exactly what leaves the device for an image request: `sanitize.ts` strips identifying words and caps length, `normalizeConcept()` produces the cache key, and `prompt.ts` renders one house-style prompt template for every card.

## Purpose

**Sanitisation is a shape, not a discipline.** The header comment is explicit: an image request is built from a concept string and nothing else. The child's name, year group, profile note, board, metrics and anything they have ever said stay here — *"not because the calling code remembers to omit them, but because this is the only way to construct a request and it accepts nothing else. Preventing the leak by the shape of the function beats preventing it by discipline, because discipline is where these things fail."*

**One prompt template, because a board where each symbol is drawn in a different style is harder to scan.** A child learning to find a word is reading shape and weight before they read meaning, so consistency matters more than any individual picture looking good. The constraints are not stylistic preferences: no text because the user may not read; one subject because two objects in a frame is two meanings; plain background because detail competes with the thing that carries the meaning.

## Source Files
| File | Role |
|------|------|
| `lib/visuals/sanitize.ts` | `VisualSpec`, `sanitizeConcept()`, `normalizeConcept()`, `toRequest()`, `IDENTIFYING`, `STOPWORDS` |
| `lib/visuals/prompt.ts` | `StyleConfig`, `HOUSE_STYLE`, `buildPrompt()` |

## Implementation

### `VisualSpec`
```ts
type VisualSpec = {
  concept: string   // the word the picture is for: 'milkshake'
  detail?: string   // optional description an adult typed: 'tall cup with a straw'
}
```

### `IDENTIFYING`
```js
/\b(mr|mrs|ms|miss|dr|mum|mummy|mom|dad|daddy|nan|nana|grandma|grandad)\b/gi
```
A card called **"Mrs Patel"** must not send a real teacher's name to an image API. The concept becomes `teacher`… — and the comment argues this is also the better picture: *a generated stranger's face standing in for someone the child knows is worse than a generic symbol.* For a real person a photo is the right answer, and the edit sheet says so.

> Note what the code actually does: the title token is replaced with a space, but the surrounding proper noun is **not** removed. `"Mrs Patel"` → `"patel"`, not `"teacher"`. The in-code justification is that "a proper noun following a title is gone with it; any remaining capitalised name is already lowercased and carries no more signal than an ordinary word." The lowercasing is real; the removal of the surname is not.

### `sanitizeConcept(raw)` — pipeline, in order
1. `.toLowerCase()`
2. `.replace(IDENTIFYING, ' ')`
3. `.replace(/[^a-z0-9\s-]/g, ' ')` — everything but lowercase letters, digits, whitespace and hyphen
4. `.replace(/\s+/g, ' ')`
5. `.trim()`
6. `.slice(0, 80)` — hard length cap

### `STOPWORDS` (24 entries, verbatim)
`a · an · the · of · to · for · my · his · her · their · some · this · that · i · want · need · like · please · can · have · get · is · are · and`

### `normalizeConcept(raw)` — the cache key
`sanitizeConcept(raw)` → split on `' '` → drop empties and stopwords → **`.sort()`** → join with `' '`.

Sorting makes the key order-insensitive, so `'a drink of water'`, `'Water!'` and `'the water'` all collapse to `water`. Without it "the cache misses on wording rather than meaning and every phrasing costs a fresh generation".

### `toRequest(spec)`
Returns `{ concept: sanitizeConcept(spec.concept), detail: spec.detail ? sanitizeConcept(spec.detail) : null }` — "everything the outside world is allowed to see about a request". **Currently exported but not imported anywhere**; `lib/visuals/ladder.ts` calls `sanitizeConcept()` on the two fields directly, producing the same values.

### `HOUSE_STYLE: StyleConfig`
| Key | Value |
|---|---|
| `illustration` | `flat vector illustration with clean bold outlines and simple shapes` |
| `background` | `plain solid off-white background` |
| `detail` | `minimal detail, no shading, no gradients, no texture` |

### `buildPrompt(concept, detail)`
`subject = detail ? `${concept} — ${detail}` : concept` (em dash). Joined with `'\n'`:

```
A single AAC communication symbol representing: <subject>.

Style: <illustration>. <background>. <detail>.
One clear subject, centred, filling most of the frame.
Instantly recognisable at the size of a thumbnail.

Must not contain: any text, letters, numbers, words or labels;
speech bubbles; logos or watermarks; borders or frames;
more than one main object; background scenery; people unless the concept
itself is a person.

This is a picture a child who cannot read will use to speak.
It has to be understood without any words at all.
```

The prompt is stored verbatim in `generated_visuals.prompt` alongside the image, so a picture can always be traced to the exact text that produced it.

## Dependencies & Connections

### Depends On
- Nothing. Both files are pure functions with no imports.

### Depended On By
- [visual-resolution-ladder](visual-resolution-ladder.md) — `sanitizeConcept()` on `spec.concept` and `spec.detail` at the top of `resolveVisual()`, `normalizeConcept()` in the `gap_detected` payload, `buildPrompt()` at step 5
- [visual-cache](visual-cache.md) — `normalizeConcept()` is the storage key (`generated_visuals.normalized_concept`) and the `findExact()` lookup key
- [image-providers](image-providers.md) — receives the built prompt string; it never sees the raw `VisualSpec`

### Shared Resources
- `normalizeConcept()` output is written into **two** places that must agree: `generated_visuals.normalized_concept` (the cache index) and the `gap_detected` payload key `normalizedConcept` (read by `vocabularyGaps()` and `unreviewedGapCount()`)
- `HOUSE_STYLE` governs every generated card's appearance across the whole board

## Change Risks
- **Changing `normalizeConcept()`** invalidates the entire existing cache: previously stored `normalized_concept` values no longer match new lookups, so every concept regenerates once at `IMAGE_COST_USD` each. It also re-buckets historical `vocabulary_gaps` rows, since the metric groups by the stored payload value, not a recomputed one.
- **Adding a word to `STOPWORDS`** merges cache buckets that were previously distinct — cheap and usually desirable, but it also merges historical vocabulary-gap groupings retroactively for new events only, so a gap list can appear to split across two spellings.
- **Removing a term from `IDENTIFYING`** sends a family term (`mum`, `nana`) straight to a third-party image API attached to a child's board.
- **Relaxing the `[^a-z0-9\s-]` filter** would allow punctuation and non-Latin characters through — the 80-character cap is the only other bound on what is sent.
- **Editing `HOUSE_STYLE` or `buildPrompt()`** makes newly generated cards visually inconsistent with everything already in `generated_visuals`, which is exactly the scanning problem the single-template decision exists to avoid. Cached pictures are never regenerated to match.
- **Loosening the "Must not contain" list** (particularly the no-text clause) produces symbols with words on them for a user who cannot read.
- **`toRequest()` is unused** — deleting it is safe today, but any new caller must not bypass it in favour of raw `spec` values.
