import { describe, expect, it } from 'vitest'

import type { ManualLedgerDayFigures, ManualLedgerExpense } from '@/data-access/adapters'
import { NotPaiseError } from '@/domain'

import {
  checkOpeningChain,
  monthOf,
  monthRange,
  netAggregatorPaise,
  readDay,
  readMonth,
} from './ledger'

const OUTLET = '00000000-0000-4000-a000-000000000001'

function day(overrides: Partial<ManualLedgerDayFigures> = {}): ManualLedgerDayFigures {
  return {
    outletId: OUTLET,
    businessDate: '2026-08-01',
    openingCashPaise: 500_000,
    cashRevenuePaise: 0,
    upiRevenuePaise: 0,
    zomatoRevenuePaise: 0,
    cashAddedPaise: 0,
    cashAddedReason: null,
    cashRemovedPaise: 0,
    cashRemovedReason: null,
    countedCashPaise: 500_000,
    zomatoCommissionPaise: 0,
    note: null,
    ...overrides,
  }
}

let nextExpenseId = 0
function expense(overrides: Partial<ManualLedgerExpense> = {}): ManualLedgerExpense {
  nextExpenseId += 1
  return {
    id: `expense-${nextExpenseId}`,
    outletId: OUTLET,
    businessDate: '2026-08-01',
    category: 'raw_materials',
    isCash: true,
    amountPaise: 50_000,
    note: 'Chicken from Nadia Poultry',
    source: null,
    occurredAt: null,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    recordedBy: { id: 'person-owner', name: 'Synthetic Owner' },
    updatedBy: null,
    recordedAway: false,
    // Counted unless a test says otherwise, which is what every figure below
    // assumes. Withdrawal is exercised by the tests that set it.
    voidedAt: null,
    voidedBy: null,
    voidedReason: null,
    ...overrides,
  }
}

describe('commission, as an amount rather than a rate', () => {
  it('subtracts what the aggregator actually charged', () => {
    expect(netAggregatorPaise(300_000, 67_500)).toBe(232_500)
  })

  /*
   * The retired version multiplied by basis points, which needed a rounding rule
   * that rounded half up and did so symmetrically about zero so a refunded day
   * still reconciled. Four tests existed to hold that rule in place. An exact
   * commission has nothing to round, so they are gone rather than rewritten.
   *
   * The figures below are one real order: ₹208.00 gross, ₹78.58 charged, ₹129.42
   * paid. Zomato publishes a 14% base service fee for it; the actual take was
   * 37.8%, because the charge is a service fee plus a per-kilometre delivery fee
   * less a capping discount plus a payment fee plus tax on all of it. No single
   * stored percentage could have produced ₹129.42.
   */
  it('reproduces a real order exactly, which no stored rate could', () => {
    expect(netAggregatorPaise(20_800, 7_858)).toBe(12_942)
  })

  it('refuses a float on either side of the subtraction', () => {
    expect(() => netAggregatorPaise(100.5, 2_250)).toThrow(NotPaiseError)
    expect(() => netAggregatorPaise(100, 22.5)).toThrow(NotPaiseError)
  })
})

describe('a day read against its count', () => {
  it('balances when the count matches', () => {
    const reading = readDay(day({ cashRevenuePaise: 1_200_000, countedCashPaise: 1_650_000 }), [
      expense({ amountPaise: 50_000, isCash: true }),
    ])

    expect(reading.expectedCashPaise).toBe(1_650_000)
    expect(reading.differencePaise).toBe(0)
    expect(reading.difference).toBe('balanced')
  })

  it('reports a shortfall as negative, with the word for it', () => {
    const reading = readDay(day({ cashRevenuePaise: 1_200_000, countedCashPaise: 1_675_000 }), [
      expense({ amountPaise: 50_000 }),
    ])

    expect(reading.differencePaise).toBe(25_000)
    expect(reading.difference).toBe('over')

    const short = readDay(day({ cashRevenuePaise: 1_200_000, countedCashPaise: 1_625_000 }), [
      expense({ amountPaise: 50_000 }),
    ])
    expect(short.differencePaise).toBe(-25_000)
    expect(short.difference).toBe('short')
  })

  it('counts cash brought in and cash taken out', () => {
    const reading = readDay(
      day({
        cashRevenuePaise: 1_000_000,
        cashAddedPaise: 100_000,
        cashAddedReason: 'Float topped up',
        cashRemovedPaise: 400_000,
        cashRemovedReason: 'Banked on the way home',
        countedCashPaise: 1_200_000,
      }),
      [],
    )

    // 500,000 + 1,000,000 + 100,000 − 0 − 400,000
    expect(reading.expectedCashPaise).toBe(1_200_000)
    expect(reading.difference).toBe('balanced')
  })

  it('leaves UPI, Zomato, Swiggy and non-cash expenses out of the drawer', () => {
    const reading = readDay(
      day({
        cashRevenuePaise: 1_000_000,
        upiRevenuePaise: 400_000,
        zomatoRevenuePaise: 300_000,
        countedCashPaise: 1_500_000,
      }),
      [expense({ amountPaise: 180_000, isCash: false, category: 'electricity' })],
    )

    expect(reading.expectedCashPaise).toBe(1_500_000)
    expect(reading.difference).toBe('balanced')
    expect(reading.cashExpensesPaise).toBe(0)
    expect(reading.nonCashExpensesPaise).toBe(180_000)
    // The month still knows about all of it.
    expect(reading.grossRevenuePaise).toBe(1_700_000)
  })

  it('accepts a refund as negative cash revenue', () => {
    const reading = readDay(day({ cashRevenuePaise: -25_000, countedCashPaise: 475_000 }), [])

    expect(reading.expectedCashPaise).toBe(475_000)
    expect(reading.difference).toBe('balanced')
  })

  it('keeps a drawer honest when equipment is bought with its cash', () => {
    // The load-bearing half of the no-capital decision (design D8). A ₹40,000
    // fridge is recorded as cash taken out with its reason, NOT as an expense —
    // so the drawer still reconciles and the month's expenses are untouched.
    const fridgeDay = day({
      cashRevenuePaise: 1_000_000,
      cashRemovedPaise: 4_000_000,
      cashRemovedReason: 'Bought the second fridge',
      openingCashPaise: 4_000_000,
      countedCashPaise: 1_000_000,
    })

    const reading = readDay(fridgeDay, [])
    expect(reading.expectedCashPaise).toBe(1_000_000)
    expect(reading.difference).toBe('balanced')

    const month = readMonth([fridgeDay], [])
    expect(month.totalExpensesPaise).toBe(0)
    expect(month.expensesByCategory).toEqual([])
    // Revenue survived intact: a cash movement is not a sale and not a cost.
    expect(month.profit.profitPaise).toBe(1_000_000)
  })

  it('leaves expected cash untouched when a drawer expense is withdrawn', () => {
    const withdrawn = expense({
      amountPaise: 200_000,
      isCash: true,
      voidedAt: '2026-08-01T18:00:00.000Z',
      voidedBy: { id: 'person-biller', name: 'Synthetic Biller Kal' },
      voidedReason: null,
    })
    const standing = expense({ amountPaise: 50_000, isCash: true })

    const reading = readDay(day({ openingCashPaise: 500_000 }), [withdrawn, standing])

    // 5,000 − 500 only. The withdrawn ₹2,000 never leaves the drawer, which is
    // the whole point: a row typed by mistake must not move the count somebody
    // is about to reconcile against.
    expect(reading.expectedCashPaise).toBe(450_000)
    expect(reading.cashExpensesPaise).toBe(50_000)
  })

  it('drops a withdrawn non-cash expense from the day it appears on', () => {
    const reading = readDay(day(), [
      expense({ amountPaise: 180_000, isCash: false, voidedAt: '2026-08-01T18:00:00.000Z' }),
    ])
    expect(reading.nonCashExpensesPaise).toBe(0)
    // And it moved nothing on the cash side either, so the two totals cannot
    // disagree about the same row.
    expect(reading.cashExpensesPaise).toBe(0)
  })
})

describe('the opening-cash chain', () => {
  it('says nothing on an outlet’s first tracked day', () => {
    expect(checkOpeningChain(day(), null)).toEqual({ kind: 'first-day' })
  })

  it('agrees when the opening matches the previous count', () => {
    const first = day({ businessDate: '2026-08-01', countedCashPaise: 480_000 })
    const second = day({ businessDate: '2026-08-02', openingCashPaise: 480_000 })

    expect(checkOpeningChain(second, first)).toEqual({
      kind: 'agrees',
      previousBusinessDate: '2026-08-01',
    })
  })

  it('reports a break without repairing it', () => {
    // Day 1 expected ₹5,000 and held ₹4,800. Opening day 2 at the computed
    // ₹5,000 would make that ₹200 invisible forever while every later day read
    // balanced — which is the compounding error this signal exists to catch.
    const first = day({ businessDate: '2026-08-01', countedCashPaise: 480_000 })
    const second = day({ businessDate: '2026-08-02', openingCashPaise: 500_000 })

    const signal = checkOpeningChain(second, first)

    expect(signal).toEqual({
      kind: 'disagrees',
      previousBusinessDate: '2026-08-01',
      storedOpeningPaise: 500_000,
      previousCountPaise: 480_000,
      gapPaise: 20_000,
    })
    // The stored figure is untouched. Nothing here writes a repair.
    expect(second.openingCashPaise).toBe(500_000)
  })
})

describe('a month read for one outlet', () => {
  /** Three days at visibly different Zomato takes, which is the case that matters. */
  const days: ManualLedgerDayFigures[] = [
    day({
      businessDate: '2026-08-01',
      cashRevenuePaise: 1_200_000,
      upiRevenuePaise: 400_000,
      zomatoRevenuePaise: 300_000,
      zomatoCommissionPaise: 67_500,
      countedCashPaise: 1_650_000,
      swiggySettlement: swiggySettlement(),
    }),
    day({
      businessDate: '2026-08-02',
      cashRevenuePaise: 900_000,
      upiRevenuePaise: 350_000,
      zomatoRevenuePaise: 400_000,
      // A visibly lighter take on this day: 18% where the day before was 22.5%.
      zomatoCommissionPaise: 72_000,
      countedCashPaise: 1_400_000,
      swiggySettlement: swiggySettlement({ revenuePaise: 200_000, commissionPaise: 42_000 }),
    }),
    day({
      businessDate: '2026-08-03',
      cashRevenuePaise: -25_000,
      zomatoRevenuePaise: 0,
      countedCashPaise: 475_000,
    }),
  ]

  const expenses: ManualLedgerExpense[] = [
    expense({ businessDate: '2026-08-01', category: 'raw_materials', amountPaise: 240_000 }),
    expense({
      businessDate: '2026-08-02',
      category: 'raw_materials',
      amountPaise: 180_000,
      note: 'Vegetables from the Kalyani market',
    }),
    expense({
      businessDate: '2026-08-02',
      category: 'electricity',
      amountPaise: 320_000,
      isCash: false,
      note: 'WBSEDCL bill paid by UPI',
    }),
    expense({
      businessDate: '2026-08-03',
      category: 'salaries',
      amountPaise: 900_000,
      note: 'Weekly wages, four staff',
    }),
  ]

  it('nets each aggregator day by that day’s own stored rate', () => {
    const month = readMonth(days, expenses)

    // Zomato: ₹3,000 at 22.5% is ₹675; ₹4,000 at 18% is ₹720.
    expect(month.grossZomatoPaise).toBe(700_000)
    expect(month.netZomatoPaise).toBe(232_500 + 328_000)
    expect(month.zomatoCommissionPaise).toBe(67_500 + 72_000)

    // Swiggy: ₹2,500 and ₹2,000, both at 21%.
    expect(month.grossSwiggyPaise).toBe(350_000)
    expect(month.netSwiggyPaise).toBe(105_000 + 158_000)
  })

  /**
   * One stamp per channel for the month, not one per day and not one shared.
   *
   * The shared version is the tempting one and it is the wrong one: the two
   * channels hold independent sessions, so a Zomato read taken an hour ago
   * would vouch for a Swiggy session that lapsed days back. Stated as an
   * inequality so combining them cannot be reintroduced silently.
   */
  it('reports each channel’s latest confirmation separately', () => {
    const stamped: ManualLedgerDayFigures[] = [
      day({
        businessDate: '2026-08-01',
        zomatoRevenuePaise: 300_000,
        zomatoCommissionPaise: 67_500,
        zomatoSettlement: swiggySettlement({ asOfAt: '2026-08-28T17:53:00.000Z' }),
        swiggySettlement: swiggySettlement({ asOfAt: '2026-08-24T04:10:00.000Z' }),
      }),
      day({
        businessDate: '2026-08-02',
        zomatoRevenuePaise: 400_000,
        zomatoCommissionPaise: 72_000,
        // An older Zomato reading, so the month must take the later of the two
        // rather than the last one it happened to walk.
        zomatoSettlement: swiggySettlement({ asOfAt: '2026-08-26T17:53:00.000Z' }),
        swiggySettlement: swiggySettlement({ asOfAt: '2026-08-22T04:10:00.000Z' }),
      }),
    ]
    const month = readMonth(stamped, [])

    expect(month.zomatoAsOfAt).toBe('2026-08-28T17:53:00.000Z')
    expect(month.swiggyAsOfAt).toBe('2026-08-24T04:10:00.000Z')
    expect(month.swiggyAsOfAt).not.toBe(month.zomatoAsOfAt)
  })

  it('names no confirmation for a month nothing was measured in', () => {
    const month = readMonth([day({ businessDate: '2026-08-01' })], [])

    expect(month.zomatoAsOfAt).toBeNull()
    expect(month.swiggyAsOfAt).toBeNull()
  })

  it('would report a different figure if one rate were applied to the month total', () => {
    const month = readMonth(days, expenses)

    // The bug this design forecloses, stated as an inequality so it cannot be
    // reintroduced by moving the commission out of the per-day loop.
    const oneRateApplied = 700_000 - Math.trunc((700_000 * 2250 + 5000) / 10_000)
    expect(month.netZomatoPaise).not.toBe(oneRateApplied)
  })

  it('sums revenue by channel and takes commission out of revenue, not expenses', () => {
    const month = readMonth(days, expenses)

    expect(month.grossCashPaise).toBe(1_200_000 + 900_000 - 25_000)
    expect(month.grossUpiPaise).toBe(750_000)
    expect(month.netRevenuePaise).toBe(
      month.grossCashPaise + month.grossUpiPaise + month.netZomatoPaise + month.netSwiggyPaise,
    )

    // No category holds commission. Counting it as an expense as well as netting
    // it from revenue is the double-count docs/DATA_MODEL.md warns about.
    const categories = month.expensesByCategory.map((total) => total.category)
    expect(categories).not.toContain('other')
    expect(month.totalExpensesPaise).toBe(240_000 + 180_000 + 320_000 + 900_000)
  })

  it('counts a day nobody counted in the totals but not in the recorded tally', () => {
    // Aggregator figures for a date with no cash count — the "day nobody counted"
    // the sync writes to its own table. It shows and totals, but is not recorded.
    const uncounted: ManualLedgerDayFigures = {
      ...day({
        businessDate: '2026-08-19',
        openingCashPaise: 0,
        zomatoRevenuePaise: 148_500,
        // Provisional: nobody has stated yet what Zomato kept.
        zomatoCommissionPaise: null,
        countedCashPaise: 0,
      }),
      counted: false,
    }

    const month = readMonth([...days, uncounted], expenses)

    // Its Zomato gross totals in as a ceiling, and it lifts the undetermined count.
    expect(month.grossZomatoPaise).toBe(700_000 + 148_500)
    expect(month.undeterminedDays).toBeGreaterThanOrEqual(1)
    // But it is not a day the owner recorded, so the tally is unchanged.
    expect(month.daysRecorded).toBe(days.length)
  })

  it('names its basis and reconciles exactly against its expenses by category', () => {
    const month = readMonth(days, expenses)

    expect(month.profit.basis).toBe('cash')

    // The claim that matters: no expense is silently excluded. If any category or
    // marker were quietly left out, these two would differ by an amount nothing
    // on the screen could account for.
    const summedFromCategories = month.expensesByCategory.reduce(
      (running, total) => running + total.amountPaise,
      0,
    )
    expect(summedFromCategories).toBe(month.totalExpensesPaise)
    expect(month.profit.expensesPaise).toBe(month.totalExpensesPaise)
    expect(month.profit.profitPaise).toBe(month.netRevenuePaise - summedFromCategories)

    // Every line behind a total is kept, so a purchase is identifiable weeks later.
    const rawMaterials = month.expensesByCategory.find(
      (total) => total.category === 'raw_materials',
    )
    expect(rawMaterials?.lines.map((line) => line.note)).toEqual([
      'Chicken from Nadia Poultry',
      'Vegetables from the Kalyani market',
    ])
  })

  it('pins a historical month’s totals, so the aggregator freeze cannot move them', () => {
    // The carried concern from #42: a month already looked at must read the same
    // after the figures moved to their own table. These are the exact paise this
    // fixture has always produced, pinned as bare numbers so any change that
    // shifts the arithmetic fails here by name rather than somewhere downstream.
    const month = readMonth(days, expenses)

    expect(month.grossCashPaise).toBe(2_075_000)
    expect(month.grossUpiPaise).toBe(750_000)
    expect(month.grossZomatoPaise).toBe(700_000)
    expect(month.grossSwiggyPaise).toBe(350_000)
    expect(month.netZomatoPaise).toBe(560_500)
    expect(month.netSwiggyPaise).toBe(263_000)
    expect(month.netRevenuePaise).toBe(3_648_500)
    expect(month.totalExpensesPaise).toBe(1_640_000)
    expect(month.profit.profitPaise).toBe(2_008_500)
    expect(month.undeterminedDays).toBe(0)
  })

  it('groups category spellings that differ only by case or spacing', () => {
    const month = readMonth(days, [
      expense({ category: ' Chicken ', amountPaise: 240_000 }),
      expense({ category: 'chicken', amountPaise: 180_000 }),
      expense({ category: 'CHICKEN  ', amountPaise: 80_000 }),
    ])

    expect(month.expensesByCategory).toHaveLength(1)
    expect(month.expensesByCategory[0]).toMatchObject({
      category: 'Chicken',
      amountPaise: 500_000,
    })
  })

  it('separates what left the drawer from what was merely spent', () => {
    const month = readMonth(days, expenses)

    expect(month.cashExpensesPaise).toBe(240_000 + 180_000 + 900_000)
    expect(month.totalExpensesPaise - month.cashExpensesPaise).toBe(320_000)
  })

  it('tells an unrecorded month apart from a recorded zero', () => {
    const nothing = readMonth([], [])
    expect(nothing.recorded).toBe(false)
    expect(nothing.daysRecorded).toBe(0)
    expect(nothing.profit.profitPaise).toBe(0)

    // A day genuinely recorded with nothing on it is a measurement, and the
    // surface must not present it in the same words as an empty month.
    const measuredZero = readMonth([day({ countedCashPaise: 500_000 })], [])
    expect(measuredZero.recorded).toBe(true)
    expect(measuredZero.daysRecorded).toBe(1)
    expect(measuredZero.profit.profitPaise).toBe(0)
  })

  it('excludes a withdrawn expense from every figure, breakdown included', () => {
    const days = [day({ businessDate: '2026-08-01', cashRevenuePaise: 1_000_000 })]
    const kept = expense({ businessDate: '2026-08-01', category: 'Gas', amountPaise: 190_000 })
    const withdrawn = expense({
      businessDate: '2026-08-01',
      category: 'Gas',
      amountPaise: 190_000,
      voidedAt: '2026-08-01T19:00:00.000Z',
      voidedBy: { id: 'person-owner', name: 'Synthetic Owner' },
    })

    const month = readMonth(days, [kept, withdrawn])

    expect(month.totalExpensesPaise).toBe(190_000)
    expect(month.cashExpensesPaise).toBe(190_000)
    // The breakdown has to agree with the total, or the profit figure reconciles
    // against a list that contradicts it — the exact failure grouping every row
    // exists to prevent.
    expect(month.expensesByCategory).toEqual([
      {
        category: 'Gas',
        amountPaise: 190_000,
        lines: [expect.objectContaining({ amountPaise: 190_000 })],
      },
    ])
    expect(month.profit.profitPaise).toBe(810_000)
  })

  it('still calls a month recorded when its only expense was withdrawn', () => {
    // Somebody wrote in this month and then took it back. Reporting it as never
    // measured would be a different claim from reporting it as nil, and the
    // surface says different words for each.
    const month = readMonth(
      [],
      [expense({ voidedAt: '2026-08-01T19:00:00.000Z', voidedBy: { id: 'x', name: 'X' } })],
    )
    expect(month.recorded).toBe(true)
    expect(month.totalExpensesPaise).toBe(0)
    expect(month.expensesByCategory).toEqual([])
  })
})

describe('month naming', () => {
  it('reads the month off a business date', () => {
    expect(monthOf('2026-08-04')).toBe('2026-08')
  })

  it('covers the whole month, February in a leap year included', () => {
    expect(monthRange('2026-08')).toEqual({ from: '2026-08-01', to: '2026-08-31' })
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
  })

  it('refuses a month it cannot read', () => {
    expect(() => monthRange('2026-13')).toThrow(RangeError)
    expect(() => monthRange('nonsense')).toThrow(RangeError)
  })
})

// ─── Swiggy joins the day ─────────────────────────────────────────────────────

import { readSwiggy } from './ledger'
import type { ChannelSettlement } from '@/data-access/adapters'

function swiggySettlement(overrides: Partial<ChannelSettlement> = {}): ChannelSettlement {
  return {
    revenuePaise: 150_000,
    commissionPaise: 45_000,
    state: 'settled',
    origin: 'settlement',
    supersededTyped: null,
    revisedFrom: null,
    revisedAt: null,
    asOfAt: '2026-08-28T17:53:00.000Z',
    ...overrides,
  }
}

describe('the Swiggy reading of a day', () => {
  it('lets a measured settlement stand over a legacy typed figure', () => {
    const reading = readSwiggy({
      ...day(),
      swiggySettlement: swiggySettlement(),
    })

    // The portal's own numbers, not the memory typed into the row.
    expect(reading.grossPaise).toBe(150_000)
    expect(reading.commissionPaise).toBe(45_000)
    expect(reading.netPaise).toBe(105_000)
    expect(reading.settlement?.state).toBe('settled')
  })

  it('reads not yet measured where no settlement exists', () => {
    const reading = readSwiggy(day())

    // Typed Swiggy money no longer exists in the contract; an uncovered day
    // states that it has not been measured rather than inventing a zero.
    expect(reading.grossPaise).toBe(0)
    expect(reading.commissionPaise).toBeNull()
    expect(reading.netPaise).toBe(0)
    expect(reading.settlement).toBeNull()
  })

  it('keeps a negative measured net rather than flattering it away', () => {
    const reading = readSwiggy({
      ...day(),
      swiggySettlement: swiggySettlement({ revenuePaise: -2_23, commissionPaise: null }),
    })

    // A cycle whose deductions outran its orders had a day the shop paid to
    // trade. Zero would be a lie in the direction that flatters the shop.
    expect(reading.grossPaise).toBe(-2_23)
    expect(reading.commissionPaise).toBeNull()
    expect(reading.netPaise).toBeNull()
  })

  it('totals the month from the measured reading, negative nets included', () => {
    const measured = {
      ...day(),
      swiggySettlement: swiggySettlement({ revenuePaise: -223, commissionPaise: 0 }),
    }
    const month = readMonth([measured], [])

    expect(month.grossSwiggyPaise).toBe(-223)
    // Commission known (nought), so the net is exact and equally negative.
    expect(month.netSwiggyPaise).toBe(-223)
    expect(month.undeterminedDays).toBe(0)
  })
})
