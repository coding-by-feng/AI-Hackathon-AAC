import { NextResponse, type NextRequest } from 'next/server'

/**
 * Host-based routing.
 *
 * The kid board and the dashboard are one Next.js app on one port, but they are
 * published on separate hostnames. Without this, `aac.kason.app/dashboard`
 * would serve the whole class's analytics to a child's tablet, and
 * `aac-dashboard.kason.app` would accept event ingest from anywhere.
 *
 * Enforced server-side, before rendering. A path that does not belong to the
 * hostname returns 404 rather than a redirect: a redirect confirms the route
 * exists somewhere, which is a small thing to give away for nothing.
 */

type Surface = 'kid' | 'dashboard' | 'mcp' | 'any'

function surfaceFor(host: string): Surface {
  const h = host.toLowerCase().split(':')[0]
  if (h.startsWith('aac-dashboard.')) return 'dashboard'
  if (h.startsWith('aac-mcp.')) return 'mcp'
  if (h.startsWith('aac.')) return 'kid'
  // localhost, LAN addresses, previews: everything, so development is unchanged.
  return 'any'
}

/** Assets both browser surfaces need. */
const SHARED = ['/manifest.webmanifest', '/icon.svg', '/sw.js', '/favicon.ico', '/robots.txt']

/**
 * Static asset directories under public/ that both browser surfaces load.
 * Card faces reference /icons/ai/<slug>.png; without this, every icon 404s on
 * the public hostnames while localhost (surface 'any') serves them fine.
 */
const SHARED_PREFIXES = ['/icons/']

const KID_PREFIXES = ['/who', '/api/session', '/api/events', '/api/cards', '/api/visuals', '/api/categories']
const DASH_PREFIXES = [
  '/dashboard', '/login',
  '/api/dashboard', '/api/auth', '/api/chat', '/api/reports',
]

/**
 * Reachable without a session: the login page and the endpoint it posts to.
 *
 * `/login` sits OUTSIDE /dashboard on purpose. It used to be
 * /dashboard/login, which rendered it inside app/dashboard/layout.tsx — and
 * that layout calls currentViewer(), which throws NOT_SIGNED_IN when there is
 * no session. So the one page a signed-out visitor could reach was the one page
 * guaranteed to crash, and the root error boundary showed them the AAC board's
 * child-facing fallback.
 */
const PUBLIC_DASH = ['/login', '/api/auth']

function allowed(surface: Surface, pathname: string): boolean {
  if (surface === 'any') return true
  if (SHARED.includes(pathname)) return surface !== 'mcp'
  if (SHARED_PREFIXES.some((p) => pathname.startsWith(p))) return surface !== 'mcp'

  switch (surface) {
    case 'kid':
      return pathname === '/' || KID_PREFIXES.some((p) => pathname.startsWith(p))
    case 'dashboard':
      // '/' is the dashboard on this hostname — see the rewrite below.
      return pathname === '/' || DASH_PREFIXES.some((p) => pathname.startsWith(p))
    case 'mcp':
      return pathname.startsWith('/api/mcp')
  }
}

export function middleware(request: NextRequest) {
  const host = request.headers.get('host') ?? ''
  const surface = surfaceFor(host)
  const { pathname } = request.nextUrl

  if (!allowed(surface, pathname)) {
    return new NextResponse('Not found', { status: 404 })
  }

  /*
   * On the dashboard hostname, the root IS the dashboard.
   *
   * A rewrite rather than a redirect: the URL stays clean at
   * https://aac-dashboard.kason.app/ instead of bouncing to /dashboard, and
   * every existing /dashboard/... link keeps working unchanged.
   *
   * This runs before the session check so an unauthenticated visitor to the
   * root is still sent to the login page rather than served the dashboard.
   */
  if (surface === 'dashboard' && pathname === '/') {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return request.cookies.get('aac_adult')
      ? NextResponse.rewrite(url)
      : NextResponse.redirect(new URL('/login', request.url))
  }

  /*
   * The dashboard requires an adult session.
   *
   * Checked here so a page cannot forget: a new route under /dashboard is
   * protected the moment it exists, rather than when someone remembers to add
   * a check to it. The cookie's signature is verified in lib/auth.ts; this only
   * asks whether one is present, because middleware runs on the Edge runtime
   * and cannot open SQLite.
   */
  const needsSession =
    pathname.startsWith('/dashboard') && !PUBLIC_DASH.some((p) => pathname.startsWith(p))

  if (needsSession && !request.cookies.get('aac_adult')) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    return NextResponse.redirect(url)
  }

  /*
   * The dashboard is published without a login for the demo. It cannot be kept
   * out of a search index by a robots file alone — noindex on the response is
   * what actually stops a crawler retaining the page. This blocks nobody who
   * has the link; it only prevents children's names and profiles being
   * archived somewhere that outlives the demo.
   */
  const res = NextResponse.next()
  if (surface === 'dashboard' || pathname.startsWith('/dashboard')) {
    res.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet')
  }
  return res
}

export const config = {
  // Static chunks and images are exempt; they carry no data of their own and
  // running middleware on every one of them is wasted work.
  matcher: ['/((?!_next/static|_next/image).*)'],
}
