import { readFileSync } from 'node:fs'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { Db, McpError } from '@/mcp/db.ts'
import { tools } from '@/mcp/tools.ts'

export const dynamic = 'force-dynamic'

/**
 * MCP over HTTP.
 *
 * `mcp/server.ts` speaks JSON-RPC over stdio, which Claude Desktop uses and
 * which a Cloudflare Tunnel cannot carry — a tunnel forwards HTTP to a port,
 * and stdio has no port. This route is the same protocol over POST, so the
 * analysis device can reach the tools remotely.
 *
 * The tool implementations are imported unchanged from `mcp/tools.ts`. Both
 * transports therefore expose exactly the same surface, and the stdio server
 * keeps working for local development.
 */

const ROOT = process.cwd()
const PROTOCOL_VERSION = '2025-06-18'
const DB_PATH = process.env.AAC_DB ?? path.join(ROOT, 'aac.db')

declare global {
  var __mcpDb: Db | undefined
}

function db(): Db {
  // Read-only. Writes go through the dashboard, where a human approves them.
  if (!globalThis.__mcpDb) globalThis.__mcpDb = new Db(DB_PATH)
  return globalThis.__mcpDb
}

const RESOURCES = [
  {
    uri: 'schema://ddl',
    name: 'Database DDL',
    mimeType: 'text/plain',
    description: 'Full schema with comments. Read before writing SQL.',
    load: () => readFileSync(path.join(ROOT, 'db/schema.sql'), 'utf8'),
  },
  {
    uri: 'schema://dictionary',
    name: 'Metric dictionary',
    mimeType: 'application/json',
    description: 'All metrics: formula, unit, polarity, min_n, caveat.',
    load: () =>
      JSON.stringify(
        db().all('SELECT * FROM metrics_catalog ORDER BY group_code, metric_id'),
        null,
        1,
      ),
  },
  {
    uri: 'schema://insights',
    name: 'Insight rules',
    mimeType: 'application/json',
    description: 'The 8 rules, their thresholds, and the actions each one forbids.',
    load: () => JSON.stringify(db().all('SELECT * FROM insights_catalog'), null, 1),
  },
  {
    uri: 'schema://interpretation-guide',
    name: 'AAC clinical constraints',
    mimeType: 'text/markdown',
    description: 'READ BEFORE WRITING ANY RECOMMENDATION. Eight constraints from AAC practice.',
    load: () => readFileSync(path.join(ROOT, 'docs/aac-clinical-constraints.md'), 'utf8'),
  },
]

const INSTRUCTIONS =
  'Analytics for an AAC system used by children with cerebral palsy.\n' +
  'Read schema://interpretation-guide before writing any recommendation.\n' +
  'Every response carries `guidance` — read it before the numbers. A null ' +
  'metric value means the sample was too small, never that nothing happened. ' +
  'Repeated pressing is communication, not error. Never recommend moving or ' +
  'resizing a learned layout.'

type Req = { jsonrpc: '2.0'; id?: number | string | null; method: string; params?: Record<string, unknown> }

function handle(req: Req): unknown {
  switch (req.method) {
    case 'initialize':
      return {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'aac-analytics', version: '1.0.0' },
        instructions: INSTRUCTIONS,
      }

    case 'tools/list':
      return {
        tools: Object.entries(tools).map(([name, t]) => ({
          name,
          description: t.description,
          inputSchema: t.schema,
        })),
      }

    case 'tools/call': {
      const name = req.params?.name as string
      const tool = tools[name]
      if (!tool) throw new McpError('UNKNOWN_TOOL', `No tool named ${name}.`)
      const result = tool.run(db(), (req.params?.arguments ?? {}) as Record<string, unknown>)
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 1) }] }
    }

    case 'resources/list':
      return {
        resources: RESOURCES.map(({ uri, name, mimeType, description }) => ({
          uri,
          name,
          mimeType,
          description,
        })),
      }

    case 'resources/read': {
      const uri = req.params?.uri as string
      const res = RESOURCES.find((r) => r.uri === uri)
      if (!res) throw new McpError('UNKNOWN_RESOURCE', `No resource ${uri}.`)
      return { contents: [{ uri, mimeType: res.mimeType, text: res.load() }] }
    }

    case 'ping':
      return {}

    default:
      throw new McpError('METHOD_NOT_FOUND', `Unsupported method: ${req.method}`)
  }
}

/**
 * Shared-secret auth.
 *
 * A fixed bearer token, compared in constant time so a wrong guess cannot be
 * narrowed down by timing. This is a demo-grade control: a single token that
 * never rotates and is the same for every caller. Cloudflare Access service
 * tokens are the upgrade path when this stops being a demo — see docs/deploy.md.
 *
 * With no AAC_MCP_TOKEN set the route refuses everything rather than running
 * open, so forgetting to configure it fails closed.
 */
function authorised(req: Request): boolean {
  const expected = process.env.AAC_MCP_TOKEN
  if (!expected) return false

  const header = req.headers.get('authorization') ?? ''
  const presented = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (presented.length !== expected.length) return false

  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return diff === 0
}

export async function POST(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorised' } },
      { status: 401 },
    )
  }

  let req: Req
  try {
    req = await request.json()
  } catch {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
  }

  // A notification has no id and expects no reply.
  const isNotification = req.id === undefined || req.id === null

  try {
    const result = handle(req)
    if (isNotification) return new Response(null, { status: 204 })
    return NextResponse.json({ jsonrpc: '2.0', id: req.id, result })
  } catch (err) {
    const e = err as McpError
    return NextResponse.json({
      jsonrpc: '2.0',
      id: req.id ?? null,
      error: { code: -32000, message: e.message, data: { code: e.code ?? 'INTERNAL' } },
    })
  }
}

/** Liveness only — deliberately reveals nothing about the data. */
export async function GET() {
  return NextResponse.json({ status: 'ok', transport: 'http', protocol: PROTOCOL_VERSION })
}
