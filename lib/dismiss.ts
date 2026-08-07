/**
 * Dismissal vocabulary, kept free of any database import.
 *
 * The insight card is a client component: it needs these labels, and anything
 * it imports gets bundled for the browser. Re-exporting them from lib/insights
 * would drag node:sqlite into the client build.
 */
export type DismissReason =
  | 'not_accurate'
  | 'already_known'
  | 'not_actionable'
  | 'disagree_with_advice'
  | 'other'

export const DISMISS_LABELS: Record<DismissReason, string> = {
  not_accurate: "That's not what's happening",
  already_known: 'I already knew this',
  not_actionable: 'Nothing I can do about it now',
  disagree_with_advice: 'I disagree with the advice',
  other: 'Another reason',
}
