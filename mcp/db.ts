/**
 * Database access for the MCP server.
 *
 * Zero dependencies: node:sqlite is built in, and Node strips the TypeScript
 * types at load. `node mcp/server.ts` just runs.
 *
 * READ-ONLY IS HARDER THAN IT LOOKS — see docs/mcp-api.md §10.
 *  - node:sqlite's { readOnly: true } DOES open a WAL database (Python's
 *    `mode=ro` URI does not — it cannot create the -shm file).
 *  - ATTACH is still permitted on a read-only handle, and node:sqlite exposes
 *    no authorizer callback. So the only things standing between this process
 *    and aac_text.db are the SQL parse guard below and OS file permissions.
 *  - Run this server as a user with no read bit on aac_text.db. That is the
 *    guarantee; everything else is defence in depth.
 */
import { DatabaseSync } from 'node:sqlite'

export type Row = Record<string, unknown>

const SELECT_ONLY = /^\s*(with|select)\b/i
// Deliberately blunt. A false positive costs one retry; a false negative costs
// a child's entire communication history.
const BANNED = /\b(attach|detach|pragma|insert|update|delete|drop|alter|create|replace|vacuum|reindex|begin|commit|rollback|savepoint)\b/i

export class Db {
  private read: DatabaseSync
  private write: DatabaseSync | null = null
  readonly path: string

  constructor(path: string, opts: { allowWrites?: boolean } = {}) {
    this.path = path
    this.read = new DatabaseSync(path, { readOnly: true })
    this.read.exec('PRAGMA busy_timeout = 5000')
    if (opts.allowWrites) {
      this.write = new DatabaseSync(path)
      this.write.exec('PRAGMA busy_timeout = 5000')
      this.write.exec('PRAGMA foreign_keys = ON')
    }
  }

  all(sql: string, params: unknown[] = []): Row[] {
    return this.read.prepare(sql).all(...(params as never[])) as Row[]
  }

  one(sql: string, params: unknown[] = []): Row | undefined {
    return this.read.prepare(sql).get(...(params as never[])) as Row | undefined
  }

  scalar<T = unknown>(sql: string, params: unknown[] = []): T | undefined {
    const row = this.one(sql, params)
    return row ? (Object.values(row)[0] as T) : undefined
  }

  /**
   * The escape hatch. Everything a caller can reach that is not a typed tool.
   * Rejected before execution rather than relying on the read-only handle,
   * because a read-only handle still permits ATTACH.
   */
  freeQuery(sql: string, limit = 200): { rows: Row[]; truncated: boolean; applied: string } {
    const trimmed = sql.trim().replace(/;\s*$/, '')
    if (!SELECT_ONLY.test(trimmed)) {
      throw new McpError('SQL_REJECTED', 'Only SELECT and WITH statements are permitted.')
    }
    if (trimmed.includes(';')) {
      throw new McpError('SQL_REJECTED', 'Multiple statements are not permitted.')
    }
    // Strip comments before scanning, or `-- attach` style tricks slip through.
    const bare = trimmed.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')
    const banned = bare.match(BANNED)
    if (banned) {
      throw new McpError('SQL_REJECTED', `Statement contains a forbidden keyword: ${banned[0]}`)
    }
    const capped = /\blimit\b/i.test(bare) ? trimmed : `${trimmed} LIMIT ${limit + 1}`
    let rows: Row[]
    try {
      rows = this.read.prepare(capped).all() as Row[]
    } catch (err) {
      // Verbatim, so the model can self-correct rather than guess again.
      throw new McpError('SQL_REJECTED', (err as Error).message)
    }
    const truncated = rows.length > limit
    return { rows: truncated ? rows.slice(0, limit) : rows, truncated, applied: capped }
  }

  /** Writes are confined to `insights` and `board_change_proposals`. */
  exec(sql: string, params: unknown[] = []): void {
    if (!this.write) throw new McpError('NOT_AUTHORISED', 'This server is read-only.')
    if (!/^\s*insert\s+into\s+(insights|board_change_proposals)\b/i.test(sql)) {
      throw new McpError('NOT_AUTHORISED', 'Writes are limited to insights and board_change_proposals.')
    }
    this.write.prepare(sql).run(...(params as never[]))
  }

  close(): void {
    this.read.close()
    this.write?.close()
  }
}

export class McpError extends Error {
  // Written out longhand: Node's strip-only TypeScript mode does not support
  // parameter properties, and this file must run with `node mcp/server.ts`
  // and no build step.
  code: string
  retryable: boolean

  constructor(code: string, message: string, retryable = false) {
    super(message)
    this.code = code
    this.retryable = retryable
  }
}
