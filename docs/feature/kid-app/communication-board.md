# Communication Board

## Function
The child-facing AAC surface at `/`: a fixed-position symbol grid, an always-on essential rail, a sentence bar with Speak/Undo/Clear/Stop, communication-mode chips that highlight rather than move cards, and adult toggles for Modelling, Editing, Scene and Private Mode.

## Purpose
This is the product itself — "the dashboard exists to explain what happens here, not the other way round" (`app/page.tsx` header). Every layout decision here is traceable to a clinical constraint: a mode never moves a card (C4), the grid column count comes from the child's own `boards.grid_cols` and never from the viewport (C2), masked cells stay as empty holes rather than being closed up (C2 progressive masking), and the essential rail is never reordered or dimmed. Modelling Mode exists because an adult demonstrating on the child's device otherwise inflates the child's own independence figures.

## Source Files
| File | Role |
|------|------|
| `app/page.tsx` | Server component. Resolves identity from the session cookie, reads the robust board, essentials, modes and categories from SQLite, applies per-child overrides, hands a `BoardData` object to the client. |
| `components/kid/board-app.tsx` | The client board: composer state, tap handling, mode chips, essential rail, sentence bar, header toggles, and the four modal surfaces (voice, categories, card edit, category editor). |

## Implementation

### Route and identity
- Route: `/` (`app/page.tsx`), `export const dynamic = 'force-dynamic'`.
- `?child=<id>` is **not** identity. If present, the page calls `setCurrentChild(requested)` then `redirect('/')`, so identity always comes back from the `aac_child` cookie. See [Child Sign-In](child-sign-in.md).
- No cookie → `redirect('/who')`. Cookie present but the child is missing from `children` (stale roster) → `redirect('/who')`.
- No `boards` row with `kind = 'robust'` → renders the `Fallback` component: `"<name> has no robust board."` plus a link to `/dashboard`.

### Server queries (all against `aac.db` via `lib/db.ts`)
| Data | Query |
|---|---|
| child | `SELECT child_id, display_name FROM children WHERE child_id = ?` |
| board | `SELECT board_id, grid_rows, grid_cols FROM boards WHERE child_id = ? AND kind = 'robust' ORDER BY created_at LIMIT 1` |
| cards | `board_cells bc JOIN cards c` → `card_id, label, spoken_text, is_essential, is_core, grid_row, grid_col, masked, nav_depth`, `ORDER BY bc.grid_row, bc.grid_col` |
| essentials | `cards c LEFT JOIN board_cells bc ON bc.card_id = c.card_id AND bc.board_id = ?` `WHERE c.is_essential = 1 ORDER BY c.card_id`, with `COALESCE(bc.grid_row, -1)`, `COALESCE(bc.grid_col, -1)`, `0 AS masked`, `COALESCE(bc.nav_depth, 0)` |
| modes | `boards b JOIN mode_selection ms ON ms.board_id = b.board_id WHERE b.child_id = ? AND b.kind = 'mode' AND ms.emphasis = 'highlight' ORDER BY b.name, ms.rank` |

The essential rail is built as its own list, not as a filter of the grid, "so these must be reachable even when a mode has dimmed everything else". An essential card that has no `board_cells` row for this board is logged with `grid_row = -1, grid_col = -1` (the `COALESCE` default) — never null, which is what keeps it past the ingest validator.

Mode rows are folded into `BoardMode { board_id, name, highlighted: string[] }`. A mode holds **no coordinates of its own**.

### Override application
`overridesFor(child_id)` (see [Card Customisation](card-customisation.md)) is applied over each card by `applyOverride`:
1. `word_form` is always seeded first: `seededWordForm(card_id, label)`.
2. `label ← o.label ?? c.label`, `spoken_text ← o.spoken_text ?? c.spoken_text`.
3. `word_form ← o.word_form ?? (o.label ? o.label : withWord.word_form)`.
4. `symbol ← o.symbol ?? (o.label && o.label !== c.label ? c.label : null)` — renaming "water" to "my bottle" keeps the original word's symbol, because symbols are looked up by label and a rename would otherwise drop the child to the letter-tile fallback.
5. `image_data ← o.image_data`.

### Client data shape
```ts
type BoardCard = { card_id, label, spoken_text, is_essential, is_core,
                   grid_row, grid_col, masked, nav_depth,
                   word_form?, symbol?, image_data? }
type BoardMode = { board_id, name, highlighted: string[] }
type BoardData = { child_id, child_name, board_id, grid_rows, grid_cols,
                   cards?, essentials?, modes?, categories?, editableCategories? }
```
`cards`, `essentials`, `modes`, `categories` and `editableCategories` are **optional on purpose**: during a hot reload the client component can be swapped in ahead of the server payload, which crashed the board once. Every consumer defaults (`data.cards ?? []`) — "losing the category folders is an inconvenience, losing the board is losing someone's voice."

### Constants
| Name | Value | Meaning |
|---|---|---|
| `SCENES` | `classroom` "Classroom", `therapy` "Therapy", `free_play` "Free play", `home` "Home", `community` "Out" | Scene selector options |
| modelling auto-exit | `90_000` ms | Timer reset on every adult press |
| speaking-flag timeout | `Math.min(6000, 800 + text.length * 60)` ms | How long the Speak button reads "Speaking…" |
| card min height | `max(64px, 14vh)` | Grid cell |
| essential min height / width | `64` / `84` px | Rail button |
| sentence-bar button min height | `64` px | Speak / Undo / Clear / Stop |
| Speak button flex | `flex-[3]` vs `flex-1` for the other three | |
| dimmed opacity | `opacity-35` | Cards not highlighted by the active mode |

### Component state
`composed: {key, card}[]`, `modeId`, `modeling`, `scene` (default `'classroom'`), `priv`, `speaking`, `speechChecked`, `canSpeak`, `editing`, `editTarget`, `cards`, `essentials`, `openCategory`, `voice`, `voiceOpen`, `catsOpen`.
Refs: `utteranceId` (`crypto.randomUUID()`, rotated on speak and on clear), `startedAt` (ms of first tap in the utterance), `modelingTimer`.

`speechChecked`/`canSpeak` are resolved after mount because speech support cannot be detected during SSR — rendering "this browser cannot speak" on the server would flash the warning at everyone.

### Flows

**Tap a grid or essential card** (`tap(card, source)`):
1. If `editing` → `setEditTarget(card)` and return. Nothing is spoken and **nothing is logged** — an adult's editing session must not land in the child's figures.
2. `startedAt.current ??= Date.now()`.
3. If `modeling` → `touchModeling()` (reset the 90 s timer).
4. `logger.logTap({ cardId, label, boardId, row, col, gridRows, gridCols, navDepth, source, utteranceId })` — `source` is `'board'` or `'essential'`.
5. Append `{ key: `${card_id}-${Date.now()}`, card }` to `composed`.

**Pick a word from a category folder** (`pickFromCategory(word)`): logs `card_tap` with `nav_depth: 1`, `source: 'search'`, `ms_delta: null`, `card_id: word.card_id` (null for words the catalogue lacks), and `payload {viaCategory, onBoard}`. The composed card gets `card_id: word.card_id ?? \`extra:${word.label}\``, `grid_row: -1`, `grid_col: -1`, `nav_depth: 1`. The drawer then closes.

**Speak** (`doSpeak`): no-op when `composed` is empty. Calls `unlock()` then `speak(text, voice)`, sets `speaking`, logs a `speak` event with `payload {cardIds, labels, symbolCount, wordCount, assembly, msCompose, usedSuggestion: false}` where `assembly` is the utterance mode (`'phrase' | 'joined'`) and `wordCount` is `text.split(/\s+/).filter(Boolean).length`. Then rotates `utteranceId`, clears `startedAt`, calls `logger.resetTapClock()` and empties `composed`.

**Undo** (`deleteLast`): logs `delete_last` with `card_id`, `label`, `grid_row`, `grid_col`, `grid_rows`, `grid_cols` and `ms_delta = Date.now() - Number(last.key.split('-').at(-1))` — the ms between tapping the card and removing it, which is the sole input to `mistap_rate`. Removes the last chip.

**Clear** (`clear`): logs `abandon` with `payload {cardIds, msAlive, reason: 'cleared'}`, rotates `utteranceId`, resets the tap clock, empties `composed`.

**Stop**: calls `stop()` (cancels `speechSynthesis`) and clears the speaking flag. It does **not** log.

**Mode chip** (`switchMode(id)`): logs event type `board_switch` with `payload {from, to, trigger: 'manual'}` and sets `modeId`. Note the event type is `board_switch`, not the `mode_switch` named in `docs/analytics-metrics.md` §3.2; `lib/ingest.ts` accepts `board_switch`.

**Scene select**: logs `scene_change` with `payload {from, to, setBy: 'manual'}` then `setScene`. An effect pushes the scene into the logger (`logger.setScene(scene)`) so subsequent events carry it.

**Session bracketing**: on mount `logger.log({type:'session_start'})`; on unmount `session_end` followed by `void logger.flush()`.

**Modelling**: an effect maps `modeling` to `logger.setActor(modeling ? 'adult' : 'child')`. A full-width `--color-warn` banner reads *"Adult is modelling — these presses are recorded as the grown-up's, not <FirstName>'s"*. Toggling the button also calls `touchModeling()`, so switching modelling **off** still arms a 90 s timer that sets it off again (harmless, but the timer is not cancelled on exit).

**Editing**: a `--color-accent` banner reads *"Editing — press any card to change its picture or words. Nothing is spoken or recorded."* Cards gain `ring-2 ring-[var(--color-accent)]` and an `edit` badge. Saving through the edit sheet calls `applyEdit`, which patches both `cards` and `essentials` in place and sets `editing` to `false` — one edit per activation, so a toggle left on cannot silently swallow presses.

### UI elements (header, left to right)
| Element | Label | Handler |
|---|---|---|
| Signed-in chip | initial + first name | `DELETE /api/session?child=<id>` then `window.location.href = '/who'`; `title="Not you? Sign in as someone else"` |
| Mode chips | `All words` + one per mode name | `switchMode(null | board_id)` |
| Scene `<select>` | `aria-label="Where are we?"` | logs `scene_change` |
| `Categories` (only while editing) | opens `CategoryEditor` | |
| `Voice` | opens `VoicePicker` | |
| `Edit cards` / `Done editing` | `aria-pressed={editing}` | toggles editing |
| `I am modelling` / `Stop modelling` | | toggles modelling |
| `Private` / `Private — nothing recorded` | `aria-pressed={priv}`, `title="Nothing is recorded while this is on"` | `setPrivate(next)` — the child can reach it, it is not buried in adult settings |

Sentence bar: sticky (`top-0 z-10`), `min-h-[4.5rem]` so the board never jumps as words are added; empty state reads `Press a word to begin`; below it `Will say: "<text>"`.

Board: `grid` with `gridTemplateColumns: repeat(${data.grid_cols}, minmax(0,1fr))`, iterating `grid_rows × grid_cols` and looking each cell up by `` `${r}:${c}` ``. An empty cell renders `<div aria-hidden />`. A **masked** card renders a dashed `--color-line` placeholder with `minHeight: 64` and no button — the position is held open, never reclaimed.

Essential rail: `<nav aria-label="Always available">`, sticky at the bottom with `paddingBottom: max(0.5rem, env(safe-area-inset-bottom))`, horizontally scrollable, never dimmed by a mode.

Speech-unavailable banner (rendered only once `speechChecked`): *"This browser cannot speak. The sentence bar still shows what <FirstName> wants to say — hold the screen up to read it."*

## Dependencies & Connections

### Depends On
- [Utterance & Speech](utterance-and-speech.md) — `buildUtterance`, `speak`, `stop`, `unlock`, `isSupported`, `loadVoiceChoice`, `seededWordForm`.
- [Event Logging](event-logging.md) — `EventLogger`, `isPrivate`, `setPrivate`, `Scene`.
- [Symbol Set & Card Faces](symbol-set.md) — `CardFace`, `faceColours`.
- [Category Folders](category-folders.md) — `CategoryBar`, `CategoryDrawer`, `CategoryEditor`, `categoriesForChild`.
- [Card Customisation](card-customisation.md) — `overridesFor`, `EditSheet`.
- [Child Sign-In](child-sign-in.md) — `currentChildId`, `setCurrentChild`.
- [Offline & PWA Shell](offline-pwa.md) — the root layout, viewport lock and service worker that wrap this page.
- ../database/schema.md — `children`, `boards`, `board_cells`, `cards`, `mode_selection`.
- ../api/sign-in-endpoints.md — `DELETE /api/session?child=` for the sign-out chip.

### Depended On By
- ../analytics/metric-readers.md — every metric is computed from the events this screen emits; the five starred fields (`grid_row`, `grid_col`, `grid_rows`, `grid_cols`, `nav_depth`) exist only because `logTap` captures them here.
- ../dashboard/student-overview.md — `mistap_rate`, `abandonment_rate`, `repeat_tap_rate` and the position heat map all read taps produced here.
- communication-board.md — generated modes are consumed as `mode_selection` rows with `emphasis = 'highlight'`; they are rendered as a lens, never as a new grid.

### Shared Resources
- `aac.db` tables `children`, `boards`, `board_cells`, `cards`, `mode_selection` (read-only through `lib/db.ts`).
- The `aac_child` cookie.
- `POST /api/events` (via the logger) and `DELETE /api/session`.
- CSS custom properties from `app/globals.css`.

## Change Risks
- **Deriving grid columns from the viewport** would relocate every learned button and break the motor plan (C2). The column count must keep coming from `boards.grid_cols`.
- **Making a mode render its own coordinates** breaks C4 and the `position_consistency` signal (target 1.0). Modes must stay a highlight-and-dim lens over the robust board.
- **Closing up masked cells** (rendering only the non-masked cards) shifts every card after the gap — the same C2 failure by another route.
- **Dimming or reordering the essential rail** removes `yes/no/stop/help/toilet/hurt` from reach at exactly the moment they matter.
- **Logging taps while `editing` is true** would attribute an adult's setup session to the child, inflating tap counts and corrupting `mistap_rate` and independence figures.
- **Removing `touchModeling()` from `tap`** re-creates the original bug: a Modelling toggle left on marks the child's own sentences as the grown-up's.
- **Changing the `composed` key format** (`${card_id}-${Date.now()}`) breaks `deleteLast`, which recovers the tap timestamp with `Number(last.key.split('-').at(-1))`; `ms_delta` would become `NaN` and `mistap_rate` would silently stop working.
- **Renaming the `board_switch` event type** to match the `mode_switch` name in the metrics spec requires a matching change to the `TYPES` set in `lib/ingest.ts`, or every mode switch is rejected with `unknown event type`.
- **Making `cards`/`categories` required in `BoardData`** re-introduces the hot-reload crash the optional fields were added to prevent.

> **2026-08-08:** Card icons are responsive — `clamp(40px, 11vh, 112px)` capped at
> card width with `aspect-ratio: 1` (see `CardFace` size prop, now `number | string`).
> Card face column is `min-w-0 max-w-full` and labels wrap with `overflow-wrap:anywhere`
> (long labels used to push icons past the card borders on phones). Grid gap and card
> padding tighten below `sm:`. Live install currently has **no mode boards** (Snack
> time removed by request at data level); the mode code path is unchanged and a
> pipeline rebuild re-seeds them.
