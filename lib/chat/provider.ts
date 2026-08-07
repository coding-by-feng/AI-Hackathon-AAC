/**
 * Chat provider abstraction — OpenAI or Gemini, chosen by configuration.
 *
 * Deliberately no vendor SDK. Both providers are a single POST with a JSON
 * body; an SDK would add a dependency, a version to track, and its own opinion
 * about streaming, in exchange for saving about forty lines.
 *
 * Set CHAT_PROVIDER=openai|gemini. Keys are read server-side only — a key in a
 * NEXT_PUBLIC_ var is readable from devtools in seconds.
 */

export type ProviderId = 'openai' | 'gemini'

/** A tool as the agent knows it, before translation to a provider dialect. */
export type ToolDef = {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON Schema
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string }

export type ToolCall = {
  id: string
  name: string
  args: Record<string, unknown>
}

/** What a provider streams back. */
export type ProviderChunk =
  | { type: 'text'; delta: string }
  | { type: 'tool_calls'; calls: ToolCall[] }
  | { type: 'usage'; inputTokens: number; outputTokens: number }

export interface ChatProvider {
  readonly id: ProviderId
  readonly model: string
  send(
    messages: ChatMessage[],
    tools: ToolDef[],
    signal?: AbortSignal,
  ): AsyncGenerator<ProviderChunk>
}

export class ProviderError extends Error {
  status: number
  retryable: boolean
  constructor(message: string, status: number, retryable = false) {
    super(message)
    this.status = status
    this.retryable = retryable
  }
}

/**
 * Resolved once per request rather than at module load, so changing the env var
 * in development does not require a restart.
 */
export async function resolveProvider(): Promise<ChatProvider> {
  const id = (process.env.CHAT_PROVIDER ?? 'openai') as ProviderId
  if (id === 'gemini') {
    const { GeminiProvider } = await import('./gemini')
    return new GeminiProvider()
  }
  if (id !== 'openai') {
    throw new ProviderError(
      `CHAT_PROVIDER must be 'openai' or 'gemini', got '${id}'`,
      500,
    )
  }
  const { OpenAIProvider } = await import('./openai')
  return new OpenAIProvider()
}

export function requireKey(name: string): string {
  const key = process.env[name]
  if (!key) {
    throw new ProviderError(
      `${name} is not set. The chat panel needs a key on the server; ` +
        `never put one in a NEXT_PUBLIC_ variable.`,
      500,
    )
  }
  return key
}

/**
 * Line-delimited SSE reader shared by both providers. Yields the JSON payload
 * of each `data:` line and stops at `[DONE]`.
 */
export async function* sseLines(res: Response): AsyncGenerator<unknown> {
  const reader = res.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // Keep the trailing partial line in the buffer — splitting on '\n' and
    // parsing every piece drops the tail of any chunk that lands mid-line.
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (payload === '[DONE]') return
      try {
        yield JSON.parse(payload)
      } catch {
        /* keep-alive or partial frame; ignore */
      }
    }
  }
}
