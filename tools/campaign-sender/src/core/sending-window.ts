/**
 * The sending window, read on the customers' clock (design D8).
 *
 * Campaign messages go out only in India's daytime, whatever the time is where
 * the laptop sits. **The database decides this for a real campaign**, at the
 * moment a recipient is handed over, so a wrong clock on the laptop cannot
 * message anybody at night. This module is the same arithmetic for the two
 * places on the laptop that need it: the rehearsal queue, which stands in for
 * the database, and the line that tells the owner when the window next opens.
 *
 * Asia/Kolkata is five and a half hours ahead of UTC all year, with no summer
 * time, so the arithmetic needs no time-zone library.
 */

const INDIA_OFFSET_MS = 330 * 60_000
const DAY_MS = 24 * 60 * 60_000
const DAY_MINUTES = 24 * 60

/** `"10:00"` → 600. `"24:00"` is allowed as the end of a day. Null when it is not a time. */
export function parseClockTime(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (minutes > 59 || hours > 24 || (hours === 24 && minutes !== 0)) return null
  return hours * 60 + minutes
}

export interface WindowReading {
  open: boolean
  /** When it next opens. Null while it is open. */
  opensAt: Date | null
}

/**
 * Whether `nowMs` falls inside the window, and if not, when the window opens.
 * The start is inside and the end is not. A window whose end is not after its
 * start runs through midnight.
 */
export function windowAt(nowMs: number, startMinutes: number, endMinutes: number): WindowReading {
  const india = nowMs + INDIA_OFFSET_MS
  const midnight = Math.floor(india / DAY_MS) * DAY_MS
  const minute = (india - midnight) / 60_000

  const open =
    startMinutes < endMinutes
      ? minute >= startMinutes && minute < endMinutes
      : startMinutes % DAY_MINUTES === endMinutes % DAY_MINUTES
        ? false
        : minute >= startMinutes || minute < endMinutes
  if (open) return { open: true, opensAt: null }

  let opens = midnight + startMinutes * 60_000
  if (opens <= india) opens += DAY_MS
  return { open: false, opensAt: new Date(opens - INDIA_OFFSET_MS) }
}

/** The calendar day in India at `ms`, as a count of days: equal for two instants on one day there. */
export function indiaDay(ms: number): number {
  return Math.floor((ms + INDIA_OFFSET_MS) / DAY_MS)
}

/** The time in India at `ms`, as `HH:MM`. */
export function indiaClock(ms: number): string {
  const india = new Date(ms + INDIA_OFFSET_MS)
  const two = (value: number) => String(value).padStart(2, '0')
  return `${two(india.getUTCHours())}:${two(india.getUTCMinutes())}`
}
