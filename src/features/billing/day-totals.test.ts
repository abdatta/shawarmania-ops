import { describe, expect, it } from 'vitest'

import type { BillingBill, PaymentMethod } from '@/data-access/adapters'

import { averageBillPaise, combinedTakingsPaise, paymentTotalPaise } from './day-totals'

/** Only the fields these three functions read; the rest of a bill is not their business. */
function bill(payments: readonly { method: PaymentMethod; amountPaise: number }[]): BillingBill {
  return { payments } as unknown as BillingBill
}

describe('what a scope of bills came to', () => {
  it('adds each tender separately and both together', () => {
    const bills = [
      bill([{ method: 'cash', amountPaise: 25_000 }]),
      bill([{ method: 'upi', amountPaise: 17_550 }]),
      // A split-tender bill belongs to both figures, in its own parts.
      bill([
        { method: 'cash', amountPaise: 10_000 },
        { method: 'upi', amountPaise: 2_450 },
      ]),
    ]

    const totals = [
      { method: 'cash' as const, totalPaise: paymentTotalPaise(bills, 'cash') },
      { method: 'upi' as const, totalPaise: paymentTotalPaise(bills, 'upi') },
    ]

    expect(totals[0]?.totalPaise).toBe(35_000)
    expect(totals[1]?.totalPaise).toBe(20_000)
    // The takings are the cards' own sum, so they cannot disagree with them.
    expect(combinedTakingsPaise(totals)).toBe(55_000)
  })

  it('averages in whole paise, rounded', () => {
    // 1000 paise over three bills is 333.33…, which must not reach a card.
    const average = averageBillPaise(1_000, 3)
    expect(average).toBe(333)
    expect(Number.isInteger(average)).toBe(true)
    // Rounds up rather than truncating at the halfway point.
    expect(averageBillPaise(1_001, 2)).toBe(501)
  })

  it('reads zero on a day nothing was paid, rather than NaN or infinity', () => {
    expect(averageBillPaise(0, 0)).toBe(0)
    // Belt and braces: a count that somehow arrives negative is still not a
    // division.
    expect(averageBillPaise(5_000, -1)).toBe(0)
  })

  it('counts nothing when there are no bills at all', () => {
    expect(paymentTotalPaise([], 'cash')).toBe(0)
    expect(combinedTakingsPaise([])).toBe(0)
  })
})
