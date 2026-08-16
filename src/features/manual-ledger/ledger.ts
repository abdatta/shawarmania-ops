import type {
  ManualLedgerDayFigures,
  ManualLedgerExpense,
  ZomatoSettlement,
} from '@/data-access/adapters'
import {
  describeDifference,
  differencePaise,
  NotPaiseError,
  normalizeCategory,
  profitEstimate,
  type DifferenceKind,
  type ProfitEstimate,
} from '@/domain'

/**
 * Everything the manual ledger derives, in one place, in integer paise.
 *
 * **The database stores facts; this file computes figures.** There is no view, no
 * SQL function and no generated column behind this surface (design D3), for two
 * reasons: a migration that drops two tables is trivially reviewable where one
 * that also drops views invites leaving something behind, and the commission
 * rounding rule has to be identical wherever it runs, which it is if there is
 * exactly one implementation of it.
 *
 * The one rule worth reading before the code: **commission is applied per day,
 * from that day's own stored rate, and never to a month's total.** Days in a
 * month may carry different rates — that is the whole point of storing the rate
 * on the row — so a month total reduced by one rate would be a different, wrong
 * number that happens to look plausible.
 */

/** 10000 basis points is 100%. */
export const COMMISSION_BP_SCALE = 10_000

/** Half of one basis-point scale, which is what makes the division round half up. */
const COMMISSION_HALF = COMMISSION_BP_SCALE / 2

function assertPaise(value: number, what: string): number {
  if (!Number.isInteger(value)) {
    const error = new NotPaiseError(value)
    error.message = `${error.message} (${what})`
    throw error
  }
  return value
}

/**
 * What the aggregator keeps: `(stated × bp + 5000) / 10000`, integer division.
 *
 * Rounds half up, and rounds **symmetrically about zero**. A refund can push a
 * day's stated aggregator revenue negative, and `Math.trunc` on a negative
 * numerator rounds toward zero instead of up, so a month containing one refunded
 * day would fail to reconcile by a paisa. Rounding the magnitude and reapplying
 * the sign makes the rule mean the same thing on both sides of zero.
 */
export function commissionPaise(statedPaise: number, bp: number): number {
  assertPaise(statedPaise, 'stated aggregator revenue')
  if (!Number.isInteger(bp) || bp < 0 || bp > COMMISSION_BP_SCALE) {
    throw new RangeError(
      `Expected a commission rate in basis points between 0 and ${COMMISSION_BP_SCALE}, received ${String(bp)}.`,
    )
  }

  const sign = statedPaise < 0 ? -1 : 1
  const magnitude = Math.abs(statedPaise)
  return sign * Math.trunc((magnitude * bp + COMMISSION_HALF) / COMMISSION_BP_SCALE)
}

/** What actually arrives: the stated figure less the commission on it. */
export function netAggregatorPaise(statedPaise: number, bp: number): number {
  return statedPaise - commissionPaise(statedPaise, bp)
}

// ─────────────────────────────────────────────────────────────────────────────
// Zomato, which a day answers for in one of two ways.

/** Gross, commission and net for one day's Zomato revenue, however it was got. */
export interface ZomatoReading {
  grossPaise: number
  commissionPaise: number
  netPaise: number
  /** `null` on a day nobody synced, which is every day before the sync existed. */
  settlement: ZomatoSettlement | null
}

/**
 * A day's Zomato figures, chosen by **what that day itself stores** rather than
 * by today's configuration.
 *
 * This is the whole of the migration story. A day the sync covers answers from
 * its measured triple; a day recorded before it answers from its stated figure
 * and its own stored rate, exactly as it always did. Switching on the day's own
 * values rather than on the outlet's current sync date is what makes a
 * historical month unmovable: turning the sync on, or off again, cannot reach
 * backwards and change a figure that was already recorded.
 *
 * No stored percentage participates in a synced day's net. The rate such a day
 * implies is available for display through `effectiveRateBp`, and is a reading
 * of the two measured figures rather than an input to either.
 */
export function readZomato(day: ManualLedgerDayFigures): ZomatoReading {
  const settlement = day.zomatoSettlement ?? null

  if (settlement) {
    return {
      grossPaise: assertPaise(settlement.grossPaise, 'Zomato gross'),
      commissionPaise: assertPaise(settlement.commissionPaise, 'Zomato commission'),
      netPaise: assertPaise(settlement.netPaise, 'Zomato net'),
      settlement,
    }
  }

  const grossPaise = assertPaise(day.zomatoRevenuePaise, 'Zomato revenue')
  const commission = commissionPaise(grossPaise, day.zomatoCommissionBp)
  return {
    grossPaise,
    commissionPaise: commission,
    netPaise: grossPaise - commission,
    settlement: null,
  }
}

/**
 * The rate a measured day implies, in basis points, for display only.
 *
 * Returns null on a day that earned nothing, because a rate on nil revenue is a
 * division by zero dressed up as a percentage. Never fed back into any figure:
 * rounding this to basis points and recomputing the net is precisely the nine
 * paise that made a stored rate unusable.
 */
export function effectiveRateBp(reading: ZomatoReading): number | null {
  if (reading.grossPaise === 0) return null
  return Math.round((reading.commissionPaise * COMMISSION_BP_SCALE) / reading.grossPaise)
}

// ─────────────────────────────────────────────────────────────────────────────
// One day.

export interface DayReading {
  /** `opening + cash revenue + cash in − cash expenses − cash out`. */
  expectedCashPaise: number
  countedCashPaise: number
  /** `counted − expected`, so a shortfall is negative — the repo's convention. */
  differencePaise: number
  /** The word beside the figure, because a minus sign is what a bad screen loses. */
  difference: DifferenceKind
  cashExpensesPaise: number
  nonCashExpensesPaise: number
  /** Gross, by channel, for the day's own reading. */
  grossRevenuePaise: number
  netZomatoPaise: number
  netSwiggyPaise: number
  /** How this day answered for Zomato, and whether it was measured or derived. */
  zomato: ZomatoReading
}

/**
 * The day, read against its count.
 *
 * Only cash moves the drawer. UPI, Zomato and Swiggy revenue and every non-cash
 * expense are excluded here and included in the month — the single rule that
 * connects the two readings, and the one a reader is most likely to expect
 * wrongly.
 */
export function readDay(
  day: ManualLedgerDayFigures,
  expenses: readonly ManualLedgerExpense[],
): DayReading {
  const zomato = readZomato(day)
  const counting = expenses.filter(isCounted)
  const cashExpensesPaise = sumExpenses(counting.filter((expense) => expense.isCash))
  const nonCashExpensesPaise = sumExpenses(counting.filter((expense) => !expense.isCash))

  const expectedCashPaise =
    assertPaise(day.openingCashPaise, 'opening cash') +
    assertPaise(day.cashRevenuePaise, 'cash revenue') +
    assertPaise(day.cashAddedPaise, 'cash brought in') -
    cashExpensesPaise -
    assertPaise(day.cashRemovedPaise, 'cash taken out')

  const difference = differencePaise(
    assertPaise(day.countedCashPaise, 'counted cash'),
    expectedCashPaise,
  )

  return {
    expectedCashPaise,
    countedCashPaise: day.countedCashPaise,
    differencePaise: difference,
    difference: describeDifference(difference),
    cashExpensesPaise,
    nonCashExpensesPaise,
    grossRevenuePaise:
      day.cashRevenuePaise +
      assertPaise(day.upiRevenuePaise, 'UPI revenue') +
      zomato.grossPaise +
      assertPaise(day.swiggyRevenuePaise, 'Swiggy revenue'),
    netZomatoPaise: zomato.netPaise,
    netSwiggyPaise: netAggregatorPaise(day.swiggyRevenuePaise, day.swiggyCommissionBp),
    zomato,
  }
}

/**
 * Does this expense count toward anything?
 *
 * **The single filter every figure in this file passes through**, because a
 * withdrawn expense that counted in one reading and not another would produce
 * two true-looking numbers that disagree, and nothing on the screen could
 * explain the gap. It stays visible on the list and contributes to no total:
 * the day's expected cash, the day's own totals, the month, and the month's
 * category breakdown all ignore it (design D3).
 */
export function isCounted(expense: ManualLedgerExpense): boolean {
  return expense.voidedAt === null
}

function sumExpenses(expenses: readonly ManualLedgerExpense[]): number {
  return expenses.reduce(
    (running, expense) => running + assertPaise(expense.amountPaise, 'expense amount'),
    0,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// The opening-cash chain.

export type ChainSignal =
  /** No earlier day at this outlet: the opening was typed, and nothing contradicts it. */
  | { kind: 'first-day' }
  | { kind: 'agrees'; previousBusinessDate: string }
  | {
      kind: 'disagrees'
      previousBusinessDate: string
      storedOpeningPaise: number
      previousCountPaise: number
      /** `stored opening − previous count`. Signed, and never applied to anything. */
      gapPaise: number
    }

/**
 * Whether this day's stored opening cash agrees with the previous day's count.
 *
 * **Reports, never repairs.** Storing the opening rather than deriving it is what
 * stops a correction to day 3 silently moving day 4 through day 31, and the price
 * of that is that the chain can break. A function that quietly returned the
 * previous count instead would hide exactly the break it had just found — which
 * is the compounding error this ledger exists to catch (design D2).
 */
export function checkOpeningChain(
  day: ManualLedgerDayFigures,
  previousDay: ManualLedgerDayFigures | null,
): ChainSignal {
  if (!previousDay) return { kind: 'first-day' }

  const gapPaise =
    assertPaise(day.openingCashPaise, 'opening cash') -
    assertPaise(previousDay.countedCashPaise, 'previous counted cash')

  if (gapPaise === 0) return { kind: 'agrees', previousBusinessDate: previousDay.businessDate }

  return {
    kind: 'disagrees',
    previousBusinessDate: previousDay.businessDate,
    storedOpeningPaise: day.openingCashPaise,
    previousCountPaise: previousDay.countedCashPaise,
    gapPaise,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// One month.

/** One expense, as the month's category breakdown lists it. */
export interface MonthExpenseLine {
  businessDate: string
  note: string | null
  amountPaise: number
  isCash: boolean
}

export interface MonthCategoryTotal {
  category: string
  amountPaise: number
  /** Every row behind the total, so a figure can be checked rather than trusted. */
  lines: MonthExpenseLine[]
}

export interface MonthReading {
  /**
   * Whether anything was recorded at all. A month nobody wrote in is not a month
   * that earned nothing, and a surface that showed zero for both would be
   * reporting a measurement it never took.
   */
  recorded: boolean
  daysRecorded: number
  grossCashPaise: number
  grossUpiPaise: number
  grossZomatoPaise: number
  grossSwiggyPaise: number
  /** Per day, from each day's own stored rate, then summed. Never the reverse. */
  netZomatoPaise: number
  netSwiggyPaise: number
  zomatoCommissionPaise: number
  swiggyCommissionPaise: number
  /** Cash + UPI + both aggregators net of their own commission. */
  netRevenuePaise: number
  expensesByCategory: MonthCategoryTotal[]
  totalExpensesPaise: number
  cashExpensesPaise: number
  /**
   * Cash basis, and the estimate names its basis on screen because
   * `profit-estimates` requires any profit figure to. Every recorded expense is
   * subtracted, so this reconciles exactly against `expensesByCategory`.
   */
  profit: ProfitEstimate
}

/**
 * The month, read for one outlet.
 *
 * Two things are deliberately absent. **Aggregator commission is not an expense**
 * — it is already netted out of revenue, and counting it twice is the second of
 * the double-counting traps `docs/DATA_MODEL.md` names. And **consumption-basis
 * profit is not offered**, because no stock valuation is recorded here; raw
 * materials are taken as zero on hand at the start of tracking by owner decision,
 * which leaves cash basis the only computable answer.
 *
 * The figure this returns is an **operating** estimate: capital spending is not
 * recorded in this ledger at all (design D8), so it answers whether trading
 * covered running costs and not where every rupee went. The surface says so in
 * words; nothing here can enforce that, which is why the spec requires it.
 */
export function readMonth(
  days: readonly ManualLedgerDayFigures[],
  allExpenses: readonly ManualLedgerExpense[],
): MonthReading {
  // Withdrawn rows are dropped once, here, so every figure below is computed
  // from the same set. `recorded` still counts the raw list: a month whose only
  // expense was withdrawn was written in, and reporting it as never measured
  // would be a different claim from reporting it as nil.
  const expenses = allExpenses.filter(isCounted)

  let grossCashPaise = 0
  let grossUpiPaise = 0
  let grossZomatoPaise = 0
  let grossSwiggyPaise = 0
  let netZomatoPaise = 0
  let netSwiggyPaise = 0

  for (const day of days) {
    grossCashPaise += assertPaise(day.cashRevenuePaise, 'cash revenue')
    grossUpiPaise += assertPaise(day.upiRevenuePaise, 'UPI revenue')
    grossSwiggyPaise += assertPaise(day.swiggyRevenuePaise, 'Swiggy revenue')
    // Per day, from that day's own figures — measured where the sync covers the
    // day, derived from that day's own rate where it does not. Moving either out
    // of the loop is the bug this whole per-day design exists to make
    // impossible.
    const zomato = readZomato(day)
    grossZomatoPaise += zomato.grossPaise
    netZomatoPaise += zomato.netPaise
    netSwiggyPaise += netAggregatorPaise(day.swiggyRevenuePaise, day.swiggyCommissionBp)
  }

  const netRevenuePaise = grossCashPaise + grossUpiPaise + netZomatoPaise + netSwiggyPaise
  const expensesByCategory = groupByCategory(expenses)

  return {
    recorded: days.length > 0 || allExpenses.length > 0,
    daysRecorded: days.length,
    grossCashPaise,
    grossUpiPaise,
    grossZomatoPaise,
    grossSwiggyPaise,
    netZomatoPaise,
    netSwiggyPaise,
    zomatoCommissionPaise: grossZomatoPaise - netZomatoPaise,
    swiggyCommissionPaise: grossSwiggyPaise - netSwiggyPaise,
    netRevenuePaise,
    expensesByCategory,
    totalExpensesPaise: sumExpenses(expenses),
    cashExpensesPaise: sumExpenses(expenses.filter((expense) => expense.isCash)),
    // The domain's own estimator, so this surface cannot invent a third
    // definition of cash-basis profit. `movements` is empty because no stock is
    // valued here, which is also why the consumption basis is never asked for.
    profit: profitEstimate('cash', {
      salesPaise: netRevenuePaise,
      expenses: expenses.map((expense) => ({
        category: expense.category,
        amountPaise: expense.amountPaise,
      })),
      movements: [],
    }),
  }
}

/**
 * Expenses grouped by category, largest total first.
 *
 * Every recorded expense lands in exactly one group and no group is filtered
 * out, which is what makes the profit figure reconcile against this list. A
 * category quietly excluded here would make the two disagree by an amount
 * nothing on the screen could explain.
 */
function groupByCategory(expenses: readonly ManualLedgerExpense[]): MonthCategoryTotal[] {
  const groups = new Map<string, MonthCategoryTotal>()

  for (const expense of expenses) {
    const category = normalizeCategory(expense.category)
    const key = category.toLocaleLowerCase()
    const existing = groups.get(key)
    const line: MonthExpenseLine = {
      businessDate: expense.businessDate,
      note: expense.note,
      amountPaise: assertPaise(expense.amountPaise, 'expense amount'),
      isCash: expense.isCash,
    }

    if (existing) {
      existing.amountPaise += line.amountPaise
      existing.lines.push(line)
    } else {
      groups.set(key, {
        category,
        amountPaise: line.amountPaise,
        lines: [line],
      })
    }
  }

  for (const group of groups.values()) {
    group.lines.sort((a, b) => a.businessDate.localeCompare(b.businessDate))
  }

  return [...groups.values()].sort((a, b) => b.amountPaise - a.amountPaise)
}

// ─────────────────────────────────────────────────────────────────────────────
// Small shared helpers the surface and the adapters both want.

/** `YYYY-MM` for a business date, which is how a month is named to the adapter. */
export function monthOf(businessDate: string): string {
  return businessDate.slice(0, 7)
}

/** The inclusive date range a `YYYY-MM` month covers, as business dates. */
export function monthRange(month: string): { from: string; to: string } {
  const [year, monthNumber] = month.split('-').map(Number)
  if (!year || !monthNumber || monthNumber < 1 || monthNumber > 12) {
    throw new RangeError(`Expected a month as YYYY-MM, received ${month}.`)
  }
  // Day 0 of the next month is the last day of this one, which avoids a table of
  // month lengths and gets February right in a leap year for free.
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  return {
    from: `${month}-01`,
    to: `${month}-${String(lastDay).padStart(2, '0')}`,
  }
}
