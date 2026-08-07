# Category Folders

## Function
A second vocabulary surface: a chip bar above the sentence bar opens a drawer that slides **over** the board with extra words, plus an adult editor for creating, renaming, reordering, hiding and populating those folders. Words picked here are logged with `nav_depth = 1` and `source = 'search'`.

## Purpose
"The robust grid holds the words a child uses constantly, and it never changes — that is the whole point of it (clinical constraints C2/C3). But 15 cells cannot hold a vocabulary, and a child with no way to reach 'angry' or 'seven' simply cannot say them" (`lib/vocabulary/categories.ts` header).

So categories are a **second surface, not a rearrangement of the first**. Opening "Feelings" slides a drawer over the board; the grid underneath is untouched and every button stays exactly where it was learned. Words reached this way are logged at `nav_depth 1`, "which is what lets the dashboard's I3 rule notice a drawer word being used constantly and suggest adding a *copy* of it to the grid" — a copy, never a move (C3).

The folders used to be a constant, "so adding 'Swimming club' meant a deploy" (`lib/categories/store.ts`). That constant is now only a seed. Hiding is not deleting: "A folder a child is not ready for disappears from their board and keeps its words, so turning it back on restores exactly what was there — nobody has to rebuild it from memory."

## Source Files
| File | Role |
|------|------|
| `lib/vocabulary/categories.ts` | The built-in `CATEGORIES` seed, `Category`/`DrawerWord` types, `categoryByKey`. |
| `lib/categories/store.ts` | SQLite store in `aac_app.db`: schema, `seedIfEmpty`, reads, and all writes. |
| `lib/categories/types.ts` | `Category`, `CategoryWord`, `ChildCategory` — shared between server store and client editor. |
| `components/kid/category-drawer.tsx` | `CategoryDrawer` (the folder itself) and `CategoryBar` (the chip row, with a `leading` slot hosting the board's ABC chip). |
| `components/kid/category-editor.tsx` | The adult modal: folder list with tick/reorder/add, and a per-folder word list. |

## Implementation

### Two layers, deliberately
| Table | Scope |
|---|---|
| `categories` + `category_words` | **SHARED.** "Build a folder once and any child can use it." |
| `child_categories` | **PER CHILD.** "Maya needs Numbers, Jonah is not there yet." |

Schema in `aac_app.db` (`process.env.AAC_APP_DB ?? <cwd>/aac_app.db`), opened through `connect('app:categories', …)` with `PRAGMA journal_mode = WAL` and `PRAGMA busy_timeout = 5000`:

```sql
categories       (category_id PK, name, sort DEFAULT 0, built_in DEFAULT 0, created_by, created_at)
category_words   (word_id PK, category_id, label, spoken_text, word_form, symbol, card_id, sort DEFAULT 0)
child_categories (child_id, category_id, shown DEFAULT 1, sort DEFAULT 0, PRIMARY KEY (child_id, category_id))
CREATE INDEX ix_catwords ON category_words (category_id, sort)
```
`category_words.card_id` is "set when the word exists in the shared catalogue" and is `NULL` for extras. `db/schema.sql` belongs to the analytics pipeline; none of this lives there.

### The seed
`CATEGORIES` in `lib/vocabulary/categories.ts` holds **9** entries (the header comments in both files say "eleven" — that is stale; the array has nine):

| key | name | `dbCategories` | extras |
|---|---|---|---|
| `feelings` | Feelings | — | happy, sad, angry, scared, tired, excited, hungry, thirsty (8) |
| `food` | Food & drink | `food`, `drink` | apple, juice, sandwich, banana (4) |
| `activities` | Things to do | `play`, `activity` | play, draw, sing, dance, walk, garden (6) |
| `behaviour` | Taking turns | — | my turn, your turn, wait, share, break, listen, gentle, sorry (8) |
| `numbers` | Numbers | — | `'1'`…`'10'`, each spoken as the digit (10) |
| `people` | People | `people` | — |
| `places` | Places | `place` | — |
| `body` | Body | `body` | — |
| `describing` | Describing | `vehicle` | big, little, hot, cold, fast, slow (6) |

`dbCategories` are matched against `cards.category`; `extras` are vocabulary the seeded catalogue does not contain (feelings and numbers exist in `cards` at all).

`seedIfEmpty()` runs once — it returns immediately if `SELECT COUNT(*) FROM categories` is non-zero. For each seed entry it inserts a `categories` row with `built_in = 1`, `created_by = 'system'`, `sort = i`, then resolves both sources into concrete `category_words`: first `SELECT card_id, label, spoken_text FROM cards WHERE category IN (…) ORDER BY label` (word ids `w_<12 hex>`, `card_id` set), then the extras (`card_id` NULL). "Afterwards a category is simply a list and there is one thing to edit rather than two." It is called from `listCategories()` and `categoriesForChild()`.

### Reads
- `listCategories()` → `ORDER BY sort, name`.
- `wordsIn(categoryId)` → `ORDER BY sort, label`.
- `categoriesForChild(childId)` → `LEFT JOIN child_categories`, `COALESCE(cc.sort, c.sort) AS sort`, `COALESCE(cc.shown, 1) AS shown`, `ORDER BY sort, c.name`, each row expanded with its words. **A category with no `child_categories` row is shown by default** — "a folder added for the class should appear for everyone without someone having to enable it child by child."

### Writes
| Function | Behaviour |
|---|---|
| `createCategory(name, createdBy)` | id `cat_<10 hex>`, `built_in = 0`, `sort = MAX(sort)+1`; throws `'A category needs a name'` on blank |
| `renameCategory(id, name)` | shared across every child |
| `deleteCategory(id)` | **throws `'Built-in categories can be hidden but not deleted'` when `built_in = 1`**; otherwise deletes words, `child_categories` rows, then the category |
| `addWord(categoryId, {label, spokenText?, wordForm?, symbol?})` | id `w_<12 hex>`, `card_id` always NULL, `sort = MAX(sort)+1`; `spoken_text` defaults to the capitalised label + `'.'`; `word_form` defaults to the label |
| `updateWord(wordId, patch)` | builds a partial `SET`; blank label throws |
| `removeWord(wordId)` | delete by `word_id` |
| `setShown(childId, categoryId, shown)` | upsert into `child_categories`, seeding `sort` from the category's own |
| `reorderForChild(childId, orderedIds)` | upsert `sort = index`, preserving the existing `shown` — "one child's arrangement never changes another's" |

Deleting "removes the folder for every child, so it is refused for the built-in set. Hiding is the reversible option and is what the UI offers first — a folder deleted by mistake takes its whole word list with it."

### Board integration (`app/page.tsx`)
`categoriesForChild(child_id)` is filtered to `c.shown && c.words.length > 0` and mapped to `{category: {key: category_id, name, dbCategories: [], extras: []}, words: DrawerWord[]}`, where `DrawerWord.onBoard = onGrid.has(card_id)` against the set of `card_id`s currently on the grid. The full `ChildCategory[]` is passed separately as `editableCategories`, used only by the editor.

### `CategoryBar`
A horizontally scrollable row of pill buttons above the sentence bar, `minHeight: 44`. A `leading` prop renders a chip before the folders — the board passes its ABC keyboard toggle there, so the bar stays a dumb list and the board owns the keyboard state ([Keyboard & Modelling Help](keyboard-and-modeling-help.md)). The bar renders even with zero folders, so the leading chip — alphabet access — never disappears. Each folder chip renders `categoryIcon(c.key, firstWords[c.key])` through `CardFace` at `size 20` with `showLabel={false}` plus the folder name — "recognisable by shape, not only by reading."

### `CategoryDrawer`
- `role="dialog" aria-modal="true" aria-label={category.name}`, a full-screen `bg-black/30` scrim; clicking the scrim closes, clicks inside `stopPropagation()`.
- Panel: `max-h-[78dvh]`, `rounded-t-2xl`, `paddingBottom: max(1rem, env(safe-area-inset-bottom))`.
- Header: the folder name plus a `Back to board` button at `minHeight: 48`.
- Grid: `repeat(auto-fill, minmax(84px, 1fr))` for the `numbers` folder, `repeat(auto-fill, minmax(112px, 1fr))` otherwise; tiles `minHeight: 84` tinted by `faceColours(label)`.
- A word matching `isNumeral` renders as a `text-3xl font-bold` digit; everything else as `CardFace` at `size "clamp(40px, 9vh, 96px)"` — a CSS length, so the face scales with the drawer tile.
- A word already on the grid carries an `on board` badge (`title="This word is also on the board"`) — "a child who finds 'water' in Food and then sees it on the board next time is learning where it lives, which is the whole argument for a stable layout."
- Empty state: *"No words in here yet."* Footer: *"Words used often from here can be added to the main board — the dashboard flags them."*

Picking a word calls the board's `pickFromCategory`, which logs `card_tap` with `nav_depth: 1`, `source: 'search'`, `ms_delta: null` and `payload {viaCategory, onBoard}`, appends a composed card with `grid_row: -1, grid_col: -1`, and closes the drawer. `card_id` stays `null` for words the catalogue does not contain, "because `events` has a foreign key to `cards` and the denormalised label carries the meaning."

### `CategoryEditor`
Opened from the board's `Categories` button, which is only rendered while Edit mode is on — "the adult setting a board up is sitting with the child; the tools belong next to each other rather than on a separate device."

The two levels of change are stated in the UI rather than left to be discovered: **the tick → this child only; name and words → every child using the folder.** Subtitle: *"Tick what <FirstName> sees. Editing the words changes them for everyone."*

Every mutation goes through one helper that `POST`s to `/api/categories`, then re-reads `GET /api/categories?child=<id>` to refresh local state and calls `onChanged()` (the board reloads the page). Errors render as `data.error ?? 'That did not work'`, or *"Could not reach the server"* on a network failure.

| Control | Action payload |
|---|---|
| checkbox `Show <name> for <FirstName>` | `{action:'show', childId, categoryId, shown}` |
| `↑` / `↓` (`aria-label="Move <name> up/down"`, disabled at the ends) | `{action:'reorder', childId, order}` via the local `move(ids, from, to)` helper |
| `New category — e.g. Swimming club` + `Add` | `{action:'create', name}` |
| folder name + `Rename` (disabled when unchanged or blank) | `{action:'rename', categoryId, name}` |
| `Delete` (**rendered only when `built_in === 0`**) | `{action:'delete', categoryId}` |
| `Remove` per word (`aria-label="Remove <label>"`) | `{action:'remove-word', wordId}` |
| `Word on the card — e.g. goggles` + `What it says out loud (optional)` + `Add` | `{action:'add-word', categoryId, label, spokenText?}` |

The route also supports `{action:'update-word', wordId, …}`, which the editor does not currently call. Word rows show `CardFace label={w.symbol ?? w.label}` at size 26 with the spoken text underneath. Footer copy: *"Unticking hides a folder from <FirstName> and keeps its words. Nothing is lost, and ticking it again brings back exactly what was there."* and *"A picture is found automatically — the built-in set first, and only made if nothing matches."*

## Dependencies & Connections

### Depends On
- ../api/board-content-endpoints.md — `GET /api/categories?child=`, `POST /api/categories` with the `action` switch (`create`, `rename`, `delete`, `show`, `reorder`, `add-word`, `update-word`, `remove-word`).
- ../database/schema.md — `cards.category`, `cards.card_id`, `cards.label`, `cards.spoken_text` are read once during seeding.
- [Symbol Set & Card Faces](symbol-set.md) — `CardFace`, `faceColours`, `isNumeral`, `categoryIcon`.
- [Event Logging](event-logging.md) — the `card_tap` emitted on a pick.
- `lib/sqlite.ts` `connect()` — inode-checked handles for `aac_app.db`.

### Depended On By
- [Communication Board](communication-board.md) — renders `CategoryBar`, `CategoryDrawer` and `CategoryEditor`, and owns `pickFromCategory`.
- ../dashboard/student-overview.md — insight **I3** reads `nav_depth_by_card` (`D1`) produced by these picks; its action is *add a copy* at a stable position or unmask an existing one, never move the original (C3).

### Shared Resources
- `aac_app.db` tables `categories`, `category_words`, `child_categories` — the same file as `card_overrides` and `child_passcodes`.
- The `w_`/`cat_` id prefixes.
- `POST /api/categories`.

## Change Risks
- **Making the drawer replace the board instead of overlaying it** breaks C2: the grid must stay mounted and unmoved underneath.
- **Logging folder picks with `nav_depth: 0` or `source: 'board'`** breaks two things at once — `lib/ingest.ts` would then demand grid coordinates the word does not have, and `nav_depth_by_card` (D1) would stop feeding I3, so buried high-frequency words would never be surfaced.
- **Auto-promoting a frequently used folder word onto the grid** violates C3. The only permitted action is adding a *copy* at a stable position, recorded as a `board_revisions` row so I8 can measure the disruption.
- **Removing the `built_in` guard in `deleteCategory`** lets one adult delete a shared folder, taking its entire word list from every child; there is no undo and no soft delete.
- **Treating hide as delete** loses the folder's words, and the promise that ticking it back on "brings back exactly what was there" fails.
- **Adding a tenth seed entry to `CATEGORIES`** has no effect on an existing install: `seedIfEmpty()` short-circuits once any `categories` row exists. New folders must be created through `POST /api/categories`.
- **Renaming a category id** orphans every `child_categories` row (there is no foreign key), so per-child visibility and order silently revert to the defaults.
- **`categoriesForChild` calls `wordsIn` once per category (N+1)** — a large folder set makes the board's server render proportionally slower.
