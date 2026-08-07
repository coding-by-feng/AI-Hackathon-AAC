# AI Vocabulary Icons

> **Status: built in parallel this wave — verify against source after integration.** The generator and manifest exist and `card-face.tsx` already consumes them; the icon set itself is still being generated (~90 concepts, a handful on disk at the time of writing).

## Function
Generates one flat-vector PNG icon per vocabulary word via Vertex AI (`tools/generate-icons.mjs`), stores them as static assets under `public/icons/ai/<slug>.png`, and exposes them to the board through a generated manifest (`lib/icons/ai-manifest.ts`). `CardFace` uses them as the default face for a card, above the built-in SVG symbol set but below any per-child photo.

## Purpose
The built-in inline-SVG set covers 68 symbols; the vocabulary is larger, and a card with no picture is a card a non-reading child cannot use. Generating icons **at build time** — rather than through the runtime visual ladder — makes every word's face a static, offline-cacheable asset that costs nothing at request time and never blocks the board on a network call. The SVG symbol set stays as the offline/regeneration fallback, so deleting every generated icon degrades the board rather than breaking it.

## Source Files
| File | Role |
|------|------|
| `tools/generate-icons.mjs` | The generator: reads vocabulary, calls Vertex, downscales, writes PNGs + manifest. Plain `.mjs`, no TS toolchain. |
| `public/icons/ai/*.png` | The generated 256px icons, one per slug. |
| `lib/icons/ai-manifest.ts` | GENERATED — `AI_ICONS` slug→path map plus `aiIconFor(label)` case-insensitive lookup. |
| `components/kid/card-face.tsx` | Consumes `aiIconFor()` in the face-precedence chain. |

## Implementation

### Concept collection
- Reads `SELECT label FROM cards` from `aac.db` and `SELECT label FROM category_words` from `aac_app.db` (both opened read-only), dedupes case-insensitively, keeps the first-seen casing.
- Skips pure numerals (`/^\d+$/`) — digits render as digits, no icon needed.
- `slugify(label)`: lowercase, trim, spaces→`-`, strip anything outside `[a-z0-9-]`. The same function is duplicated in the generated manifest so lookup and generation can never disagree.

### Generation (Vertex AI)
- Model `gemini-2.5-flash-image` (override `VERTEX_IMAGE_MODEL`), project from `VERTEX_PROJECT`/`GOOGLE_CLOUD_PROJECT`, location from `VERTEX_LOCATION`/`GOOGLE_CLOUD_LOCATION` with `global`→`us-central1` fallback.
- Auth is **GCP ADC via the gcloud CLI**: `gcloud auth print-access-token`, cached 45 minutes. No API key involved.
- The prompt mirrors `lib/visuals/prompt.ts` `buildPrompt(concept, null)` — copied, not imported, so the script stays dependency-free: flat vector, bold outlines, plain off-white background, one centred subject, and an explicit must-not list (no text, letters, speech bubbles, logos, borders, multiple objects, background scenery). Ends with the intent sentence: *"This is a picture a child who cannot read will use to speak."*
- `generationConfig.responseModalities: ['IMAGE']`; the first `inlineData` part is the PNG.
- Retry: up to 2 extra attempts on HTTP 429 with a 15 s sleep; any other error propagates.
- Concurrency 3 with a 300 ms stagger between starts.

### Output
- Raw bytes land in a dot-prefixed temp file, then `sips -Z 256 -s format png` downscales to the final `<slug>.png`; a result under 1 KiB is treated as failure. Temp file always unlinked.
- **Resumable:** existing files are skipped, so an interrupted run is simply re-run.
- Ends by regenerating `lib/icons/ai-manifest.ts` from whatever PNGs are actually on disk — the manifest can never reference a missing file.

### Board consumption (`card-face.tsx`)
Face precedence, most specific first:
1. `imageData` — a per-child photo/override (data: URL) from `lib/overrides.ts`
2. `aiIconFor(symbolKey ?? label)` — the generated icon
3. `symbolFor(...)` — the built-in inline SVG
4. label text only

The Fitzgerald-key ink colour logic is unchanged: word-class foreground still comes from the SVG set's `wordClass` even when an AI icon renders.

## Dependencies & Connections
- [Symbol Set, Card Faces & Design Tokens](symbol-set.md) — owns `card-face.tsx`'s other branches and the word-class colours.
- [Card Customisation](card-customisation.md) — a per-child photo always beats the AI icon.
- [Image Provider Chain](../ai/image-providers.md) / [Visual Resolution Ladder](../ai/visual-resolution-ladder.md) — the *runtime* generation path; this feature is its build-time sibling and deliberately shares the prompt shape.
- [Offline & PWA Shell](offline-pwa.md) — the icons are static `public/` assets, cacheable by the service worker.

## Change Risks
- **Editing `lib/icons/ai-manifest.ts` by hand** — it is regenerated at the end of every generator run; hand edits are silently lost.
- **Changing `slugify` in one place only** — generator and manifest each carry a copy; if they diverge, icons exist on disk but never resolve.
- **Importing from `lib/visuals/prompt.ts`** — the copy is deliberate; adding a TS import breaks the plain-`.mjs`, zero-toolchain property of the script.
- **Running without `gcloud` ADC or with a project that cannot reach `gemini-2.5-flash-image`** — the script fails per-concept; re-running resumes safely.
