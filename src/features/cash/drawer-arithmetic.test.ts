import { describe, expect, it } from 'vitest'

import type { DrawerState } from '@/data-access/adapters'

import { countAdvice, expectedAtInstant } from './drawer-arithmetic'

/**
 * What the count sheet may say, and what it must never say.
 *
 * The refusal in `countAdvice` is the single most load-bearing decision in this
 * change (design D7), so it is asserted here against the function's own return
 * value rather than inferred from rendered text. A component test can only prove
 * that a string is absent from one render; this proves the surface has nothing to
 * render.
 */

const COUNTED_AT = new Date('2026-08-25T16:45:00Z')
const PREVIOUS_COUNT = new Date('2026-08-24T16:50:00Z')

/**
 * The bill set from `design.md`'s worked example, around a 22:15 count.
 * The three bills at 16:34, 16:38 and 16:42 sum to exactly ₹854.
 */
const NEARBY = [
  { billId: 'b-2158', billNumber: 2158, paidAt: '2026-08-25T16:28:00Z', cashPaise: 59600 },
  { billId: 'b-2204', billNumber: 2204, paidAt: '2026-08-25T16:34:00Z', cashPaise: 13900 },
  { billId: 'b-2208', billNumber: 2208, paidAt: '2026-08-25T16:38:00Z', cashPaise: 43700 },
  { billId: 'b-2212', billNumber: 2212, paidAt: '2026-08-25T16:42:00Z', cashPaise: 27800 },
  { billId: 'b-2222', billNumber: 2222, paidAt: '2026-08-25T16:52:00Z', cashPaise: 18000 },
  { billId: 'b-2233', billNumber: 2233, paidAt: '2026-08-25T17:03:00Z', cashPaise: 60000 },
]

function stateWith(overrides: Partial<DrawerState> = {}): DrawerState {
  return {
    outletId: 'outlet-1',
    lastObservation: {
      id: 'obs-1',
      outletId: 'outlet-1',
      countedAt: PREVIOUS_COUNT.toISOString(),
      recordedAt: PREVIOUS_COUNT.toISOString(),
      isAnchor: false,
      openingPaise: 145000,
      expectedPaise: 895000,
      differencePaise: 0,
      countedTotalPaise: 895000,
      isLegacyImprecise: false,
      isApproximate: false,
      toleranceMinutes: 15,
      recordedBy: 'p1',
      recordedByName: 'A Manager',
      correctedBy: null,
      correctedByName: null,
      onSite: true,
      awayReason: null,
      note: null,
      ownCashOut: [],
      adjustments: [],
      openingBreakPaise: null,
    },
    expectedNowPaise: 895000,
    leftInDrawerPaise: 145000,
    cashReceiptsSincePaise: 840000,
    cashReceiptsSinceCount: 51,
    cashExpensesSincePaise: 90000,
    cashExpensesSinceCount: 1,
    receiptsByDay: [{ businessDate: '2026-08-25', paise: 750000, bills: 51 }],
    cashExpensesByDay: [{ businessDate: '2026-08-25', paise: 0, rows: 1 }],
    cashOutSincePaise: 0,
    cashOutSinceCount: 0,
    daysCovered: 1,
    recentObservations: [],
    nearbyCashBills: NEARBY,
    unsyncedDevices: { count: 0, since: null },
    exceptions: [],
    ...overrides,
  }
}

/**
 * The expected total at `COUNTED_AT` (16:45).
 *
 * Opening ₹1,450 + receipts ₹8,400 − expenses ₹900, **less the ₹780 of cash rung
 * after 16:45** — the 16:52 and 17:03 bills. That subtraction is not a quirk of
 * the fixture, it is the model: `cashReceiptsSincePaise` runs to *now*, and
 * stating an earlier count instant excludes what arrived after it.
 */
const RUNG_AFTER_COUNT = 18000 + 60000
const EXPECTED = 145000 + 840000 - 90000 - RUNG_AFTER_COUNT

describe('expectedAtInstant — the movable boundary', () => {
  it('expects opening plus receipts less expenses, cash out and anything rung after', () => {
    const { expectedPaise, excludedPaise } = expectedAtInstant(stateWith(), COUNTED_AT)
    expect(excludedPaise).toBe(RUNG_AFTER_COUNT)
    expect(expectedPaise).toBe(145000 + 840000 - 90000 - RUNG_AFTER_COUNT)
  })

  it('excludes nothing when the count instant is after every nearby bill', () => {
    const afterEverything = new Date('2026-08-25T17:30:00Z')
    const { expectedPaise, excludedPaise, excludedBills } = expectedAtInstant(
      stateWith(),
      afterEverything,
    )
    expect(excludedBills).toBe(0)
    expect(excludedPaise).toBe(0)
    expect(expectedPaise).toBe(145000 + 840000 - 90000)
  })

  it('excludes the cash rung after the stated instant, and says how much', () => {
    // Moving the boundary back to 16:40 leaves out the 16:42, 16:52 and 17:03
    // bills, which is the whole point: the collector corrects the time from
    // evidence they recognise and the difference is whatever that produces.
    const earlier = new Date('2026-08-25T16:40:00Z')
    const { expectedPaise, excludedPaise, excludedBills } = expectedAtInstant(stateWith(), earlier)

    expect(excludedBills).toBe(3)
    expect(excludedPaise).toBe(27800 + 18000 + 60000)
    expect(expectedPaise).toBe(145000 + 840000 - 90000 - excludedPaise)
    // Moving the line earlier can only lower the expected figure, never raise it.
    expect(expectedPaise).toBeLessThan(EXPECTED)
  })

  it('is empty at an outlet whose drawer is not tracked yet', () => {
    const untracked = stateWith({ lastObservation: null, leftInDrawerPaise: null })
    expect(expectedAtInstant(untracked, COUNTED_AT)).toEqual({
      expectedPaise: 0,
      excludedPaise: 0,
      excludedBills: 0,
    })
  })
})

describe('countAdvice', () => {
  it('states the difference and its direction in words', () => {
    const short = countAdvice(stateWith(), EXPECTED - 24000, COUNTED_AT, false)
    expect(short.differencePaise).toBe(-24000)
    expect(short.direction).toBe('short')

    const over = countAdvice(stateWith(), EXPECTED + 5000, COUNTED_AT, false)
    expect(over.direction).toBe('over')

    const balanced = countAdvice(stateWith(), EXPECTED, COUNTED_AT, false)
    expect(balanced.direction).toBe('balanced')
    expect(balanced.differencePaise).toBe(0)
  })

  it('reports an exact bill-run coincidence as a fact, naming the bills', () => {
    // ₹854 short is exactly the three bills at 16:34, 16:38 and 16:42.
    const advice = countAdvice(stateWith(), EXPECTED - 85400, COUNTED_AT, true)
    expect(advice.coincidence).not.toBeNull()
    expect(advice.coincidence?.totalPaise).toBe(85400)
    expect(advice.coincidence?.bills.map((bill) => bill.billId)).toEqual([
      'b-2204',
      'b-2208',
      'b-2212',
    ])
  })

  it('states in rupees how much the timing could account for, when approximate', () => {
    const advice = countAdvice(stateWith(), EXPECTED - 5000, COUNTED_AT, true)
    // ±15 min around 16:45 covers 16:34, 16:38, 16:42 and 16:52.
    expect(advice.timingCouldExplainPaise).toBe(13900 + 43700 + 27800 + 18000)
  })

  it('says nothing about timing when the recorder asserted the instant', () => {
    const advice = countAdvice(stateWith(), EXPECTED - 5000, COUNTED_AT, false)
    expect(advice.timingCouldExplainPaise).toBeNull()
  })
})

/**
 * **THE REFUSAL.** Design decision 7, asserted directly.
 *
 * Moving a count boundary does not move the expected figure smoothly — it jumps
 * one bill at a time, so a *near* hit is almost always available. A genuine ₹500
 * shortfall matches no reachable value, but the nearest would shrink it to ₹222,
 * and ₹222 reads as rounding noise where ₹500 reads as a missing note. The denser
 * the trade the denser that set, so the ability to explain anything away is
 * strongest on exactly the nights when a loss is easiest to hide.
 */
describe('the surface proposes no instant when nothing matches', () => {
  it('offers no coincidence for a genuine ₹500 shortfall against the same bills', () => {
    const advice = countAdvice(stateWith(), EXPECTED - 50000, COUNTED_AT, true)
    expect(advice.coincidence).toBeNull()
  })

  it('never returns a suggested instant, for ANY difference', () => {
    // Swept rather than sampled: if a future change starts proposing a nearby
    // boundary it has to set this field, and this test is what makes that
    // decision visible instead of quiet.
    for (let gap = -200000; gap <= 200000; gap += 100) {
      const advice = countAdvice(stateWith(), EXPECTED + gap, COUNTED_AT, true)
      expect(advice.suggestedInstant).toBeNull()
    }
  })

  it('ranks no candidate boundary: the advice carries bills, never instants', () => {
    const advice = countAdvice(stateWith(), EXPECTED - 50000, COUNTED_AT, true)
    const keys = Object.keys(advice)
    // No field that could hold an ordered list of candidate times.
    expect(keys).not.toContain('candidates')
    expect(keys).not.toContain('rankedInstants')
    expect(keys).not.toContain('bestInstant')
    expect(keys.sort()).toEqual([
      'coincidence',
      'differencePaise',
      'direction',
      'expectedPaise',
      'suggestedInstant',
      'timingCouldExplainPaise',
    ])
  })

  it('does not disclose the balancing point even when one exists nearby', () => {
    // ₹278 short IS reachable (the 16:42 bill alone), so a coincidence is
    // reported — that is a fact about bills. What must not appear is an instant.
    const reachable = countAdvice(stateWith(), EXPECTED - 27800, COUNTED_AT, true)
    expect(reachable.coincidence?.totalPaise).toBe(27800)
    expect(reachable.suggestedInstant).toBeNull()
  })
})
