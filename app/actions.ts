'use server'

import { revalidatePath } from 'next/cache'
import { currentViewer, requireChild } from '@/lib/access'
import { dismissInsight, type DismissReason } from '@/lib/insights'
import { one } from '@/lib/db'

/**
 * Dismiss a finding.
 *
 * Scoped through requireChild so a dismissal cannot be forged for a child the
 * caller has no roster row for — the check is here, in the action, not in the
 * component that renders the button.
 */
export async function dismissAction(firedRuleId: string, reason: DismissReason): Promise<void> {
  const viewer = await currentViewer()
  const row = one<{ child_id: string }>(
    `SELECT child_id FROM fired_rules WHERE fired_rule_id = ?`,
    [firedRuleId],
  )
  if (!row) throw new Error('Unknown finding')
  const child = requireChild(viewer, row.child_id)

  dismissInsight(firedRuleId, viewer.adult_id, reason)
  revalidatePath(`/dashboard/student/${child.child_id}`)
  revalidatePath('/dashboard')
}
