# Visual Resolution Ladder

## Function
`resolveVisual()` finds a picture for a concept by trying five sources cheapest-first — built-in symbol set, another card's picture, exact cache, semantic cache, then paid image generation — and writes a `gap_detected` event recording which step resolved it.

## Purpose
Generation is the last resort, not the default. The header comment states the product claim precisely: **AI fills gaps in a vocabulary, it does not draw every symbol.** If most resolutions reach step 5, the ladder is mis-tuned and the dashboard's cost panel will say so.

The `gap_detected` event is written for **every** step, not just for generation, because the useful figure is the *ratio*: what share of pictures cost nothing. Logging only the paid ones would show a column of failures with no denominator. Two dashboard panels — "Where her pictures come from" and "Words she reached for that do not exist" — read those events and are empty until this runs.

## Source Files
| File | Role |
|------|------|
| `lib/visuals/ladder.ts` | `resolveVisual()`, `Resolution`, `ResolvedBy`, `ResolveOptions`, `logGap()` |

## Implementation

### The ladder, as documented in the file header
| Step | Source | Cost | Latency |
|---|---|---|---|
| 1 | built-in symbol set | $0 | instant |
| 2 | another card's picture | $0 | ~1 ms |
| 3 | exact concept in cache | $0 | ~2 ms |
| 4 | semantic match in cache | ~$0 | ~200 ms (an embedding, not an image) |
| 5 | image generation API | $$ | 5–15 s |

### Constants
| Name | Value | Note |
|------|-------|------|
| `IMAGE_COST_USD` | `0.02` | Rough per-image figure for the cost panel — indicative, not billing |
| `EMBED_COST_USD` | `0.00002` | Per embedding call |

### Types
```ts
type ResolvedBy = 'icon_pack' | 'card_library' | 'hash_cache' | 'semantic' | 'generated' | 'failed'

type Resolution = {
  resolvedBy: ResolvedBy
  symbol?: string | null      // step 1/2 — the key into the symbol set
  imageData?: string | null   // step 3/4/5 — a data: URL
  candidates?: string[]       // only when freshly generated
  visualId?: string | null
  ms: number
  costUsd: number             // zero for steps 1–3
  note: string
}

type ResolveOptions = {
  spec: VisualSpec            // { concept, detail? }
  childId?: string | null
  createdBy?: string | null
  forceGenerate?: boolean     // skip steps 1–4 when an adult explicitly asked for something new
  scene?: string
}
```

### Flow, in execution order
1. `started = Date.now()`. `concept = sanitizeConcept(spec.concept)`, `detail = spec.detail ? sanitizeConcept(spec.detail) : null` — see [visual-prompt-and-sanitisation](visual-prompt-and-sanitisation.md).
2. `finish()` closure stamps `ms = Date.now() - started`, calls `logGap()`, and returns.
3. Empty `concept` → `{ resolvedBy: 'failed', costUsd: 0, note: 'Nothing to draw' }`.
4. **Steps 1–3 are skipped entirely when `forceGenerate` is true.**
   - **Step 1 — `icon_pack`.** `symbolFor(concept)` (from `lib/icons/symbols.tsx`, lowercased-label lookup) → `{ symbol: concept, costUsd: 0, note: 'Already in the built-in symbol set' }`. Free, instant, and consistent with the rest of the board.
   - **Step 2 — `card_library`.** `SELECT label FROM cards WHERE lower(label) = ? LIMIT 1`, and the found label must *also* have a built-in symbol → `{ symbol: existing.label, costUsd: 0, note: 'Reused from another card' }`.
   - **Step 3 — `hash_cache`.** `findExact(concept)`; on hit `markUsed(visual_id)` → `{ imageData, visualId, costUsd: 0, note: 'Reused a picture made earlier for “<stored concept>”' }`.
5. **Step 4 — `semantic`.** Also skipped when `forceGenerate`. `embedding = await embed(concept)` then `findSemantic(embedding)`; on hit `markUsed()` → `{ imageData, visualId, costUsd: EMBED_COST_USD, note: 'Close enough to “<stored concept>” (<Math.round(score*100)>%)' }`. Both notes quote the **stored** row's concept (`exact.concept` / `near.visual.concept`), not the concept that was requested. Any thrown error is swallowed and execution falls through to generation — *"a cache miss is never a reason to leave a card without a picture"*.
6. **Step 5 — `generated`.** If `activeProvider()` is null → `{ resolvedBy: 'failed', costUsd: 0, note: unconfiguredMessage() }`. Otherwise `buildPrompt(concept, detail)`, `generate(prompt, 3)`, `save({ concept, prompt, model: providerModel(), imageData: images[0].dataUrl, embedding, createdBy })` →
   `{ resolvedBy: 'generated', imageData: images[0].dataUrl, candidates: images.map(i => i.dataUrl), visualId, costUsd: IMAGE_COST_USD * images.length + (embedding ? EMBED_COST_USD : 0), note: 'Newly made — pick the one that reads best' }`.
   A throw → `{ resolvedBy: 'failed', costUsd: embedding ? EMBED_COST_USD : 0, note: err.message }`.

Note that `costUsd` for a generation charges `IMAGE_COST_USD` per **candidate returned** (`images.length`, normally 3), not per kept image.

### `logGap(opts, concept, res)`
Returns immediately when `opts.childId` is falsy — anonymous resolutions are not audited. Otherwise calls `ingestEvents()` with a single event:

| Field | Value |
|---|---|
| `event_id` | `crypto.randomUUID()` |
| `child_id` | `opts.childId` |
| `ts` | `now.getTime()` |
| `day_local` | local date, `new Date(now - tzOffset*60_000).toISOString().slice(0,10)` |
| `tz_offset_min` | `-now.getTimezoneOffset()` |
| `session_id` | `'visual-resolve'` (literal) |
| `scene` | `opts.scene ?? 'unknown'` |
| `actor` | `'adult'` |
| `type` | `'gap_detected'` |
| `label` | `concept` |
| `payload` | JSON `{ concept, normalizedConcept, resolvedBy, msResolve, costUsd: res.costUsd \|\| null }` |

The whole body is wrapped in `try {} catch {}` with the comment *"auditing must never block the adult"* — a logging failure never propagates, because an adult must not lose a picture because an audit row could not be written.

### What reads those events
| Reader | Query shape |
|---|---|
| `vocabularyGaps()` in `lib/metrics.ts` | `gap_detected` where `payload.$.resolvedBy = 'generated'`, grouped by `payload.$.normalizedConcept` — metric `vocabulary_gaps` (`min_n = 1`) |
| `visualSourceSplit()` in `lib/metrics.ts` | `gap_detected` grouped by `payload.$.resolvedBy` — metric `visual_source_split` (`min_n = 10`; catalogue caveat: *"Target is at least 90% resolved before reaching generation"*) |
| `unreviewedGapCount()` in `lib/queue.ts` | `COUNT(DISTINCT payload.$.normalizedConcept)` where `resolvedBy = 'generated'`; attention-queue threshold `gaps = 3` |
| `app/dashboard/student/[id]/ai-impact/page.tsx` | `eventTypeCollected('gap_detected')` gates the F1/F3/F4 panels |

## Dependencies & Connections

### Depends On
- [visual-prompt-and-sanitisation](visual-prompt-and-sanitisation.md) — `sanitizeConcept()`, `normalizeConcept()`, `buildPrompt()`
- [visual-cache](visual-cache.md) — `findExact()`, `findSemantic()`, `save()`, `markUsed()`
- [image-providers](image-providers.md) — `generate()`, `embed()`, `providerModel()`, `activeProvider()`, `unconfiguredMessage()`
- [../kid-app/symbol-set.md](../kid-app/symbol-set.md) — `symbolFor()` from `lib/icons/symbols.tsx`
- [../database/schema.md](../database/schema.md) — `cards` table (step 2) via `one()` from `lib/db`
- [../api/event-ingest.md](../api/event-ingest.md) — `ingestEvents()` writes the `gap_detected` row

### Depended On By
- [../api/visual-resolution-endpoint.md](../api/visual-resolution-endpoint.md) — `POST /api/visuals` is the only caller; `maxDuration = 60` because generation takes 5–15 s, and `resolvedBy === 'failed'` is returned as HTTP `502` with `{ error: note, resolvedBy: 'failed' }`
- [../analytics/metric-readers.md](../analytics/metric-readers.md) — `vocabularyGaps()` and `visualSourceSplit()` read `gap_detected`
- [../dashboard/student-overview.md](../dashboard/student-overview.md) — "Where her pictures come from" and "Words she reached for that do not exist"
- [../dashboard/attention-queue.md](../dashboard/attention-queue.md) — `unreviewedGapCount()`

### Shared Resources
- The `gap_detected` event type in `db/schema.sql` and its allowed-types list in `lib/ingest.ts`
- The `payload` JSON keys `resolvedBy` and `normalizedConcept` — read by `json_extract()` in three separate query sites
- The `ResolvedBy` string union is duplicated as free text in `db/seed_catalogues.sql` (`visual_source_split` formula)

## Change Risks
- **Renaming a `ResolvedBy` value** breaks `visual_source_split` grouping and the `resolvedBy = 'generated'` filters in `lib/metrics.ts` and `lib/queue.ts` — the strings are compared literally in SQL, so nothing errors; the panels just go empty or wrong.
- **Renaming `payload.normalizedConcept`** silently empties `vocabulary_gaps` and the attention-queue gap count (`json_extract` returns NULL, not an error).
- **Skipping `logGap()` for cheap steps** would remove the denominator and make `visual_source_split` report 100% generated.
- **Reordering the ladder or lowering the semantic threshold** changes the cost profile the dashboard is designed to police; a rising generated share is meant to mean "the ladder is mistuned or the child has moved into genuinely new territory", per the `visual_source_split` catalogue caveat.
- **Passing an unsanitised concept** to `buildPrompt()` or `save()` would send a child's or teacher's name to an external image API — the sanitisation happens once, at the top of `resolveVisual()`, and every downstream call uses that value.
- **`forceGenerate: true` bypasses steps 1–4 including the embedding**, so a forced generation stores `embedding: null` and can never be found by step 4 later.
- **Charging `IMAGE_COST_USD * images.length`** means a provider that returns fewer candidates (Gemini uses `Promise.allSettled` and may return 1 or 2) reports a proportionally lower cost — the figure tracks candidates, not requests.
