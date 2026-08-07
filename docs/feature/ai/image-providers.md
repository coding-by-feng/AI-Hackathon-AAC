# Image Provider Chain (Gemini / Vertex / OpenAI)

## Function
Selects and calls whichever image-generation and embedding service is actually configured — Gemini AI Studio, Vertex AI on GCP, or the OpenAI Images API — and falls through to the next one when a call fails, so the ladder above never learns which provider answered.

## Purpose
Two providers were not enough in practice: which Google path is available depends on how the account is set up and neither is guaranteed. Selection is by **what is configured rather than by a hardcoded preference**, ordered by how little setup each needs — *a Gemini key is one value, Vertex needs a billed project, OpenAI needs credits.* Swapping providers is a change in `provider.ts` and nowhere else.

The fallback chain exists because "quota and billing failures are the norm here rather than the exception — a free tier runs out, a project loses billing — and an adult should not lose a picture because the first choice was unavailable."

## Source Files
| File | Role |
|------|------|
| `lib/visuals/provider.ts` | `activeProvider()`, `providerModel()`, `unconfiguredMessage()`, `generate()`, `embed()`, `usable()` |
| `lib/visuals/gemini.ts` | `generateWithGemini()`, `embedWithGemini()`, `geminiAvailable()`, `GEMINI_IMAGE_MODEL` |
| `lib/visuals/vertex.ts` | `generateWithVertex()`, `embedWithVertex()`, `vertexAvailable()`, `VERTEX_IMAGE_MODEL`, ADC token cache |
| `lib/visuals/openai.ts` | `generateImages()`, `embed()`, `cosine()`, `IMAGE_MODEL` |

## Implementation

### Environment variables
| Var | Default | Effect |
|---|---|---|
| `IMAGE_PROVIDER` | unset | Forces `gemini` \| `vertex` \| `openai`; **also disables the fallback chain** |
| `GEMINI_API_KEY` | — | Presence makes `geminiAvailable()` true |
| `GEMINI_IMAGE_MODEL` | `gemini-2.5-flash-image` | Overridable "because model names move faster than code" |
| `VERTEX_PROJECT` / `GOOGLE_CLOUD_PROJECT` | — | Presence of either makes `vertexAvailable()` true |
| `VERTEX_LOCATION` / `GOOGLE_CLOUD_LOCATION` | `us-central1` | `'global'` is treated as **unset**, because it is valid for some Vertex services and not for Imagen |
| `VERTEX_IMAGE_MODEL` | `imagen-4.0-fast-generate-001` | |
| `OPENAI_API_KEY` | — | Presence makes OpenAI usable; read via `requireKey()` from `lib/chat/provider.ts` |
| `IMAGE_MODEL` | `gpt-image-1` | OpenAI image model |

### `activeProvider(): 'gemini' | 'vertex' | 'openai' | null`
1. If `IMAGE_PROVIDER` is set, return that provider **only if** it is available, else `null`.
2. Otherwise: `geminiAvailable()` → `'gemini'`; `vertexAvailable()` → `'vertex'`; `OPENAI_API_KEY` → `'openai'`; else `null`.

### `providerModel()`
`gemini` → `GEMINI_IMAGE_MODEL`; `vertex` → `VERTEX_IMAGE_MODEL`; **default (including `null`)** → `IMAGE_MODEL`. Stored on every cached picture as `generated_visuals.model`.

### `unconfiguredMessage()`
A message an adult can act on — *"'No provider configured' is not useful to someone looking at a board that will not draw a picture; the exact line to add is."*

> No image service is configured. Any one of these works: `GEMINI_API_KEY` in `.env.local` (free key from aistudio.google.com); `GOOGLE_CLOUD_PROJECT` pointing at a GCP project with Vertex AI and billing enabled; or `OPENAI_API_KEY` with credits available.

### `generate(prompt, n = 3, signal?)`
- No active provider → throws `unconfiguredMessage()`.
- Chain: `IMAGE_PROVIDER` set → `[provider]` only. Otherwise `[provider, 'gemini', 'vertex', 'openai']` deduped by first index and filtered by `usable(p)`.
- Tries each in turn inside `try/catch`, keeping `lastError`. All fail → throws `lastError`. **The last error is the one reported, so the message describes a real attempt.**
- Returns `ProviderImage[] = { dataUrl, model, ms }[]`.

### `embed(text, signal?)` — no fallback chain
Routes to `embedWithGemini` / `embedWithVertex` / `openaiEmbed` by `activeProvider()` only. A failure here is swallowed by the ladder and falls through to generation.

### Gemini (`lib/visuals/gemini.ts`)
- Base: `https://generativelanguage.googleapis.com/v1beta/models`
- Images: `POST /<GEMINI_IMAGE_MODEL>:generateContent?key=<GEMINI_API_KEY>` with body `{ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['IMAGE'] } }`
- **Gemini returns one image per call**, so `n` candidates means `n` calls. They run together via `Promise.allSettled(Array.from({ length: n }, once))` — "three sequential round-trips would put an adult in front of a spinner for half a minute".
- One rejected call must not lose the others: fulfilled non-null results are kept; only if **zero** images survive does it throw, using the first rejection's reason (`String(reason).slice(0, 300)`) or `'Gemini returned no image'`.
- `dataUrl` = `data:<inlineData.mimeType ?? 'image/png'>;base64,<data>`. `ms` is measured once across the whole batch.
- Non-OK inside a single call throws `Gemini image generation failed (<status>): <body.slice(0,300)>`.
- Embeddings: `POST /text-embedding-004:embedContent?key=…` with `{ model: 'models/text-embedding-004', content: { parts: [{ text }] } }` → `embedding.values`.

### Vertex (`lib/visuals/vertex.ts`)
Authenticates with **Application Default Credentials** — no API key to store, rotate or leak. The token comes from `gcloud auth print-access-token` (`execFile`, `timeout: 15_000`), cached in a module variable for **45 minutes** (`Date.now() + 45 * 60 * 1000`); tokens last about an hour, and the margin exists so a long generation cannot start on a token that expires mid-flight. Swapping to `google-auth-library` later changes only `accessToken()`.

Three things must be true, and the failure modes are easy to confuse:
- `aiplatform.googleapis.com` enabled on the project
- **billing enabled** — without it every model answers `403`
- a real region — `GOOGLE_CLOUD_LOCATION=global` answers `404` for Imagen, which reads like the model does not exist

Images: `POST https://<loc>-aiplatform.googleapis.com/v1/projects/<proj>/locations/<loc>/publishers/google/models/<VERTEX_IMAGE_MODEL>:predict`
```json
{ "instances": [{ "prompt": "…" }],
  "parameters": { "sampleCount": n, "aspectRatio": "1:1",
                  "safetySetting": "block_medium_and_above",
                  "personGeneration": "dont_allow" } }
```
*"A board is used by children; the strictest filter is the right default."*

Two error statuses are named explicitly because they are common and confusing:
- `403` with `billing` in the body → `Vertex AI needs billing enabled on project <proj>. Enable it at console.cloud.google.com/billing, or set GEMINI_API_KEY instead.`
- `404` → `Model <VERTEX_IMAGE_MODEL> is not available to project <proj> in <loc>. Check the model name and that Vertex AI is enabled for that region.`
- anything else → `Vertex image generation failed (<status>): <body.slice(0,250)>`

`dataUrl` = `data:<mimeType ?? 'image/png'>;base64,<bytesBase64Encoded>`; empty result throws `Vertex returned no image`.

Embeddings: same host, model `text-embedding-005`, body `{ instances: [{ content: text }] }` → `predictions[0].embeddings.values`.

### OpenAI (`lib/visuals/openai.ts`)
- `POST https://api.openai.com/v1/images/generations`, `authorization: Bearer <OPENAI_API_KEY>` via `requireKey()` — server-side only; the board posts a concept to `/api/visuals` and gets a picture back.
- Body: `{ model: IMAGE_MODEL, prompt, n, size: '1024x1024', quality: 'low', output_format: 'webp', background: 'opaque' }`. `quality: 'low'` is deliberate: *"Cards render around 40px. The cheapest tier is more than enough, and paying for detail nobody can see is just cost."*
- Several candidates at once "because a symbol either reads instantly or it does not, and that is obvious on sight but hard to predict. Offering three costs one request and saves the adult a round of regeneration."
- `b64_json` → `data:image/webp;base64,…`. A returned `url` (older models) is **fetched immediately** and re-encoded as `data:image/png;base64,…` — "a card must not depend on a link that dies in an hour".
- Non-OK → `Image generation failed (<status>): <body.slice(0,300)>`; empty result → `Image generation returned nothing`.
- Embeddings: `POST https://api.openai.com/v1/embeddings`, model `text-embedding-3-small`; non-OK → `Embedding failed (<status>)`.
- `cosine(a, b)` — returns `0` on length mismatch or zero denominator; used by [visual-cache](visual-cache.md) `findSemantic()`.

### Cross-provider note
Embedding dimensionality differs per provider (`text-embedding-004`, `text-embedding-005`, `text-embedding-3-small`). `cosine()` returns `0` when `a.length !== b.length`, so embeddings written under one provider simply never match under another — no error, just permanent step-4 misses.

## Dependencies & Connections

### Depends On
- [chat-providers](chat-providers.md) — `lib/visuals/openai.ts` imports `requireKey()` from `lib/chat/provider.ts`
- `gcloud` CLI on `PATH` — the Vertex path shells out to `gcloud auth print-access-token`

### Depended On By
- [visual-resolution-ladder](visual-resolution-ladder.md) — `activeProvider()` gates step 5, `generate(prompt, 3)` performs it, `embed()` powers step 4, `providerModel()` is stored with the picture, `unconfiguredMessage()` becomes the failure `note`
- [visual-cache](visual-cache.md) — imports `cosine()` from `lib/visuals/openai.ts` regardless of which provider produced the embedding

### Shared Resources
- `OPENAI_API_KEY` — shared with the chat provider (`lib/chat/openai.ts`)
- The Vertex access-token cache is a module-level singleton shared by `generateWithVertex()` and `embedWithVertex()`
- `providerModel()`'s return value is persisted in `generated_visuals.model`

## Change Risks
- **Setting `IMAGE_PROVIDER`** disables the fallback chain entirely; a quota exhaustion then surfaces to the adult as a failed card rather than being routed around.
- **Adding a fourth provider** requires touching `activeProvider()`, `providerModel()`, `usable()`, the `chain` array, `embed()`, and `unconfiguredMessage()` — six places in one file, none of them shared.
- **Switching the active provider on an existing install** makes every previously stored embedding unmatchable (`cosine()` returns `0` on differing lengths), so step 4 stops hitting until the cache refills. Nothing logs this; it shows up as a rising `generated` share in `visual_source_split`.
- **Replacing the `gcloud` shell-out** with `google-auth-library` is contained to `accessToken()` by design, but any deployment without `gcloud` on `PATH` fails Vertex with an `execFile` error, not a clear auth message.
- **Reducing the 45-minute token cache margin** risks a token expiring mid-generation on a 5–15 s Imagen call.
- **Raising OpenAI `quality` above `'low'`** multiplies the real bill without changing what a ~40 px card shows, and desyncs the `IMAGE_COST_USD = 0.02` estimate the dashboard cost panel reports.
- **Removing Gemini's `Promise.allSettled`** turns one rejected candidate into a total failure; the adult would get nothing rather than two pictures.
- **Relaxing Vertex `personGeneration: 'dont_allow'` or `safetySetting: 'block_medium_and_above'`** loosens the safety posture on a board used by children — and would still not apply to the Gemini or OpenAI paths, which set no equivalent parameters.
