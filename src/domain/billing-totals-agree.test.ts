/**
 * The pure function's half of the anti-drift proof.
 *
 * `src/domain/billing-totals-cases.json` is the one table of cases the bill
 * identity is held to. This file runs it through `billTotals()`; the SQL half
 * runs the same rows through the check constraints and through
 * `billing_validate_totals` in `supabase/tests/47_bill_discount_arithmetic.sql`.
 * `scripts/check-totals-cases.mjs` fails the lint if the two copies drift.
 *
 * A case added here without the SQL copy is a lint failure, not a silent gap,
 * which is the whole point: the failure mode this guards against is an identity
 * changed in one place and left alone in the other, and that shows up as bills
 * being refused at a live counter rather than as a red test.
 */
import { describe, expect, it } from 'vitest'

import cases from './billing-totals-cases.json'
import { billTotals } from './billing'

interface TotalsCase {
  name: string
  subtotal: number
  discount: number
  rounding: number
  total: number
}

const TOTALS_CASES: TotalsCase[] = cases.cases

describe('the bill identity, across every definition of it', () => {
  it('has cases to check', () => {
    expect(TOTALS_CASES.length).toBeGreaterThan(0)
  })

  it.each(TOTALS_CASES)(
    '$name: ₹$subtotal less ₹$discount rounds by $rounding to ₹$total',
    ({ subtotal, discount, rounding, total }) => {
      // One line carrying the whole subtotal: this table is about the bill's
      // arithmetic, not about how the lines were composed.
      const totals = billTotals([{ unitPricePaise: subtotal, quantity: 1 }], {
        discountPaise: discount,
      })

      expect(totals.subtotalPaise).toBe(subtotal)
      expect(totals.discountPaise).toBe(discount)
      expect(totals.roundingPaise).toBe(rounding)
      expect(totals.totalPaise).toBe(total)
    },
  )

  it.each(TOTALS_CASES)('$name satisfies the identity itself', (testCase) => {
    const totals = billTotals([{ unitPricePaise: testCase.subtotal, quantity: 1 }], {
      discountPaise: testCase.discount,
    })

    expect(totals.totalPaise).toBe(
      totals.subtotalPaise - totals.discountPaise + totals.taxPaise + totals.roundingPaise,
    )
    expect(totals.totalPaise % 100).toBe(0)
    expect(totals.totalPaise).toBeGreaterThanOrEqual(100)
    expect(totals.roundingPaise).toBeGreaterThanOrEqual(0)
    expect(totals.roundingPaise).toBeLessThanOrEqual(100)
    expect(totals.discountPaise).toBeLessThanOrEqual(totals.subtotalPaise)
  })
})
