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

function toDate(instant: Date | string): Date {
  const date = instant instanceof Date ? instant : new Date(instant)
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Expected a valid date, got "${String(instant)}"`)
  }
  return date
}
