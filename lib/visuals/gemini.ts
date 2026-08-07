/**
 * Image generation via Gemini.
 *
 * Two ways in, because which one is available depends on how the account is
 * set up and neither is guaranteed:
 *
 *   GEMINI_API_KEY   the AI Studio key. One value, works immediately, has a
 *                    free tier. This is the path to prefer.
 *   Vertex AI        project + ADC. Needs the models enabled on the project;
 *                    a project without them answers 404 for every model,
 *                    including text, which is a confusing way to discover it.
 *
 * Server-side only. A key in the browser is a key anyone can take.
 */

const GENAI = 'https://generativelanguage.googleapis.com/v1beta/models'

/** Gemini's image model. Overridable, because model names move faster than code. */
export const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-2.5-flash-image'

export type GeminiImage = { dataUrl: string; model: string; ms: number }

export function geminiAvailable(): boolean {
  return Boolean(process.env.GEMINI_API_KEY)
}

/**
 * Generate `n` candidates.
 *
 * Gemini returns one image per call, so several candidates means several calls.
 * They run together — three sequential round-trips would put an adult in front
 * of a spinner for half a minute.
 */
export async function generateWithGemini(
  prompt: string,
  n = 3,
  signal?: AbortSignal,
): Promise<GeminiImage[]> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY is not set')

  const started = Date.now()

  const once = async (): Promise<string | null> => {
    const res = await fetch(`${GENAI}/${GEMINI_IMAGE_MODEL}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'] },
      }),
      signal,
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Gemini image generation failed (${res.status}): ${body.slice(0, 300)}`)
    }

    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[]
    }

    for (const part of json.candidates?.[0]?.content?.parts ?? []) {
      const inline = part.inlineData
      if (inline?.data) {
        return `data:${inline.mimeType ?? 'image/png'};base64,${inline.data}`
      }
    }
    return null
  }

  // One rejected call must not lose the others — an adult would rather choose
  // from two pictures than from none.
  const settled = await Promise.allSettled(Array.from({ length: n }, () => once()))
  const ms = Date.now() - started

  const images = settled
    .filter((r): r is PromiseFulfilledResult<string | null> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((v): v is string => v !== null)
    .map((dataUrl) => ({ dataUrl, model: GEMINI_IMAGE_MODEL, ms }))

  if (images.length === 0) {
    const firstError = settled.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined
    throw new Error(firstError ? String(firstError.reason).slice(0, 300) : 'Gemini returned no image')
  }

  return images
}

/**
 * Embedding for the semantic cache step.
 *
 * Costs a fraction of an image, so asking whether we already drew something
 * close enough is far cheaper than drawing it again.
 */
export async function embedWithGemini(text: string, signal?: AbortSignal): Promise<number[]> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY is not set')

  const res = await fetch(`${GENAI}/text-embedding-004:embedContent?key=${key}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'models/text-embedding-004',
      content: { parts: [{ text }] },
    }),
    signal,
  })
  if (!res.ok) throw new Error(`Gemini embedding failed (${res.status})`)
  const json = (await res.json()) as { embedding?: { values?: number[] } }
  const values = json.embedding?.values
  if (!values) throw new Error('Gemini returned no embedding')
  return values
}
