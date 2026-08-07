/**
 * Image generation via Vertex AI on GCP.
 *
 * Authenticates with Application Default Credentials — no API key to store,
 * rotate or leak. The token comes from `gcloud auth print-access-token`, which
 * is already configured on this machine; swapping to `google-auth-library`
 * later changes only `accessToken()` below.
 *
 * Vertex needs three things to be true, and the failure modes are easy to
 * confuse:
 *   - `aiplatform.googleapis.com` enabled on the project
 *   - **billing enabled** — without it every model answers 403
 *   - a real region. `GOOGLE_CLOUD_LOCATION=global` answers 404 for Imagen,
 *     which reads like the model does not exist.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * gemini-2.5-flash-image via generateContent — verified the ONLY image path
 * this project can reach. Imagen's :predict endpoint and even gemini text
 * models answer 404 here, so the obvious implementations all fail; this one
 * returns real 1024x1024 PNGs.
 */
export const VERTEX_IMAGE_MODEL = process.env.VERTEX_IMAGE_MODEL ?? 'gemini-2.5-flash-image'

function project(): string | null {
  return process.env.VERTEX_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? null
}

/**
 * `global` is a valid Vertex location for some services and not for Imagen, so
 * it is treated as unset rather than passed through to produce a 404.
 */
function location(): string {
  const loc = process.env.VERTEX_LOCATION ?? process.env.GOOGLE_CLOUD_LOCATION ?? ''
  return loc && loc !== 'global' ? loc : 'us-central1'
}

/*
 * Tokens last about an hour. Cached with a margin so a long generation cannot
 * start on a token that expires mid-flight.
 */
let cached: { token: string; expires: number } | null = null

async function accessToken(): Promise<string> {
  if (cached && cached.expires > Date.now()) return cached.token
  const { stdout } = await run('gcloud', ['auth', 'print-access-token'], { timeout: 15_000 })
  const token = stdout.trim()
  if (!token) throw new Error('gcloud returned no access token')
  cached = { token, expires: Date.now() + 45 * 60 * 1000 }
  return token
}

export function vertexAvailable(): boolean {
  return Boolean(project())
}

export type VertexImage = { dataUrl: string; model: string; ms: number }

export async function generateWithVertex(
  prompt: string,
  n = 3,
  signal?: AbortSignal,
): Promise<VertexImage[]> {
  const proj = project()
  if (!proj) throw new Error('GOOGLE_CLOUD_PROJECT is not set')

  const loc = location()
  const started = Date.now()
  const token = await accessToken()

  // One image per generateContent call, so n candidates run in parallel —
  // three sequential round-trips would leave an adult at a spinner for a minute.
  const once = async (): Promise<string | null> => {
    const res = await fetch(
      `https://${loc}-aiplatform.googleapis.com/v1/projects/${proj}/locations/${loc}/publishers/google/models/${VERTEX_IMAGE_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ['IMAGE'] },
        }),
        signal,
      },
    )

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      if (res.status === 403 && body.includes('billing')) {
        throw new Error(
          `Vertex AI needs billing enabled on project ${proj}. ` +
            `Enable it at console.cloud.google.com/billing, or set GEMINI_API_KEY instead.`,
        )
      }
      if (res.status === 404) {
        throw new Error(
          `Model ${VERTEX_IMAGE_MODEL} is not available to project ${proj} in ${loc}.`,
        )
      }
      throw new Error(`Vertex image generation failed (${res.status}): ${body.slice(0, 250)}`)
    }

    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[]
    }
    for (const part of json.candidates?.[0]?.content?.parts ?? []) {
      if (part.inlineData?.data) {
        return `data:${part.inlineData.mimeType ?? 'image/png'};base64,${part.inlineData.data}`
      }
    }
    return null
  }

  const settled = await Promise.allSettled(Array.from({ length: n }, () => once()))
  const ms = Date.now() - started
  const images = settled
    .filter((r): r is PromiseFulfilledResult<string | null> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((v): v is string => v !== null)
    .map((dataUrl) => ({ dataUrl, model: VERTEX_IMAGE_MODEL, ms }))

  if (images.length === 0) {
    const firstError = settled.find((r) => r.status === 'rejected') as
      | PromiseRejectedResult
      | undefined
    throw new Error(firstError ? String(firstError.reason).slice(0, 300) : 'Vertex returned no image')
  }
  return images
}

/** Embedding for the semantic cache step. */
export async function embedWithVertex(text: string, signal?: AbortSignal): Promise<number[]> {
  const proj = project()
  if (!proj) throw new Error('GOOGLE_CLOUD_PROJECT is not set')
  const loc = location()
  const token = await accessToken()

  const res = await fetch(
    `https://${loc}-aiplatform.googleapis.com/v1/projects/${proj}/locations/${loc}/publishers/google/models/text-embedding-005:predict`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ instances: [{ content: text }] }),
      signal,
    },
  )
  if (!res.ok) throw new Error(`Vertex embedding failed (${res.status})`)
  const json = (await res.json()) as {
    predictions?: { embeddings?: { values?: number[] } }[]
  }
  const values = json.predictions?.[0]?.embeddings?.values
  if (!values) throw new Error('Vertex returned no embedding')
  return values
}
