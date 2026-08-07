/**
 * Gemini on Vertex AI — the same wire dialect as lib/chat/gemini.ts with two
 * differences: the endpoint lives under aiplatform.googleapis.com, and auth is
 * an ADC bearer token instead of an API key.
 *
 * This exists because it is the only chat path this machine can actually use:
 * the OpenAI account answers billing_not_active, no GEMINI_API_KEY is
 * configured, and project project-3d2bf61a serves gemini-2.5-flash (verified:
 * text, SSE streaming, and function calling all work).
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

function project(): string {
  const p = process.env.VERTEX_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT
  if (!p) throw new ProviderError('GOOGLE_CLOUD_PROJECT is not set', 500)
  return p
}

function location(): string {
  const loc = process.env.VERTEX_LOCATION ?? process.env.GOOGLE_CLOUD_LOCATION ?? ''
  // `global` is valid for some Vertex services but 404s for these models.
  return loc && loc !== 'global' ? loc : 'us-central1'
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

  constructor(model = process.env.CHAT_MODEL ?? 'gemini-2.5-flash') {
    this.model = model
  }

  async *send(
    messages: ChatMessage[],
    tools: ToolDef[],
    signal?: AbortSignal,
  ): AsyncGenerator<ProviderChunk> {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
    const contents = toGeminiContents(messages.filter((m) => m.role !== 'system'))

    const loc = location()
    const url =
      `https://${loc}-aiplatform.googleapis.com/v1/projects/${project()}` +
      `/locations/${loc}/publishers/google/models/${this.model}:streamGenerateContent?alt=sse`

    const res = await fetch(url, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${await accessToken()}`,
      },
      body: JSON.stringify({
        contents,
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        tools: tools.length ? toGeminiTools(tools) : undefined,
      }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new ProviderError(
        `Vertex ${res.status}: ${body.slice(0, 300)}`,
        res.status,
        res.status === 429 || res.status >= 500,
      )
    }

    // Identical stream shape to the Gemini API — parts with text or a whole
    // functionCall object per part, usage on the trailing chunks.
    const calls: ToolCall[] = []
    let seq = 0

    for await (const raw of sseLines(res)) {
      const evt = raw as {
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
        candidates?: { content?: { parts?: { text?: string; functionCall?: { name: string; args?: Record<string, unknown> } }[] } }[]
      }
      if (evt.usageMetadata) {
        yield {
          type: 'usage',
          inputTokens: evt.usageMetadata.promptTokenCount ?? 0,
          outputTokens: evt.usageMetadata.candidatesTokenCount ?? 0,
        }
      }
      for (const part of evt.candidates?.[0]?.content?.parts ?? []) {
        if (typeof part.text === 'string' && part.text.length) {
          yield { type: 'text', delta: part.text }
        }
        if (part.functionCall) {
          calls.push({
            id: `vtx_${seq++}_${part.functionCall.name}`,
            name: part.functionCall.name,
            args: (part.functionCall.args ?? {}) as Record<string, unknown>,
          })
        }
      }
    }

    if (calls.length) yield { type: 'tool_calls', calls }
  }
}
