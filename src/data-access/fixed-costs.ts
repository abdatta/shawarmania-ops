/**
 * An outlet's fixed costs, as the Fixed costs page, the Ledger and Expenses read
 * them (fixed-costs-are-spread-over-the-month). Money is always integer paise.
 *
 * **One read carries everything.** `list` returns every fixed cost of the outlet
 * with its amounts, settlements and effective payments, and the outlet's
 * business date; every figure on every screen is folded from that by
 * `src/domain/fixed-costs.ts`, so no screen can disagree with another about what
 * a month cost or what is still owed.
 */
import type { FixedCostCategory, FixedCostFacts, PayChoiceKey } from '@/domain/fixed-costs'

export interface FixedCostsReading {
  /** The outlet's business date, through its cutover. */
  today: string
  /** Ongoing first, then stopped; each in the order it was added. */
  costs: FixedCostFacts[]
}

export interface NewFixedCost {
  outletId: string
  name: string
  category: FixedCostCategory
  monthlyPaise: number
  startsOn: string
  note: string | null
  /**
   * What a month started part-way through comes to (agreed-part-months): sent
   * only by the on path, and only when the start is not the 1st.
   */
  firstMonthPaise?: number
}

/** Stop, or close a stopped cost's last month, with the final payment (agreed-part-months). */
export interface FixedCostClosing {
  fixedCostId: string
  stopsOn: string
  /** On top of what payments already leave for the stop month; 0 for nothing more. */
  finalPaise: number
  /** The final payment, recorded on the last day; null when nothing more was paid. */
  payment: { id: string; isCash: boolean } | null
}

export interface FixedCostPaymentInput {
  /** Client-generated, so a retried tap records one payment. */
  id: string
  fixedCostId: string
  amountPaise: number
  paidOn: string
  countsIn: string
  isCash: boolean
  note: string | null
  /** Null when the amount is what was owed and nothing was asked. */
  choice: PayChoiceKey | null
}

/** Fixed costs with a month that ended unpaid, across the outlets the reader reaches. */
export interface FixedCostsUnpaid {
  count: number
  /** The ended months named, oldest first (1sts). */
  months: string[]
  /** What those months left uncovered (owner, 2026-10-20: lead with the money). */
  paise: number
  /** How many of the fixed costs behind it are of each category. */
  categories: Partial<Record<FixedCostCategory, number>>
  /** The latest business date among the outlets read; null where nothing was. */
  today: string | null
}

/** What Edit may change besides the monthly amount (owner, 2026-10-19: every field). */
export interface FixedCostDetails {
  name: string
  category: FixedCostCategory
  startsOn: string
  note: string | null
  /** What the start month comes to, where the start moves to a day that is not the 1st. */
  firstMonthPaise?: number
}

export interface FixedCostsAdapter {
  list(outletId: string): Promise<FixedCostsReading>
  add(cost: NewFixedCost): Promise<FixedCostFacts>
  /** Edit: name, category, start date and note. Past months follow a new start date. */
  update(fixedCostId: string, details: FixedCostDetails): Promise<void>
  /** Edit: a new monthly amount from a month on. */
  changeAmount(fixedCostId: string, fromMonth: string, amountPaise: number): Promise<void>
  /** Stop from a date; `clearAhead` settles the last month to clear a paid-ahead balance. */
  stop(fixedCostId: string, stopsOn: string, clearAhead: boolean): Promise<void>
  /**
   * Stop, closing every month through the stop month: the stop month costs what
   * was paid plus the final payment, and nothing is left to pay (agreed-part-months).
   */
  close(closing: FixedCostClosing): Promise<void>
  /** Undo a stop: it runs again, its closing figures and final payment taken back (agreed-part-months). */
  unstop(fixedCostId: string): Promise<void>
  pay(payment: FixedCostPaymentInput): Promise<void>
  /**
   * Undo a payment: withdraw its expense and void what its answer recorded (the
   * month it settled, the monthly amount it set), so it can be paid again right.
   */
  undoPayment(fixedCostId: string, paymentId: string): Promise<void>
  /** Drop: settle a month at what it has covered. */
  settle(fixedCostId: string, month: string, amountPaise: number): Promise<void>
  /** Undo: void a settlement. */
  voidSettlement(settlementId: string): Promise<void>
  unpaid(): Promise<FixedCostsUnpaid>
}
