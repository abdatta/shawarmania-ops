/**
 * Date and time formatting. Pure, no I/O.
 *
 * Timestamps are stored as UTC and displayed in Asia/Kolkata. The time zone is
 * always passed explicitly and never inherited from the device: a tablet with
 * a wrong clock setting must not silently relabel which day a bill belongs to.
 *
 * Business dates are a separate concept — an explicit `date` column resolved
 * against the outlet's cutover, never derived from a timestamp here. This
 * module only renders one that has already been resolved.
 */

export const OUTLET_TIME_ZONE = 'Asia/Kolkata'

const dateFormat = new Intl.DateTimeFormat('en-IN', {
  timeZone: OUTLET_TIME_ZONE,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

const timeFormat = new Intl.DateTimeFormat('en-IN', {
  timeZone: OUTLET_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
})

const dateTimeFormat = new Intl.DateTimeFormat('en-IN', {
  timeZone: OUTLET_TIME_ZONE,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
})

/** `2026-07-25T14:30:00Z` -> `25 Jul 2026` (in Asia/Kolkata). */
export function formatDate(instant: Date | string): string {
  return dateFormat.format(toDate(instant))
}

/** `2026-07-25T14:30:00Z` -> `08:00 pm` (in Asia/Kolkata). */
export function formatTime(instant: Date | string): string {
  return timeFormat.format(toDate(instant))
}

/** `2026-07-25T14:30:00Z` -> `25 Jul 2026, 08:00 pm` (in Asia/Kolkata). */
export function formatDateTime(instant: Date | string): string {
  return dateTimeFormat.format(toDate(instant))
}

/**
 * Render an already-resolved business date (`2026-07-25`) as a date.
 *
 * Parsed as UTC midnight and formatted in UTC, not Asia/Kolkata — a business
 * date is a calendar label, not an instant, and running it through a +05:30
 * offset would shift it by a day.
 */
export function formatBusinessDate(businessDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
    throw new TypeError(`Expected a YYYY-MM-DD business date, got "${businessDate}"`)
  }
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${businessDate}T00:00:00Z`))
}

const partsFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: OUTLET_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

/**
 * Which business day does this instant belong to?
 *
 * The mirror of `public.app_business_date(ts, cutover)`, and it must stay one:
 * shift the instant into Asia/Kolkata, subtract the outlet's cutover, take the
 * calendar date. A bill rung at 00:20 under an 04:00 cutover belongs to the
 * previous day, and the app and the database have to agree about that or a
 * check-in lands on a day nobody is looking at.
 *
 * The database remains the authority: this resolves the date a write is
 * *labelled* with, and the `validate_business_date` trigger checks it.
 *
 * @param cutover the outlet's `business_day_cutover`, as `HH:MM` or `HH:MM:SS`
 */
export function resolveBusinessDate(instant: Date | string, cutover: string): string {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(cutover)
  if (!match) {
    throw new TypeError(`Expected a HH:MM or HH:MM:SS cutover, got "${cutover}"`)
  }

  const parts = Object.fromEntries(
    partsFormat.formatToParts(toDate(instant)).map((part) => [part.type, part.value]),
  ) as Record<string, string>

  // Hour 24 is how some engines spell midnight in a 24-hour clock.
  const hour = Number(parts.hour) % 24

  const wallClockMs = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second),
  )

  const cutoverMs = (Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0)) * 1000

  const shifted = new Date(wallClockMs - cutoverMs)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
}

/** `2026-07-25` shifted by whole days, staying a calendar label throughout. */
export function shiftBusinessDate(businessDate: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
    throw new TypeError(`Expected a YYYY-MM-DD business date, got "${businessDate}"`)
  }
  const shifted = new Date(`${businessDate}T00:00:00Z`)
  shifted.setUTCDate(shifted.getUTCDate() + days)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
}

function toDate(instant: Date | string): Date {
  const date = instant instanceof Date ? instant : new Date(instant)
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Expected a valid date, got "${String(instant)}"`)
  }
  return date
}
