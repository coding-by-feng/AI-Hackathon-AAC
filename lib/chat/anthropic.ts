/**
 * Anthropic Claude Messages API, streaming, with tool use.
 *
 * Dialect differences the abstraction absorbs:
 *
 *  1. System prompt is a top-level `system` field, not a message.
 *  2. Tool results are content blocks inside a USER message, and consecutive
 *     tool results must share ONE user turn — Anthropic enforces strict
 *     user/assistant alternation.
 *  3. Tool-call arguments stream as `input_json_delta` fragments per content
 *     block; text as `text_delta`. Usage arrives split across message_start
 *     (input) and message_delta (output).
 *  4. `max_tokens` is required.
 */
import {
  ProviderError, sseLines,
  type ChatMessage, type ChatProvider, type ProviderChunk, type ToolCall, type ToolDef,
} from './provider'

const ENDPOINT = 'https://api.anthropic.com/v1/messages'

export class AnthropicProvider implements ChatProvider {
  readonly id = 'anthropic' as const
  readonly model: string
  private readonly apiKey: string

  constructor(model: string, apiKey: string | null) {
    this.model = model
    if (!apiKey) {
      throw new ProviderError(
        'No Anthropic API key. Add one in Dashboard → Settings, or set ANTHROPIC_API_KEY on the server.',
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
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 2048,
        system: system || undefined,
        messages: toAnthropicMessages(messages.filter((m) => m.role !== 'system')),
        tools: tools.length
          ? tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }))
          : undefined,
        stream: true,
      }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new ProviderError(
        `Anthropic ${res.status}: ${body.slice(0, 300)}`,
        res.status,
        res.status === 429 || res.status >= 500,
      )
    }

    // content-block index -> partial tool call being assembled.
    const pending = new Map<number, { id: string; name: string; json: string }>()

    for await (const raw of sseLines(res)) {
      const evt = raw as any
      switch (evt.type) {
        case 'message_start':
          yield {
            type: 'usage',
            inputTokens: evt.message?.usage?.input_tokens ?? 0,
            outputTokens: evt.message?.usage?.output_tokens ?? 0,
          }
          break
        case 'content_block_start':
          if (evt.content_block?.type === 'tool_use') {
            pending.set(evt.index, { id: evt.content_block.id, name: evt.content_block.name, json: '' })
          }
          break
        case 'content_block_delta':
          if (evt.delta?.type === 'text_delta' && evt.delta.text) {
            yield { type: 'text', delta: evt.delta.text }
          } else if (evt.delta?.type === 'input_json_delta') {
            const slot = pending.get(evt.index)
            if (slot) slot.json += evt.delta.partial_json ?? ''
          }
          break
        case 'message_delta':
          if (evt.usage?.output_tokens) {
            yield { type: 'usage', inputTokens: 0, outputTokens: evt.usage.output_tokens }
          }
          break
      }
    }

    if (pending.size) {
      const calls: ToolCall[] = []
      for (const [, slot] of [...pending.entries()].sort((a, b) => a[0] - b[0])) {
        let args: Record<string, unknown> = {}
        try {
          args = slot.json.trim() ? JSON.parse(slot.json) : {}
        } catch {
          // Recoverable: validateArgs reports the problem back to the model.
          args = { __parse_error: slot.json.slice(0, 200) }
        }
        calls.push({ id: slot.id, name: slot.name, args })
      }
      yield { type: 'tool_calls', calls }
    }
  }
}

function toAnthropicMessages(messages: ChatMessage[]): unknown[] {
  // Every user turn is a block array so ANY consecutive user content merges —
  // the API rejects two user messages in a row, and the agent produces exactly
  // that at the step limit (tool results followed by a "answer now" nudge).
  const out: { role: 'user' | 'assistant'; content: unknown[] }[] = []
  const pushUser = (block: unknown) => {
    const last = out[out.length - 1]
    if (last?.role === 'user') last.content.push(block)
    else out.push({ role: 'user', content: [block] })
  }
  for (const m of messages) {
    if (m.role === 'user') {
      pushUser({ type: 'text', text: m.content })
    } else if (m.role === 'assistant') {
      const content: unknown[] = []
      if (m.content) content.push({ type: 'text', text: m.content })
      for (const c of m.toolCalls ?? []) {
        content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args })
      }
      if (content.length) out.push({ role: 'assistant', content })
    } else if (m.role === 'tool') {
      pushUser({ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content })
    }
  }
  return out
}
