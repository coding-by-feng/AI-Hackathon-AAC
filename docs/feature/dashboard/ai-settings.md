# AI Settings (Provider Configuration)

## Function
The `/dashboard/settings` page and its vertical: teachers, SLTs and admins choose which AI provider and model answers the [Ask panel](ask-panel.md) — five providers including a fully local one — and store API keys (write-only) or a local server address (shown back) in `aac_app.db`, overriding environment defaults without touching them.

## Purpose
The Ask agent has to run somewhere, and "somewhere" differs per deployment: a school with a Google Cloud project uses Vertex ADC, one with an OpenAI key uses that, and one that wants nothing leaving the building points at Gemma on its own network. Hardcoding any of these in `.env` makes switching a redeploy. The settings row is an **override, not a migration** (`lib/chat/settings.ts` header): resolution for every field is *settings row → environment → default*, so `.env.local` keeps working untouched and the page only ever narrows what the environment already allows.

Two properties are deliberate:

- **Keys travel one way.** The browser can write a key (`POST`) but no read path returns one — `settingsStatus()` returns `configured`, the source (`settings` | `env`) and the last four characters, never the key. "KEYS ARE WRITE-ONLY" is the file header's own emphasis.
- **The local base URL is shown back.** *"An address is not a secret: show it back so a typo can be seen and fixed"* (source comment) — unlike the key fields, the address renders in the form and beside the provider radio, because hiding it would only hide typos.

## Source Files
| File | Role |
|------|------|
| `app/dashboard/settings/page.tsx` | Server page — role gate, renders `SettingsForm` seeded with `settingsStatus()` |
| `app/dashboard/settings/settings-form.tsx` | `SettingsForm` (client) — provider radios, model dropdown + free-text override, key fields, base-URL field, save flow |
| `app/api/dashboard/settings/route.ts` | `GET` masked status · `POST` partial save; the role gate that actually enforces |
| `lib/chat/settings.ts` | `PROVIDERS` registry, `chatConfig()`, `settingsStatus()`, `saveSettings()`, the `ai_settings` table |

## Implementation

### Storage — `ai_settings` in `aac_app.db`
`lib/chat/settings.ts` opens `AAC_APP_DB ?? {cwd}/aac_app.db` (the **app-owned** database — never pipeline-owned `aac.db`), sets WAL + `busy_timeout = 5000`, caches the handle on `globalThis.__aacAiSettings`, and lazily creates:

```sql
CREATE TABLE IF NOT EXISTS ai_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
) STRICT
```

Keys used: `chat_provider`, `chat_model`, `openai_api_key`, `anthropic_api_key`, `gemini_api_key`, `local_api_key`, `local_base_url`. `put()` upserts with `Date.now()` and the saving adult's id; a `null`/empty value **deletes** the row, which is how "clear the key, fall back to env" works.

### `PROVIDERS` — five providers
| id | label | `auth` | `keySetting` | `envKey` | `defaultModel` |
|---|---|---|---|---|---|
| `vertex` | Google Vertex AI (gcloud ADC — no key needed) | `adc` | — | — | `gemini-3-flash-preview` |
| `gemini` | Google AI Studio (API key) | `api_key` | `gemini_api_key` | `GEMINI_API_KEY` | `gemini-3-flash-preview` |
| `openai` | OpenAI (API key) | `api_key` | `openai_api_key` | `OPENAI_API_KEY` | `gpt-5.1` |
| `anthropic` | Anthropic Claude (API key) | `api_key` | `anthropic_api_key` | `ANTHROPIC_API_KEY` | `claude-sonnet-5` |
| `local` | Local model — Gemma on your own machine or network (no cloud) | `base_url` | `local_api_key` | `AAC_LOCAL_API_KEY` | `gemma3:4b` |

`auth: 'base_url'` marks a provider that needs an **address instead of a cloud key** — the local key is optional (most local servers want none; vLLM behind a proxy may). The local model list is `gemma3:4b · gemma3:12b · gemma3:27b · qwen3:8b · llama3.1:8b`; the base URL resolves `local_base_url` setting → `AAC_LOCAL_BASE_URL` env.

### `chatConfig()` — what the chat actually runs with
Returns `{ provider, model, apiKey, baseUrl }`, resolved *settings → env → default*:
- **provider**: stored `chat_provider` if valid → `CHAT_PROVIDER` env if valid → `'vertex'`
- **model**: stored `chat_model` (only when the provider itself came from settings — the form always writes provider and model together, so a stored model belongs to the stored provider) → env `CHAT_MODEL` (only when the env provider is the one running: *"'gpt-5.1' must never be sent to Vertex"*) → the provider's `defaultModel`
- **apiKey**: `null` for ADC; otherwise stored key → env key → `null`
- **baseUrl**: only for `auth === 'base_url'`: stored → env → `null`; `null` for every cloud provider

### `settingsStatus()` — what the page may see
`{ provider, model, localBaseUrl: { value, source: 'settings' | 'env' | null, envName: 'AAC_LOCAL_BASE_URL' }, providers, keys }` where each `keys[k]` is `{ configured, source: 'settings' | 'env' | null, last4 }`. The full base URL is included by design; no key ever is.

### `saveSettings(input, by)` — bounds
- `provider` must be a `PROVIDERS` id, else `{ ok: false, error: "Unknown provider '…'. Allowed: …" }`
- `model` trimmed, **≤ 100 chars**; free text on purpose — *"a newer model than this file knows about must be selectable without a code change. The provider 404s loudly if it is wrong."*
- `local_base_url` validated **at save time**, "not by a failed question three screens later": must parse as a `URL` (error suggests `http://localhost:11434`), protocol must be `http:` or `https:`, raw length **≤ 300**
- each key **≤ 300 chars** (*"does not look like an API key"*); trimmed-empty ⇒ row deleted

### `GET`/`POST /api/dashboard/settings`
`runtime = 'nodejs'` (`node:sqlite` needs a filesystem). Both verbs run `gate()` first: `currentViewer()` throws ⇒ **401** `{ error: 'Sign in first.' }`; role outside `ALLOWED_ROLES = {teacher, slt, admin}` ⇒ **403** `{ error: 'Only teachers and therapists can change AI settings.' }` — the route header's reason: *"a parent's account configures nothing shared."*

- **GET** → `settingsStatus()` as JSON, 200.
- **POST** — body must be JSON (else 400 `Body must be JSON.`). Fields are whitelisted by `typeof … === 'string'`: `provider`, `model`, `openai_api_key`, `anthropic_api_key`, `gemini_api_key`, `local_api_key`, `local_base_url` — a **partial save**: absent fields are untouched. `saveSettings` failure ⇒ 400 `{ error }`; success ⇒ fresh `settingsStatus()`, 200.

### The page (`app/dashboard/settings/page.tsx`)
`force-dynamic`. `currentViewer()`, then `allowed = role === 'teacher' || 'slt' || 'admin'`. Not allowed ⇒ `DashHeader` plus the explanation *"Only teachers and speech therapists can change AI settings. Ask a teacher on this class if something needs adjusting."* — the page gate is UX; the API gate is the enforcement. Allowed ⇒ `DashHeader` (subtitle *"Which AI model answers the Ask panel — applies to every question from the next one on"*) and `<SettingsForm initial={settingsStatus()} />`, in a `max-w-2xl` column.

### `SettingsForm` (client) — controls and save flow
- **Provider** — one radio per `PROVIDERS` entry, label from the registry. Inline status beside each: `api_key` providers show `key configured ({source}) ····{last4}` or `no key yet`; the `base_url` provider shows the address `{value} ({source})` or `no address yet`. `pickProvider(id)` resets the model to that provider's `defaultModel` and clears the free-text override.
- **Where the model runs** — rendered only while the local provider is selected: a `type="url"` input, placeholder `http://localhost:11434`, seeded from `localBaseUrl.value`. Helper text: paste the host, the `/v1` root or the full URL; Ollama, LM Studio, llama.cpp and vLLM all work; *"The server must support tool calling, or answers will cite no numbers. Nothing leaves your network on this setting."*; server-side `{envName}` (`AAC_LOCAL_BASE_URL`) is used when the field is empty.
- **Model** — a `<select>` of the provider's known-good ids plus a free-text input that **wins over the dropdown** (`effectiveModel = customModel.trim() || model`): *"a brand-new model works the day it ships. A wrong id fails loudly on the next question — nothing silently falls back."*
- **API keys** — four `type="password" autoComplete="off"` fields (OpenAI, Anthropic, Google AI Studio, and the optional local key). Write-only: values are never seeded; placeholders show masked presence (`configured ({source}) ····{last4}` / `not configured`). Helper: *"Stored on the server, shown never. Leave a field empty to keep the current key; type a new one to replace it; save a single space to clear it."* Only fields the user typed into are sent.
- **Save settings** — POSTs `{ provider, model: effectiveModel, local_base_url? (only when local), …typed keys }`, then replaces local state from the response: status, provider, model refreshed; key inputs cleared; base URL re-seeded. Success note: `Saved. The Ask panel now uses {provider} · {model}.`; failure renders the API's error string.
- Footer, always: *"Whatever the provider, every answer runs through the same guardrails: the child-scoped tools, the clinical rules, and the forbidden-action check. Switching models changes the writing, never the boundaries."*

## Dependencies & Connections

### Depends On
- [Chat providers](../ai/chat-providers.md) — the registry here describes exactly what `resolveProvider()` can construct; every model list and auth mode must match a provider implementation
- [Role & consent scoping](../auth/role-consent-scoping.md) — `currentViewer()` and `viewer.role`, gating both the page and the API
- [Adult sign-in](../auth/adult-sign-in.md) — the session cookie `currentViewer()` validates; `aac_app.db` is the same app-owned database that holds accounts
- [Dashboard shell](dashboard-shell.md) — `DashHeader`, and the rail's **Settings** item as the entry point

### Depended On By
- [Chat providers](../ai/chat-providers.md) — `resolveProvider()` (`lib/chat/provider.ts`) calls `chatConfig()` on every Ask request to decide provider, model, key and base URL
- [Dashboard shell](dashboard-shell.md) — the rail's **Settings** item lands here

### Shared Resources
- `aac_app.db` / the `ai_settings` table — app-owned state, distinct from pipeline-owned `aac.db`; handle cached on `globalThis.__aacAiSettings`
- Environment variables: `CHAT_PROVIDER`, `CHAT_MODEL`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `AAC_LOCAL_API_KEY`, `AAC_LOCAL_BASE_URL`, `AAC_APP_DB` — the fallback layer under every settings row

## Change Risks
- **Returning a full key anywhere** — from `settingsStatus()`, the `GET` route, or a new debug field — breaks the one-way property the whole design leans on; everything downstream assumes `last4` is the maximum exposure.
- **Widening `ALLOWED_ROLES`** (e.g. adding `parent`) lets one household change the model every teacher's Ask panel runs on — the route header states the rule: a parent's account configures nothing shared. The page gate alone is not enforcement; the API's `gate()` is.
- **Adding a provider id** requires the `PROVIDERS` entry *and* a `ChatProvider` implementation branch in `resolveProvider()` *and* a schema dialect ([chat-providers](../ai/chat-providers.md)); an id in the registry with no implementation saves fine and then fails every question.
- **Relaxing the `local_base_url` validation** (accepting non-http(s) schemes, or skipping the `URL` parse) hands the server-side fetcher an arbitrary address — the scheme whitelist and save-time parse are the only guards on it.
- **Writing `model` without `provider`** (changing the form's always-together save) re-opens cross-provider model leakage; `chatConfig()`'s stored-model rule assumes the pair was written atomically, which is why env `CHAT_MODEL` is already ignored under a settings-chosen provider.
- **Validating the model against the dropdown list** would break the deliberate free-text property — the newest model of the month must be selectable without a code change; the provider 404-ing loudly is the designed failure mode.
- **Renaming or migrating `ai_settings`** must keep the lazy `CREATE TABLE IF NOT EXISTS` in step — every web process opens `aac_app.db` and creates the table on first use, so a rename without a migration resurrects the old schema silently.
