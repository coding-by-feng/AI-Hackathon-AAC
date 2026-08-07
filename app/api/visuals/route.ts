import { NextResponse } from 'next/server'
import { resolveVisual } from '@/lib/visuals/ladder'

export const dynamic = 'force-dynamic'
// Image generation takes 5–15s; the platform default would cut it off.
export const maxDuration = 60

/**
 * Find a picture for a concept.
 *
 * The caller does not choose how — it asks for a picture and the ladder decides
 * whether that means a built-in symbol, a cached one, or a new generation. The
 * response says which, so the UI can be honest about it.
 */
export async function POST(req: Request) {
  let body: {
    concept?: string
    detail?: string
    childId?: string
    scene?: string
    force?: boolean
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 })
  }

  if (!body.concept || !body.concept.trim()) {
    return NextResponse.json({ error: 'A word or description is required' }, { status: 400 })
  }

  try {
    const result = await resolveVisual({
      spec: { concept: body.concept, detail: body.detail },
      childId: body.childId ?? null,
      createdBy: body.childId ? 'adult' : null,
      scene: body.scene,
      forceGenerate: body.force === true,
    })

    if (result.resolvedBy === 'failed') {
      return NextResponse.json({ error: result.note, resolvedBy: 'failed' }, { status: 502 })
    }
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
