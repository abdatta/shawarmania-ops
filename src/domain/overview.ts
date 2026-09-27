import { shiftBusinessDate } from './datetime'

export interface OverviewPeriod {
  month: string
  from: string
  through: string
  previousFrom: string
  previousThrough: string
  fullMonth: boolean
}

export function overviewPeriod(today: string): OverviewPeriod {
  const through = shiftBusinessDate(today, -1)
  const month = through.slice(0, 7)
  const from = `${month}-01`
  const previousLast = shiftBusinessDate(from, -1)
  const previousMonth = previousLast.slice(0, 7)
  const fullMonth = today.endsWith('-01')
  const day = fullMonth
    ? Number(previousLast.slice(8))
    : Math.min(Number(through.slice(8)), Number(previousLast.slice(8)))
  return {
    month,
    from,
    through,
    fullMonth,
    previousFrom: `${previousMonth}-01`,
    previousThrough: `${previousMonth}-${String(day).padStart(2, '0')}`,
  }
}

export function revenueChange(current: number, previous: number): number | null {
  return previous > 0 ? ((current - previous) / previous) * 100 : null
}

/** Presence is separate from the age allowed for unresolved-write evidence. */
export const TABLET_ONLINE_MS = 3 * 60_000

/**
 * Whether an outlet's tablets are reachable right now: every one, some, or none.
 *
 * Named **online / offline**, not open / closed (outlets-one-at-a-time, owner
 * 2026-09-26). This is a live reading of the tablets' heartbeats, and it read
 * as Open and Closed on Overview while Outlets used the same two words for
 * whether a shop is trading at all — so one outlet could be "Closed" on one
 * screen and "Open" on the next at the same moment. Open and closed now mean
 * the outlet's own state, and only that.
 */
export function outletPresence(
  lastSeen: readonly (string | null)[],
  now: number,
): 'online' | 'partial' | 'offline' {
  const online = lastSeen.filter((at) => {
    if (!at) return false
    const elapsed = now - Date.parse(at)
    return elapsed >= 0 && elapsed <= TABLET_ONLINE_MS
  }).length
  return online === 0 ? 'offline' : online === lastSeen.length ? 'online' : 'partial'
}
