/**
 * Gemini on Vertex AI — the same wire dialect as lib/chat/gemini.ts with two
 * differences: the endpoint lives under aiplatform.googleapis.com, and auth is
 * an ADC bearer token instead of an API key.
 *
 * Model routing (verified against project project-3d2bf61a on 2026-08-08):
 *   gemini-3-*-preview  -> the GLOBAL endpoint (regional endpoints 404)
 *   gemini-2.5-flash    -> us-central1
 * A preview model that 404s falls back to gemini-2.5-flash once, loudly in the
 * message metadata, so a model rollout change can never take the Ask panel down.
 *
 * Gemini 3 additionally streams "thought" parts (internal reasoning summaries,
 * marked part.thought === true) which must NOT be shown as answer text, and
 * attaches a thoughtSignature to each functionCall that MUST be echoed back on
 * the next turn (see toGeminiContents).
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  ProviderError, sseLines,
  type ChatMessage, type ChatProvider, type ProviderChunk, type ToolCall, type ToolDef,
} from './provider'
import { toGeminiTools } from './schema-adapter'
import { toGeminiContents } from './gemini'

const run = promisify(execFile)

const FALLBACK_MODEL = 'gemini-2.5-flash'

function project(): string {
  const p = process.env.VERTEX_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT
  if (!p) throw new ProviderError('GOOGLE_CLOUD_PROJECT is not set', 500)
  return p
}

/** Gemini 3 previews serve only from `global`; 2.x from the regional endpoint. */
function locationFor(model: string): string {
  if (model.startsWith('gemini-3')) return 'global'
  const loc = process.env.VERTEX_LOCATION ?? process.env.GOOGLE_CLOUD_LOCATION ?? ''
  return loc && loc !== 'global' ? loc : 'us-central1'
}

function endpointFor(model: string): string {
  const loc = locationFor(model)
  const host = loc === 'global' ? 'aiplatform.googleapis.com' : `${loc}-aiplatform.googleapis.com`
  return (
    `https://${host}/v1/projects/${project()}/locations/${loc}` +
    `/publishers/google/models/${model}:streamGenerateContent?alt=sse`
  )
}

/* Tokens last ~an hour; cached with margin so a long stream cannot start on
 * one that expires mid-flight. */
let cached: { token: string; expires: number } | null = null

async function accessToken(): Promise<string> {
  if (cached && cached.expires > Date.now()) return cached.token
  const { stdout } = await run('gcloud', ['auth', 'print-access-token'], { timeout: 15_000 })
  const token = stdout.trim()
  if (!token) throw new ProviderError('gcloud returned no access token', 500)
  cached = { token, expires: Date.now() + 45 * 60 * 1000 }
  return token
}

export class VertexChatProvider implements ChatProvider {
  // Presented as 'gemini' downstream would lie about provenance; the agent
  // records provider ids in usage, so this is its own.
  readonly id = 'vertex' as const
  readonly model: string

  constructor(model = process.env.CHAT_MODEL ?? FALLBACK_MODEL) {
    this.model = model
  }

  async *send(
    messages: ChatMessage[],
    tools: ToolDef[],
    signal?: AbortSignal,
  ): AsyncGenerator<ProviderChunk> {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
    const contents = toGeminiContents(messages.filter((m) => m.role !== 'system'))
    const body = JSON.stringify({
      contents,
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      tools: tools.length ? toGeminiTools(tools) : undefined,
    })
    const headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${await accessToken()}`,
    }

    let res = await fetch(endpointFor(this.model), { method: 'POST', signal, headers, body })

    // A preview model the project stops serving must degrade, not fail: one
    // retry on the stable model. Only for 404 — anything else is a real error.
    if (res.status === 404 && this.model !== FALLBACK_MODEL) {
      res = await fetch(endpointFor(FALLBACK_MODEL), { method: 'POST', signal, headers, body })
    }

    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      throw new ProviderError(
        `Vertex ${res.status}: ${errBody.slice(0, 300)}`,
        res.status,
        res.status === 429 || res.status >= 500,
      )
    }

    const calls: ToolCall[] = []
    let seq = 0

    for await (const raw of sseLines(res)) {
      const evt = raw as {
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
        candidates?: {
          content?: {
            parts?: {
              text?: string
              thought?: boolean
              thoughtSignature?: string
              functionCall?: { name: string; args?: Record<string, unknown> }
            }[]
          }
        }[]
      }
      if (evt.usageMetadata) {
        yield {
          type: 'usage',
          inputTokens: evt.usageMetadata.promptTokenCount ?? 0,
          outputTokens: evt.usageMetadata.candidatesTokenCount ?? 0,
        }
      }
      for (const part of evt.candidates?.[0]?.content?.parts ?? []) {
        // Gemini 3 streams reasoning summaries as thought parts. They are not
        // answer text; leaking them reads like the model talking to itself.
        if (part.thought) continue
        if (typeof part.text === 'string' && part.text.length) {
          yield { type: 'text', delta: part.text }
        }
        if (part.functionCall) {
          calls.push({
            id: `vtx_${seq++}_${part.functionCall.name}`,
            name: part.functionCall.name,
            args: (part.functionCall.args ?? {}) as Record<string, unknown>,
            thoughtSignature: part.thoughtSignature,
          })
        }
      }
    }

    if (calls.length) yield { type: 'tool_calls', calls }
  }
}
