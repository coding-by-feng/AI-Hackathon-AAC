/**
 * GET/POST /api/dashboard/settings — AI provider configuration.
 *
 * Teacher / SLT / admin only: a parent's account configures nothing shared.
 * GET returns the current selection and masked key presence (never a key).
 * POST accepts partial updates; an empty-string key removes the stored one.
 *
 * Node runtime: node:sqlite needs a filesystem.
 */
import { currentViewer } from '@/lib/access'
import { saveSettings, settingsStatus, type SaveInput } from '@/lib/chat/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = new Set(['teacher', 'slt', 'admin'])

async function gate(): Promise<{ ok: true; adultId: string } | { ok: false; res: Response }> {
  try {
    const viewer = await currentViewer()
    if (!ALLOWED_ROLES.has(viewer.role)) {
      return {
        ok: false,
        res: json({ error: 'Only teachers and therapists can change AI settings.' }, 403),
      }
    }
    return { ok: true, adultId: viewer.adult_id }
  } catch {
    return { ok: false, res: json({ error: 'Sign in first.' }, 401) }
  }
}

export async function GET(): Promise<Response> {
  const g = await gate()
  if (!g.ok) return g.res
  return json(settingsStatus(), 200)
}

export async function POST(req: Request): Promise<Response> {
  const g = await gate()
  if (!g.ok) return g.res

  let body: SaveInput
  try {
    body = (await req.json()) as SaveInput
  } catch {
    return json({ error: 'Body must be JSON.' }, 400)
  }

  const input: SaveInput = {}
  if (typeof body.provider === 'string') input.provider = body.provider
  if (typeof body.model === 'string') input.model = body.model
  for (const k of ['openai_api_key', 'anthropic_api_key', 'gemini_api_key'] as const) {
    if (typeof body[k] === 'string') input[k] = body[k]
  }

  const saved = saveSettings(input, g.adultId)
  if (!saved.ok) return json({ error: saved.error }, 400)
  return json(settingsStatus(), 200)
}

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
