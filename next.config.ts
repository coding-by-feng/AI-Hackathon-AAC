import type { NextConfig } from 'next'

const config: NextConfig = {
  // node:sqlite is a builtin, but the dashboard's data layer must never be
  // pulled into a client bundle. Anything importing lib/db.ts is a Server
  // Component or a Route Handler.
  serverExternalPackages: ['node:sqlite'],
  experimental: {
    // Server Actions are used for insight dismissal and board-change proposals.
    serverActions: { bodySizeLimit: '1mb' },
  },
  async headers() {
    return [
      {
        // Pre-generated card icons. Without this they serve with max-age=0 and
        // a board load revalidates all 76 on a child's tablet over school wifi.
        // The set only changes when tools regenerate it, and a regeneration can
        // bump the URL; a day of staleness is acceptable, a broken board is not.
        source: '/icons/ai/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' }],
      },
    ]
  },
}

export default config
