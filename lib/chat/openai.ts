/**
 * OpenAI Chat Completions, streaming, with tool calling.
 *
 * The default provider. Tool-call arguments arrive as string fragments spread
 * across many deltas, so they are accumulated by index and parsed only once the
 * stream finishes — parsing early gets you a SyntaxError on `{"child_i`.
 */
import {
  ProviderError, sseLines,
  type ChatMessage, type ChatProvider, type ProviderChunk, type ToolCall, type ToolDef,
} from './provider'
import { toOpenAITools } from './schema-adapter'

const ENDPOINT = 'https://api.openai.com/v1/chat/completions'

export class OpenAIProvider implements ChatProvider {
  readonly id = 'openai' as const
  readonly model: string
  private readonly apiKey: string

  constructor(model = process.env.CHAT_MODEL ?? 'gpt-5.1', apiKey: string | null = process.env.OPENAI_API_KEY ?? null) {
    this.model = model
    if (!apiKey) {
      throw new ProviderError(
        'No OpenAI API key. Add one in Dashboard → Settings, or set OPENAI_API_KEY on the server.',
        500,
      )
    }
    this.apiKey = apiKey
  }

  async *send(
    messages: ChatMessage[],
    tools: ToolDef[],
    signal?: AbortSignal,
  ): AsyncGenerator<ProviderChunk> {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map(toOpenAIMessage),
        tools: tools.length ? toOpenAITools(tools) : undefined,
        tool_choice: tools.length ? 'auto' : undefined,
        stream: true,
        stream_options: { include_usage: true },
      }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new ProviderError(
        `OpenAI ${res.status}: ${body.slice(0, 300)}`,
        res.status,
        res.status === 429 || res.status >= 500,
      )
    }

    // index -> partial call. Fragments can interleave across several tools.
    const pending = new Map<number, { id: string; name: string; args: string }>()

    for await (const raw of sseLines(res)) {
      const evt = raw as any
      if (evt.usage) {
        yield {
          type: 'usage',
          inputTokens: evt.usage.prompt_tokens ?? 0,
          outputTokens: evt.usage.completion_tokens ?? 0,
        }
      }
      const delta = evt.choices?.[0]?.delta
      if (!delta) continue

      if (typeof delta.content === 'string' && delta.content.length) {
        yield { type: 'text', delta: delta.content }
      }

      for (const tc of delta.tool_calls ?? []) {
        const slot = pending.get(tc.index) ?? { id: '', name: '', args: '' }
        if (tc.id) slot.id = tc.id
        if (tc.function?.name) slot.name = tc.function.name
        if (tc.function?.arguments) slot.args += tc.function.arguments
        pending.set(tc.index, slot)
      }
    }

    if (pending.size) {
      const calls: ToolCall[] = []
      for (const [, slot] of [...pending.entries()].sort((a, b) => a[0] - b[0])) {
        let args: Record<string, unknown> = {}
        try {
          args = slot.args.trim() ? JSON.parse(slot.args) : {}
        } catch {
          // Malformed JSON is recoverable: the agent validates args and hands
          // the error back, and the model retries. Dropping the call is not.
          args = { __parse_error: slot.args.slice(0, 200) }
        }
        calls.push({ id: slot.id || `call_${slot.name}`, name: slot.name, args })
      }
      yield { type: 'tool_calls', calls }
    }
  }
}

function toOpenAIMessage(m: ChatMessage): Record<string, unknown> {
  switch (m.role) {
    case 'tool':
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
    case 'assistant':
      return {
        role: 'assistant',
        content: m.content,
        tool_calls: m.toolCalls?.length
          ? m.toolCalls.map((c) => ({
              id: c.id,
              type: 'function',
              function: { name: c.name, arguments: JSON.stringify(c.args) },
            }))
          : undefined,
      }
    default:
      return { role: m.role, content: m.content }
  }
}
