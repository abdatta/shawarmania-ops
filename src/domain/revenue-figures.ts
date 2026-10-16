/**
 * One meaning for revenue, commission, expenses and profit, and for the month
 * and the comparison they are read over (revenue-reads-the-same-everywhere).
 *
 * **Revenue is everything customers paid**: counter bills plus each delivery
 * channel's sales before commission, as the platform states them. **Commission
 * is an expense**, on the date it belongs to, from the day the platform states
 * it. Profit is revenue less expenses, which is the same sum the Ledger reported
 * when it netted delivery instead (design D1): only where commission is shown
 * moves.
 *
 * Pure, and beside `readMonth` rather than inside it, so the off path keeps
 * folding exactly as it did; this reads the same day inputs a second way.
 */

import { instantOnBusinessDay, shiftBusinessDate } from './datetime'
import type {
  MonthCategoryTotal,
  MonthDayInput,
  MonthExpenseLine,
  MonthReading,
} from './ledger-month'
import { NotPaiseError } from './money'

/** The expense category commission is listed under. Derived, never recorded. */
export const DELIVERY_COMMISSION = 'Delivery commission'

function assertPaise(value: number): number {
  if (!Number.isInteger(value)) throw new NotPaiseError(value)
  return value
}

// ── Periods ─────────────────────────────────────────────────────────────────

/** The current month: its 1st through today's business date. */
export function monthToDate(today: string): { month: string; from: string; through: string } {
  const month = today.slice(0, 7)
  return { month, from: `${month}-01`, through: today }
}

function lastDayOf(month: string): string {
  const [year, number] = month.split('-').map(Number) as [number, number]
  return `${month}-${String(new Date(Date.UTC(year, number, 0)).getUTCDate()).padStart(2, '0')}`
}

function previousMonth(month: string): string {
  return shiftBusinessDate(`${month}-01`, -1).slice(0, 7)
}

/**
 * The same day-of-month span `back` months earlier.
 *
 * A window ending on its month's last date maps to the earlier month's last
 * date, so a whole month compares with a whole month. Otherwise the end is
 * clamped to the earlier month's length, and `clamped` says so: the matched
 * date is then a different day of the month, and cutting it would set a whole
 * day of the current window against part of a different one.
 */
function monthBack(
  from: string,
  through: string,
  back: number,
): { from: string; through: string; clamped: boolean } {
  let month = from.slice(0, 7)
  for (let i = 0; i < back; i += 1) month = previousMonth(month)
  const last = lastDayOf(month)
  const wholeMonth = from.endsWith('-01') && through === lastDayOf(through.slice(0, 7))
  // A different last day of the month is a different date to match, as below.
  if (wholeMonth)
    return { from: `${month}-01`, through: last, clamped: last.slice(8) !== through.slice(8) }
  const wanted = `${month}-${through.slice(8)}`
  const clamped = wanted > last
  return {
    from: `${month}-${from.slice(8)}` > last ? last : `${month}-${from.slice(8)}`,
    through: clamped ? last : wanted,
    clamped,
  }
}

/**
 * The window a month-aligned figure compares with, and whether its last date is
 * cut at the time of day it is now (design D3): only when the current window
 * ends today and the matched date is the same day of the month.
 */
export function comparisonWindow(
  from: string,
  through: string,
  today: string,
): { from: string; through: string; cut: boolean } {
  const earlier = monthBack(from, through, 1)
  return {
    from: earlier.from,
    through: earlier.through,
    cut: through === today && !earlier.clamped,
  }
}

export interface ComparedWindow {
  first: string
  last: string
  /** Whether this window's last date counts only up to the time it is now. */
  cut: boolean
}

/**
 * Every compared window, current first. `equal` is Analytics' adjacent windows
 * of equal length, exactly as before; `month` is the same dates in each earlier
 * month.
 */
export function windowsFor(
  from: string,
  to: string,
  periods: number,
  align: 'equal' | 'month',
  today: string,
): ComparedWindow[] {
  const endsToday = to === today
  if (align === 'month') {
    return Array.from({ length: periods }, (_, back) => {
      if (back === 0) return { first: from, last: to, cut: false }
      const window = monthBack(from, to, back)
      return { first: window.from, last: window.through, cut: endsToday && !window.clamped }
    })
  }
  const span = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1
  return Array.from({ length: periods }, (_, back) => ({
    first: shiftBusinessDate(from, -back * span),
    last: shiftBusinessDate(to, -back * span),
    cut: back > 0 && endsToday,
  }))
}

/**
 * The instant on `matchedDate` that has the same distance from its business-day
 * start as `now` has from today's. At 15:40 on 15 October under a 04:00
 * cutover, 15 September's cut is 15:40 on 15 September.
 */
export function cutInstant(
  matchedDate: string,
  today: string,
  now: number,
  cutover: string,
): string {
  const elapsed = now - Date.parse(instantOnBusinessDay(today, cutover, cutover))
  return new Date(
    Date.parse(instantOnBusinessDay(matchedDate, cutover, cutover)) + elapsed,
  ).toISOString()
}

// ── Figures ─────────────────────────────────────────────────────────────────

/**
 * What a channel kept on one day: its sales less what the outlet received, from
 * the day the platform states it; `null` until then. A charge on a day with no
 * orders is a negative receipt, and so the whole charge.
 */
export function commissionOf(channel: {
  grossPaise: number
  netPaise: number | null
}): number | null {
  if (channel.netPaise === null) return null
  return assertPaise(channel.grossPaise) - assertPaise(channel.netPaise)
}

export interface RevenueFigures {
  cashPaise: number
  upiPaise: number
  /** Every channel's sales before commission. */
  deliveryPaise: number
  revenuePaise: number
  /** Stated commission only. */
  commissionPaise: number
  /** Dates on which any channel's commission is not stated yet. */
  waitingDays: number
  /** The expenses somebody recorded, without commission. */
  recordedExpensesPaise: number
  /** Recorded expenses plus commission. */
  expensesPaise: number
  /** `null` where nothing was sold on any date, as `readMonth` withholds it. */
  profitPaise: number | null
}

export interface MonthFigures extends RevenueFigures {
  /** The recorded categories with Delivery commission among them, largest first. */
  expensesByCategory: MonthCategoryTotal[]
}

function channelName(channel: string): string {
  return channel.charAt(0).toUpperCase() + channel.slice(1)
}

/**
 * The month's figures on the one definition, from the same day inputs and the
 * same bound `readMonth` already applied. `reading` supplies what the two
 * definitions share: the recorded categories and whether anything sold.
 */
export function readMonthFigures(
  days: readonly MonthDayInput[],
  reading: MonthReading,
  options: { throughBusinessDate?: string } = {},
): MonthFigures {
  const inScope = options.throughBusinessDate
    ? days.filter((d) => d.businessDate <= options.throughBusinessDate!)
    : days
  let deliveryPaise = 0
  let commissionPaise = 0
  let waitingDays = 0
  const lines: MonthExpenseLine[] = []
  for (const day of inScope) {
    let waiting = false
    for (const channel of day.channels) {
      deliveryPaise += assertPaise(channel.grossPaise)
      const kept = commissionOf(channel)
      if (kept === null) {
        waiting = true
        continue
      }
      commissionPaise += kept
      if (kept !== 0)
        lines.push({
          businessDate: day.businessDate,
          category: DELIVERY_COMMISSION,
          note: channelName(channel.channel),
          amountPaise: kept,
          isCash: false,
        })
    }
    if (waiting) waitingDays += 1
  }
  const recordedExpensesPaise = reading.totalExpensesPaise
  const revenuePaise = reading.cashPaise + reading.upiPaise + deliveryPaise
  const expensesPaise = recordedExpensesPaise + commissionPaise
  const expensesByCategory = lines.length
    ? [
        ...reading.expensesByCategory,
        { category: DELIVERY_COMMISSION, amountPaise: commissionPaise, lines },
      ].sort((a, b) => b.amountPaise - a.amountPaise)
    : reading.expensesByCategory
  return {
    cashPaise: reading.cashPaise,
    upiPaise: reading.upiPaise,
    deliveryPaise,
    revenuePaise,
    commissionPaise,
    waitingDays,
    recordedExpensesPaise,
    expensesPaise,
    profitPaise: reading.profitPaise === null ? null : revenuePaise - expensesPaise,
    expensesByCategory,
  }
}
