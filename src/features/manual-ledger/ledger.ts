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
 * SQL function and no generated column behind this surface (design D3): a
 * migration that drops two tables is trivially reviewable where one that also
 * drops views invites leaving something behind.
 *
 * **Commission is an amount, never a rate** [owner, 2026-08-17]. It used to be
 * stored as basis points and multiplied out here, which needed a rounding rule
 * that had to mean the same thing on both sides of zero and a warning that a
 * month's total must never be reduced by one day's rate. All of that is gone. The
 * measured take rate swings between 24% and 35% day to day — 14% is the only
 * percentage Zomato publishes and the real figure on one sampled order was 37.8% —
 * so a stored rate was an estimate presented as exact. Both channels now carry the
 * commission Zomato or Swiggy actually charged, and net is one subtraction.
 */

function assertPaise(value: number, what: string): number {
  if (!Number.isInteger(value)) {
    const error = new NotPaiseError(value)
    error.message = `${error.message} (${what})`
    throw error
  }
  return value
}

/**
 * What actually arrives: the stated figure less the commission charged on it, or
 * `null` where that commission is **undetermined**.
 *
 * Null is a real state [owner, 2026-08-17], not a missing value to be defaulted.
 * Zomato's Order History shows today's orders but carries no commission and no
 * payout, so a day read tonight knows what came in and cannot know what was kept
 * until its week closes. Returning nought instead would claim the whole of the
 * revenue arrived, which is wrong in the one direction that flatters the shop.
 */
export function netAggregatorPaise(
  statedPaise: number,
  commissionPaise: number | null,
): number | null {
  assertPaise(statedPaise, 'stated aggregator revenue')
  if (commissionPaise === null) return null
  return statedPaise - assertPaise(commissionPaise, 'aggregator commission')
}

// ─────────────────────────────────────────────────────────────────────────────
// Zomato, which a day answers for in one of two ways.

/** Gross, commission and net for one day's Zomato revenue, however it was got. */
export interface ZomatoReading {
  grossPaise: number
  /** `null` where nobody has established what Zomato kept for this day yet. */
  commissionPaise: number | null
  /** `null` for the same reason: an unknown deduction leaves an unknown net. */
  netPaise: number | null
  /** `null` on a day nobody synced, which is every day before the sync existed. */
  settlement: ZomatoSettlement | null
}

/**
 * A day's Zomato figures, and where they came from.
 *
 * One pair of stored columns whatever the source, since commission became an
 * amount: a synced day and a typed day hold the same kind of number in the same
 * place, and `zomatoSettlement` is the only thing that says which wrote them.
 *
 * That is also what keeps a historical month unmovable. The reading depends on
 * what the row itself stores and on nothing about today's configuration, so
 * turning the sync on, or off again, cannot reach backwards and change a figure
 * that was already recorded.
 */
export function readZomato(day: ManualLedgerDayFigures): ZomatoReading {
  const grossPaise = assertPaise(day.zomatoRevenuePaise, 'Zomato revenue')
  const commissionPaise = day.zomatoCommissionPaise
  return {
    grossPaise,
    commissionPaise:
      commissionPaise === null ? null : assertPaise(commissionPaise, 'Zomato commission'),
    netPaise: netAggregatorPaise(grossPaise, commissionPaise),
    settlement: day.zomatoSettlement ?? null,
  }
}

/**
 * A day's Swiggy figures, on exactly Zomato's terms.
 *
 * One authority rule, applied per channel: where a measured reading exists it
 * IS the day's figure, and any legacy typed number in the row's own columns
 * stands down; where none exists — an outlet Swiggy does not cover, or a date
 * before its first read — the typed columns stand exactly as they always did,
 * with no settlement to show for provenance. A negative measured net is a real
 * answer, not an error: a cycle whose deductions outran its orders had a day
 * the shop paid to trade, and hiding that would be the flattering kind of
 * wrong.
 */
export function readSwiggy(day: ManualLedgerDayFigures): ZomatoReading {
  const settlement = day.swiggySettlement ?? null
  if (settlement) {
    const grossPaise = assertPaise(settlement.revenuePaise, 'Swiggy revenue')
    return {
      grossPaise,
      commissionPaise:
        settlement.commissionPaise === null
          ? null
          : assertPaise(settlement.commissionPaise, 'Swiggy commission'),
      netPaise: netAggregatorPaise(grossPaise, settlement.commissionPaise),
      settlement,
    }
  }
  // Typed Swiggy figures no longer exist anywhere in the contract: a day the
  // sync has not covered reads as not yet measured, never as zero.
  return { grossPaise: 0, commissionPaise: null, netPaise: 0, settlement: null }
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
  /** `null` where that channel's commission is undetermined. */
  netZomatoPaise: number | null
  netSwiggyPaise: number | null
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
  const swiggy = readSwiggy(day)
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
      swiggy.grossPaise,
    netZomatoPaise: zomato.netPaise,
    netSwiggyPaise: swiggy.netPaise,
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
  /**
   * Per day, from each day's own stored commission, then summed. Never the reverse.
   *
   * **A CEILING where any day in the month is undetermined** [owner, 2026-08-17].
   * Commission can only reduce a net, so a month totalling the determined days and
   * leaving the rest at their gross states the most the shop can have received. It
   * cannot mislead upward, and it never stops being a usable number — which matters,
   * because until a week closes on Sunday most weeks contain undetermined days.
   */
  netZomatoPaise: number
  netSwiggyPaise: number
  /** Commission KNOWN so far. A floor, for the same reason the net is a ceiling. */
  zomatoCommissionPaise: number
  swiggyCommissionPaise: number
  /**
   * How many days in the month have an undetermined commission on either channel.
   *
   * Nought means every figure above is exact. Anything else means the nets are
   * ceilings and the surface must say so: an approximate number presented as final
   * is the failure this whole capability was built to remove.
   */
  undeterminedDays: number
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
  let undeterminedDays = 0

  for (const day of days) {
    grossCashPaise += assertPaise(day.cashRevenuePaise, 'cash revenue')
    grossUpiPaise += assertPaise(day.upiRevenuePaise, 'UPI revenue')
    // Per day, from that day's own figures — measured where the sync covers the
    // day, derived from that day's own rate where it does not. Moving either out
    // of the loop is the bug this whole per-day design exists to make
    // impossible.
    const zomato = readZomato(day)
    const swiggy = readSwiggy(day)
    grossSwiggyPaise += swiggy.grossPaise
    // Per day, from that day's own figures — measured where the sync covers the
    // day, derived from that day's own rate where it does not. Moving either out
    // of the loop is the bug this whole per-day design exists to make
    // impossible.
    const zomatoNet = zomato.netPaise
    const swiggyNet = swiggy.netPaise
    grossZomatoPaise += zomato.grossPaise

    /*
     * An undetermined day contributes its GROSS, which is what makes the total a
     * ceiling rather than an understatement.
     *
     * The alternative — skipping the day — would report a month smaller than the
     * shop actually earned, and understating profit is its own kind of wrong: it is
     * the number the owner would make decisions against. Contributing the gross
     * says "at most this much arrived", which is true, and the count below is what
     * stops it being read as final.
     */
    netZomatoPaise += zomatoNet ?? zomato.grossPaise
    netSwiggyPaise += swiggyNet ?? swiggy.grossPaise
    if (zomatoNet === null || swiggyNet === null) undeterminedDays += 1
  }

  const netRevenuePaise = grossCashPaise + grossUpiPaise + netZomatoPaise + netSwiggyPaise
  const expensesByCategory = groupByCategory(expenses)

  return {
    recorded: days.length > 0 || allExpenses.length > 0,
    // A day nobody counted (aggregator figures, no cash count) is not a day the
    // owner recorded, so it does not swell this count even though it shows above.
    daysRecorded: days.filter((day) => day.counted !== false).length,
    grossCashPaise,
    grossUpiPaise,
    grossZomatoPaise,
    grossSwiggyPaise,
    netZomatoPaise,
    netSwiggyPaise,
    // Derived from the same two running totals, so a determined-only commission
    // and a ceiling net cannot drift apart: an undetermined day adds its gross to
    // the net and therefore nothing to the commission, which is exactly right.
    zomatoCommissionPaise: grossZomatoPaise - netZomatoPaise,
    swiggyCommissionPaise: grossSwiggyPaise - netSwiggyPaise,
    undeterminedDays,
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
