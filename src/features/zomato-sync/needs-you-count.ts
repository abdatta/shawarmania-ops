import { useCallback } from 'react'

import { useAdapters } from '@/data-access'
import type { AggregatorSyncEventRow } from '@/data-access/adapters'
import { useSharedRead, type Attention } from '@/features/attention/attention'

/**
 * How many things on the Zomato surface want the owner.
 *
 * Counted across every outlet they can reach rather than the one in view. The
 * badge sits on a navigation tab, and a week that would not reconcile at
 * Kanchrapara which only appeared once Kanchrapara was selected would be a badge
 * that hides at exactly the moment it is worth having.
 *
 * Read on mount, on returning to the foreground, and when the surface says it
 * has done some of the work. Never on a timer, for the reason every count in
 * this app avoids one: the phone spends its day in an apron, and waking the
 * radio for a number nobody is looking at is a cost paid continuously for a
 * benefit taken occasionally.
 */
export function useNeedsYouCounts(): readonly { outletId: string; needing: number }[] | null {
  const { aggregatorSync } = useAdapters()
  const read = useCallback(() => aggregatorSync.countNeedsOwner(), [aggregatorSync])
  const { value } = useSharedRead(aggregatorSync, read)
  return value
}

export function useZomatoAttention(): Attention | null {
  const counts = useNeedsYouCounts()
  if (counts === null) return null
  const total = counts.reduce((sum, count) => sum + count.needing, 0)
  return { count: total, label: zomatoAttentionLabel(total) }
}

/**
 * The sentence somebody hears instead of seeing the number.
 *
 * It does not name the surface, because the shell already puts the tab's label
 * in front of it: saying "Zomato" here produces "Zomato: 3 Zomato items need
 * you". It is also deliberately vague about *what* is waiting, since the three
 * things it can be are a discrepancy about money, a login and a duplicated
 * expense, and naming one of them would be wrong two thirds of the time.
 */
export function zomatoAttentionLabel(count: number): string {
  return count === 1 ? '1 item needs you' : `${count} items need you`
}

/**
 * Rows the owner has to do something about. Everything else is a record.
 *
 * Lives beside the count rather than beside the row it renders, because the two
 * have to agree: the badge counts what this returns, and the page groups by it.
 * Splitting them across a component file and a hook file is how they drift.
 *
 * Takes the row rather than the event, because whether something needs a person
 * is not a property of what happened: a week that would not reconcile has been
 * dealt with once it settles, and a session that lapsed has been dealt with once
 * it is back. Both stay on the page and both stop asking.
 */
export function needsOwner(row: AggregatorSyncEventRow): boolean {
  if (row.resolvedAt !== null) return false
  return (
    row.event.kind === 'week-disputed' ||
    row.event.kind === 'session-lapsed' ||
    row.event.kind === 'possible-duplicate-expense'
  )
}
