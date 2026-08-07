# Symbol Set, Card Faces & Design Tokens

## Function
A built-in inline-SVG AAC symbol set (68 symbols) coloured by the Fitzgerald key, the `CardFace` component that renders a card as photo → symbol → letter tile, and the shared CSS custom properties both the kid app and the dashboard draw from.

## Purpose
Inline SVG rather than image files, for four reasons that all matter on this device (`lib/icons/symbols.tsx` header):
- crisp at every cell size across the four breakpoints, with no sprite sheet
- **works with no network**, which the board must
- inherits colour, so the same symbol reads correctly in light and dark
- nothing to 404, and no per-card request

One drawing style throughout — 24×24 box, no fill, 2px round strokes — because "symbol sets fail when each icon is drawn to its own taste: a child learning to scan a grid is reading shape and weight before they read meaning."

Colour follows the **Fitzgerald key**, "which most AAC systems and most speech therapists already use: word class is the grouping, so the colours a child learns here transfer to other boards rather than competing with them."

The fallback tier is the point of `CardFace`: "A missing symbol must degrade to something legible, never to an empty box or a broken image icon — the child still needs to find the word."

## Source Files
| File | Role |
|------|------|
| `lib/icons/symbols.tsx` | `SYMBOLS` map, `CLASS_STYLE`, `SymbolArt`, `symbolFor`, `wordClassFor`, `allSymbolNames`, `isNumeral`, `CATEGORY_ICON`, `categoryIcon`. |
| `components/kid/card-face.tsx` | `CardFace` (three-tier rendering) and `faceColours` (background/border/foreground for a card button). |
| `app/globals.css` | Tailwind import, the `@theme` token set, dark-mode overrides, focus ring, reduced-motion and touch behaviour. |

## Implementation

### Word classes and the Fitzgerald key
```ts
type WordClass = 'pronoun' | 'verb' | 'descriptor' | 'noun' | 'social' | 'urgent'
```
| Class | `bg` | `fg` | `border` | `name` |
|---|---|---|---|---|
| `pronoun` | `#fff8db` | `#7a5c00` | `#e8c95a` | people |
| `verb` | `#e6f6ea` | `#1c6b3a` | `#7bc396` | doing |
| `descriptor` | `#e8f0fd` | `#1f4f9c` | `#8bb0e8` | describing |
| `noun` | `#fdeee0` | `#8a4a12` | `#e5a76a` | things |
| `social` | `#fbe9f2` | `#8c2b5c` | `#e08cb4` | social |
| `urgent` | `#fdeaea` | `#9c1f1f` | `#e08585` | important |

These are literal hex values, **not** CSS variables, so they do not flip between light and dark mode. Card backgrounds must stay constant "or a child re-learns the colour code every time the theme flips."

### The symbol map
`SYMBOLS: Record<string, {wordClass, art}>` — **68 entries**, keyed by lowercased card label, grouped in the file as: important/urgent (`yes`, `no`, `stop`, `help`, `hurt`, `not`), people/pronouns (`i`, `you`, `my`, `this`, `dad`, `mum`, `teacher`), doing words, describing words, social (`please`, `thank you`), things, feelings, behaviour/turn-taking, food and drink, activities.

The six feelings faces (`happy`, `sad`, `angry`, `scared`, `tired`, `excited`) deliberately "share one head shape and differ only in the mouth and brows, so they read as a family and a child learns the set rather than six pictures" — a feeling word being the hardest thing to find by reading.

Helpers:
- `symbolFor(label)` → `SYMBOLS[label.trim().toLowerCase()] ?? null`
- `wordClassFor(label)` → the class or `null`
- `allSymbolNames()` → `Object.keys(SYMBOLS).sort()` — the source list for the edit sheet's picker and for server-side validation in `PUT /api/cards`
- `SymbolArt({label, size = 32})` → `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">`, returning `null` when the label has no symbol

### Numerals
```ts
isNumeral(label) => /^\d{1,2}$/.test(label.trim())
```
Numbers render as digits, not drawings: "A picture of four apples means 'apple' as readily as it means 'four'. The numeral is unambiguous, and it is also what the child will meet everywhere else — on a clock, a page, a lift button." Used by `CategoryDrawer` to render the Numbers folder as `text-3xl font-bold` digits.

### Category icons
`CATEGORY_ICON` (9 entries) maps a folder id to a representative symbol:
`feelings→happy`, `food→apple`, `activities→play`, `behaviour→wait`, `numbers→more`, `people→i`, `places→home`, `body→hurt`, `describing→good`.

`categoryIcon(categoryId, firstWord?)` returns the mapped symbol if it exists in `SYMBOLS`, else the first word of the folder if *that* resolves, else `null`. The chips "were text-only, which makes the bar a row of words to read — the one thing an AAC user may not be able to do."

### `CardFace` — three tiers, in priority order
```ts
CardFace({ label, symbolKey?, imageData?, size = 40, showLabel = true })
```
1. **`imageData`** — an `<img>` at `size × size`, `rounded-md object-cover`, `alt=""`. "A real picture of *their* cup beats any generic drawing of a cup."
2. **`SymbolArt`** for `symbolKey ?? label`.
3. **The first letter**, uppercased, in a `--color-surface-sunk` tile at `fontSize: size * 0.55` with `--color-ink-muted` — the legible degradation.

**Colour is owned here, not inherited.** The face sets `color` from `CLASS_STYLE[wordClass].fg` (falling back to `var(--color-ink)` when the word has no class), and both the symbol (`stroke="currentColor"`) and the label inherit it. Without this, the page's ink colour flips in dark mode and "a near-white label on pale yellow is invisible: the word disappears and only the picture is left."

`faceColours(label, symbolKey?)` returns `{background, borderColor, color}` — from `CLASS_STYLE` when a symbol resolves, otherwise `{--color-surface, --color-line, --color-ink}`. `color` travels with the pair "so anything rendered inside the card — including text the face does not own, like an edit badge — is legible against it."

### Design tokens (`app/globals.css`)
Two surfaces share this stylesheet — the dashboard on a laptop and the kid PWA on phone/tablet/iPad/laptop — and "the kid surface drives the hard constraints: 64px minimum touch targets, high contrast, and no colour that carries meaning on its own."

| Token | Light | Dark (`prefers-color-scheme: dark`) |
|---|---|---|
| `--color-ink` | `#10131a` | `#eef1f6` |
| `--color-ink-muted` | `#545c6b` | `#a3abb9` |
| `--color-ink-faint` | `#8b94a3` | `#6f7889` |
| `--color-surface` | `#ffffff` | `#14171e` |
| `--color-surface-sunk` | `#f4f6f9` | `#1b1f28` |
| `--color-line` | `#dfe3ea` | `#2a2f3a` |
| `--color-accent` | `#2f5fd0` | `#7fa4f5` |
| `--color-accent-soft` | `#e8eefc` | `#1c2740` |
| `--color-good` / `-soft` | `#1c7a4a` / `#e3f5eb` | soft → `#14301f` |
| `--color-warn` / `-soft` | `#9a5b00` / `#fdf1de` | soft → `#322414` |
| `--color-alert` / `-soft` | `#b3261e` / `#fce9e7` | soft → `#351a17` |
| `--color-neutral` / `-soft` | `#4a5261` / `#eef0f4` | soft → `#212632` |
| `--radius-card` | `0.75rem` | — |
| `--font-sans` | `ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif` | — |

`--color-neutral` exists **because clinical constraint C1 forbids styling repetition or stimming as a problem** — the comment points at `docs/aac-clinical-constraints.md`, where `metrics_catalog.polarity = 'neutral'` blocks red/warning styling. Stimming does not get a red badge.

Global rules:
- `html { color-scheme: light dark }`
- `body { touch-action: manipulation }` — "iOS Safari: stop double-tap zoom eating the second tap on an AAC card."
- `:focus-visible { outline: 3px solid var(--color-accent); outline-offset: 2px }` — "the laptop build supports keyboard and switch scanning, which is only usable if the focused cell is unmistakable."
- `@media (prefers-reduced-motion: reduce)` forces all animation and transition durations to `0.01ms !important`.

## Dependencies & Connections

### Depends On
- Tailwind CSS v4 (`@import 'tailwindcss'` plus `@theme`) — tokens are consumed as `var(--color-*)` throughout the kid components.

### Depended On By
- [Communication Board](communication-board.md) — every grid cell and rail button uses `CardFace` + `faceColours`.
- [Category Folders](category-folders.md) — `CardFace`, `isNumeral`, `categoryIcon` for the chips and the drawer.
- [Card Customisation](card-customisation.md) — `allSymbolNames()` drives the picker and the server-side validation; `CLASS_STYLE` tints each picker tile.
- [Child Sign-In](child-sign-in.md) — `PIN_SYMBOLS` are keys into `SYMBOLS`, rendered through `CardFace`.
- ../dashboard/student-overview.md — shares `app/globals.css` tokens, including the `neutral` colour C1 requires.

### Shared Resources
- `SYMBOLS` keys form an implicit contract with `cards.label` values, `PIN_SYMBOLS`, `CATEGORY_ICON` and the stored `card_overrides.symbol` values.
- `app/globals.css` is the single stylesheet for both the kid app and the dashboard.

## Change Risks
- **Making `CLASS_STYLE` backgrounds theme-aware** breaks the Fitzgerald colour code: the child re-learns the grouping every time the theme flips.
- **Removing the `ink` assignment in `CardFace`** makes labels near-invisible in dark mode on pale pastel cards — the word vanishes and only the picture is left.
- **Deleting or renaming a `SYMBOLS` key** silently degrades every card with that label to a letter tile, and if the key is in `PIN_SYMBOLS` or `CATEGORY_ICON`, degrades the passcode pad or the folder chips as well. Stored `card_overrides.symbol` values referencing it also stop resolving.
- **Replacing inline SVG with image files** re-introduces network dependence and 404s on a device that must work offline.
- **Dropping `touch-action: manipulation`** brings back iOS double-tap zoom swallowing the second tap on a card — a repeated press, which C1 says is normal communication, would stop registering.
- **Weakening `:focus-visible`** removes the only affordance switch-scanning and keyboard users have to see where they are.
- **Colouring a `neutral` metric red on the dashboard** violates C1's enforcement rule; `--color-neutral` exists specifically so the UI cannot.
