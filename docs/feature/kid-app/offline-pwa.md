# Offline & PWA Shell

## Function
The installable-app wrapper around the board: the root layout and viewport lock, the web app manifest and icon, and a service worker that serves the board network-first with a cache fallback so a school wifi outage does not take a child's voice away.

## Purpose
Two failure modes shaped this.

**The board must survive a dead network.** "A child mid-sentence during a school wifi outage should not meet an error page" (`public/sw.js`).

**But an earlier cache-first version went too far** — it served the page from cache forever, "so code changes never reached the browser and a broken cache entry could take the site down entirely while the server was perfectly healthy."

Installing the PWA is also a **data-durability feature, not a nicety** (`components/kid/register-sw.tsx`): "On iPad this matters more than it looks: Safari evicts IndexedDB for sites that are not installed to the home screen after about a week of disuse, and a communication board that vanishes is a catastrophic failure rather than a bug. Installed PWAs are exempt." The queued events in [Event Logging](event-logging.md) live in exactly that IndexedDB.

The viewport lock exists because "an AAC user must never be able to pinch the board out of alignment mid-sentence, but text scaling stays available through the OS."

## Source Files
| File | Role |
|------|------|
| `app/layout.tsx` | Root layout: metadata, manifest and icon links, viewport lock, pre-paint theme script (`THEME_SCRIPT`, with `suppressHydrationWarning` on `<html>`), mounts `<RegisterSW />`. |
| `components/kid/register-sw.tsx` | Client component that registers `/sw.js` after `load`. |
| `public/sw.js` | The service worker: versioned cache, split fetch strategy, offline fallback page. |
| `public/manifest.webmanifest` | Install metadata — name, `start_url`, display mode, colours. |
| `public/icon.svg` | The app icon (also the favicon and Apple touch icon). |

## Implementation

### Root layout (`app/layout.tsx`)
```ts
metadata = {
  title: 'AAC',
  description: 'Communication board and communication analytics',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'AAC' },
}

viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,      // pinch-zoom locked; OS text scaling still works
  viewportFit: 'cover', // so env(safe-area-inset-*) is meaningful
}
```
`<html lang="en" suppressHydrationWarning>` with an inline script in `<head>`, then `<body>{children}<RegisterSW /></body>`. `viewportFit: 'cover'` is what makes the board's `env(safe-area-inset-bottom)` padding on the essential rail and the category drawer meaningful on a notched device.

The head script re-applies any stored forced theme **before paint** — "Applied before paint so a stored theme never flashes the default first":

```ts
const THEME_SCRIPT =
  "try{var t=localStorage.getItem('aac-theme');if(t==='black'||t==='white'||t==='warm')document.documentElement.dataset.theme=t}catch(e){}"
```

The server cannot know `data-theme` — it lives in the browser's `localStorage` — so the server-rendered `<html>` never carries the attribute and the script adds it before first paint; `suppressHydrationWarning` on `<html>` silences that deliberate server/client mismatch. Theme tokens and the toggle live in [Symbol Set & Card Faces](symbol-set.md).

### Registration (`components/kid/register-sw.tsx`)
Returns `null`. In a `useEffect`:
1. Bail if `!('serviceWorker' in navigator)`.
2. Register `/sw.js` on `load` — immediately if `document.readyState === 'complete'`, otherwise on the `load` event (with cleanup that removes the listener).
3. `.catch(() => {})` — "Registration failing costs offline support, not the board itself."

### Service worker (`public/sw.js`)
| Constant | Value |
|---|---|
| `CACHE` | `'aac-v2'` |
| `OFFLINE_FALLBACK` | `'/'` |

`CACHE` is versioned deliberately: "Bumping it evicts everything the previous version held, which is the escape hatch when a bad entry gets in."

**install** → `caches.open(CACHE)` then `self.skipWaiting()` — "take over immediately rather than waiting for every tab to close: a fix that only lands after the user quits the browser is not much of a fix." Nothing is precached.

**activate** → delete every cache key other than `CACHE`, then `self.clients.claim()`.

**fetch** — the strategy is split by what the request is *for*:

| Request | Strategy |
|---|---|
| `request.method !== 'GET'` | not intercepted |
| cross-origin (`url.origin !== self.location.origin`) | not intercepted |
| `/dashboard*` or `/api*` | **not intercepted** — "the dashboard is an adult tool on a connected laptop, and its numbers must never be stale. The APIs own their own retry behaviour." |
| `/_next/static/*` | **cache first**: serve the hit, else fetch and `cache.put` when `res.ok`. Safe because the filename contains a content hash, so a given URL never changes. |
| everything else (navigations, the board itself) | **network first**: fetch, `cache.put` a clone when `res.ok`, and on a thrown fetch fall back to `caches.match(request)` → `caches.match('/')` → an inline offline page |

The final fallback is a `503` HTML document, never an opaque failure: *"No connection — The board could not be loaded and nothing was saved offline yet. Reconnect and try again."*

Because `/api` is excluded, the event queue's `POST /api/events` is never intercepted or cached — offline durability for events comes from IndexedDB and the retry loop in `EventLogger`, not from the service worker.

### Manifest (`public/manifest.webmanifest`)
| Field | Value |
|---|---|
| `name` | `AAC Communication Board` |
| `short_name` | `AAC` |
| `description` | `A communication board that works with or without a network.` |
| `start_url` | `/` |
| `scope` | `/` |
| `display` | `standalone` |
| `orientation` | `any` |
| `background_color` | `#f4f6f9` (matches `--color-surface-sunk` in light mode) |
| `theme_color` | `#2f5fd0` (matches `--color-accent` in light mode) |
| `icons` | one entry: `/icon.svg`, `sizes: "any"`, `type: image/svg+xml`, `purpose: "any maskable"` |

`orientation: 'any'` matters clinically: forcing an orientation would change the effective cell geometry a child has learned.

### Icon (`public/icon.svg`)
A 512×512 SVG: a `#2f5fd0` rounded square (`rx=96`) holding four white 136×136 rounded tiles at opacities `1`, `.72`, `.72`, `.45` — a 2×2 grid, i.e. the board itself. Being SVG, it satisfies both the `any` and `maskable` purposes from a single file with nothing to rasterise.

## Dependencies & Connections

### Depends On
- [Symbol Set & Card Faces](symbol-set.md) — `app/globals.css` is imported by the root layout, so its tokens (including the `background_color`/`theme_color` values mirrored in the manifest) apply to every page.
- Browser Service Worker API and Cache Storage.

### Depended On By
- [Communication Board](communication-board.md) — the board is the page this shell keeps loadable offline, and it relies on `viewportFit: 'cover'` for the essential rail's safe-area padding.
- [Event Logging](event-logging.md) — installability is what stops iPad Safari evicting the `aac-events` IndexedDB queue after ~1 week of disuse.
- ../dashboard/attention-queue.md — explicitly *excluded* from the worker so dashboard numbers are never served stale.

### Shared Resources
- Cache Storage bucket `aac-v2`.
- `/sw.js`, `/manifest.webmanifest`, `/icon.svg` — served from `public/`, so they are always same-origin and within `scope: '/'`.

## Change Risks
- **Switching navigations back to cache-first** re-creates the original bug: deploys never reach the browser, and one bad cache entry takes the app down while the server is healthy.
- **Precaching or intercepting `/api`** would let `POST /api/events` be answered from cache or replayed, corrupting the analytics store; ingest's idempotency protects against duplicates, but a cached `200` would make the client clear events that were never delivered.
- **Caching `/dashboard`** shows a teacher stale metrics with no indication they are stale — worse than an empty panel, per the staleness rule in `docs/TECH_STACK.md`.
- **Editing `sw.js` without bumping `CACHE`** leaves old entries in place; the version string is the only eviction mechanism.
- **Removing `skipWaiting()`/`clients.claim()`** means a fix only lands after every tab is closed — on a kiosk tablet that may be never.
- **Moving `THEME_SCRIPT` out of `<head>` or dropping `suppressHydrationWarning`** — run after first paint the script flashes the default theme before the stored one lands; without the suppression React warns on every themed load, because the server can never render the `data-theme` the client applies.
- **Dropping `maximumScale: 1`** lets a stray pinch shift the grid mid-sentence, which changes where every learned button appears on screen.
- **Dropping `viewportFit: 'cover'`** makes `env(safe-area-inset-bottom)` collapse to `0`, so the essential rail sits under the home indicator on an iPad.
- **Failing to serve `/manifest.webmanifest` or `/icon.svg`** makes the app un-installable, which on iPad re-exposes the queued events in `aac-events` to Safari's 7-day eviction.
