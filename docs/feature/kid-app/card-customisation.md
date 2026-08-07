# Card Customisation (Edit Sheet & Overrides)

## Function
Lets an adult change a card's wording, its symbol and its picture for **one child**, storing the change as a `card_overrides` row in `aac_app.db` that is layered over the shared `cards` catalogue at render time. Position is never editable.

## Purpose
Two constraints drive the design (`lib/overrides.ts` header):

- **`cards` is global.** Editing `cards.label` would rename the word on every child's board at once — "exactly what a customisation feature must not do."
- **The analytics database is owned by the pipeline** in `db/` and `tools/`. Adding a mutable UI table there would collide with the rebuild and would put mutable state inside an append-only analytics store.

And the hard clinical line: "An override changes how a card LOOKS and what it SAYS. It can never change where the card sits — position lives in `board_cells` and moving a learned button destroys the motor plan (clinical constraints C2/C3)." The edit sheet says this to the adult in plain words: *"This is how it will look on the board. Its position never changes."*

Photos exist because "for anything that belongs to them — their cup, their chair, a person — a real photo works better than a drawing."

## Source Files
| File | Role |
|------|------|
| `lib/overrides.ts` | The `card_overrides` table, `overridesFor`, `saveOverride`, `clearOverride`, `clearPhoto`, image validation. |
| `components/kid/edit-sheet.tsx` | The modal an adult sees: label / word form / phrase fields, photo capture with client-side downscale, symbol picker, Save and Reset. |

## Implementation

### Storage
File: `process.env.AAC_APP_DB ?? path.join(process.cwd(), 'aac_app.db')`, opened once onto `globalThis.__aacApp` with `PRAGMA journal_mode = WAL` and `PRAGMA busy_timeout = 5000`.

```sql
CREATE TABLE IF NOT EXISTS card_overrides (
  child_id    TEXT NOT NULL,
  card_id     TEXT NOT NULL,
  label       TEXT,          -- NULL = keep the card's own label
  word_form   TEXT,          -- contribution to a multi-word sentence
  spoken_text TEXT,
  symbol      TEXT,          -- a key into lib/icons/symbols.tsx
  image_data  TEXT,          -- data: URL of a photo, already downscaled
  updated_at  INTEGER NOT NULL,
  updated_by  TEXT,
  PRIMARY KEY (child_id, card_id)
) STRICT
```
There is **no row/col column**. Position cannot be expressed here at all.

### Server API (`lib/overrides.ts`)
| Function | Behaviour |
|---|---|
| `overridesFor(childId)` | `SELECT * FROM card_overrides WHERE child_id = ?` → `Record<card_id, CardOverride>` |
| `saveOverride(input)` | Validates, then upserts with `COALESCE(excluded.X, card_overrides.X)` per field |
| `clearOverride(childId, cardId)` | `DELETE` the row — back to the card's own label, phrase and built-in symbol |
| `clearPhoto(childId, cardId)` | `UPDATE ... SET image_data = NULL` — drops only the photo, keeping label/phrase edits |

Validation in `saveOverride`:
- `MAX_IMAGE_BYTES = 400_000`. An `imageData` longer than that throws `"Image too large — downscale it in the browser before sending"`.
- `imageData` must match `/^data:image\/(png|jpeg|webp);base64,/` or it throws `"imageData must be a base64 data URL for a png, jpeg or webp"`.
- An explicitly-provided empty/whitespace label throws `"A card cannot have an empty label"`.

### HTTP contract (`app/api/cards/route.ts`)
| Method | Path | Body / params | Notes |
|---|---|---|---|
| `GET` | `/api/cards?child=<id>` | — | `{ overrides }`; `400` without `child` |
| `PUT` | `/api/cards` | `{childId, cardId, label?, wordForm?, spokenText?, symbol?, imageData?, updatedBy?, scene?}` | `404` for an unknown `card_id`; `400` for a `symbol` not in `allSymbolNames()`; **no row/col is accepted** |
| `DELETE` | `/api/cards?child=&card=&photoOnly=1` | — | `photoOnly=1` → `clearPhoto`, otherwise `clearOverride` |

A successful `PUT` also writes a `card_created` event (`actor: 'adult'`, `session_id: 'card-edit'`) with `payload {origin: imageData ? 'photo' : 'manual', changed: {label, spokenText, symbol, photo}}` — "so the dashboard can answer the question that matters afterwards: did the new picture actually get used?" A failure to write that event is swallowed rather than losing the customisation.

### Client photo downscale (`edit-sheet.tsx`)
```ts
async function downscale(file: File, max = 256): Promise<string>
```
`createImageBitmap` → scale so the longest edge is at most **256 px** → draw to a canvas → `canvas.toDataURL('image/jpeg', 0.82)`. Rationale from the header: "A phone photo is 3–8 MB; the board renders it at up to ~124 px (the card face's clamp), so a 256 px longest edge is about 2× the largest render. Sending the original would put megabytes into the database for something rendered postage-stamp size — and on a school connection the upload would be the slowest thing in the app." A read failure sets the error *"That image could not be read."*

### Edit sheet UI
Modal `role="dialog" aria-modal="true" aria-label="Edit <label>"`, `max-h-[92dvh]`, bottom sheet on mobile / centred on `sm:`.

| Field | Label | Helper copy |
|---|---|---|
| preview | — | *"This is how it will look on the board. Its position never changes."* |
| `label` | **Word on the card** | — |
| `word` | **In a sentence, this word is** | *"What this card contributes when joined with others — 'water' gives 'I want water'. Usually the same as the word on the card."* |
| `spoken` | **On its own, it says** | *"The whole sentence, used when this is the only card pressed."* |
| photo | **Photo** | *"For anything that belongs to them — their cup, their chair, a person — a real photo works better than a drawing."* |
| symbol grid | **Or pick a picture** | Warns *"The photo is used instead. Remove it to use a drawing."* while an image is set |

- Photo buttons: `Take or choose a photo` / `Change photo`, `Remove photo`; the hidden `<input type="file" accept="image/*" capture="environment">` opens the rear camera on a tablet.
- Symbol grid: `grid-cols-5 sm:grid-cols-7`, `max-h-52` scroll, an `auto` tile first (`symbol = null`, *"Use the built-in picture for this word"*), then every name from `allSymbolNames()` tinted with `CLASS_STYLE[wordClass]`. Picker tiles render `CardFace` at `size 26` and the preview at `size 56` — fixed pixel sizes on purpose: this is an adult surface and does not scale with the board.
- `Save` is disabled while `busy` or when `label.trim()` is empty; on success it calls `onSaved({...card, label, word_form: word, spoken_text: spoken, symbol, image_data: image})` and closes. The board's `applyEdit` patches both `cards` and `essentials` and turns `editing` off.
- `Reset to default` calls `DELETE /api/cards?child=&card=` (no `photoOnly`), then `onSaved({...card, label: card.label, symbol: null, image_data: null})`.

### Known behaviour: "Remove photo" does not clear the stored photo
`saveOverride` merges with `COALESCE(excluded.image_data, card_overrides.image_data)`, and `EditSheet.save()` sends `imageData: null` after "Remove photo". `COALESCE` therefore keeps the **existing** photo in the database. The board's local state is patched to `image_data: null`, so the photo disappears until the next page load, at which point `overridesFor` returns it again. `clearPhoto` and the `photoOnly=1` query parameter exist for exactly this job but the edit sheet never calls them. The same `COALESCE` merge means no field can be reverted to the card's default individually — only `Reset to default`, which deletes the whole row, does that.

### How an override reaches the board
`app/page.tsx` calls `overridesFor(child.child_id)` and applies `applyOverride` to both `cards` and `essentials`. The symbol fallback is the subtle part: `symbol: o.symbol ?? (o.label && o.label !== c.label ? c.label : null)` — renaming "water" to "my bottle" keeps the *original* label as the symbol key, because symbols are looked up by label and a rename would otherwise drop the card to its letter-tile fallback. "The child loses a picture they already recognise purely because an adult reworded the caption."

## Dependencies & Connections

### Depends On
- [Symbol Set & Card Faces](symbol-set.md) — `CardFace` for the preview, `allSymbolNames()`/`symbolFor`/`CLASS_STYLE` for the picker, and the server-side symbol validation in `PUT /api/cards`.
- ../api/board-content-endpoints.md — the three handlers above.
- ../database/schema.md — `cards` (read-only; the `PUT` checks the `card_id` exists) and `events` (the `card_created` audit row).
- `aac_app.db` — shared with [Child Sign-In](child-sign-in.md) and [Category Folders](category-folders.md).

### Depended On By
- [Communication Board](communication-board.md) — `applyOverride` in `app/page.tsx`, and the edit-mode tap path that opens this sheet.
- [Utterance & Speech](utterance-and-speech.md) — the `word_form` and `spoken_text` edited here are exactly what `buildUtterance` consumes.
- ../dashboard/student-overview.md — `card_created` events with `origin: 'photo' | 'manual'` are how the dashboard measures whether a new picture was used.

### Shared Resources
- `aac_app.db` table `card_overrides`, keyed `(child_id, card_id)`.
- `globalThis.__aacApp` — the cached `DatabaseSync` handle.
- `PUT /api/cards`, `DELETE /api/cards`, `GET /api/cards`.

## Change Risks
- **Adding a row/col field to `card_overrides` or to the `PUT` payload** breaks C2/C3 directly: a learned button would move and the child's motor plan would be destroyed. The absence of these columns is the enforcement mechanism.
- **Writing edits into `cards` instead of `card_overrides`** renames the word on every child's board simultaneously, and puts mutable state into a database `tools/build.sh` rebuilds from scratch — the edit would vanish on the next build.
- **Removing the `symbol: o.symbol ?? (o.label !== c.label ? c.label : null)` fallback** in `app/page.tsx` makes every renamed card fall back to a letter tile, taking away a picture the child already recognises.
- **Raising `MAX_IMAGE_BYTES` without changing `downscale`'s `max = 256` / quality `0.82`** lets multi-megabyte data URLs into SQLite; every board render then ships them to the client inside the server payload.
- **Growing the board's card-face size past `downscale`'s `max = 256`** makes every stored photo render soft: 256 px is sized as roughly 2× the current ~124 px maximum face. Re-check `max` (and `MAX_IMAGE_BYTES`) whenever card sizing grows.
- **Fixing the "Remove photo" `COALESCE` behaviour** (e.g. by switching to `excluded.image_data`) changes the merge semantics for *every* field: a `PUT` that omits a field would then null it out, so all callers must start sending complete payloads.
- **Removing the `allSymbolNames()` check in `PUT /api/cards`** lets an arbitrary `symbol` string be stored, which `symbolFor` will not resolve — the card silently degrades to a letter tile.
