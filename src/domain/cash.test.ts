import { describe, expect, it } from 'vitest'

import { describeDifference, differencePaise, expectedClosingPaise } from './cash'
import { NotPaiseError } from './money'

const day = {
  openingCashPaise: 200000,
  cashSalesPaise: 1_25_000,
  cashExpensesPaise: 285000,
  cashWithdrawnPaise: 50000,
}

describe('expectedClosingPaise', () => {
  it('is opening plus cash sales minus cash expenses minus withdrawals', () => {
    expect(expectedClosingPaise(day)).toBe(200000 + 125000 - 285000 - 50000)
  })

  it('counts nothing but cash — a UPI sale is simply not in the inputs', () => {
    const noCashSales = expectedClosingPaise({ ...day, cashSalesPaise: 0 })
    expect(noCashSales).toBe(200000 - 285000 - 50000)
  })

  it('throws rather than rounding when a float reaches it', () => {
    expect(() => expectedClosingPaise({ ...day, cashSalesPaise: 1250.5 })).toThrow(NotPaiseError)
  })
})

describe('differencePaise', () => {
  it('is negative when the drawer is short', () => {
    const expected = expectedClosingPaise(day)
    expect(differencePaise(expected - 24000, expected)).toBe(-24000)
  })

  it('is positive when the drawer is over', () => {
    const expected = expectedClosingPaise(day)
    expect(differencePaise(expected + 12000, expected)).toBe(12000)
  })

  it('is zero when it balances', () => {
    const expected = expectedClosingPaise(day)
    expect(differencePaise(expected, expected)).toBe(0)
  })

  it('throws on a float', () => {
    expect(() => differencePaise(100.5, 100)).toThrow(NotPaiseError)
  })
})

describe('describeDifference', () => {
  it('names the direction so the sign is not the only signal', () => {
    expect(describeDifference(-24000)).toBe('short')
    expect(describeDifference(12000)).toBe('over')
    expect(describeDifference(0)).toBe('balanced')
  })
})
