/**
 * The month, accumulated from its own days (#52).
 *
 * **Pure, and deliberately not inside either adapter.** Both the Supabase reader
 * and the mock build the same thirty-one day readings and must fold them the
 * same way; a fold written twice is a fold that disagrees with itself the first
 * time somebody edits one copy. It lives here for the reason `run-outcome.ts`
 * was extracted from its Edge Function: a decision worth getting right is worth
 * being able to test without standing up the thing that calls it.
 *
 * Three rules carry the whole file, and each is a decision somebody could
 * plausibly make the other way.
 *
 * **An undetermined day contributes its GROSS** (`design.md` D1, the owner's
 * decision of 2026-08-17, carried unchanged from #36). That is what makes the
 * month a ceiling rather than an understatement. Skipping such a day would
 * report a month smaller than the shop earned, and understating profit is its
 * own kind of wrong — it is the number the owner makes decisions against.
 *
 * **The commission is derived, never accumulated.** `gross - net` cannot drift
 * from the two totals it is computed from; a third running total can, the moment
 * one branch forgets an undetermined day. An undetermined day adds its gross to
 * the net and therefore nothing to the commission, which is exactly right.
 *
 * **The netting stays inside the loop.** Each day is netted at its own stored
 * rate and the results added, so a rate renegotiated mid-month is right on both
 * sides of the change. Hoisting either the netting or the undetermined branch
 * out of the loop is the bug the whole per-day design exists to make impossible.
 */

import { NotPaiseError } from './money'

function assertPaise(value: number): number {
  if (!Number.isInteger(value)) throw new NotPaiseError(value)
  return value
}

/** One channel's figures for one day, as the day reading already carries them. */
export interface MonthChannelDay {
  channel: string
  grossPaise: number
  /** `null` is **not known yet**, and is what makes the month a ceiling. */
  commissionPaise: number | null
  /** `null` whenever the commission is. */
  netPaise: number | null
  asOfAt: string | null
}

/** One expense behind the month's category breakdown. */
export interface MonthExpenseLine {
  businessDate: string
  category: string
  /** The description where one exists, else `null` — never the category again. */
  note: string | null
  amountPaise: number
  isCash: boolean
}

/** One business date, reduced to only what the month needs from it. */
export interface MonthDayInput {
  businessDate: string
  cashPaise: number
  upiPaise: number
  /** What this day's bills gave away. Revenue above is already net of it. */
  discountPaise: number
  channels: readonly MonthChannelDay[]
  expenses: readonly MonthExpenseLine[]
  drawerState: 'counted' | 'carried' | 'not-tracked-yet'
}

/** One channel's month, netted per day and totalled. */
export interface MonthChannelTotal {
  channel: string
  grossPaise: number
  /** Derived as `gross - net`, so it counts only determined days. */
  commissionPaise: number
  /** A ceiling while any of this channel's days is undetermined. */
  netPaise: number
  /** The latest instant any of this channel's days was confirmed at. */
  asOfAt: string | null
  /** How many of this channel's days have no stated commission. */
  undeterminedDays: number
  /**
   * How many dates in the period carried a figure for this channel at all.
   *
   * **Nought is the case worth naming.** A channel that produced no rows and a
   * channel that took no orders are identical in the data, so a month that
   * simply omits the channel reports a revenue total that looks complete and is
   * not. That is exactly what a broken sync looks like from here, and Swiggy's
   * payouts query is broken as this ships. The surface says *nothing recorded*
   * rather than saying nothing.
   */
  reportedDays: number
}

/** One category's month, with every line behind it. */
export interface MonthCategoryTotal {
  category: string
  amountPaise: number
  lines: MonthExpenseLine[]
}

export interface MonthReading {
  cashPaise: number
  upiPaise: number
  /**
   * What the month gave away across its bills.
   *
   * Beside the revenue rather than inside it: the revenue is already net, and
   * without this figure a month running a discount reads as a month that traded
   * badly. It carries the same ceiling qualification as the revenue it sits
   * beside, because it is read together with it.
   */
  discountPaise: number
  channels: MonthChannelTotal[]
  /**
   * Cash + UPI + each channel's net. A ceiling whenever `undeterminedDays > 0`,
   * because an undetermined day contributed its gross.
   */
  netRevenuePaise: number
  /** How many dates carry an undetermined commission on **any** channel. */
  undeterminedDays: number
  /** Dates on which nothing was rung up at all. Named, never explained. */
  datesWithoutSales: string[]
  /** The complement of the above, and what the old screen's day count meant. */
  daysWithSales: number
  expensesByCategory: MonthCategoryTotal[]
  totalExpensesPaise: number
  cashExpensesPaise: number
  /**
   * Revenue received less everything recorded as spent.
   *
   * **`null` when no date in the month carries a sale.** Profit needs both
   * halves; with one wholly absent the answer is not a smaller number, it is not
   * a number, and rendering `−₹40,000` for a month nobody billed in would be the
   * app inventing a loss the business did not make (`design.md` D3).
   */
  profitPaise: number | null
  countedDays: number
  carriedDays: number
  /** Dates before this outlet's anchor: neither counted nor carried (D18). */
  notTrackedDays: number
}

/** ISO-8601 UTC sorts as it orders, so the later string is the later moment. */
function later(left: string | null, right: string | null): string | null {
  if (left === null) return right
  if (right === null) return left
  return right > left ? right : left
}

/**
 * Fold a month's day readings into one reading.
 *
 * The input is every date in the month, including the ones nobody touched — the
 * derived reader renders them all, and a date with no sales is a fact this
 * function reports rather than a row it drops.
 *
 * **`throughBusinessDate` bounds what has actually happened**, and without it the
 * current month lies loudly. Opening September on the first of September gave
 * *"29 dates had no sales"* and *"0 of 30 days counted, 30 carried"* — a fake
 * sales collapse and a fake drawer failure, both describing dates that have not
 * arrived yet. Nothing was rung up on the fifteenth because the fifteenth has not
 * happened. Found by looking at the built screen; no unit test would have shown
 * it, because every one of them seeds a month in the past.
 *
 * A future date contributes nought to every total either way, so this changes no
 * money — only the counts and the dates named, which are the things a reader
 * reacts to.
 */
export function readMonth(
  days: readonly MonthDayInput[],
  options: { throughBusinessDate?: string; expectedChannels?: readonly string[] } = {},
): MonthReading {
  // ISO-8601 dates compare lexicographically, so no Date is constructed.
  const inScope = options.throughBusinessDate
    ? days.filter((day) => day.businessDate <= options.throughBusinessDate!)
    : days
  let cashPaise = 0
  let upiPaise = 0
  let discountPaise = 0
  let undeterminedDays = 0
  let countedDays = 0
  let carriedDays = 0
  let notTrackedDays = 0

  const datesWithoutSales: string[] = []
  const channels = new Map<string, MonthChannelTotal>()
  // Seeded, not discovered. A channel absent from the rows is the whole point:
  // it has to be sayable, and only an expected list makes it so.
  for (const channel of options.expectedChannels ?? []) {
    channels.set(channel, {
      channel,
      grossPaise: 0,
      commissionPaise: 0,
      netPaise: 0,
      asOfAt: null,
      undeterminedDays: 0,
      reportedDays: 0,
    })
  }
  const categories = new Map<string, MonthCategoryTotal>()
  const allLines: MonthExpenseLine[] = []

  for (const day of inScope) {
    cashPaise += assertPaise(day.cashPaise)
    discountPaise += assertPaise(day.discountPaise)
    upiPaise += assertPaise(day.upiPaise)

    if (day.drawerState === 'counted') countedDays += 1
    else if (day.drawerState === 'carried') carriedDays += 1
    else notTrackedDays += 1

    let dayGrossPaise = day.cashPaise + day.upiPaise
    let dayUndetermined = false

    for (const channel of day.channels) {
      const running = channels.get(channel.channel) ?? {
        channel: channel.channel,
        grossPaise: 0,
        commissionPaise: 0,
        netPaise: 0,
        asOfAt: null,
        undeterminedDays: 0,
        reportedDays: 0,
      }

      const grossPaise = assertPaise(channel.grossPaise)
      running.reportedDays += 1
      running.grossPaise += grossPaise
      dayGrossPaise += grossPaise

      // The whole ceiling, in one branch. An undetermined day contributes its
      // gross; a determined one contributes what actually arrived.
      if (channel.netPaise === null) {
        running.netPaise += grossPaise
        running.undeterminedDays += 1
        dayUndetermined = true
      } else {
        running.netPaise += assertPaise(channel.netPaise)
      }

      running.asOfAt = later(running.asOfAt, channel.asOfAt)
      channels.set(channel.channel, running)
    }

    if (dayUndetermined) undeterminedDays += 1

    // A date with no bills is one nothing was rung up on. It is reported, and
    // never explained: before-billing, a closure and a broken tablet are
    // indistinguishable from here (`design.md` D3).
    if (dayGrossPaise === 0) datesWithoutSales.push(day.businessDate)

    for (const line of day.expenses) {
      assertPaise(line.amountPaise)
      allLines.push(line)
      const running = categories.get(line.category) ?? {
        category: line.category,
        amountPaise: 0,
        lines: [],
      }
      running.amountPaise += line.amountPaise
      running.lines.push(line)
      categories.set(line.category, running)
    }
  }

  // Derived, never accumulated — see the file header.
  for (const channel of channels.values()) {
    channel.commissionPaise = channel.grossPaise - channel.netPaise
  }

  /*
   * Which channels the month SHOWS.
   *
   * Every channel this outlet trades on, plus any channel that produced revenue
   * whether or not anybody expected it. The second half is not tidiness: money
   * is never hidden because a mapping is missing, which is the same rule that
   * makes a silent expected channel visible.
   *
   * What this excludes is the case the owner had to tell us about: Kanchrapara
   * does not sell on Swiggy, and the sync writes it nineteen ₹0 rows a month
   * anyway. Rendering those as figures put three nought rows on the screen for a
   * channel the outlet does not use, and rendering their absence as *recorded
   * nothing* would raise an alarm every month about a channel nobody expected to
   * report. Neither is true; the honest rendering is silence.
   */
  const expected = new Set(options.expectedChannels ?? [])
  const orderedChannels = [...channels.values()]
    .filter((channel) => expected.has(channel.channel) || channel.grossPaise > 0)
    .sort((a, b) => a.channel.localeCompare(b.channel))
  // Over EVERY channel that reported, not only the ones shown. A ₹0 channel adds
  // nothing either way, but reading the total off the filtered list would make
  // hiding a channel and losing its revenue the same edit.
  const netRevenuePaise =
    cashPaise +
    upiPaise +
    [...channels.values()].reduce((sum, channel) => sum + channel.netPaise, 0)

  const totalExpensesPaise = allLines.reduce((sum, line) => sum + line.amountPaise, 0)
  const cashExpensesPaise = allLines
    .filter((line) => line.isCash)
    .reduce((sum, line) => sum + line.amountPaise, 0)

  const daysWithSales = inScope.length - datesWithoutSales.length

  return {
    cashPaise,
    discountPaise,
    upiPaise,
    channels: orderedChannels,
    netRevenuePaise,
    undeterminedDays,
    datesWithoutSales,
    daysWithSales,
    expensesByCategory: [...categories.values()].sort((a, b) => b.amountPaise - a.amountPaise),
    totalExpensesPaise,
    cashExpensesPaise,
    // Withheld only where NOTHING was rung up all month. A month with some
    // unbilled dates still gets a figure, qualified by the note beside it.
    profitPaise: daysWithSales === 0 ? null : netRevenuePaise - totalExpensesPaise,
    countedDays,
    carriedDays,
    notTrackedDays,
  }
}
