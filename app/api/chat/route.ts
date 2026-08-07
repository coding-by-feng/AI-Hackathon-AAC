/**
 * POST /api/chat — the Ask panel's endpoint.
 *
 * Node runtime, not Edge: node:sqlite needs a filesystem.
 *
 * Scope is resolved HERE from the session, never from the request body. The
 * client may name a child to focus on, but that name is checked against the
 * roster before it becomes scope — a body is user input, and this one decides
 * whose communication history gets read.
 */
import { currentViewer, requireChild, visibleChildren } from '@/lib/access'
import { runAgent, type AgentEvent } from '@/lib/chat/agent'
import { toolsForScope, type ChatScope } from '@/lib/chat/tools'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Body = {
  message?: unknown
  childId?: unknown
  history?: unknown
}

const MAX_MESSAGE = 2000
const MAX_HISTORY = 12

export async function POST(req: Request): Promise<Response> {
  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return json({ error: 'Body must be JSON.' }, 400)
  }

  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) return json({ error: 'A question is required.' }, 400)
  if (message.length > MAX_MESSAGE) {
    return json({ error: `Questions are limited to ${MAX_MESSAGE} characters.` }, 400)
  }

  let scope: ChatScope
  try {
    const viewer = await currentViewer()
    const children = visibleChildren(viewer)
    if (!children.length) {
      return json({ error: 'No children are shared with your account.' }, 403)
    }

    // A parent has exactly one child, so the panel is always focused whether or
    // not the client said so. A teacher may focus, but only within the roster.
    let focusChildId: string | undefined
    if (typeof body.childId === 'string' && body.childId) {
      focusChildId = requireChild(viewer, body.childId).child_id   // throws if not rostered
    } else if (children.length === 1) {
      focusChildId = children[0].child_id
    }

    scope = {
      viewer,
      children,
      focusChildId,
      classId: children.find((c) => c.class_id)?.class_id ?? undefined,
    }
  } catch (err) {
    const msg = (err as Error).message
    return json({ error: msg }, msg.startsWith('NOT_AUTHORISED') ? 403 : 500)
  }

  const history = Array.isArray(body.history)
    ? (body.history as unknown[])
        .filter((h): h is { role: 'user' | 'assistant'; content: string } =>
          !!h && typeof h === 'object' &&
          ((h as any).role === 'user' || (h as any).role === 'assistant') &&
          typeof (h as any).content === 'string')
        .slice(-MAX_HISTORY)
    : []

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AgentEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      try {
        for await (const event of runAgent(scope, [...history, { role: 'user', content: message }], req.signal)) {
          send(event)
        }
      } catch (err) {
        send({ type: 'error', message: (err as Error).message, retryable: false })
      } finally {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Nginx buffers SSE by default and the panel appears frozen until the
      // whole answer lands.
      'x-accel-buffering': 'no',
    },
  })
}

/**
 * GET /api/chat — what can the assistant see, for the current viewer?
 *
 * Read-only, no model call. Exists so the scope boundary is inspectable rather
 * than merely asserted: you can see for yourself that `child_id` is absent for
 * a parent and constrained to the roster for a teacher.
 */
export async function GET(): Promise<Response> {
  try {
    const viewer = await currentViewer()
    const children = visibleChildren(viewer)
    const focusChildId = children.length === 1 ? children[0].child_id : undefined
    const scope: ChatScope = {
      viewer, children, focusChildId,
      classId: children.find((c) => c.class_id)?.class_id ?? undefined,
    }
    const tools = toolsForScope(scope)
    return json({
      viewer: { adult_id: viewer.adult_id, display_name: viewer.display_name, role: viewer.role },
      provider: process.env.CHAT_PROVIDER ?? 'openai',
      children: children.map((c) => ({ child_id: c.child_id, display_name: c.display_name })),
      focused: focusChildId ?? null,
      tools: tools.map((t) => ({
        name: t.name,
        // The whole point: absent when the panel is focused on one child,
        // enum-of-roster otherwise, never a free string.
        child_id: (t.parameters as any).properties?.child_id ?? null,
      })),
    }, 200)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
