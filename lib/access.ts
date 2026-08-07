/**
 * Role and consent scoping.
 *
 * Enforced here, in the query layer — never in a component. A page that forgets
 * to check is a bug; a query that cannot return unauthorised rows is a
 * guarantee. docs/analytics-metrics.md §10, §11.
 *
 * SQLite has no row-level security, so "RLS" in the older docs means this file.
 */
import { all, one } from './db'
import { currentAdultId } from './auth'

export type Relation = 'teacher' | 'parent' | 'slt'
export type ConsentTier = 'aggregate' | 'card_labels' | 'utterance_text' | 'partner_speech'

export type Viewer = {
  adult_id: string
  display_name: string
  role: 'teacher' | 'parent' | 'slt' | 'admin'
}

export type ChildSummary = {
  child_id: string
  display_name: string
  year_group: string | null
  profile_note: string | null
  class_id: string | null
  relation: Relation
  consent_tiers: ConsentTier[]
}

/**
 * Who is signed in.
 *
 * The signed session cookie decides. AAC_VIEWER remains as a development
 * override only — it is ignored whenever a session exists, and ignored
 * entirely in production, so it cannot become a way past the login.
 */
export async function currentViewer(): Promise<Viewer> {
  const sessionId = await currentAdultId()
  const id =
    sessionId ?? (process.env.NODE_ENV === 'production' ? null : (process.env.AAC_VIEWER ?? null))

  if (!id) throw new Error('NOT_SIGNED_IN')

  const row = one<Viewer>(
    `SELECT adult_id, display_name, role FROM adults WHERE adult_id = ?`,
    [id],
  )
  if (!row) throw new Error('NOT_SIGNED_IN')
  return row
}

/** Children this adult may see. Expired roster rows are excluded. */
export function visibleChildren(viewer: Viewer): ChildSummary[] {
  const rows = all<Record<string, unknown>>(
    `
    SELECT c.child_id, c.display_name, c.year_group, c.profile_note, c.class_id,
           r.relation
    FROM children c
    JOIN roster r ON r.child_id = c.child_id
    WHERE r.adult_id = ?
      AND (r.expires_at IS NULL OR r.expires_at > CAST(strftime('%s','now') AS INTEGER) * 1000)
    ORDER BY c.display_name
    `,
    [viewer.adult_id],
  )
  return rows.map((r) => ({
    child_id: r.child_id as string,
    display_name: r.display_name as string,
    year_group: (r.year_group as string) ?? null,
    profile_note: (r.profile_note as string) ?? null,
    class_id: (r.class_id as string) ?? null,
    relation: r.relation as Relation,
    consent_tiers: consentTiers(r.child_id as string),
  }))
}

export function requireChild(viewer: Viewer, childId: string): ChildSummary {
  const child = visibleChildren(viewer).find((c) => c.child_id === childId)
  if (!child) {
    throw new Error(`NOT_AUTHORISED: ${viewer.adult_id} has no active roster row for ${childId}`)
  }
  return child
}

/** Tiers currently granted for a child — revoked rows do not count. */
export function consentTiers(childId: string): ConsentTier[] {
  const rows = all<{ tier: ConsentTier }>(
    `
    SELECT DISTINCT tier FROM consent
    WHERE child_id = ? AND revoked_at IS NULL
    `,
    [childId],
  )
  return rows.map((r) => r.tier)
}

/**
 * Whether this viewer may see a data tier for this child.
 *
 * Two independent conditions, both required:
 *   1. consent has been granted for the child
 *   2. the viewer's relation is permitted that tier at all
 *
 * A teacher never sees utterance text or partner speech, however the consent
 * table is configured. That is a policy decision, recorded here rather than
 * spread across pages.
 */
const TIER_RELATIONS: Record<ConsentTier, Relation[]> = {
  aggregate: ['teacher', 'parent', 'slt'],
  card_labels: ['teacher', 'parent', 'slt'],
  utterance_text: ['parent', 'slt'],
  partner_speech: ['slt'],
}

export function canSee(child: ChildSummary, tier: ConsentTier): boolean {
  return child.consent_tiers.includes(tier) && TIER_RELATIONS[tier].includes(child.relation)
}

/** Why a locked panel is locked, phrased for the person reading it. */
const RELATION_NAME: Record<Relation, string> = {
  teacher: 'teachers',
  parent: 'parents',
  slt: 'speech therapists',
}

export function lockReason(child: ChildSummary, tier: ConsentTier): string {
  if (!TIER_RELATIONS[tier].includes(child.relation)) {
    const who = TIER_RELATIONS[tier].map((r) => RELATION_NAME[r])
    const list = who.length > 1 ? `${who.slice(0, -1).join(', ')} and ${who.at(-1)}` : who[0]
    return `Available to ${list}. You have ${RELATION_NAME[child.relation].replace(/s$/, '')} access.`
  }
  return 'Consent for this has not been granted, or has been withdrawn.'
}
