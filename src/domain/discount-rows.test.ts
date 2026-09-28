import { describe, expect, it } from 'vitest'

import cases from './discount-row-cases.json'
import { groupMenuDiscounts, menuDiscountLabel, type DiscountedLine } from './discount-rows'
import { formatPaise } from './money'

/**
 * The TypeScript half of a two-implementation rule. The SQL half runs the same
 * `cases` through `public.bill_public_discount_rows()` in
 * `supabase/tests/rest/zz-public-receipt.test.ts`, so a divergence fails on one
 * side or the other rather than quietly showing a customer different rows from
 * the ones the till showed.
 */
describe('grouping menu discounts into rows', () => {
  it.each(cases.cases.map((c) => [c.name, c] as const))('%s', (_name, testCase) => {
    // JSON widens `kind` to a string; the case file only ever says item or packaging.
    expect(groupMenuDiscounts(testCase.lines as readonly DiscountedLine[])).toEqual(testCase.rows)
  })

  /*
   * The fixture has to be a bill before it can prove anything about one. A case
   * whose rows do not sum to its lines' discounts would be asserting agreement
   * about a bill the database would refuse.
   */
  it.each(cases.cases.map((c) => [c.name, c] as const))(
    'the %s case is a bill the database would accept',
    (_name, testCase) => {
      // The packaging waiver is never a menu row (#60), so it is not in the sum.
      const lineDiscounts = testCase.lines
        .filter((line) => !('kind' in line) || line.kind !== 'packaging')
        .reduce((sum, line) => sum + line.discountPaise, 0)
      const rowTotal = testCase.rows.reduce((sum, row) => sum + row.amountPaise, 0)
      expect(rowTotal).toBe(lineDiscounts)
    },
  )
})

describe('how a row is worded', () => {
  it('reads a percentage as a percentage, fractions included', () => {
    expect(
      menuDiscountLabel(
        { basis: 'percent', valueBp: 1500, valuePaise: null, categories: [], amountPaise: 0 },
        formatPaise,
      ),
    ).toBe('15%')
    expect(
      menuDiscountLabel(
        { basis: 'percent', valueBp: 750, valuePaise: null, categories: [], amountPaise: 0 },
        formatPaise,
      ),
    ).toBe('7.5%')
  })

  it('reads a rupee discount as its per-unit amount', () => {
    expect(
      menuDiscountLabel(
        { basis: 'amount', valueBp: null, valuePaise: 2000, categories: [], amountPaise: 6000 },
        formatPaise,
      ),
    ).toBe('₹20')
  })
})
