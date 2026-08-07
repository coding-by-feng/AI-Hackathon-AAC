/**
 * The MCP tools, in-process.
 *
 * Imports mcp/tools.ts directly rather than spawning mcp/server.ts. Measured:
 * 4.4 ms per call in-process against ~70 ms of process startup plus JSON-RPC
 * framing. An agentic turn makes 3-6 calls, so the subprocess route costs
 * roughly 350 ms of pure overhead per question. The stdio server stays exactly
 * as it is for external clients (Claude Code, Codex, the Gemma device).
 *
 * SCOPE INJECTION IS THE POINT OF THIS FILE.
 *
 * The model never supplies child_id, class_id or adult_id. They are resolved
 * from the session's viewer and merged into the args server-side:
 *
 *   parent  -> child_id removed from the schema entirely; the one rostered
 *              child is injected
 *   teacher -> child_id becomes an ENUM of that adult's roster ids, so a
 *              hallucinated or injected id fails validation before any query
 *
 * A model that cannot name a child it was not given cannot read that child's
 * communication history, whatever it is asked to do.
 */
import { Db } from '../../mcp/db.ts'
import { tools as mcpTools } from '../../mcp/tools.ts'
import { validateArgs } from '../../mcp/validate.ts'
import type { ToolDef } from './provider'
import type { ChildSummary, Viewer } from '../access'

// Args the caller must never control. Any of these appearing in a tool schema
// is stripped before the model sees it and injected afterwards.
const SCOPED_PARAMS = ['child_id', 'class_id', 'adult_id'] as const

// Free-form SQL is a fine escape hatch for a trusted operator at a terminal.
// It is not one for a chat box: `SELECT * FROM utterances` would cross every
// roster boundary this file exists to enforce.
const EXCLUDED_FROM_CHAT = new Set(['query'])

let cached: Db | undefined
declare global {
  var __aacChatDb: Db | undefined
}

function db(): Db {
  // Next reloads modules on every edit in dev; without the global, each reload
  // leaks a SQLite handle until the WAL reader count blocks the writer.
  if (!globalThis.__aacChatDb) {
    const path = process.env.AAC_DB ?? `${process.cwd()}/aac.db`
    globalThis.__aacChatDb = new Db(path)
  }
  cached = globalThis.__aacChatDb
  return cached
}

export type ChatScope = {
  viewer: Viewer
  children: ChildSummary[]
  /** Set when the panel is pinned to one child (the per-student Ask). */
  focusChildId?: string
  classId?: string
}

export type ToolInvocation = {
  name: string
  args: Record<string, unknown>
  ok: boolean
  ms: number
  resultJson: string
  guidance: { level: string; code: string; detail: string }[]
  forbiddenActions: string[]
  rowCount: number
}

/**
 * Build the tool list this viewer is allowed to see, with scoped parameters
 * rewritten. Called once per turn — the roster can change between turns.
 */
export function toolsForScope(scope: ChatScope): ToolDef[] {
  const ids = scope.focusChildId
    ? [scope.focusChildId]
    : scope.children.map((c) => c.child_id)
  const single = ids.length === 1

  const out: ToolDef[] = []
  for (const [name, tool] of Object.entries(mcpTools)) {
    if (EXCLUDED_FROM_CHAT.has(name)) continue

    const schema = JSON.parse(JSON.stringify(tool.schema)) as Record<string, any>
    const props: Record<string, any> = schema.properties ?? {}
    const required: string[] = schema.required ?? []

    for (const param of SCOPED_PARAMS) {
      if (!(param in props)) continue
      if (param === 'child_id' && !single) {
        // Teacher: keep the parameter, but constrain it to the roster. An enum
        // is enforced by validateArgs, so an invented id never reaches SQL.
        props.child_id = {
          type: 'string',
          enum: ids,
          description:
            'Which child. Only these ids exist for you; any other value is rejected.',
        }
      } else {
        delete props[param]
      }
    }
    schema.properties = props
    schema.required = required.filter(
      (r) => r !== 'class_id' && r !== 'adult_id' && (r !== 'child_id' || !single),
    )

    out.push({
      name,
      description: tool.description,
      parameters: schema,
    })
  }
  return out
}

/**
 * Run one tool with the viewer's scope forced in.
 *
 * Never throws for a bad model argument — the error is returned as the tool
 * result so the model can correct itself on the next iteration. Throwing would
 * end the turn and lose the conversation.
 */
export function invokeTool(
  scope: ChatScope,
  name: string,
  modelArgs: Record<string, unknown>,
): ToolInvocation {
  const started = performance.now()
  const fail = (msg: string): ToolInvocation => ({
    name, args: modelArgs, ok: false, ms: performance.now() - started,
    resultJson: JSON.stringify({ error: msg }),
    guidance: [], forbiddenActions: [], rowCount: 0,
  })

  const tool = (mcpTools as Record<string, any>)[name]
  if (!tool || EXCLUDED_FROM_CHAT.has(name)) {
    return fail(`No tool named '${name}'.`)
  }

  const ids = scope.focusChildId
    ? [scope.focusChildId]
    : scope.children.map((c) => c.child_id)

  // ---- the injection -------------------------------------------------------
  const args: Record<string, unknown> = { ...modelArgs }
  const schemaProps: Record<string, any> = tool.schema?.properties ?? {}

  if ('child_id' in schemaProps) {
    const requested = typeof args.child_id === 'string' ? args.child_id : undefined
    const chosen = ids.length === 1 ? ids[0] : requested
    if (!chosen) {
      return fail(
        `This tool needs a child. Available: ${ids.join(', ')}.`,
      )
    }
    // Belt and braces: the enum already rejects this, but a schema change
    // should not be able to open a hole.
    if (!ids.includes(chosen)) {
      return fail(`'${chosen}' is not one of your children. Available: ${ids.join(', ')}.`)
    }
    args.child_id = chosen
  }
  if ('class_id' in schemaProps) {
    const classId = scope.classId ?? scope.children.find((c) => c.class_id)?.class_id
    if (!classId) return fail('No class is associated with your account.')
    args.class_id = classId
  }
  if ('adult_id' in schemaProps) {
    args.adult_id = scope.viewer.adult_id
  }

  // ---- validate against the FULL schema, including what Gemini never saw ---
  const validated = validateArgs(tool.schema, args)
  if (!validated.ok) {
    return fail(
      `Invalid arguments: ${validated.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`,
    )
  }

  try {
    const envelope = tool.run(db(), validated.value)
    const guidance = (envelope.guidance ?? []).map((g: any) => ({
      level: g.level, code: g.code, detail: g.detail,
    }))
    return {
      name,
      args: validated.value,
      ok: true,
      ms: performance.now() - started,
      resultJson: JSON.stringify(envelope),
      guidance,
      forbiddenActions: envelope.forbidden_actions ?? [],
      rowCount: Number(envelope.meta?.row_count ?? 0),
    }
  } catch (err) {
    return fail((err as Error).message)
  }
}

/** Read an MCP resource by uri — used to seed the system prompt. */
export function readCatalogueSummary(): string {
  const rows = db().all(
    `SELECT metric_id, name, unit, polarity, min_n, caveat
     FROM metrics_catalog WHERE status = 'shown' ORDER BY group_code, metric_id`,
  )
  return rows
    .map((r: any) => `${r.metric_id} (${r.unit}, ${r.polarity}, min_n=${r.min_n}): ${r.name}`)
    .join('\n')
}
