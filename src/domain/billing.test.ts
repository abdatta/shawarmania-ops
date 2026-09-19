import { describe, expect, it } from 'vitest'

import {
  AWAITING_ORDER_NUMBER,
  billReference,
  isAwaitingOrderNumber,
  UNSENT_ORDER_REFERENCE,
  billTotals,
  classifySync,
  discountAmountPaise,
  lineTotalPaise,
  menuLineDiscount,
  MINIMUM_BILL_PAISE,
  SYNC_ESCALATION_COUNT,
  SYNC_ESCALATION_MS,
  ticketEditDeadlineMs,
} from './billing'
import { NotPaiseError } from './money'

describe('lineTotalPaise', () => {
  it('multiplies a unit price by a whole quantity', () => {
    expect(lineTotalPaise(13900, 2)).toBe(27800)
    expect(lineTotalPaise(25000, 1)).toBe(25000)
  })

  it('throws on a fractional price rather than rounding it', () => {
    expect(() => lineTotalPaise(139.5, 1)).toThrow(NotPaiseError)
  })

  it('throws on a quantity that is not a whole item', () => {
    expect(() => lineTotalPaise(13900, 1.5)).toThrow(TypeError)
    expect(() => lineTotalPaise(13900, 0)).toThrow(TypeError)
    expect(() => lineTotalPaise(13900, -1)).toThrow(TypeError)
  })
})

describe('billTotals', () => {
  // The real menu, which is the order a counter actually rings.
  const order = [
    { unitPricePaise: 13900, quantity: 2 },
    { unitPricePaise: 19900, quantity: 1 },
    { unitPricePaise: 25000, quantity: 1 },
  ]

  it('sums the lines and satisfies total = subtotal − discount + tax + rounding', () => {
    const totals = billTotals(order)

    expect(totals.subtotalPaise).toBe(27800 + 19900 + 25000)
    expect(totals.discountPaise).toBe(0)
    expect(totals.taxPaise).toBe(0)
    expect(totals.roundingPaise).toBe(0)
    expect(totals.totalPaise).toBe(
      totals.subtotalPaise - totals.discountPaise + totals.taxPaise + totals.roundingPaise,
    )
  })

  it('keeps the invariant with a discount and tax present', () => {
    const totals = billTotals(order, { discountPaise: 5000, taxPaise: 1200 })
    expect(totals.totalPaise).toBe(72700 - 5000 + 1200)
    expect(totals.roundingPaise).toBe(0)
  })

  it('is zero for an empty order rather than throwing', () => {
    const totals = billTotals([])
    expect(totals.totalPaise).toBe(0)
    expect(totals.roundingPaise).toBe(0)
  })

  it('caps a discount larger than the order rather than refusing it', () => {
    const totals = billTotals(order, { discountPaise: 999999 })
    expect(totals.discountPaise).toBe(72700)
    // Nothing is left to pay, so the floor is what the customer is asked for.
    expect(totals.totalPaise).toBe(MINIMUM_BILL_PAISE)
    expect(totals.roundingPaise).toBe(MINIMUM_BILL_PAISE)
  })

  it('refuses a negative discount', () => {
    expect(() => billTotals(order, { discountPaise: -1 })).toThrow(RangeError)
  })

  it('throws when a float reaches the money path', () => {
    expect(() => billTotals(order, { taxPaise: 12.5 })).toThrow(NotPaiseError)
    expect(() => billTotals(order, { discountPaise: 12.5 })).toThrow(NotPaiseError)
    expect(() => billTotals([{ unitPricePaise: 0.1 + 0.2, quantity: 1 }])).toThrow(NotPaiseError)
  })
})

describe('billTotals rounding', () => {
  const oneLine = (paise: number) => [{ unitPricePaise: paise, quantity: 1 }]

  it('rounds a part-rupee total up, and records the difference as its own figure', () => {
    // 15% of ₹389 is ₹58.35, leaving ₹330.65.
    const totals = billTotals([{ unitPricePaise: 38900, quantity: 1 }], { discountPaise: 5835 })

    expect(totals.discountPaise).toBe(5835)
    expect(totals.roundingPaise).toBe(35)
    expect(totals.totalPaise).toBe(33100)
    expect(totals.totalPaise % 100).toBe(0)
  })

  it('rounds up rather than to nearest, so the paise are never the business’s to lose', () => {
    // ₹330.01 and ₹330.99 both land on ₹331: the direction is away from the
    // customer whichever side of the halfway point the amount falls.
    expect(billTotals(oneLine(33001)).totalPaise).toBe(33100)
    expect(billTotals(oneLine(33099)).totalPaise).toBe(33100)
  })

  it('adds nothing when the amount is already a whole rupee', () => {
    const totals = billTotals(oneLine(33100))
    expect(totals.roundingPaise).toBe(0)
    expect(totals.totalPaise).toBe(33100)
  })

  it('records the whole giveaway and floors the bill at ₹1', () => {
    // The discount says what the promotion actually cost. Capping it at
    // ₹138 to leave a rupee would under-report every free meal by a rupee.
    const totals = billTotals(oneLine(13900), { discountPaise: 13900 })

    expect(totals.discountPaise).toBe(13900)
    expect(totals.roundingPaise).toBe(100)
    expect(totals.totalPaise).toBe(MINIMUM_BILL_PAISE)
  })

  it('floors a bill whose lines are cheaper than a rupee', () => {
    const totals = billTotals(oneLine(50))
    expect(totals.totalPaise).toBe(MINIMUM_BILL_PAISE)
    expect(totals.roundingPaise).toBe(50)
  })

  it('never floors an order with nothing on it', () => {
    expect(billTotals([]).totalPaise).toBe(0)
  })

  it('keeps the identity across a hundred awkward subtotals', () => {
    for (let paise = 1; paise <= 100; paise += 1) {
      const totals = billTotals(oneLine(paise * 37), { discountPaise: paise })
      expect(totals.totalPaise).toBe(
        totals.subtotalPaise - totals.discountPaise + totals.taxPaise + totals.roundingPaise,
      )
      expect(totals.totalPaise % 100).toBe(0)
      expect(totals.totalPaise).toBeGreaterThanOrEqual(MINIMUM_BILL_PAISE)
      expect(totals.roundingPaise).toBeGreaterThanOrEqual(0)
      expect(totals.roundingPaise).toBeLessThanOrEqual(100)
    }
  })
})

describe('discountAmountPaise', () => {
  it('takes a percentage of the base it is given', () => {
    expect(discountAmountPaise({ basis: 'percent', percentBp: 1500 }, 38900, 1)).toBe(5835)
    expect(discountAmountPaise({ basis: 'percent', percentBp: 1000 }, 13900, 1)).toBe(1390)
  })

  it('reads a fractional percentage without a float reaching the result', () => {
    // 12.5% of ₹139 is ₹17.375, which is not a whole paisa.
    const amount = discountAmountPaise({ basis: 'percent', percentBp: 1250 }, 13900, 1)
    expect(Number.isInteger(amount)).toBe(true)
    expect(amount).toBe(1738)
  })

  it('multiplies a rupee amount by the quantity, because a percentage would have', () => {
    // ₹20 off a Paneer Roll with three on the bill is ₹60 [owner, 2026-09-03].
    expect(discountAmountPaise({ basis: 'amount', amountPaise: 2000 }, 37500, 3)).toBe(6000)
  })

  it('never exceeds the base it applies to', () => {
    // A ₹40 item cannot give ₹50 away, whatever the configuration says.
    expect(discountAmountPaise({ basis: 'amount', amountPaise: 5000 }, 4000, 1)).toBe(4000)
    expect(discountAmountPaise({ basis: 'percent', percentBp: 20000 }, 4000, 1)).toBe(4000)
  })

  it('refuses a negative value rather than paying the customer', () => {
    expect(() => discountAmountPaise({ basis: 'percent', percentBp: -100 }, 13900, 1)).toThrow(
      RangeError,
    )
    expect(() => discountAmountPaise({ basis: 'amount', amountPaise: -1 }, 13900, 1)).toThrow(
      RangeError,
    )
  })

  it('refuses a fractional basis point or a fractional amount', () => {
    expect(() => discountAmountPaise({ basis: 'percent', percentBp: 12.5 }, 13900, 1)).toThrow(
      TypeError,
    )
    expect(() => discountAmountPaise({ basis: 'amount', amountPaise: 20.5 }, 13900, 1)).toThrow(
      NotPaiseError,
    )
  })

  it('is order independent, because every discount reads the same gross base', () => {
    const base = 38900
    const fifteen = discountAmountPaise({ basis: 'percent', percentBp: 1500 }, base, 1)
    const ten = discountAmountPaise({ basis: 'percent', percentBp: 1000 }, base, 1)

    expect(fifteen + ten).toBe(ten + fifteen)
    // And additive rather than sequential: 25% off, not 23.5%.
    expect(fifteen + ten).toBe(discountAmountPaise({ basis: 'percent', percentBp: 2500 }, base, 1))
  })
})

describe('an order with no number yet', () => {
  it('is the sentinel both adapters already write, named', () => {
    expect(isAwaitingOrderNumber(AWAITING_ORDER_NUMBER)).toBe(true)
    expect(isAwaitingOrderNumber(106)).toBe(false)
  })

  it('is spoken as a phrase, never as something that could be an identifier', () => {
    // A token used to stand here. Four characters in an identifier slot read as
    // an identifier, so `#106` replacing it read as the order changing identity.
    expect(UNSENT_ORDER_REFERENCE).not.toMatch(/\d/)
    expect(UNSENT_ORDER_REFERENCE).toMatch(/\s/)
  })

  it('is written differently from a numbered bill', () => {
    expect(billReference(143)).toBe('Bill 143')
    expect(UNSENT_ORDER_REFERENCE).not.toMatch(/^Bill /)
  })
})

describe('classifySync', () => {
  const now = Date.parse('2026-07-28T12:00:00Z')

  it('is synced when nothing waits', () => {
    expect(classifySync({ pending: 0, oldestQueuedAt: null, now })).toBe('synced')
  })

  it('is pending while the queue is short and young', () => {
    expect(classifySync({ pending: 1, oldestQueuedAt: now - 1000, now })).toBe('pending')
    expect(
      classifySync({ pending: SYNC_ESCALATION_COUNT - 1, oldestQueuedAt: now - 1000, now }),
    ).toBe('pending')
  })

  it('escalates at the count threshold', () => {
    expect(classifySync({ pending: SYNC_ESCALATION_COUNT, oldestQueuedAt: now, now })).toBe(
      'stalled',
    )
  })

  it('escalates when the oldest bill has waited too long, however few there are', () => {
    expect(classifySync({ pending: 1, oldestQueuedAt: now - SYNC_ESCALATION_MS, now })).toBe(
      'stalled',
    )
    expect(classifySync({ pending: 1, oldestQueuedAt: now - SYNC_ESCALATION_MS + 1, now })).toBe(
      'pending',
    )
  })
})

describe('menuLineDiscount', () => {
  const shawarma = 'cat-shawarma'
  const rolls = 'cat-rolls'

  const fifteenOffShawarma = {
    basis: 'percent' as const,
    percentBp: 1500,
    categoryIds: [shawarma],
  }

  it('takes nothing off a line no discount covers', () => {
    const result = menuLineDiscount({ categoryId: rolls, unitPricePaise: 13900, quantity: 1 }, [
      fifteenOffShawarma,
    ])
    expect(result).toEqual({ discountPaise: 0, discountPercentBp: null })
  })

  it('takes the percentage off a line its category covers, and says which', () => {
    const result = menuLineDiscount({ categoryId: shawarma, unitPricePaise: 13900, quantity: 1 }, [
      fifteenOffShawarma,
    ])
    expect(result).toEqual({ discountPaise: 2085, discountPercentBp: 1500 })
  })

  it('reads the gross line total, so a quantity scales the discount with it', () => {
    const result = menuLineDiscount({ categoryId: shawarma, unitPricePaise: 13900, quantity: 3 }, [
      fifteenOffShawarma,
    ])
    expect(result.discountPaise).toBe(6255)
  })

  it('adds two rules covering one category rather than compounding them', () => {
    const result = menuLineDiscount({ categoryId: shawarma, unitPricePaise: 10000, quantity: 1 }, [
      fifteenOffShawarma,
      { basis: 'percent', percentBp: 1000, categoryIds: [shawarma] },
    ])
    // 25% off the original, not 23.5% — and the row can say 25%.
    expect(result).toEqual({ discountPaise: 2500, discountPercentBp: 2500 })
  })

  it('is order independent, because every rule reads the same gross base', () => {
    const line = { categoryId: shawarma, unitPricePaise: 10000, quantity: 1 }
    const ten = { basis: 'percent' as const, percentBp: 1000, categoryIds: [shawarma] }
    expect(menuLineDiscount(line, [fifteenOffShawarma, ten])).toEqual(
      menuLineDiscount(line, [ten, fifteenOffShawarma]),
    )
  })

  it('multiplies a rupee rule by the quantity and records no percentage', () => {
    const result = menuLineDiscount({ categoryId: rolls, unitPricePaise: 12500, quantity: 3 }, [
      { basis: 'amount', amountPaise: 2000, categoryIds: [rolls] },
    ])
    // ₹20 off an item with three on the bill is ₹60 [owner, 2026-09-03].
    expect(result).toEqual({ discountPaise: 6000, discountPercentBp: null })
  })

  it('records no percentage when a rupee rule joined a percentage one', () => {
    // There is no single percentage describing the pair, and inventing one would
    // put a figure on the bill that no rule produced.
    const result = menuLineDiscount({ categoryId: shawarma, unitPricePaise: 10000, quantity: 1 }, [
      fifteenOffShawarma,
      { basis: 'amount', amountPaise: 1000, categoryIds: [shawarma] },
    ])
    expect(result).toEqual({ discountPaise: 2500, discountPercentBp: null })
  })

  it('never lets a line give away more than it is worth', () => {
    const result = menuLineDiscount({ categoryId: shawarma, unitPricePaise: 10000, quantity: 1 }, [
      { basis: 'percent', percentBp: 6000, categoryIds: [shawarma] },
      { basis: 'percent', percentBp: 8000, categoryIds: [shawarma] },
    ])
    expect(result.discountPaise).toBe(10000)
  })

  it('takes nothing off a line with no category at all', () => {
    const result = menuLineDiscount({ categoryId: null, unitPricePaise: 13900, quantity: 1 }, [
      fifteenOffShawarma,
    ])
    expect(result.discountPaise).toBe(0)
  })
})

/**
 * The ticket's edit window (#55). The database computes the identical
 * expression in `billing_edit_window_end`; these cases are the app's half of
 * the promise that the two never disagree.
 */
describe('ticketEditDeadlineMs', () => {
  const noon = '2026-09-17T12:00:00.000Z'
  const ms = (iso: string) => Date.parse(iso)

  it('gives an order whose food is still owed no deadline at all', () => {
    // The complaint that started #55: the customer pays when they order, and
    // the clock used to run while the shawarma was being made.
    // Null is "no deadline", not "expired". Every reader treats it as open, so
    // the payment stays reversible however long the food takes.
    expect(
      ticketEditDeadlineMs({ paidAt: noon, preparedAt: null, settlesAnOrder: true }),
    ).toBeNull()
  })

  it('starts the clock at preparation for the upfront payer', () => {
    expect(
      ticketEditDeadlineMs({
        paidAt: noon,
        preparedAt: '2026-09-17T12:30:00.000Z',
        settlesAnOrder: true,
      }),
    ).toBe(ms('2026-09-17T12:35:00.000Z'))
  })

  it('starts it at payment when the payment came last', () => {
    // `greatest`, not `prepared_at`: the handover payer's undo would otherwise
    // land already expired.
    expect(
      ticketEditDeadlineMs({
        paidAt: '2026-09-17T12:30:00.000Z',
        preparedAt: noon,
        settlesAnOrder: true,
      }),
    ).toBe(ms('2026-09-17T12:35:00.000Z'))
  })

  it('keeps the payment-time clock for a bill with no order behind it', () => {
    // The direct sale. Reading its absent preparation as "not prepared yet"
    // would hand every direct bill an unbounded window.
    expect(ticketEditDeadlineMs({ paidAt: noon, preparedAt: null, settlesAnOrder: false })).toBe(
      ms('2026-09-17T12:05:00.000Z'),
    )
  })

  it('closes exactly five minutes after the ticket was finished', () => {
    // Both facts at once, which is the ordinary handover sale: one instant is
    // the later one and the window is five minutes from it.
    expect(ticketEditDeadlineMs({ paidAt: noon, preparedAt: noon, settlesAnOrder: true })).toBe(
      ms('2026-09-17T12:05:00.000Z'),
    )
  })

  it('offers nothing on money that was never taken', () => {
    expect(
      ticketEditDeadlineMs({ paidAt: null, preparedAt: noon, settlesAnOrder: true }),
    ).toBeNull()
  })
})
