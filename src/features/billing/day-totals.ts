import type { BillingBill, BillingMethodTotal, PaymentMethod } from '@/data-access/adapters'

/**
 * What a scope of bills came to, in integer paise and nothing else.
 *
 * Pure, and separate from the surface that shows it, because these are the only
 * three arithmetic operations on this screen and each of them has an answer that
 * is wrong in a way a rendered card would not show: a total that disagrees with
 * the tender split beside it, an average carried as a float, and a division by a
 * day on which nothing was paid.
 */

/** Every payment of one tender in these bills, added up. */
export function paymentTotalPaise(bills: readonly BillingBill[], method: PaymentMethod): number {
  return bills
    .flatMap((bill) => bill.payments)
    .filter((payment) => payment.method === method)
    .reduce((total, payment) => total + payment.amountPaise, 0)
}

/**
 * The day's takings: the sum of the tender figures shown beside it.
 *
 * Summed from the same totals the cards render rather than derived again from
 * the bills, so the three money cards cannot disagree with each other whatever
 * a correction did to a bill's allocation.
 */
export function combinedTakingsPaise(totals: readonly BillingMethodTotal[]): number {
  return totals.reduce((sum, total) => sum + total.totalPaise, 0)
}

/**
 * The average bill, in integer paise.
 *
 * Rounded rather than truncated: an average is a reading of the day, not an
 * amount anybody is owed, and half a paise down reads wrong against the takings
 * beside it. Nothing reconciles against this figure.
 *
 * A scope with no paid bill has no average, and the count is checked before the
 * division rather than the result checked after it, so `₹0` is a deliberate
 * answer rather than a formatter quietly covering for `NaN`.
 */
export function averageBillPaise(takingsPaise: number, paidBillCount: number): number {
  if (paidBillCount <= 0) return 0
  return Math.round(takingsPaise / paidBillCount)
}
