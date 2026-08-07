import { NextResponse } from 'next/server'
import {
  categoriesForChild,
  createCategory,
  renameCategory,
  deleteCategory,
  addWord,
  updateWord,
  removeWord,
  setShown,
  reorderForChild,
} from '@/lib/categories/store'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const childId = new URL(req.url).searchParams.get('child')
  if (!childId) return NextResponse.json({ error: 'child is required' }, { status: 400 })
  return NextResponse.json({ categories: categoriesForChild(childId) })
}

type Body = {
  action?: string
  childId?: string
  categoryId?: string
  wordId?: string
  name?: string
  shown?: boolean
  order?: string[]
  label?: string
  spokenText?: string
  wordForm?: string
  symbol?: string | null
}

/**
 * One endpoint, an `action` field, because these are all small edits to the
 * same shape. Splitting them across seven routes would spread the same
 * validation over seven files.
 */
export async function POST(req: Request) {
  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 })
  }

  try {
    switch (body.action) {
      case 'create': {
        if (!body.name) throw new Error('A name is required')
        const cat = createCategory(body.name, 'adult')
        return NextResponse.json({ ok: true, category: cat })
      }

      case 'rename': {
        if (!body.categoryId || !body.name) throw new Error('categoryId and name are required')
        renameCategory(body.categoryId, body.name)
        return NextResponse.json({ ok: true })
      }

      case 'delete': {
        if (!body.categoryId) throw new Error('categoryId is required')
        deleteCategory(body.categoryId)
        return NextResponse.json({ ok: true })
      }

      case 'show': {
        if (!body.childId || !body.categoryId) throw new Error('childId and categoryId are required')
        setShown(body.childId, body.categoryId, body.shown !== false)
        return NextResponse.json({ ok: true })
      }

      case 'reorder': {
        if (!body.childId || !body.order) throw new Error('childId and order are required')
        reorderForChild(body.childId, body.order)
        return NextResponse.json({ ok: true })
      }

      case 'add-word': {
        if (!body.categoryId || !body.label) throw new Error('categoryId and label are required')
        const word = addWord(body.categoryId, {
          label: body.label,
          spokenText: body.spokenText,
          wordForm: body.wordForm,
          symbol: body.symbol ?? null,
        })
        return NextResponse.json({ ok: true, word })
      }

      case 'update-word': {
        if (!body.wordId) throw new Error('wordId is required')
        updateWord(body.wordId, {
          label: body.label,
          spokenText: body.spokenText,
          wordForm: body.wordForm,
          symbol: body.symbol,
        })
        return NextResponse.json({ ok: true })
      }

      case 'remove-word': {
        if (!body.wordId) throw new Error('wordId is required')
        removeWord(body.wordId)
        return NextResponse.json({ ok: true })
      }

      default:
        return NextResponse.json({ error: `Unknown action '${body.action}'` }, { status: 400 })
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}
