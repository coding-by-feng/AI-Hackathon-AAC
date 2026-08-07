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
}

export default config
