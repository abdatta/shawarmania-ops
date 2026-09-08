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

export function outletPresence(
  lastSeen: readonly (string | null)[],
  now: number,
): 'open' | 'partial' | 'closed' {
  const online = lastSeen.filter((at) => {
    if (!at) return false
    const elapsed = now - Date.parse(at)
    return elapsed >= 0 && elapsed <= TABLET_ONLINE_MS
  }).length
  return online === 0 ? 'closed' : online === lastSeen.length ? 'open' : 'partial'
}
