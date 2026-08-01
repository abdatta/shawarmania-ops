import { useCallback } from 'react'

import { useAdapters } from '@/data-access'
import type { WaitingCount } from '@/data-access/adapters'
import { useSharedRead, type Attention } from '@/features/attention/attention'

/**
 * Arrivals nobody has approved, per outlet the reader can actually reach.
 *
 * The read is `countWaitingByOutlet`, which carries **no owner gate**: it is a
 * plain filtered select scoped by the attendance policies, so a Franchise Admin
 * gets their own outlets and the owner gets all of them. Tenancy for every
 * badge in the app therefore comes from the policies that were already there
 * and already tested, not from a filter written here (design D-RLS).
 *
 * Read on mount, on returning to the foreground, and when a surface says it has
 * done some of the work. Never on a timer (design D4).
 *
 * A failed read **keeps the last known counts**. Blanking the badge would imply
 * the work is done, and showing yesterday's number is the less wrong of the two
 * — which matters on the counter tablet, where being offline is allowed.
 */
export function useWaitingCounts(): {
  counts: readonly WaitingCount[] | null
  reread: () => void
} {
  const { attendance } = useAdapters()
  const read = useCallback(() => attendance.countWaitingByOutlet(), [attendance])
  const { value, reread } = useSharedRead(attendance, read)
  return { counts: value, reread }
}

/**
 * How many waiting arrivals sit across a set of outlets, from counts already
 * read, with the extreme dates of the whole set.
 *
 * A set rather than one outlet since attendance-one-day-per-person: the day
 * controls mark "there is work that way" for the outlets **in scope**, and with
 * two selected that is the earliest of either and the latest of either. An
 * outlet outside the selection still cannot mark them, which is the property
 * that mattered and is now true by construction of this function rather than by
 * a filter each caller remembers.
 */
export function waitingAt(
  counts: readonly WaitingCount[] | null,
  outletIds: readonly string[],
): { waiting: number; oldest: string; newest: string } | null {
  if (counts === null) return null
  const scoped = counts.filter((count) => outletIds.includes(count.outletId))
  if (scoped.length === 0) return null
  return {
    waiting: scoped.reduce((sum, count) => sum + count.waiting, 0),
    oldest: scoped.reduce((min, c) => (c.oldest < min ? c.oldest : min), scoped[0]!.oldest),
    newest: scoped.reduce((max, c) => (c.newest > max ? c.newest : max), scoped[0]!.newest),
  }
}

/** The sentence a badge of this size is read as. */
export function waitingLabel(count: number): string {
  return count === 1 ? '1 arrival waiting for approval' : `${count} arrivals waiting for approval`
}

/**
 * The attendance surface's own badge source, as the gate registry names it.
 *
 * Everything the reader can reach, summed: a manager's one outlet, an owner's
 * several. A number on a navigation tab is answering "is there anything for me
 * anywhere", and splitting it per outlet there would be a list, not a badge.
 */
export function useWaitingAttention(): Attention | null {
  const { counts } = useWaitingCounts()
  if (counts === null) return null
  const total = counts.reduce((sum, count) => sum + count.waiting, 0)
  return { count: total, label: waitingLabel(total) }
}
