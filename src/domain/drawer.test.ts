import { describe, expect, it } from 'vitest'

import {
  APPROXIMATE_WINDOW_MINUTES,
  describeDrawerDifference,
  drawerDifferencePaise,
  exactCoincidence,
  expectedTotalPaise,
  isInInterval,
  nextOpeningPaise,
  toleranceThroughputPaise,
  type NearbyCashBill,
} from './drawer'
import { NotPaiseError } from './money'

const interval = {
  openingPaise: 145000,
  cashReceiptsPaise: 840000,
  cashExpensesPaise: 90000,
  cashOutPaise: 0,
}

describe('expectedTotalPaise', () => {
  it('is opening plus receipts minus expenses minus cash out', () => {
    expect(expectedTotalPaise(interval)).toBe(145000 + 840000 - 90000)
  })

  it('counts only cash — UPI and aggregator revenue are simply not inputs', () => {
    expect(expectedTotalPaise({ ...interval, cashReceiptsPaise: 0 })).toBe(145000 - 90000)
  })

  it('throws rather than rounding when a float reaches it', () => {
    expect(() => expectedTotalPaise({ ...interval, cashReceiptsPaise: 8400.5 })).toThrow(
      NotPaiseError,
    )
  })
})

describe('drawerDifferencePaise', () => {
  it('is negative when the drawer is short, so a shortfall cannot read as a surplus', () => {
    expect(drawerDifferencePaise(890000, 895000)).toBe(-5000)
  })

  it('is positive when the drawer is over', () => {
    expect(drawerDifferencePaise(900000, 895000)).toBe(5000)
  })

  it('throws on a float', () => {
    expect(() => drawerDifferencePaise(100.5, 100)).toThrow(NotPaiseError)
  })
})

describe('describeDrawerDifference', () => {
  it('names the direction so the sign is not the only signal', () => {
    expect(describeDrawerDifference(-50000)).toBe('short')
    expect(describeDrawerDifference(4000)).toBe('over')
    expect(describeDrawerDifference(0)).toBe('balanced')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The property the whole design rests on (design D3).

describe('nextOpeningPaise — the carry-forward anchors to the counted figure', () => {
  it('is the counted total less this observation own cash out', () => {
    expect(nextOpeningPaise(895000, 750000)).toBe(145000)
  })

  it('does not carry a shortfall into the next interval', () => {
    // Two runs, identical but for a ₹500 shortfall in the middle observation.
    // The third observation opens on the same figure in both, which is the
    // whole safety property: a variance is recorded once and cannot ripple.
    const balancedRun = nextOpeningPaise(895000, 750000)
    const shortRun = nextOpeningPaise(895000, 750000)
    expect(shortRun).toBe(balancedRun)

    // And the shortfall lives on its own observation rather than in the next
    // opening: expected was ₹9,000 and counted ₹8,950.
    expect(drawerDifferencePaise(895000, 900000)).toBe(-5000)
  })

  it('adds when the cash out is negative, with no branch anywhere (design D5)', () => {
    // A thin drawer counted at ₹450, topped up by ₹1,000 recorded as −1,000.
    expect(nextOpeningPaise(45000, -100000)).toBe(145000)
  })

  it('raises the expected total by the same amount when a negative sits in the interval', () => {
    const withTopUp = expectedTotalPaise({ ...interval, cashOutPaise: -100000 })
    expect(withTopUp).toBe(expectedTotalPaise(interval) + 100000)
  })

  it('throws on a float', () => {
    expect(() => nextOpeningPaise(895000, 7500.5)).toThrow(NotPaiseError)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Interval membership (design D2).

describe('isInInterval', () => {
  const previous = new Date('2026-08-25T16:30:00Z')
  const current = new Date('2026-08-26T16:30:00Z')

  it('excludes a payment exactly at the previous count — it belonged to that one', () => {
    expect(isInInterval(previous, previous, current)).toBe(false)
  })

  it('includes a payment exactly at this count', () => {
    expect(isInInterval(current, previous, current)).toBe(true)
  })

  it('includes a payment inside the interval and excludes one after it', () => {
    expect(isInInterval(new Date('2026-08-26T10:00:00Z'), previous, current)).toBe(true)
    expect(isInInterval(new Date('2026-08-26T17:00:00Z'), previous, current)).toBe(false)
  })

  it('is empty for an anchor, which has no interval at all (design D18)', () => {
    expect(isInInterval(new Date('2026-08-01T00:00:00Z'), null, current)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// What may be said about an approximate time (design D6, D7).

/** The bill set from `design.md`'s worked example, around a 22:15 count. */
const nearby: NearbyCashBill[] = [
  { billId: 'b-2158', paidAt: new Date('2026-08-25T16:28:00Z'), cashPaise: 59600 },
  { billId: 'b-2204', paidAt: new Date('2026-08-25T16:34:00Z'), cashPaise: 13900 },
  { billId: 'b-2208', paidAt: new Date('2026-08-25T16:38:00Z'), cashPaise: 43700 },
  { billId: 'b-2212', paidAt: new Date('2026-08-25T16:42:00Z'), cashPaise: 27800 },
  { billId: 'b-2222', paidAt: new Date('2026-08-25T16:52:00Z'), cashPaise: 18000 },
  { billId: 'b-2233', paidAt: new Date('2026-08-25T17:03:00Z'), cashPaise: 60000 },
  { billId: 'b-2241', paidAt: new Date('2026-08-25T17:11:00Z'), cashPaise: 42000 },
]

describe('toleranceThroughputPaise', () => {
  it('sums the cash that moved inside the window', () => {
    const countedAt = new Date('2026-08-25T16:45:00Z')
    // ±15 min covers 16:30 to 17:00: the 16:34, 16:38, 16:42 and 16:52 bills.
    expect(toleranceThroughputPaise(nearby, countedAt)).toBe(13900 + 43700 + 27800 + 18000)
  })

  it('excludes cash outside the window', () => {
    const countedAt = new Date('2026-08-25T16:45:00Z')
    const throughput = toleranceThroughputPaise(nearby, countedAt)
    const everything = nearby.reduce((sum, bill) => sum + bill.cashPaise, 0)
    // The 16:28, 17:03 and 17:11 bills are outside ±15 min and contribute nothing.
    expect(throughput).toBe(everything - 59600 - 60000 - 42000)
  })

  it('defaults to a fifteen minute window either side', () => {
    expect(APPROXIMATE_WINDOW_MINUTES).toBe(15)
  })
})

describe('exactCoincidence — reports a fact, never a proposal (design D7)', () => {
  it('names the run when the difference matches it to the paise', () => {
    // ₹854 short is exactly the three bills at 16:34, 16:38 and 16:42.
    const found = exactCoincidence(-85400, nearby)
    expect(found).not.toBeNull()
    expect(found?.totalPaise).toBe(85400)
    expect(found?.bills.map((bill) => bill.billId)).toEqual(['b-2204', 'b-2208', 'b-2212'])
  })

  it('finds the same run for an excess of the same magnitude', () => {
    expect(exactCoincidence(85400, nearby)?.totalPaise).toBe(85400)
  })

  it('THE REFUSAL: returns nothing for a genuine ₹500 shortfall against the same bills', () => {
    // The nearest reachable run would shrink ₹500 to ₹222, and ₹222 reads as
    // rounding noise where ₹500 reads as a missing note. So: nothing.
    expect(exactCoincidence(-50000, nearby)).toBeNull()
  })

  it('requires contiguity in time, not any subset that happens to add up', () => {
    // 16:28 + 16:42 = ₹874, but they are not adjacent, so it is not a boundary
    // anybody could have moved.
    expect(exactCoincidence(-(59600 + 27800), nearby)).toBeNull()
  })

  it('says nothing about a balanced count, where every empty run would match', () => {
    expect(exactCoincidence(0, nearby)).toBeNull()
  })

  it('throws on a float', () => {
    expect(() => exactCoincidence(-500.5, nearby)).toThrow(NotPaiseError)
  })
})
