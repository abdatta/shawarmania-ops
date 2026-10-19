/** The words the fixed-cost screens share for months and days. */

const MONTH = new Intl.DateTimeFormat('en-IN', { month: 'long', timeZone: 'Asia/Kolkata' })
const SHORT = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  timeZone: 'Asia/Kolkata',
})

/** `2026-10-01` (or any date in it) → `October`. */
export function monthName(month: string): string {
  if (!month) return ''
  return MONTH.format(new Date(`${month.slice(0, 7)}-15T12:00:00+05:30`))
}

const SHORT_MONTH = new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'Asia/Kolkata' })

/** `2026-09-01` → `Sep`; several joined with commas. */
export function shortMonths(months: readonly string[]): string {
  return months
    .map((month) => SHORT_MONTH.format(new Date(`${month.slice(0, 7)}-15T12:00:00+05:30`)))
    .join(', ')
}

/** `2026-11-02` → `2 Nov`. */
export function shortDate(date: string): string {
  return SHORT.format(new Date(`${date}T12:00:00+05:30`))
}

/** Months named, joined with "and": `September and October`. */
export function monthWords(months: readonly string[]): string {
  const names = months.map(monthName)
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}
