/**
 * Google Gemini, streaming, with function calling.
 *
 * Three differences from OpenAI that the abstraction has to absorb:
 *
 *  1. No system role. The system prompt goes in a separate `systemInstruction`
 *     field; sending it as a turn makes the model answer it.
 *  2. Roles are 'user' and 'model'. A tool RESULT is a 'user' turn containing a
 *     functionResponse part — not a distinct role.
 *  3. Function-call arguments arrive as a whole object in one part, not as
 *     string fragments. Simpler than OpenAI, and the reason there is no
 *     accumulator here.
 */
import {
  ProviderError, requireKey, sseLines,
  type ChatMessage, type ChatProvider, type ProviderChunk, type ToolCall, type ToolDef,
} from './provider'
import { toGeminiTools } from './schema-adapter'

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

export class GeminiProvider implements ChatProvider {
  readonly id = 'gemini' as const
  readonly model: string

  constructor(model = process.env.CHAT_MODEL ?? 'gemini-2.5-pro') {
    this.model = model
  }

  async *send(
    messages: ChatMessage[],
    tools: ToolDef[],
    signal?: AbortSignal,
  ): AsyncGenerator<ProviderChunk> {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
    const contents = toGeminiContents(messages.filter((m) => m.role !== 'system'))

    const url = `${BASE}/${this.model}:streamGenerateContent?alt=sse&key=${requireKey('GEMINI_API_KEY')}`
    const res = await fetch(url, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents,
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        tools: tools.length ? toGeminiTools(tools) : undefined,
      }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new ProviderError(
        `Gemini ${res.status}: ${body.slice(0, 300)}`,
        res.status,
        res.status === 429 || res.status >= 500,
      )
    }

    const calls: ToolCall[] = []
    let seq = 0

    for await (const raw of sseLines(res)) {
      const evt = raw as any
      const usage = evt.usageMetadata
      if (usage) {
        yield {
          type: 'usage',
          inputTokens: usage.promptTokenCount ?? 0,
          outputTokens: usage.candidatesTokenCount ?? 0,
        }
      }
      for (const part of evt.candidates?.[0]?.content?.parts ?? []) {
        if (typeof part.text === 'string' && part.text.length) {
          yield { type: 'text', delta: part.text }
        }
        if (part.functionCall) {
          // Gemini assigns no call id, but the agent needs one to pair the
          // result back. Synthesise a stable one.
          calls.push({
            id: `gem_${seq++}_${part.functionCall.name}`,
            name: part.functionCall.name,
            args: (part.functionCall.args ?? {}) as Record<string, unknown>,
          })
        }
      }
    }

    if (calls.length) yield { type: 'tool_calls', calls }
  }
}

function toGeminiContents(messages: ChatMessage[]): unknown[] {
  const out: unknown[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', parts: [{ text: m.content }] })
    } else if (m.role === 'assistant') {
      const parts: unknown[] = []
      if (m.content) parts.push({ text: m.content })
      for (const c of m.toolCalls ?? []) {
        parts.push({ functionCall: { name: c.name, args: c.args } })
      }
      if (parts.length) out.push({ role: 'model', parts })
    } else if (m.role === 'tool') {
      // A tool result is a USER turn here, not a role of its own.
      out.push({
        role: 'user',
        parts: [{
          functionResponse: {
            name: m.name,
            response: safeParse(m.content),
          },
        }],
      })
    }
  }
  return out
}

/** functionResponse.response must be an object; our tools return JSON text. */
function safeParse(text: string): Record<string, unknown> {
  try {
    const v = JSON.parse(text)
    return v && typeof v === 'object' && !Array.isArray(v) ? v : { result: v }
  } catch {
    return { result: text }
  }
}
