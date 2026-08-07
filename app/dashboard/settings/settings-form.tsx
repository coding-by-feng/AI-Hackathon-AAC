'use client'

/**
 * Provider / model / key form.
 *
 * Model is a dropdown of known-good ids PLUS a free-text override — the newest
 * model of the month must be selectable without a code change. Key fields are
 * write-only: placeholders show masked presence ("configured ····abcd"), and
 * the inputs stay empty unless the user types a replacement. Saving an empty
 * key clears the stored one (env fallback still applies, and the status says
 * which source is live).
 */
import { useState } from 'react'

type KeyStatus = { configured: boolean; source: 'settings' | 'env' | null; last4: string | null }
type Status = {
  provider: string
  model: string
  providers: Record<
    string,
    { label: string; auth: 'adc' | 'api_key'; models: string[]; defaultModel: string; keySetting: string | null }
  >
  keys: Record<string, KeyStatus>
}

const KEY_LABELS: Record<string, string> = {
  openai_api_key: 'OpenAI API key',
  anthropic_api_key: 'Anthropic API key',
  gemini_api_key: 'Google AI Studio API key',
}

export function SettingsForm({ initial }: { initial: Status }) {
  const [status, setStatus] = useState(initial)
  const [provider, setProvider] = useState(initial.provider)
  const [model, setModel] = useState(initial.model)
  const [customModel, setCustomModel] = useState('')
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const meta = status.providers[provider]
  const knownModels = meta?.models ?? []
  const effectiveModel = customModel.trim() || model

  const pickProvider = (id: string) => {
    setProvider(id)
    setModel(status.providers[id]?.defaultModel ?? '')
    setCustomModel('')
  }

  const save = async () => {
    setBusy(true)
    setNote(null)
    try {
      const body: Record<string, string> = { provider, model: effectiveModel }
      for (const [k, v] of Object.entries(keys)) body[k] = v
      const res = await fetch('/api/dashboard/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `Save failed (${res.status})`)
      setStatus(data)
      setProvider(data.provider)
      setModel(data.model)
      setCustomModel('')
      setKeys({})
      setNote({ tone: 'ok', text: `Saved. The Ask panel now uses ${data.provider} · ${data.model}.` })
    } catch (err) {
      setNote({ tone: 'error', text: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
      <section>
        <h2 className="text-sm font-semibold">Provider</h2>
        <div className="mt-2 space-y-2">
          {Object.entries(status.providers).map(([id, p]) => (
            <label key={id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--color-line)] p-3 has-[:checked]:border-[var(--color-accent)]">
              <input
                type="radio"
                name="provider"
                value={id}
                checked={provider === id}
                onChange={() => pickProvider(id)}
                className="mt-0.5"
              />
              <span className="text-sm">
                <span className="font-medium">{p.label}</span>
                {p.auth === 'api_key' && p.keySetting && (
                  <span className="ml-2 text-xs text-[var(--color-ink-muted)]">
                    {status.keys[p.keySetting]?.configured
                      ? `key configured (${status.keys[p.keySetting].source}) ····${status.keys[p.keySetting].last4}`
                      : 'no key yet'}
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold">Model</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            value={knownModels.includes(model) ? model : (knownModels[0] ?? '')}
            onChange={(e) => setModel(e.target.value)}
            className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm"
            aria-label="Model"
          >
            {knownModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={customModel}
            onChange={(e) => setCustomModel(e.target.value)}
            placeholder="…or type any model id"
            className="min-w-[220px] flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm"
            aria-label="Custom model id"
          />
        </div>
        <p className="mt-1 text-xs text-[var(--color-ink-faint)]">
          Free text wins over the dropdown, so a brand-new model works the day it ships.
          A wrong id fails loudly on the next question — nothing silently falls back.
        </p>
      </section>

      <section>
        <h2 className="text-sm font-semibold">API keys</h2>
        <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
          Stored on the server, shown never. Leave a field empty to keep the current key;
          type a new one to replace it; save a single space to clear it.
        </p>
        <div className="mt-2 space-y-2">
          {Object.entries(KEY_LABELS).map(([k, label]) => (
            <label key={k} className="block text-sm">
              <span className="text-xs font-medium text-[var(--color-ink-muted)]">{label}</span>
              <input
                type="password"
                autoComplete="off"
                value={keys[k] ?? ''}
                onChange={(e) => setKeys((prev) => ({ ...prev, [k]: e.target.value }))}
                placeholder={
                  status.keys[k]?.configured
                    ? `configured (${status.keys[k].source}) ····${status.keys[k].last4}`
                    : 'not configured'
                }
                className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2"
              />
            </label>
          ))}
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save settings'}
        </button>
        {note && (
          <p
            className={`text-sm ${note.tone === 'ok' ? 'text-[var(--color-good,#3a8558)]' : 'text-[var(--color-alert)]'}`}
            role="status"
          >
            {note.text}
          </p>
        )}
      </div>

      <p className="border-t border-[var(--color-line)] pt-3 text-xs text-[var(--color-ink-faint)]">
        Whatever the provider, every answer runs through the same guardrails: the child-scoped
        tools, the clinical rules, and the forbidden-action check. Switching models changes the
        writing, never the boundaries.
      </p>
    </div>
  )
}
