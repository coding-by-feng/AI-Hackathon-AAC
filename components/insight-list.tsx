'use client'

import { InsightCard, type InsightCardData } from './insight-card'
import { dismissAction } from '@/app/actions'
import type { DismissReason } from '@/lib/dismiss'
import { EmptyState } from './ui'

export function InsightList({ items }: { items: InsightCardData[] }) {
  if (items.length === 0) {
    return (
      <EmptyState title="Nothing needs your attention here" tone="good">
        No rule has fired for this child in the current window.
      </EmptyState>
    )
  }
  return (
    <div className="space-y-4">
      {items.map((d) => (
        <InsightCard
          key={d.fired_rule_id}
          data={d}
          onDismiss={async (id: string, reason: DismissReason) => {
            await dismissAction(id, reason)
          }}
        />
      ))}
    </div>
  )
}
