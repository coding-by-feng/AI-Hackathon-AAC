import { NextResponse } from 'next/server'
import { authenticate, signIn, signOut, accountCount, createAccount } from '@/lib/auth'
import { all } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** Sign in, or — while no account exists at all — claim the first one. */
export async function POST(req: Request) {
  let body: { username?: string; password?: string; adultId?: string; setup?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 })
  }

  const { username, password } = body
  if (!username || !password) {
    return NextResponse.json({ error: 'Username and password are required' }, { status: 400 })
  }

  if (body.setup) {
    /*
     * First-run only, and it closes permanently.
     *
     * The check is re-run here rather than trusted from the page, because the
     * page could be loaded while zero accounts exist and submitted after one
     * was created. Once any account exists this branch is dead forever.
     */
    if (accountCount() > 0) {
      return NextResponse.json({ error: 'Setup is closed — an account already exists' }, { status: 409 })
    }
    if (!body.adultId) {
      return NextResponse.json({ error: 'Choose which person this account is for' }, { status: 400 })
    }
    try {
      createAccount(body.adultId, username, password)
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 })
    }
    await signIn(body.adultId)
    return NextResponse.json({ ok: true })
  }

  const account = authenticate(username, password)
  if (!account) {
    // One message for both failures. Saying which was wrong tells an attacker
    // which usernames exist.
    return NextResponse.json({ error: 'Those details do not match' }, { status: 401 })
  }

  await signIn(account.adult_id)
  return NextResponse.json({ ok: true })
}

export async function DELETE() {
  await signOut()
  return NextResponse.json({ ok: true })
}

/** Which adults can have an account — used by the first-run page only. */
export async function GET() {
  if (accountCount() > 0) {
    return NextResponse.json({ setupOpen: false })
  }
  const adults = all<{ adult_id: string; display_name: string; role: string }>(
    `SELECT adult_id, display_name, role FROM adults ORDER BY display_name`,
  )
  return NextResponse.json({ setupOpen: true, adults })
}
