# Generated-Picture Cache

## Function
Stores every generated picture in `generated_visuals` (in `aac_app.db`) as a data: URL with its prompt, model and embedding, and offers two lookups — exact match on the normalised concept, and cosine similarity over stored embeddings above a `0.88` threshold.

## Purpose
Every picture ever made is kept and reused, because generation is the only step of the resolution ladder that costs real money. Two lookups because two different kinds of collision matter:

- **exact** — the normalised concept, so `'a drink of water'` and `'Water!'` collapse to the same key and wording never costs a generation
- **semantic** — cosine over stored embeddings, for concepts that mean the same thing without normalising to the same string

The file lives in `aac_app.db`, deliberately separate from the analytics database: `db/schema.sql` belongs to the analytics pipeline.

## Source Files
| File | Role |
|------|------|
| `lib/visuals/store.ts` | The `generated_visuals` table (created on first use), `findExact()`, `findSemantic()`, `save()`, `markUsed()`, `stats()` |

## Implementation

### Storage
| Item | Value |
|---|---|
| Database file | `AAC_APP_DB` env var, default `path.join(process.cwd(), 'aac_app.db')` |
| Driver | `node:sqlite` `DatabaseSync` |
| Handle | `globalThis.__aacVisuals` singleton |
| PRAGMAs | `journal_mode = WAL`, `busy_timeout = 5000` |

`aac_app.db` is a **shared** file: `lib/chat/settings.ts` owns the `ai_settings` table in the same database, behind its own `globalThis.__aacAiSettings` handle with the same WAL + `busy_timeout` pattern — two handles, one file, coordinated by WAL.

### Schema (`CREATE TABLE IF NOT EXISTS … STRICT`)
```sql
generated_visuals (
  visual_id          TEXT PRIMARY KEY,
  concept            TEXT NOT NULL,   -- as the adult typed it
  normalized_concept TEXT NOT NULL,   -- the cache key
  prompt             TEXT NOT NULL,
  model              TEXT NOT NULL,
  image_data         TEXT NOT NULL,   -- data: URL
  embedding          TEXT,            -- JSON array, for semantic lookup
  created_by         TEXT,
  created_at         INTEGER NOT NULL,
  used_count         INTEGER NOT NULL DEFAULT 0
) STRICT
```
Plus `CREATE INDEX IF NOT EXISTS ix_visuals_norm ON generated_visuals (normalized_concept)`.

Note `concept` stores the value the ladder passes in, which is already `sanitizeConcept()`d — the column comment says "as the adult typed it", but no raw string reaches this table via `resolveVisual()`.

### `StoredVisual`
`{ visual_id, concept, normalized_concept, image_data, model, created_at }` — note `prompt`, `embedding`, `created_by` and `used_count` are stored but not returned by `row()`.

### `findExact(concept)` — ladder step 3
`key = normalizeConcept(concept)`; empty key → `null`. Otherwise:
```sql
SELECT visual_id, concept, normalized_concept, image_data, model, created_at
FROM generated_visuals WHERE normalized_concept = ?
ORDER BY used_count DESC, created_at DESC LIMIT 1
```
Ordering by `used_count DESC` first means the most-reused picture for a concept wins ties, not the newest.

### `findSemantic(embedding, threshold = 0.88)` — ladder step 4
Loads **every** row where `embedding IS NOT NULL` and scans them in JS: `JSON.parse` each stored embedding (a parse failure `continue`s past that row), computes `cosine(embedding, stored)` (from `lib/visuals/openai.ts`), and keeps the highest score `>= threshold`. Returns `{ visual: StoredVisual, score } | null`. There is no index or ANN structure — a full table scan per lookup.

The ladder renders the score as `Close enough to “<stored concept>” (<Math.round(score * 100)>%)`.

### `save(v)`
`visual_id` = `` `vis_${crypto.randomUUID().slice(0, 12)}` `` — a 12-character slice of the UUID string (which includes the first hyphen group boundary), not a full UUID. Inserts all ten columns with `used_count = 0`; `embedding` is `JSON.stringify(v.embedding)` or `NULL`. `normalizeConcept(v.concept)` is computed twice (once for the insert, once for the returned object) and `Date.now()` is read twice, so the returned `created_at` can differ from the stored one by a millisecond.

### `markUsed(visualId)`
`UPDATE generated_visuals SET used_count = used_count + 1 WHERE visual_id = ?` — "a reuse is the signal that a cached picture is worth keeping". Called by the ladder on every `hash_cache` and `semantic` hit, never on a fresh generation.

### `stats()`
```sql
SELECT COUNT(*) AS total,
       SUM(CASE WHEN used_count > 0 THEN 1 ELSE 0 END) AS reused
FROM generated_visuals
```
Returns `{ total, reused }` with `Number(… ?? 0)` coercion. **Currently exported but not imported anywhere.**

### Interaction with the ladder
| Ladder step | Call |
|---|---|
| 3 `hash_cache` | `findExact(concept)` → `markUsed()` on hit |
| 4 `semantic` | `findSemantic(embedding)` → `markUsed()` on hit |
| 5 `generated` | `save({ concept, prompt, model: providerModel(), imageData: images[0].dataUrl, embedding, createdBy })` |

Only `images[0]` is persisted; the other candidates are returned to the client as `candidates[]` and are lost if not chosen.

## Dependencies & Connections

### Depends On
- [visual-prompt-and-sanitisation](visual-prompt-and-sanitisation.md) — `normalizeConcept()` is both the write key and the read key
- [image-providers](image-providers.md) — `cosine()` from `lib/visuals/openai.ts`
- `node:sqlite` `DatabaseSync` (Node built-in, same driver family as the rest of the app)

### Depended On By
- [visual-resolution-ladder](visual-resolution-ladder.md) — the only consumer; steps 3, 4 and 5

### Shared Resources
- `aac_app.db` (`AAC_APP_DB`) — the application database, separate from the analytics DB used by [scoped-tool-bridge](scoped-tool-bridge.md) (`AAC_DB`, default `aac.db`); also holds `ai_settings` (see [chat-providers](chat-providers.md))
- Three process-wide SQLite handles on `globalThis`, one per concern: `__aacVisuals` (this cache, `aac_app.db`), `__aacAiSettings` (`ai_settings`, same `aac_app.db` file), and `__aacChatDb` (the analytics DB on the chat side)
- `normalized_concept` values must agree with the `normalizedConcept` written into `gap_detected` payloads

## Change Risks
- **`findSemantic()` scans the whole table on every miss of step 3.** Every row's `image_data` (a full base64 data: URL) is selected along with the embedding, so memory and time grow linearly with the cache — the cheapest fix is to stop selecting `image_data` in the scan query. At present nothing bounds the table size; there is no eviction, TTL, or `used_count`-based pruning anywhere.
- **Lowering the `0.88` threshold** returns visually wrong symbols for near-miss concepts on a board a child uses to speak; raising it pushes traffic to paid generation and shifts `visual_source_split` toward `generated`.
- **Changing `normalizeConcept()`** invalidates every `normalized_concept` already stored — see [visual-prompt-and-sanitisation](visual-prompt-and-sanitisation.md).
- **Switching image provider** changes embedding dimensionality; `cosine()` returns `0` on a length mismatch, so old rows silently stop matching and step 4 stops hitting.
- **Deleting `aac_app.db`** loses every generated picture and every `used_count`; cards referencing those `visual_id`s lose their image, and the next resolution of each concept costs a fresh generation. It also loses the `ai_settings` rows — provider selection, stored API keys, and the local model's address — so chat silently reverts to the env → `vertex`-default resolution.
- **Adding a column without `IF NOT EXISTS` migration handling** — the table is created inline on first use with no migration path, so an existing `aac_app.db` will keep the old shape and `save()` will fail on the new column.
- **`STRICT` mode** means any type drift (e.g. writing a number into `image_data`) is a hard SQLite error at insert time, not a silent coercion.
