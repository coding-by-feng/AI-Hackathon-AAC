/**
 * Which service draws the picture.
 *
 * Two providers, chosen by what is actually configured rather than by a
 * hardcoded preference. Gemini is tried first because it has a free tier and a
 * single-value setup; OpenAI is used when its key is the one present.
 *
 * The ladder above this does not know or care which one answered — it asks for
 * a picture and gets one. Swapping providers is a change here and nowhere else.
 */
import { generateImages as openaiImages, embed as openaiEmbed, IMAGE_MODEL } from './openai'
import {
  generateWithGemini,
  embedWithGemini,
  geminiAvailable,
  GEMINI_IMAGE_MODEL,
} from './gemini'
import {
  generateWithVertex,
  embedWithVertex,
  vertexAvailable,
  VERTEX_IMAGE_MODEL,
} from './vertex'

export type ProviderId = 'gemini' | 'vertex' | 'openai'

export type ProviderImage = { dataUrl: string; model: string; ms: number }

/**
 * The provider to use.
 *
 * `IMAGE_PROVIDER` forces one explicitly. Otherwise whichever key exists wins,
 * Gemini first — so adding a key is the whole of the configuration.
 */
export function activeProvider(): ProviderId | null {
  const forced = process.env.IMAGE_PROVIDER as ProviderId | undefined
  if (forced === 'gemini') return geminiAvailable() ? 'gemini' : null
  if (forced === 'vertex') return vertexAvailable() ? 'vertex' : null
  if (forced === 'openai') return process.env.OPENAI_API_KEY ? 'openai' : null

  // Order is by how little setup each needs: a Gemini key is one value,
  // Vertex needs a billed project, OpenAI needs credits.
  if (geminiAvailable()) return 'gemini'
  if (vertexAvailable()) return 'vertex'
  if (process.env.OPENAI_API_KEY) return 'openai'
  return null
}

export function providerModel(): string {
  switch (activeProvider()) {
    case 'gemini':
      return GEMINI_IMAGE_MODEL
    case 'vertex':
      return VERTEX_IMAGE_MODEL
    default:
      return IMAGE_MODEL
  }
}

/**
 * A message an adult can act on.
 *
 * "No provider configured" is not useful to someone looking at a board that
 * will not draw a picture; the exact line to add is.
 */
export function unconfiguredMessage(): string {
  return (
    'No image service is configured. Any one of these works: ' +
    'GEMINI_API_KEY in .env.local (free key from aistudio.google.com); ' +
    'GOOGLE_CLOUD_PROJECT pointing at a GCP project with Vertex AI and billing enabled; ' +
    'or OPENAI_API_KEY with credits available.'
  )
}

export async function generate(
  prompt: string,
  n = 3,
  signal?: AbortSignal,
): Promise<ProviderImage[]> {
  const provider = activeProvider()
  if (!provider) throw new Error(unconfiguredMessage())

  /*
   * Try each usable provider in turn.
   *
   * Quota and billing failures are the norm here rather than the exception —
   * a free tier runs out, a project loses billing — and an adult should not
   * lose a picture because the first choice was unavailable. The last error is
   * the one reported, so the message describes a real attempt.
   */
  const chain: ProviderId[] = process.env.IMAGE_PROVIDER
    ? [provider]
    : ([provider, 'gemini', 'vertex', 'openai'] as ProviderId[]).filter(
        (p, i, a) => a.indexOf(p) === i && usable(p),
      )

  let lastError: Error | null = null
  for (const p of chain) {
    try {
      if (p === 'gemini') return await generateWithGemini(prompt, n, signal)
      if (p === 'vertex') return await generateWithVertex(prompt, n, signal)
      return await openaiImages(prompt, n, signal)
    } catch (err) {
      lastError = err as Error
    }
  }
  throw lastError ?? new Error(unconfiguredMessage())
}

function usable(p: ProviderId): boolean {
  if (p === 'gemini') return geminiAvailable()
  if (p === 'vertex') return vertexAvailable()
  return Boolean(process.env.OPENAI_API_KEY)
}

export async function embed(text: string, signal?: AbortSignal): Promise<number[]> {
  const provider = activeProvider()
  if (!provider) throw new Error(unconfiguredMessage())
  if (provider === 'gemini') return embedWithGemini(text, signal)
  if (provider === 'vertex') return embedWithVertex(text, signal)
  return openaiEmbed(text, signal)
}
