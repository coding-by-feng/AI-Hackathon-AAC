# Visual Resolution Endpoint

## Function
`POST /api/visuals` takes a concept (a word, optionally with a clarifying detail) and returns a
picture for it, along with which rung of the five-step resolution ladder produced it.

## Purpose
The caller does not choose *how* a picture is found. It asks for a picture, and
`resolveVisual()` decides whether that means a built-in symbol, another card's symbol, a cached
image, a semantically close cached image, or a new generation. The response says which, so the
UI can be honest about it and so the dashboard's cost panel has a denominator.

This is also the only place `OPENAI_API_KEY` is reachable from: the pinned decision in
`docs/TECH_STACK.md` is "no key in the browser" — the client talks to `/api/*` and the key exists
only on the server. Generation is the last resort, not the default: the product claim is that
AI fills gaps in a vocabulary, not that it draws every symbol.

## Source Files
| File | Role |
|------|------|
| `app/api/visuals/route.ts` | The HTTP surface: body validation, `maxDuration`, and the mapping of a failed resolution to 502 |

## Implementation

### Route configuration

```ts
export const dynamic = 'force-dynamic'
export const maxDuration = 60      // image generation takes 5–15s; the platform default would cut it off
```

### `POST /api/visuals`

Body: `{ concept?, detail?, childId?, scene?, force? }`.

| Condition | Status | Response |
|---|---|---|
| body is not JSON | 400 | `{ "error": "Body must be JSON" }` |
| `concept` missing or whitespace-only | 400 | `{ "error": "A word or description is required" }` |
| `resolveVisual` returns `resolvedBy: 'failed'` | 502 | `{ "error": <result.note>, "resolvedBy": "failed" }` |
| `resolveVisual` throws | 500 | `{ "error": "<message>" }` |
| ok | 200 | the whole `Resolution` object |

The call it makes:

```ts
resolveVisual({
  spec: { concept: body.concept, detail: body.detail },
  childId: body.childId ?? null,
  createdBy: body.childId ? 'adult' : null,   // presence of childId is what sets createdBy
  scene: body.scene,
  forceGenerate: body.force === true,         // strict === true, so "1" or "yes" does not force
})
```

Note `createdBy` is derived from whether a `childId` was supplied, not from any identity — the
route has no session lookup at all.

### `Resolution` (the 200 body, from `lib/visuals/ladder.ts`)

| Field | Type | Notes |
|---|---|---|
| `resolvedBy` | `icon_pack · card_library · hash_cache · semantic · generated · failed` | which rung produced it |
| `symbol` | `string \| null` | set for `icon_pack` and `card_library` — a key into `lib/icons/symbols.tsx` |
| `imageData` | `string \| null` | set for `hash_cache`, `semantic`, `generated` — a `data:` URL |
| `candidates` | `string[]` | only when freshly generated — three images |
| `visualId` | `string \| null` | the cached/stored row |
| `ms` | number | wall time for the whole resolution |
| `costUsd` | number | `IMAGE_COST_USD = 0.02` per image plus `EMBED_COST_USD = 0.00002`; 0 for steps 1–3 |
| `note` | string | human-readable, e.g. `Close enough to "juice" (91%)` |

### The ladder this endpoint fronts

| Step | Source | Cost | Latency |
|---|---|---|---|
| 1 | built-in symbol set (`symbolFor(concept)`) | $0 | instant |
| 2 | another card's picture (`SELECT label FROM cards WHERE lower(label) = ?`) | $0 | ~1 ms |
| 3 | exact concept in the visual cache (`findExact`) | $0 | ~2 ms |
| 4 | semantic match in the cache (`embed` + `findSemantic`) | ~$0 | ~200 ms |
| 5 | provider image generation, 3 candidates | ~$0.06 | 5–15 s |

`force: true` skips steps 1–4 entirely. With no image provider configured, step 5 returns
`resolvedBy: 'failed'` with `unconfiguredMessage()` as the note — which this route surfaces as
a **502**, the same status as a provider error.

Every attempt writes a `gap_detected` event when `childId` is present
(`session_id: 'visual-resolve'`, `actor: 'adult'`, `scene: opts.scene ?? 'unknown'`, payload
carrying `concept`, `normalizedConcept`, `resolvedBy`, `msResolve`, `costUsd`). Logging failures
never propagate — an adult must not lose a picture because an audit row could not be written.

### Routing and callers

`/api/visuals` is in `KID_PREFIXES` in `middleware.ts`, so it is reachable on the `aac.*`
hostname and 404s on the dashboard and MCP hostnames.

**No component in `app/` or `components/` calls this endpoint today.** The only exercised caller
is `tools/test-api.sh`, which asserts three resolutions (`water` → `icon_pack`,
`Toilet` → case-insensitive hit, `chocolate milkshake` → generation, with `--max-time 90`).
The picture-picking UI in `components/kid/edit-sheet.tsx` currently offers the built-in symbol
set and a photo upload only, and posts to `/api/cards`.

## Dependencies & Connections

### Depends On
- [Visual resolution ladder](../ai/visual-resolution-ladder.md) — `resolveVisual`, the five steps, the cost
  constants and the `gap_detected` logging.
- [Visual cache store](../ai/visual-cache.md) — `findExact`, `findSemantic`, `save`, `markUsed`.
- [Image provider](../ai/image-providers.md) — `generate`, `embed`, `activeProvider`,
  `unconfiguredMessage`, and the `OPENAI_API_KEY` / Vertex configuration.
- [Event ingest](event-ingest.md) — `gap_detected` events flow through `ingestEvents`.
- [Symbol set](../kid-app/symbol-set.md) — step 1 of the ladder.

### Depended On By
- `tools/test-api.sh` — the only live caller in the repo.
- [AI impact panels](../dashboard/student-overview.md) — "Where her pictures come from" and "Words she
  reached for that do not exist" read the `gap_detected` events this endpoint's ladder writes,
  and are empty until it runs.

### Shared Resources
- The visual cache in `aac_app.db`.
- `aac.db` `events` (`gap_detected`).
- Environment: image-provider credentials, read server-side only.

## Change Risks
- **Lowering `maxDuration` below 60** truncates generation, which takes 5–15 s and can be slower
  under load; the caller sees a platform timeout rather than the 502 the route would have
  returned.
- **Returning 200 for `resolvedBy: 'failed'`** would make an unconfigured provider look like a
  successful resolution with no image — the current 502 is what makes the failure visible.
- **Making generation the first step** (or defaulting `force`) turns a $0 path into a paid one
  per card and inverts the ratio the cost panel reports.
- **Adding a session lookup** would change `createdBy` semantics; today the value is `'adult'`
  whenever a `childId` is present, which is what the visual store records as the creator.
- **Removing `/api/visuals` from `KID_PREFIXES`** makes it 404 on the kid hostname while
  continuing to work on localhost — the failure mode `docs/deploy.md` records as having bitten
  twice.
