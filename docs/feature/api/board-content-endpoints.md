# Board Content Endpoints

## Function
`/api/cards` reads, saves and clears per-child card customisations (label, word form, spoken
text, symbol, photo); `/api/categories` reads and edits the category folders and the words
inside them, per child and shared across children.

## Purpose
These are the two endpoints an adult uses to make a board fit a particular child without
touching anyone else's.

`/api/cards` deliberately **cannot change position**. There is no `row`/`col` in its payload and
none is accepted. Appearance and wording are editable; where the button sits is not, because a
child's motor plan depends on it staying put (clinical constraints C2 and C3 — "each time we
change the grid size, we all need to re-learn where the words are"). The customisation is
stored in `aac_app.db` rather than by editing `cards.label`, because `cards` is global and
editing it would rename the word on every child's board at once.

Every card edit also writes a `card_created` event, so the dashboard can answer the question
that matters afterwards: did the new picture actually get used?

`/api/categories` exists because folders used to be a constant in
`lib/vocabulary/categories.ts`, so adding "Swimming club" meant a deploy. The constant is now
only a seed; from first run the eleven entries are ordinary editable rows. Hiding is not
deleting — a folder a child is not ready for disappears from their board and keeps its words,
so turning it back on restores exactly what was there.

## Source Files
| File | Role |
|------|------|
| `app/api/cards/route.ts` | GET / PUT / DELETE for card overrides; validates the symbol key and logs the `card_created` audit event |
| `app/api/categories/route.ts` | GET plus a single POST with an `action` discriminator covering eight category and word edits |

## Implementation

Both routes declare `export const dynamic = 'force-dynamic'` and both are listed in
`KID_PREFIXES` in `middleware.ts`, so they are reachable on the `aac.*` hostname only.
Neither performs any authentication or authorisation check.

### `GET /api/cards?child=<childId>`

| Condition | Status | Response |
|---|---|---|
| `child` missing | 400 | `{ "error": "child is required" }` |
| ok | 200 | `{ "overrides": { "<card_id>": CardOverride, … } }` |

`CardOverride` = `{ child_id, card_id, label, word_form, spoken_text, symbol, image_data,
updated_at, updated_by }`, straight from `card_overrides` in `aac_app.db`.

### `PUT /api/cards`

Body: `{ childId?, cardId?, label?, wordForm?, spokenText?, symbol?, imageData?, updatedBy?, scene? }`.

| Condition | Status | Response |
|---|---|---|
| body is not JSON | 400 | `{ "error": "Body must be JSON" }` |
| `childId` or `cardId` missing | 400 | `{ "error": "childId and cardId are required" }` |
| `SELECT card_id FROM cards WHERE card_id = ?` returns nothing | 404 | `{ "error": "Unknown card '<id>'" }` |
| `symbol` set but not in `allSymbolNames()` | 400 | `{ "error": "Unknown symbol '<x>'" }` |
| `saveOverride` throws | 400 | `{ "error": "<message>" }` |
| ok | 200 | `{ "ok": true }` |

`saveOverride` (`lib/overrides.ts`) rejects with:
- `imageData must be a base64 data URL for a png, jpeg or webp` — the regex is
  `/^data:image\/(png|jpeg|webp);base64,/`
- `Image too large — downscale it in the browser before sending` — `MAX_IMAGE_BYTES = 400_000`
  characters of the data URL
- `A card cannot have an empty label`

The upsert uses `ON CONFLICT(child_id, card_id) DO UPDATE SET … COALESCE(excluded.x, card_overrides.x)`,
so a `null` field **preserves** the existing value rather than clearing it. Clearing goes
through `DELETE`.

After a successful save the route writes one event through `ingestEvents`, wrapped in
`try {} catch {}` — "a failed audit event must not lose the customisation the adult just made":

```jsonc
{ event_id: crypto.randomUUID(), child_id, ts: <now>,
  day_local: <local YYYY-MM-DD>, tz_offset_min: -getTimezoneOffset(),
  session_id: 'card-edit',            // a literal, not a real sitting
  scene: body.scene ?? 'unknown',
  actor: 'adult', type: 'card_created', card_id, label: body.label ?? null,
  payload: JSON.stringify({
    origin: body.imageData ? 'photo' : 'manual',
    changed: { label: …!=null, spokenText: …!=null, symbol: …!=null, photo: …!=null }
  }) }
```

`components/kid/edit-sheet.tsx` sends `childId`, `cardId`, `label`, `wordForm`, `spokenText`,
`symbol`, `imageData` — and never `updatedBy` or `scene`, so in practice every logged edit has
`updated_by = NULL` and `scene = 'unknown'`.

### `DELETE /api/cards?child=<childId>&card=<cardId>[&photoOnly=1]`

| Condition | Status | Response |
|---|---|---|
| `child` or `card` missing | 400 | `{ "error": "child and card are required" }` |
| `photoOnly=1` | 200 | `clearPhoto()` — `UPDATE card_overrides SET image_data = NULL`, keeping label and phrase edits |
| otherwise | 200 | `clearOverride()` — `DELETE FROM card_overrides`, back to the card's own label, phrase and built-in symbol |

No event is logged for a reset.

### `GET /api/categories?child=<childId>`

| Condition | Status | Response |
|---|---|---|
| `child` missing | 400 | `{ "error": "child is required" }` |
| ok | 200 | `{ "categories": ChildCategory[] }` |

`categoriesForChild()` seeds on first call, then returns every category with
`COALESCE(cc.sort, c.sort)` and `COALESCE(cc.shown, 1)` — a category with no `child_categories`
row is **shown by default**, so a folder added for the class appears for everyone without
anyone enabling it child by child. Each entry carries its full `words[]`.

### `POST /api/categories` — one endpoint, an `action` field

"Splitting them across seven routes would spread the same validation over seven files."
Every failure, including a bad JSON body and an unknown action, returns **400** with
`{ "error": "<message>" }`.

| `action` | Required fields | Effect | Success body |
|---|---|---|---|
| `create` | `name` | `createCategory(name, 'adult')` — `created_by` is hardcoded `'adult'` here | `{ ok: true, category }` |
| `rename` | `categoryId`, `name` | `renameCategory` | `{ ok: true }` |
| `delete` | `categoryId` | `deleteCategory` — throws `Built-in categories can be hidden but not deleted`; otherwise cascades `category_words` and `child_categories` | `{ ok: true }` |
| `show` | `childId`, `categoryId` | `setShown(childId, categoryId, body.shown !== false)` — note the default is **shown** when `shown` is omitted | `{ ok: true }` |
| `reorder` | `childId`, `order: string[]` | `reorderForChild` — per-child sort only; one child's arrangement never changes another's | `{ ok: true }` |
| `add-word` | `categoryId`, `label` | `addWord` with `spokenText`, `wordForm`, `symbol ?? null`; `spoken_text` defaults to the capitalised label plus a full stop, `word_form` defaults to the label | `{ ok: true, word }` |
| `update-word` | `wordId` | `updateWord` — only the keys present in the body are written | `{ ok: true }` |
| `remove-word` | `wordId` | `removeWord` | `{ ok: true }` |
| anything else | — | — | 400 `{ "error": "Unknown action '<x>'" }` |

Missing-field messages are thrown by the route itself: `A name is required`,
`categoryId and name are required`, `categoryId is required`,
`childId and categoryId are required`, `childId and order are required`,
`categoryId and label are required`, `wordId is required`.

### Storage

Both endpoints write to `aac_app.db` (`AAC_APP_DB`, default `./aac_app.db`), never to `aac.db`:

| Table | Owner | Shape |
|---|---|---|
| `card_overrides` | `lib/overrides.ts` | PK `(child_id, card_id)` |
| `categories` | `lib/categories/store.ts` | shared; `built_in` flag |
| `category_words` | `lib/categories/store.ts` | shared; index `ix_catwords (category_id, sort)` |
| `child_categories` | `lib/categories/store.ts` | per child; PK `(child_id, category_id)` |

The only write either endpoint makes to `aac.db` is the `card_created` event.

## Dependencies & Connections

### Depends On
- [Card overrides store](../kid-app/card-customisation.md) — `overridesFor`, `saveOverride`,
  `clearOverride`, `clearPhoto` and the `MAX_IMAGE_BYTES` guard.
- [Category store](../kid-app/category-folders.md) — `categoriesForChild` and the eight mutators,
  plus `seedIfEmpty()` from `CATEGORIES`.
- [Symbol set](../kid-app/symbol-set.md) — `allSymbolNames()` is the closed list a `symbol` key
  must belong to.
- [Event ingest](event-ingest.md) — the `card_created` audit event.
- [Database schema](../database/schema.md) — `cards` in `aac.db` is the existence check for
  `cardId`.

### Depended On By
- [Card edit sheet](../kid-app/card-customisation.md) — `components/kid/edit-sheet.tsx` (`PUT`, `DELETE`).
- [Category editor](../kid-app/category-folders.md) — `components/kid/category-editor.tsx`
  (`POST`, then re-`GET`s `/api/categories?child=<id>` to refresh).
- [Board composition](../kid-app/communication-board.md) — overrides and categories are merged into the
  rendered board.
- [AI impact panels](../dashboard/student-overview.md) — the `card_created` events with
  `payload.origin` are what "did the new picture get used?" reads.

### Shared Resources
- `aac_app.db` (`AAC_APP_DB`) — shared with `lib/session.ts` (`child_passcodes`) and
  `lib/auth.ts` (`adult_credentials`).
- `aac.db` `events` table, via `ingestEvents`.
- The `card_created` event type, which must stay inside `TYPES` in `lib/ingest.ts`.

## Change Risks
- **Accepting a position field on `PUT /api/cards`** violates C2/C3 directly. The comment on the
  handler is the specification: appearance and wording are editable, position is not. A move
  would also need a `board_revisions` row so insight I8 can measure the harm — this endpoint
  writes none.
- **Changing the `COALESCE` upsert to overwrite with nulls** turns every partial save into a
  data-loss event: `edit-sheet.tsx` sends all five fields every time, but any other caller
  sending only `label` would silently wipe the child's photo.
- **Raising `MAX_IMAGE_BYTES`** puts larger base64 blobs inline in `aac_app.db` and in every
  `GET /api/cards` response; the client is responsible for downscaling before sending.
- **Deleting a built-in category** (if the guard were removed) takes its whole word list with it
  for every child at once, and the seed only runs when `categories` is empty — so it would not
  come back.
- **Renaming an `action` value** silently breaks `category-editor.tsx`, which sends the string
  verbatim; the route answers 400 `Unknown action` rather than failing loudly at build time.
- **Adding authentication to these routes** requires deciding what identity a shared classroom
  tablet has — today they rely entirely on `middleware.ts` hostname separation.
