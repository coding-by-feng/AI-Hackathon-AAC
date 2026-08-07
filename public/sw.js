/*
 * Service worker for the communication board.
 *
 * The board must survive a dead network — a child mid-sentence during a school
 * wifi outage should not meet an error page. But an earlier cache-first version
 * of this file went too far and served the page from cache forever, so code
 * changes never reached the browser and a broken cache entry could take the
 * site down entirely while the server was perfectly healthy.
 *
 * So the strategy is split by what the request is for:
 *
 *   navigations + data   NETWORK FIRST, cache as a fallback.
 *                        The board is worth showing stale only when there is
 *                        no network at all.
 *   hashed static assets CACHE FIRST.
 *                        /_next/static/* filenames contain a content hash, so
 *                        a given URL never changes and caching it is safe.
 *
 * CACHE is versioned. Bumping it evicts everything the previous version held,
 * which is the escape hatch when a bad entry gets in.
 */
const CACHE = 'aac-v2'
const OFFLINE_FALLBACK = '/'

self.addEventListener('install', (event) => {
  // Take over immediately rather than waiting for every tab to close — a fix
  // that only lands after the user quits the browser is not much of a fix.
  event.waitUntil(caches.open(CACHE).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // The dashboard is an adult tool on a connected laptop, and its numbers must
  // never be stale. The APIs own their own retry behaviour.
  if (url.pathname.startsWith('/dashboard') || url.pathname.startsWith('/api')) return

  // Content-hashed assets: the URL changes when the content does, so a cache
  // hit is always correct and always current.
  const immutable = url.pathname.startsWith('/_next/static/')

  if (immutable) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(CACHE).then((c) => c.put(request, copy))
            }
            return res
          }),
      ),
    )
    return
  }

  // Everything else — the board itself. Network first so a deploy is picked up
  // on the next load; cache only when the network genuinely fails.
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(request, copy))
        }
        return res
      })
      .catch(async () => {
        const hit = await caches.match(request)
        if (hit) return hit
        const fallback = await caches.match(OFFLINE_FALLBACK)
        if (fallback) return fallback
        // Never an opaque failure: say what happened, in words a person can act on.
        return new Response(
          '<!doctype html><meta charset="utf-8"><title>Offline</title>' +
            '<body style="font:1.1rem/1.5 system-ui;padding:2rem">' +
            '<h1>No connection</h1><p>The board could not be loaded and nothing was saved offline yet. ' +
            'Reconnect and try again.</p>',
          { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } },
        )
      }),
  )
})
