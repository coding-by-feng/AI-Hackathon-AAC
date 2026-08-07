'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { currentViewer, requireChild } from '@/lib/access'
import { windowOf } from '@/lib/db'
import { generateReport } from '@/lib/report-store'

/**
 * Generate a report for one child over one period.
 *
 * Scoped through requireChild, so a report cannot be produced for a child the
 * caller has no roster row for — the check is here, in the action, not in the
 * form that renders the button.
 */
export async function generateReportAction(formData: FormData): Promise<void> {
  const childId = String(formData.get('child_id') ?? '')
  const days = Number(formData.get('days') ?? 28)

  const viewer = await currentViewer()
  const child = requireChild(viewer, childId)

  const period = [7, 28, 90].includes(days) ? days : 28
  const id = generateReport(child.child_id, windowOf(period), child.display_name.split(' ')[0])

  revalidatePath('/dashboard/reports')
  redirect(`/dashboard/reports/${id}`)
}
