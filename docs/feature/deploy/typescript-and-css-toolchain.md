# TypeScript and CSS Toolchain

## Function
`tsconfig.json` configures strict, emit-free TypeScript for the whole repo (including the `@/*`
path alias), and `postcss.config.mjs` wires Tailwind CSS v4 in as the single PostCSS plugin.

## Purpose
Both files exist to keep the build stack as small as it can be. TypeScript never emits — Next.js
and Node do the transpiling — so `tsc` is used purely as a checker (`npm run typecheck`).
Tailwind v4 needs no `tailwind.config.*` file at all, so there isn't one: the design tokens live
in `app/globals.css` inside an `@theme` block, next to the comments explaining why each token
exists. That matters here because some of those tokens are clinically load-bearing, not
decorative — `docs/aac-clinical-constraints.md` C1 forbids styling repetition or stimming as a
problem, and the stylesheet says so at the point of definition.

## Source Files
| File | Role |
|------|------|
| `tsconfig.json` | Compiler options, `@/*` path alias, include/exclude globs |
| `postcss.config.mjs` | Single-plugin PostCSS config enabling Tailwind v4 |

## Implementation

### `tsconfig.json` — every option, exactly as set
| Option | Value | Effect |
|---|---|---|
| `target` | `ES2022` | |
| `lib` | `["dom", "dom.iterable", "ES2022"]` | DOM types available repo-wide, including server files |
| `allowJs` | `false` | No `.js` sources; the repo is TypeScript-only |
| `skipLibCheck` | `true` | `.d.ts` files in `node_modules` are not checked |
| `strict` | `true` | Full strict mode |
| `noEmit` | `true` | `tsc` never writes output; required for `allowImportingTsExtensions` |
| `esModuleInterop` | `true` | |
| `module` | `esnext` | Matches `"type": "module"` in `package.json` |
| `moduleResolution` | `bundler` | |
| `resolveJsonModule` | `true` | |
| `allowImportingTsExtensions` | `true` | Lets code import `./x.ts` explicitly — needed because `node mcp/server.ts` runs TypeScript directly |
| `isolatedModules` | `true` | Every file must be transpilable alone (SWC/Next requirement) |
| `jsx` | `preserve` | JSX is handed to Next's compiler untouched |
| `incremental` | `true` | Produces `tsconfig.tsbuildinfo` at the repo root |
| `plugins` | `[{ "name": "next" }]` | Next's TS language-service plugin (editor-only) |
| `paths` | `{ "@/*": ["./*"] }` | `@/` resolves to the **repo root**, not `src/` |

```json
"include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
"exclude": ["node_modules"]
```

Notes that follow from those globs:
- `.next/types/**/*.ts` is included, so generated route types participate in `npm run typecheck` — a clean typecheck therefore depends on a prior `next build`.
- `next-env.d.ts` references `next`, `next/image-types/global` and `./.next/types/routes.d.ts`, and is marked "should not be edited".
- Nothing excludes `tools/`, `db/` or `exports/`; only `node_modules` is excluded.
- `tsconfig.tsbuildinfo` and `.next/` are generated into the repo root, and both **are** listed in `.gitignore` under its "Next.js build output" block. The rest of `.gitignore` covers the built databases (`aac.db` + its `-wal`/`-shm` siblings, `aac_text.db*`, `aac_app.db*`), scratch artefacts (`/tmp/`, `*.tmp`, `.DS_Store`, `__pycache__/`, `*.pyc`, `.playwright-cli/`), `node_modules/`, `exports/`, secrets (`.env.local`, `.env*.local`, `deploy/logs/`, `deploy/*.plist`), session-local Claude state, and feature-doc manifest backups.

### `@/*` alias in practice
45 files import through `@/`, e.g. `import { currentViewer, requireChild } from '@/lib/access'`
in `app/actions.ts`. Because the alias maps to `./*`, `@/lib/...`, `@/components/...`,
`@/app/...` and `@/mcp/...` all resolve without further configuration.

### `postcss.config.mjs`
```js
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}

export default config
```

One plugin, no options. Consequences:
- **No `tailwind.config.js`/`.ts` exists in the repo.** Tailwind v4 (`tailwindcss@^4.1.13`, `@tailwindcss/postcss@^4.1.13`) is configured from CSS.
- `app/globals.css` is the only stylesheet and starts with `@import 'tailwindcss';` followed by an `@theme { ... }` block defining the palette, including `--color-ink: #10131a`, `--color-ink-muted: #545c6b`, `--color-ink-faint: #8b94a3`, `--color-surface: #ffffff`, `--color-surface-sunk: #f4f6f9`, `--color-line: #dfe3ea`, `--color-accent: #2f5fd0`, `--color-accent-soft: #e8eefc`, `--color-good: #1c7a4a`, `--color-good-soft: #e3f5eb`, `--color-warn: #9a5b00`, `--color-warn-soft: #fdf1de`, `--color-alert: #b3261e`, `--color-alert-soft: #fce9e7`, `--color-neutral: #4a5261`, `--color-neutral-soft: #eef0f4` (the C1 "neutral" state tokens), `--radius-card: 0.75rem` and `--font-sans` (the system-UI stack).
- The stylesheet's header records the constraints it is built around: two surfaces share it (dashboard on a laptop, kid PWA on phone/tablet/iPad/laptop), and *"the kid surface drives the hard constraints: 64px minimum touch targets, high contrast, and no colour that carries meaning on its own."*
- A `neutral` semantic state exists specifically because clinical constraint **C1** ("Repetition is communication, not error") forbids styling repetition or stimming as a problem — the comment in `app/globals.css` cites `docs/aac-clinical-constraints.md` directly.

### Theming
- A second `@theme` block inside `@media (prefers-color-scheme: dark)` redefines twelve tokens (ink shades, surfaces, line, accent and the `-soft` state colours), so the kid surface follows the OS scheme; `html` sets `color-scheme: light dark`.
- Forced themes: the theme toggle sets `data-theme` on `<html>` to one of three values — `white`, `warm`, `black` — persisted in `localStorage` under `aac-theme` and applied **pre-paint** by an inline script in `app/layout.tsx`. `<html>` carries `suppressHydrationWarning` because, per the layout's comment, *"the server cannot know data-theme."* No attribute means the adaptive behaviour: OS scheme for the kid surface, fixed dark for the dashboard.
- The dashboard's fixed dark is a `.dash`-scoped block that redefines the same token names — *"Everything above this block belongs to the kid surface and its adaptive theme; nothing above may change"* — and the forced themes override it at higher specificity (`[data-theme='white'] .dash`, `[data-theme='warm'] .dash`; `black` needs no block because `.dash` already is black).
- The Fitzgerald card pastels are inline styles in `lib/icons/symbols.tsx` and are deliberately untouched by any theme — *"the colour code is a learned system."*

### Commands
| Command | Effect |
|---|---|
| `npm run typecheck` → `tsc --noEmit` | Type-checks everything in `include`; writes `tsconfig.tsbuildinfo` only |
| `npm run build:web` → `next build` | Runs SWC + PostCSS; regenerates `.next/types/**` |

## Dependencies & Connections

### Depends On
- [Package Manifest and npm Scripts](npm-scripts.md) — supplies `typescript@^5.9.2`, `tailwindcss@^4.1.13`, `@tailwindcss/postcss@^4.1.13` and the `typecheck` script.

### Depended On By
- [Next.js Build Configuration](next-build-config.md) — `next build` consumes both configs; `jsx: "preserve"` and `isolatedModules` are what let Next's compiler own transpilation.
- [Kid Board](../kid-app/communication-board.md) — the 64px touch-target and contrast rules are expressed through the `@theme` tokens this pipeline compiles.
- [Dashboard Shell](../dashboard/dashboard-shell.md) — shares the same single stylesheet.
- [MCP Server](../mcp/stdio-server.md) — `node mcp/server.ts` relies on `allowImportingTsExtensions` and `module: esnext` matching how Node strips types.

### Shared Resources
- `app/globals.css` — the single stylesheet for both the kid surface and the dashboard.
- `@/*` alias — used by 45 files across `app/`, `lib/`, `components/` and `mcp/`.
- `tsconfig.tsbuildinfo`, `.next/types/**` — generated artefacts in the working tree.

## Change Risks
- **Setting `noEmit: false` or removing `allowImportingTsExtensions`.** Any code importing a `.ts` extension explicitly stops compiling, and `tsc` starts emitting `.js` next to sources — which `allowJs: false` then refuses to read, producing a confusing second error.
- **Relaxing `strict`.** The database layer returns `Record<string, unknown>` rows (`type Row` in `lib/db.ts`) and relies on strict narrowing at every call site; loosening it hides real shape mismatches between SQL results and the dashboard's expectations.
- **Changing `paths` (e.g. to `"@/*": ["./src/*"]`).** Breaks all 45 `@/`-importing files at once.
- **Adding a `tailwind.config.js` while on Tailwind v4.** It will be ignored unless explicitly `@config`-loaded, so the palette silently keeps coming from `@theme` and the new file appears to do nothing.
- **Editing the semantic colour tokens.** `--color-alert`/`--color-warn` carry clinical meaning. Re-pointing a "repetition" or "stimming" display at `--color-alert` violates constraint **C1**; the comment in `app/globals.css` is the only thing recording that, so a purely visual refresh can regress a clinical requirement.
- **Removing `.next/types/**/*.ts` from `include`.** `npm run typecheck` stops verifying route params and page props, and typed-route mistakes surface only at `next build` time.
- **Dropping the `dom` lib entries.** Server files currently rely on `lib` being repo-wide; splitting into project references would require separate configs for `app/`, `lib/` and `mcp/`.
