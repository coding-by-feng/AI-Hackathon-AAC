/**
 * AI provider settings — which model answers the Ask panel, and with what key.
 *
 * Lives in `aac_app.db` (app-owned state), NOT `aac.db` (pipeline-owned).
 * Resolution order for every field: settings row -> environment -> default.
 * So `.env.local` keeps working untouched, and the settings page is an
 * override, not a migration.
 *
 * KEYS ARE WRITE-ONLY. `settingsStatus()` returns whether a key exists and its
 * last four characters, never the key. There is no read path that returns a
 * full key to a browser.
 */
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'

const APP_DB = process.env.AAC_APP_DB ?? path.join(process.cwd(), 'aac_app.db')

declare global {
  var __aacAiSettings: DatabaseSync | undefined
}

function db(): DatabaseSync {
  if (!globalThis.__aacAiSettings) {
    const d = new DatabaseSync(APP_DB)
    d.exec('PRAGMA journal_mode = WAL')
    d.exec('PRAGMA busy_timeout = 5000')
    d.exec(`
      CREATE TABLE IF NOT EXISTS ai_settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        updated_by TEXT
      ) STRICT
    `)
    globalThis.__aacAiSettings = d
  }
  return globalThis.__aacAiSettings
}

export type ChatProviderId = 'vertex' | 'gemini' | 'openai' | 'anthropic' | 'local'

export const PROVIDERS: Record<
  ChatProviderId,
  {
    label: string
    /** 'base_url' = a local server: an address instead of a cloud key. */
    auth: 'adc' | 'api_key' | 'base_url'
    keySetting: string | null
    envKey: string | null
    models: string[]
    defaultModel: string
  }
> = {
  vertex: {
    label: 'Google Vertex AI (gcloud ADC — no key needed)',
    auth: 'adc',
    keySetting: null,
    envKey: null,
    // gemini-3 previews serve from the global endpoint; 2.5-flash from
    // us-central1. vertex.ts routes by model and falls back if a preview 404s.
    models: ['gemini-3-flash-preview', 'gemini-3-pro-preview', 'gemini-2.5-flash'],
    defaultModel: 'gemini-3-flash-preview',
  },
  gemini: {
    label: 'Google AI Studio (API key)',
    auth: 'api_key',
    keySetting: 'gemini_api_key',
    envKey: 'GEMINI_API_KEY',
    models: ['gemini-3-flash-preview', 'gemini-3-pro-preview', 'gemini-2.5-flash'],
    defaultModel: 'gemini-3-flash-preview',
  },
  openai: {
    label: 'OpenAI (API key)',
    auth: 'api_key',
    keySetting: 'openai_api_key',
    envKey: 'OPENAI_API_KEY',
    models: ['gpt-5.1', 'gpt-5.1-mini', 'gpt-4.1'],
    defaultModel: 'gpt-5.1',
  },
  anthropic: {
    label: 'Anthropic Claude (API key)',
    auth: 'api_key',
    keySetting: 'anthropic_api_key',
    envKey: 'ANTHROPIC_API_KEY',
    models: ['claude-sonnet-5', 'claude-opus-5', 'claude-haiku-4-5-20251001'],
    defaultModel: 'claude-sonnet-5',
  },
  local: {
    // Gemma on this machine or on another device on the school's own network.
    // The key is optional (most local servers want none); the ADDRESS is what
    // this provider needs, so `auth` is 'base_url'.
    label: 'Local model — Gemma on your own machine or network (no cloud)',
    auth: 'base_url',
    keySetting: 'local_api_key',
    envKey: 'AAC_LOCAL_API_KEY',
    models: ['gemma3:4b', 'gemma3:12b', 'gemma3:27b', 'qwen3:8b', 'llama3.1:8b'],
    defaultModel: 'gemma3:4b',
  },
}

const KEY_SETTINGS = [
  'openai_api_key', 'anthropic_api_key', 'gemini_api_key', 'local_api_key',
] as const

/** Not a secret — the settings page shows it back so it can be corrected. */
const LOCAL_BASE_URL = 'local_base_url'
const LOCAL_BASE_URL_ENV = 'AAC_LOCAL_BASE_URL'

function get(key: string): string | null {
  const row = db()
    .prepare('SELECT value FROM ai_settings WHERE key = ?')
    .get(key) as { value: string } | undefined
  return row?.value ?? null
}

function put(key: string, value: string | null, by: string): void {
  if (value === null || value === '') {
    db().prepare('DELETE FROM ai_settings WHERE key = ?').run(key)
    return
  }
  db()
    .prepare(
      `INSERT INTO ai_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value,
         updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
    .run(key, value, Date.now(), by)
}

export type ChatConfig = {
  provider: ChatProviderId
  model: string
  /** Resolved API key; null for ADC, and optional for a local server. Server-side only. */
  apiKey: string | null
  /** Where the local model lives. Null for every cloud provider. */
  baseUrl: string | null
}

/** What the chat actually runs with, after settings -> env -> default. */
export function chatConfig(): ChatConfig {
  const stored = get('chat_provider')
  const env = process.env.CHAT_PROVIDER
  const provider = (
    stored && stored in PROVIDERS ? stored : env && env in PROVIDERS ? env : 'vertex'
  ) as ChatProviderId

  const meta = PROVIDERS[provider]
  // The settings form always writes provider and model together, so a stored
  // model belongs to the stored provider. Env CHAT_MODEL only applies when the
  // env provider is the one running — "gpt-5.1" must never be sent to Vertex.
  const model =
    (stored ? get('chat_model') : null) ??
    (!stored && env === provider ? process.env.CHAT_MODEL ?? null : null) ??
    meta.defaultModel

  // A local server may also carry a key (vLLM behind a proxy), so both
  // api_key and base_url providers resolve one; ADC never does.
  const apiKey =
    meta.auth === 'adc'
      ? null
      : (meta.keySetting ? get(meta.keySetting) : null) ??
        (meta.envKey ? process.env[meta.envKey] ?? null : null)

  const baseUrl =
    meta.auth === 'base_url'
      ? get(LOCAL_BASE_URL) ?? process.env[LOCAL_BASE_URL_ENV] ?? null
      : null

  return { provider, model, apiKey, baseUrl }
}

/** For the settings page: current selection + masked key presence. Never keys. */
export function settingsStatus() {
  const cfg = chatConfig()
  const keys: Record<string, { configured: boolean; source: 'settings' | 'env' | null; last4: string | null }> = {}
  for (const k of KEY_SETTINGS) {
    const fromSettings = get(k)
    const envName = Object.values(PROVIDERS).find((p) => p.keySetting === k)?.envKey ?? null
    const fromEnv = envName ? process.env[envName] ?? null : null
    const v = fromSettings ?? fromEnv
    keys[k] = {
      configured: Boolean(v),
      source: fromSettings ? 'settings' : fromEnv ? 'env' : null,
      last4: v ? v.slice(-4) : null,
    }
  }
  const storedBase = get(LOCAL_BASE_URL)
  const envBase = process.env[LOCAL_BASE_URL_ENV] ?? null
  return {
    provider: cfg.provider,
    model: cfg.model,
    // An address is not a secret: show it back so a typo can be seen and fixed.
    localBaseUrl: {
      value: storedBase ?? envBase ?? '',
      source: (storedBase ? 'settings' : envBase ? 'env' : null) as 'settings' | 'env' | null,
      envName: LOCAL_BASE_URL_ENV,
    },
    providers: Object.fromEntries(
      Object.entries(PROVIDERS).map(([id, p]) => [
        id,
        { label: p.label, auth: p.auth, models: p.models, defaultModel: p.defaultModel, keySetting: p.keySetting },
      ]),
    ),
    keys,
  }
}

export type SaveInput = {
  provider?: string
  model?: string
  openai_api_key?: string
  anthropic_api_key?: string
  gemini_api_key?: string
  local_api_key?: string
  local_base_url?: string
}

/**
 * Save from the settings form. Empty-string key = remove the stored key
 * (falling back to env if present). Unknown providers rejected loudly.
 */
export function saveSettings(input: SaveInput, by: string): { ok: true } | { ok: false; error: string } {
  if (input.provider !== undefined) {
    if (!(input.provider in PROVIDERS)) {
      return { ok: false, error: `Unknown provider '${input.provider}'. Allowed: ${Object.keys(PROVIDERS).join(', ')}.` }
    }
    put('chat_provider', input.provider, by)
  }
  if (input.model !== undefined) {
    const model = input.model.trim()
    if (model.length > 100) return { ok: false, error: 'Model name is too long.' }
    // Free text on purpose: a newer model than this file knows about must be
    // selectable without a code change. The provider 404s loudly if it is wrong.
    put('chat_model', model || null, by)
  }
  if (input.local_base_url !== undefined) {
    const raw = input.local_base_url.trim()
    if (raw) {
      // Validated here rather than at request time: a teacher fixing a typo
      // should be told now, not by a failed question three screens later.
      let url: URL
      try {
        url = new URL(raw)
      } catch {
        return { ok: false, error: `'${raw}' is not a URL. Try http://localhost:11434` }
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return { ok: false, error: 'The address must start with http:// or https://' }
      }
      if (raw.length > 300) return { ok: false, error: 'That address is too long.' }
    }
    put(LOCAL_BASE_URL, raw || null, by)
  }
  for (const k of KEY_SETTINGS) {
    const v = input[k]
    if (v === undefined) continue
    if (v.length > 300) return { ok: false, error: 'That key does not look like an API key (too long).' }
    put(k, v.trim() || null, by)
  }
  return { ok: true }
}
