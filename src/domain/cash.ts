/**
 * Daily cash reconciliation. Pure, no I/O.
 *
 * This is the arithmetic behind the one number in this system a human signs
 * their name to. `openspec/specs/daily-cash-reconciliation/spec.md` requires the
 * database to enforce the identical two equations as check constraints on
 * `daily_cash_records`; writing them once here is what stops the screen and the
 * schema disagreeing about whether a drawer balanced.
 *
 * Integer paise throughout. A float in a cash reconciliation is not a rounding
 * question, it is a wrong answer.
 */

import { NotPaiseError } from './money'

function assertPaise(value: number): number {
  if (!Number.isInteger(value)) throw new NotPaiseError(value)
  return value
}

export interface CashDayInputs {
  /** What was in the drawer when the day started. */
  openingCashPaise: number
  /** Settled bills paid in cash for this business date. Nothing else counts. */
  cashSalesPaise: number
  /** Expenses paid in cash for this business date. A UPI expense is not one. */
  cashExpensesPaise: number
  /** Cash taken out of the drawer during the day. */
  cashWithdrawnPaise: number
}

/**
 * `expected = opening + cashSales − cashExpenses − cashWithdrawn`.
 *
 * Only cash moves this. A UPI sale raises revenue and not the drawer, and that
 * single rule is what connects billing to reconciliation
 * (docs/BUSINESS_CONTEXT.md).
 */
export function expectedClosingPaise(inputs: CashDayInputs): number {
  return (
    assertPaise(inputs.openingCashPaise) +
    assertPaise(inputs.cashSalesPaise) -
    assertPaise(inputs.cashExpensesPaise) -
    assertPaise(inputs.cashWithdrawnPaise)
  )
}

/**
 * `difference = actual − expected`, so a shortfall is **negative**.
 *
 * The sign convention is not arbitrary and is not a display choice: it is the
 * one the database's constraint uses, and a screen that flipped it would report
 * a missing ₹500 as a surplus.
 */
export function differencePaise(actualClosingPaise: number, expected: number): number {
  return assertPaise(actualClosingPaise) - assertPaise(expected)
}

export type DifferenceKind = 'short' | 'over' | 'balanced'

/**
 * What the difference means, in a word.
 *
 * Shown alongside the figure rather than instead of it, because a lone signed
 * number at the end of a long day is read wrong often enough to matter — and
 * because a minus sign is the first thing a photocopy or a small screen loses.
 */
export function describeDifference(difference: number): DifferenceKind {
  assertPaise(difference)
  if (difference < 0) return 'short'
  if (difference > 0) return 'over'
  return 'balanced'
}
