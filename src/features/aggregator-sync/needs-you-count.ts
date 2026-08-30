import { useCallback } from 'react'

import { useAdapters } from '@/data-access'
import type { AggregatorSyncAdapter, AggregatorSyncEventRow } from '@/data-access/adapters'
import { useSharedRead, type Attention } from '@/features/attention/attention'

/** One outlet's waiting work, as the badge and the page both count it. */
export type ChannelNeedsYouCounts = readonly { outletId: string; needing: number }[]

/**
 * How many things on a sync surface want the owner.
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
 *
 * Keyed to the adapter instance, and each channel gets its own instance — which
 * is what makes the two badges independent by construction rather than by
 * discipline: Zomato's count reads Zomato's rows, Swiggy's reads Swiggy's, and
 * neither cache nor key is shared. Resolving Zomato's work can never move
 * Swiggy's number, and vice versa.
 */
function useChannelNeedsYouCounts(adapter: AggregatorSyncAdapter): ChannelNeedsYouCounts | null {
  const read = useCallback(() => adapter.countNeedsOwner(), [adapter])
  const { value } = useSharedRead(adapter, read)
  return value
}

export function useNeedsYouCounts(): ChannelNeedsYouCounts | null {
  const { aggregatorSync } = useAdapters()
  return useChannelNeedsYouCounts(aggregatorSync)
}

export function useSwiggyNeedsYouCounts(): ChannelNeedsYouCounts | null {
  const { swiggySync } = useAdapters()
  return useChannelNeedsYouCounts(swiggySync)
}

export function useZomatoAttention(): Attention | null {
  const counts = useNeedsYouCounts()
  if (counts === null) return null
  const total = counts.reduce((sum, count) => sum + count.needing, 0)
  return { count: total, label: zomatoAttentionLabel(total) }
}

export function useSwiggyAttention(): Attention | null {
  const counts = useSwiggyNeedsYouCounts()
  if (counts === null) return null
  const total = counts.reduce((sum, count) => sum + count.needing, 0)
  return { count: total, label: zomatoAttentionLabel(total) }
}

/**
 * What the one Delivery entry badges: every restaurant channel it can reach.
 *
 * The sum, because the entry leads to all of them and a badge that counted only
 * the channel the reader happens to land on would hide the other one's work
 * behind a switch — the same defect the outlet chips were built to avoid, one
 * level up. The switch on the surface carries the same two numbers undivided,
 * so the sum is never a figure the reader has to go hunting for the parts of
 * (spec: attention-badges).
 *
 * Null until BOTH channels have answered. A partial sum is a wrong number, and
 * a wrong number on a badge is worse than no badge: it would settle to a
 * different value a moment later with nothing to say it had.
 */
export function useDeliveryAttention(): Attention | null {
  const zomato = useZomatoAttention()
  const swiggy = useSwiggyAttention()
  if (zomato === null || swiggy === null) return null
  const total = zomato.count + swiggy.count
  return { count: total, label: zomatoAttentionLabel(total) }
}

/**
 * The sentence somebody hears instead of seeing the number.
 *
 * It does not name the surface, because the shell already puts the tab's label
 * in front of it: saying "Zomato" here produces "Zomato: 3 Zomato items need
 * you". It is also deliberately vague about *what* is waiting, since the things
 * it can be are a discrepancy about money, a login and a duplicated expense,
 * and naming one of them would be wrong two thirds of the time. One sentence
 * serves both channels for the same reason.
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
