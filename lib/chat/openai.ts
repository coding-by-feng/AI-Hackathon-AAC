/**
 * OpenAI Chat Completions, streaming, with tool calling.
 *
 * Tool-call arguments arrive as string fragments spread across many deltas, so
 * they are accumulated by index and parsed only once the stream finishes —
 * parsing early gets you a SyntaxError on `{"child_i`.
 *
 * The streaming loop is exported as `openAIStyleStream` because it is not
 * OpenAI-specific: Ollama, LM Studio, llama.cpp's server and vLLM all serve
 * this exact wire format at `/v1/chat/completions`, so lib/chat/local.ts is a
 * base URL away rather than a second copy of this file.
 */
import {
  ProviderError, sseLines,
  type ChatMessage, type ChatProvider, type ProviderChunk, type ToolCall, type ToolDef,
} from './provider'
import { toOpenAITools } from './schema-adapter'

const ENDPOINT = 'https://api.openai.com/v1/chat/completions'

/** One streaming Chat-Completions turn against any OpenAI-shaped endpoint. */
export async function* openAIStyleStream(opts: {
  endpoint: string
  /** Omitted entirely when null — local servers usually want no Authorization. */
  apiKey: string | null
  model: string
  messages: ChatMessage[]
  tools: ToolDef[]
  signal?: AbortSignal
  /** Prefix for error messages, e.g. 'OpenAI' or 'Local model'. */
  label: string
  /** Only OpenAI honours this; some local servers 400 on unknown fields. */
  usageInStream: boolean
}): AsyncGenerator<ProviderChunk> {
  const { endpoint, apiKey, model, messages, tools, signal, label } = opts

  let res: Response
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: messages.map(toOpenAIMessage),
        tools: tools.length ? toOpenAITools(tools) : undefined,
        tool_choice: tools.length ? 'auto' : undefined,
        stream: true,
        ...(opts.usageInStream ? { stream_options: { include_usage: true } } : {}),
      }),
    })
  } catch (err) {
    // A machine that is off, asleep, or on another network is the normal
    // failure for a local model — say which address failed rather than
    // surfacing a bare "fetch failed".
    if ((err as Error).name === 'AbortError') throw err
    throw new ProviderError(
      `${label} unreachable at ${endpoint}: ${(err as Error).message}`,
      503,
      true,
    )
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new ProviderError(
      `${label} ${res.status}: ${body.slice(0, 300)}`,
      res.status,
      res.status === 429 || res.status >= 500,
    )
  }

  // index -> partial call. Fragments can interleave across several tools.
  // Some local servers omit `index`; fall back to 0 so the slot still exists.
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
      const idx = typeof tc.index === 'number' ? tc.index : 0
      const slot = pending.get(idx) ?? { id: '', name: '', args: '' }
      if (tc.id) slot.id = tc.id
      if (tc.function?.name) slot.name = tc.function.name
      if (tc.function?.arguments) slot.args += tc.function.arguments
      pending.set(idx, slot)
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

export class OpenAIProvider implements ChatProvider {
  readonly id = 'openai' as const
  readonly model: string
  private readonly apiKey: string

  constructor(
    model = process.env.CHAT_MODEL ?? 'gpt-5.1',
    apiKey: string | null = process.env.OPENAI_API_KEY ?? null,
  ) {
    this.model = model
    if (!apiKey) {
      throw new ProviderError(
        'No OpenAI API key. Add one in Dashboard → Settings, or set OPENAI_API_KEY on the server.',
        500,
      )
    }
    this.apiKey = apiKey
  }

  send(messages: ChatMessage[], tools: ToolDef[], signal?: AbortSignal): AsyncGenerator<ProviderChunk> {
    return openAIStyleStream({
      endpoint: ENDPOINT,
      apiKey: this.apiKey,
      model: this.model,
      messages, tools, signal,
      label: 'OpenAI',
      usageInStream: true,
    })
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
