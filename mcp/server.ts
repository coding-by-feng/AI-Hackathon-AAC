#!/usr/bin/env node
/**
 * AAC analytics MCP server — JSON-RPC 2.0 over stdio.
 *
 *   node mcp/server.ts --db aac.db
 *
 * Zero dependencies. node:sqlite is built in and Node strips the TypeScript
 * types at load, so there is nothing to install and nothing to build.
 *
 * Consumer: Gemma 3 4B on a separate analysis device via an MCP client, plus
 * Claude Desktop over stdio for development. A 4B model cannot reliably chain
 * tool calls, so the CLIENT drives a fixed sequence and asks one narrow
 * question at a time — `next_calls` in each envelope is an instruction to the
 * client, not a hint to the model.
 */
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'
import { Db, McpError } from './db.ts'
import { tools } from './tools.ts'
import { validateArgs } from './validate.ts'

const PROTOCOL_VERSION = '2025-06-18'
const ROOT = resolve(import.meta.dirname, '..')

const argv = process.argv.slice(2)
const dbPath = argv[argv.indexOf('--db') + 1] ?? resolve(ROOT, 'aac.db')
const allowWrites = argv.includes('--allow-writes')

const db = new Db(dbPath, { allowWrites })

/**
 * Static context, fetched once per session instead of repeated in every tool
 * description. `interpretation-guide` is not optional reading: it holds the
 * clinical constraints that make otherwise sensible advice harmful.
 */
const RESOURCES = [
  { uri: 'schema://ddl', name: 'Database DDL', mimeType: 'text/plain',
    description: 'Full schema with comments. Read before writing SQL.',
    load: () => readFileSync(resolve(ROOT, 'db/schema.sql'), 'utf8') },
  { uri: 'schema://dictionary', name: 'Metric dictionary', mimeType: 'application/json',
    description: 'All 38 metrics: formula, unit, polarity, min_n, caveat.',
    load: () => JSON.stringify(db.all('SELECT * FROM metrics_catalog ORDER BY group_code, metric_id'), null, 1) },
  { uri: 'schema://insights', name: 'Insight rules', mimeType: 'application/json',
    description: 'The 8 rules, their thresholds, and the actions each one forbids.',
    load: () => JSON.stringify(db.all('SELECT * FROM insights_catalog'), null, 1) },
  { uri: 'schema://interpretation-guide', name: 'AAC clinical constraints', mimeType: 'text/markdown',
    description: 'READ BEFORE WRITING ANY RECOMMENDATION. Eight constraints from AAC practice.',
    load: () => readFileSync(resolve(ROOT, 'docs/aac-clinical-constraints.md'), 'utf8') },
]

type Req = { jsonrpc: '2.0'; id?: number | string; method: string; params?: any }

function handle(req: Req): unknown {
  switch (req.method) {
    case 'initialize':
      return {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'aac-analytics', version: '1.0.0' },
        instructions:
          'Analytics for an AAC system used by children with cerebral palsy.\n' +
          'Read schema://interpretation-guide before writing any recommendation.\n' +
          'Every response carries `guidance` — read it before the numbers. A null ' +
          'metric value means the sample was too small, never that nothing happened. ' +
          'Repeated pressing is communication, not error. Never recommend moving or ' +
          'resizing a learned layout.',
      }

    case 'tools/list':
      return {
        tools: Object.entries(tools).map(([name, t]) => ({
          name, description: t.description, inputSchema: t.schema,
        })),
      }

    case 'tools/call': {
      const name = req.params?.name as string
      const tool = tools[name]
      if (!tool) throw new McpError('UNKNOWN_TOOL', `No tool named ${name}.`)

      // Validate BEFORE running. An argument the schema does not describe used
      // to be silently dropped: `group_by: "scene"` returned one blended number
      // and the caller had no way to know it had been ignored.
      const validated = validateArgs(tool.schema, req.params?.arguments ?? {})
      if (!validated.ok) {
        throw new McpError(
          'INVALID_ARGUMENTS',
          validated.errors.map((e) => `${e.path}: ${e.message}`).join('; '),
          true,
        )
      }

      const result = tool.run(db, validated.value)
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 1) }] }
    }

    case 'resources/list':
      return { resources: RESOURCES.map(({ uri, name, mimeType, description }) => ({ uri, name, mimeType, description })) }

    case 'resources/read': {
      const uri = req.params?.uri as string
      const res = RESOURCES.find(r => r.uri === uri)
      if (!res) throw new McpError('UNKNOWN_RESOURCE', `No resource ${uri}.`)
      return { contents: [{ uri, mimeType: res.mimeType, text: res.load() }] }
    }

    case 'ping':
      return {}

    default:
      throw new McpError('METHOD_NOT_FOUND', `Unsupported method: ${req.method}`)
  }
}

function send(payload: unknown): void {
  process.stdout.write(JSON.stringify(payload) + '\n')
}

const rl = createInterface({ input: process.stdin, terminal: false })

rl.on('line', line => {
  if (!line.trim()) return
  let req: Req
  try {
    req = JSON.parse(line)
  } catch {
    return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
  }
  try {
    const result = handle(req)
    if (req.id !== undefined) send({ jsonrpc: '2.0', id: req.id, result })
  } catch (err) {
    const e = err as McpError
    if (req.id === undefined) return
    send({
      jsonrpc: '2.0', id: req.id,
      error: {
        code: -32000,
        message: e.message,
        // Structured so the caller can decide whether a retry is worth it,
        // rather than parsing prose.
        data: { code: e.code ?? 'INTERNAL', retryable: e.retryable ?? false },
      },
    })
  }
})

rl.on('close', () => { db.close(); process.exit(0) })
