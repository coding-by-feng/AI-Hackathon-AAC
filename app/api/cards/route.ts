import { NextResponse } from 'next/server'
import { saveOverride, clearOverride, clearPhoto, overridesFor } from '@/lib/overrides'
import { one } from '@/lib/db'
import { ingestEvents } from '@/lib/ingest'
import { allSymbolNames } from '@/lib/icons/symbols'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const childId = new URL(req.url).searchParams.get('child')
  if (!childId) return NextResponse.json({ error: 'child is required' }, { status: 400 })
  return NextResponse.json({ overrides: overridesFor(childId) })
}

/**
 * Save a card customisation.
 *
 * Deliberately cannot change position: there is no row/col in this payload and
 * none is accepted. Appearance and wording are editable; where the button sits
 * is not, because a child's motor plan depends on it staying put.
 *
 * The edit is also logged as a `card_created` event so the dashboard can answer
 * the question that matters afterwards — did the new picture actually get used?
 */
export async function PUT(req: Request) {
  let body: {
    childId?: string
    cardId?: string
    label?: string | null
    wordForm?: string | null
    spokenText?: string | null
    symbol?: string | null
    imageData?: string | null
    updatedBy?: string | null
    scene?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 })
  }

  const { childId, cardId } = body
  if (!childId || !cardId) {
    return NextResponse.json({ error: 'childId and cardId are required' }, { status: 400 })
  }

  const exists = one<{ card_id: string }>(`SELECT card_id FROM cards WHERE card_id = ?`, [cardId])
  if (!exists) return NextResponse.json({ error: `Unknown card '${cardId}'` }, { status: 404 })

  if (body.symbol && !allSymbolNames().includes(body.symbol)) {
    return NextResponse.json({ error: `Unknown symbol '${body.symbol}'` }, { status: 400 })
  }

  try {
    saveOverride({
      childId,
      cardId,
      label: body.label,
      wordForm: body.wordForm,
      spokenText: body.spokenText,
      symbol: body.symbol,
      imageData: body.imageData,
      updatedBy: body.updatedBy ?? null,
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }

  try {
    const now = new Date()
    ingestEvents([
      {
        event_id: crypto.randomUUID(),
        child_id: childId,
        ts: now.getTime(),
        day_local: new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
          .toISOString()
          .slice(0, 10),
        tz_offset_min: -now.getTimezoneOffset(),
        session_id: 'card-edit',
        scene: body.scene ?? 'unknown',
        actor: 'adult',
        type: 'card_created',
        card_id: cardId,
        label: body.label ?? null,
        payload: JSON.stringify({
          origin: body.imageData ? 'photo' : 'manual',
          changed: {
            label: body.label != null,
            spokenText: body.spokenText != null,
            symbol: body.symbol != null,
            photo: body.imageData != null,
          },
        }),
      },
    ])
  } catch {
    // A failed audit event must not lose the customisation the adult just made.
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const url = new URL(req.url)
  const childId = url.searchParams.get('child')
  const cardId = url.searchParams.get('card')
  const photoOnly = url.searchParams.get('photoOnly') === '1'
  if (!childId || !cardId) {
    return NextResponse.json({ error: 'child and card are required' }, { status: 400 })
  }
  if (photoOnly) clearPhoto(childId, cardId)
  else clearOverride(childId, cardId)
  return NextResponse.json({ ok: true })
}
