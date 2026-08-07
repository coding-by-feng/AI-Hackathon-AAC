/**
 * A local model — Gemma on this machine, or on any device on the school's own
 * network. No cloud, no key, no child's data leaving the building.
 *
 * Ollama, LM Studio, llama.cpp's `server`, vLLM and LiteLLM all expose the
 * OpenAI Chat Completions wire format, so this is a base URL plus the shared
 * streaming loop in lib/chat/openai.ts — not a fifth dialect. What differs:
 *
 *  - **No Authorization header** unless a key is configured. Ollama rejects
 *    nothing, but vLLM behind a proxy may want one, so it stays optional.
 *  - **No `stream_options`.** OpenAI's usage-in-stream extension makes several
 *    local servers 400 on an unknown field, so token counts simply come back
 *    as zero rather than breaking the turn.
 *  - The base URL is normalised: paste `http://192.168.1.42:11434`, or the
 *    `/v1` root, or the full `/v1/chat/completions` — all three work, because
 *    every one of them is what somebody will actually paste.
 *
 * TOOL CALLING IS THE REQUIREMENT, not chat. The agent answers by calling the
 * analytics tools; a model or server without function-calling support will
 * stream prose and cite nothing. Gemma 3 and Qwen 3 served by a recent Ollama
 * handle it; older builds do not.
 */
import {
  ProviderError,
  type ChatMessage, type ChatProvider, type ProviderChunk, type ToolDef,
} from './provider'
import { openAIStyleStream } from './openai'

/**
 * Accepts a host root, a `/v1` root, or a full completions URL.
 * Returns the completions endpoint, or throws with what was wrong.
 */
export function completionsUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new ProviderError(
      `'${raw}' is not a URL. Use the model server's address, e.g. http://localhost:11434`,
      400,
    )
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ProviderError(`Base URL must be http or https, got '${url.protocol}'.`, 400)
  }
  if (url.pathname.endsWith('/chat/completions')) return url.toString()
  if (url.pathname.endsWith('/v1')) return `${trimmed}/chat/completions`
  return `${trimmed}/v1/chat/completions`
}

export class LocalProvider implements ChatProvider {
  readonly id = 'local' as const
  readonly model: string
  private readonly endpoint: string
  private readonly apiKey: string | null

  constructor(model: string, baseUrl: string | null, apiKey: string | null) {
    this.model = model
    if (!baseUrl) {
      throw new ProviderError(
        'No address for the local model. Set it in Dashboard → Settings ' +
          '(e.g. http://localhost:11434 for Ollama), or set AAC_LOCAL_BASE_URL on the server.',
        500,
      )
    }
    this.endpoint = completionsUrl(baseUrl)
    this.apiKey = apiKey
  }

  send(messages: ChatMessage[], tools: ToolDef[], signal?: AbortSignal): AsyncGenerator<ProviderChunk> {
    return openAIStyleStream({
      endpoint: this.endpoint,
      apiKey: this.apiKey,
      model: this.model,
      messages, tools, signal,
      label: 'Local model',
      usageInStream: false,
    })
  }
}
