/** The words the fixed-cost screens share for months and days. */

import type { FixedCostsUnpaid } from '@/data-access/fixed-costs'
import { addMonths, monthOf, type FixedCostCategory } from '@/domain/fixed-costs'
import { formatPaise } from '@/domain/money'

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

const CATEGORY_WORDS: Record<FixedCostCategory, [string, string]> = {
  salary: ['salary', 'salaries'],
  rent: ['rent', 'rents'],
  utility: ['utility', 'utilities'],
  other: ['other cost', 'other costs'],
}

/**
 * Needs attention's line for fixed costs left unpaid, money first (owner,
 * 2026-10-20): *₹27,300 overdue · 3 salaries, 1 rent · from September*. The
 * categories say what kind of money is owed, each with its count.
 */
export function overdueWords(
  unpaid: Pick<FixedCostsUnpaid, 'paise' | 'categories' | 'months' | 'count'>,
): string {
  const kinds = (Object.keys(CATEGORY_WORDS) as FixedCostCategory[])
    .filter((category) => (unpaid.categories[category] ?? 0) > 0)
    .map((category) => {
      const n = unpaid.categories[category]!
      const [one, many] = CATEGORY_WORDS[category]
      return `${n} ${n === 1 ? one : many}`
    })
  const what = kinds.length > 0 ? kinds.join(', ') : `${unpaid.count} unpaid`
  // Whole rupees, as everything on Overview reads; the Fixed tab keeps the paise.
  const rupees = unpaid.paise - (unpaid.paise % 100)
  const first = unpaid.paise > 0 ? `${formatPaise(rupees)} overdue · ` : ''
  return `${first}${what} · from ${monthWords(unpaid.months)}`
}

/** The last day of the month's first stretch, when last month's salaries are paid. */
export const PAY_DAYS_END = 5

/**
 * Amber in the days last month is normally paid in, the 1st to the 5th; red from
 * the 6th, or as soon as anything older than last month is still owed (owner,
 * 2026-10-20). An alert that is loud on the 1st cries wolf on every payday.
 */
export function overdueTone(
  unpaid: Pick<FixedCostsUnpaid, 'months' | 'today'>,
): 'warning' | 'danger' {
  if (!unpaid.today) return 'warning'
  const last = addMonths(monthOf(unpaid.today), -1)
  if (unpaid.months.some((month) => month < last)) return 'danger'
  return Number(unpaid.today.slice(8, 10)) > PAY_DAYS_END ? 'danger' : 'warning'
}

/** Months named, joined with "and": `September and October`. */
export function monthWords(months: readonly string[]): string {
  const names = months.map(monthName)
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}
