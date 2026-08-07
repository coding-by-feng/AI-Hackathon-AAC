/**
 * OpenAI Images API client.
 *
 * Server-side only. The key never reaches a browser — the board posts a concept
 * to /api/visuals and gets a picture back.
 */
import { requireKey } from '../chat/provider'

const ENDPOINT = 'https://api.openai.com/v1/images/generations'

export const IMAGE_MODEL = process.env.IMAGE_MODEL ?? 'gpt-image-1'

export type GeneratedImage = {
  /** data: URL, ready to render and to store. */
  dataUrl: string
  model: string
  ms: number
}

/**
 * Generate `n` candidates for one concept.
 *
 * Several at once because a symbol either reads instantly or it does not, and
 * that is obvious on sight but hard to predict. Offering three costs one
 * request and saves the adult a round of regeneration.
 */
export async function generateImages(
  prompt: string,
  n = 3,
  signal?: AbortSignal,
): Promise<GeneratedImage[]> {
  const started = Date.now()

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${requireKey('OPENAI_API_KEY')}`,
    },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      prompt,
      n,
      size: '1024x1024',
      // Cards render around 40px. The cheapest tier is more than enough, and
      // paying for detail nobody can see is just cost.
      quality: 'low',
      output_format: 'webp',
      background: 'opaque',
    }),
    signal,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Image generation failed (${res.status}): ${body.slice(0, 300)}`)
  }

  const json = (await res.json()) as {
    data?: { b64_json?: string; url?: string }[]
  }

  const ms = Date.now() - started
  const out: GeneratedImage[] = []

  for (const item of json.data ?? []) {
    if (item.b64_json) {
      out.push({ dataUrl: `data:image/webp;base64,${item.b64_json}`, model: IMAGE_MODEL, ms })
    } else if (item.url) {
      // Older models return a URL that expires. Fetch it now — a card must not
      // depend on a link that dies in an hour.
      const img = await fetch(item.url, { signal })
      const buf = Buffer.from(await img.arrayBuffer())
      out.push({
        dataUrl: `data:image/png;base64,${buf.toString('base64')}`,
        model: IMAGE_MODEL,
        ms,
      })
    }
  }

  if (out.length === 0) throw new Error('Image generation returned nothing')
  return out
}

/**
 * Embedding for semantic cache lookup.
 *
 * Roughly a thousandth of the cost of an image, so checking whether we already
 * drew something close enough is far cheaper than drawing it again.
 */
export async function embed(text: string, signal?: AbortSignal): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${requireKey('OPENAI_API_KEY')}`,
    },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
    signal,
  })
  if (!res.ok) throw new Error(`Embedding failed (${res.status})`)
  const json = (await res.json()) as { data: { embedding: number[] }[] }
  return json.data[0].embedding
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}
