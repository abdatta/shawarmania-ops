import { describe, expect, it } from 'vitest'

import { readMonth, type MonthDayInput } from './ledger-month'
import {
  commissionOf,
  comparisonWindow,
  cutInstant,
  monthToDate,
  readMonthFigures,
  windowsFor,
} from './revenue-figures'

describe('monthToDate', () => {
  it('runs from the 1st through today', () => {
    expect(monthToDate('2026-10-15')).toEqual({
      month: '2026-10',
      from: '2026-10-01',
      through: '2026-10-15',
    })
  })

  it('is just today on the 1st', () => {
    expect(monthToDate('2026-10-01')).toEqual({
      month: '2026-10',
      from: '2026-10-01',
      through: '2026-10-01',
    })
  })
})

describe('comparisonWindow', () => {
  it('is the same dates last month, cut on the matched date, when the window ends today', () => {
    expect(comparisonWindow('2026-10-01', '2026-10-15', '2026-10-15')).toEqual({
      from: '2026-09-01',
      through: '2026-09-15',
      cut: true,
    })
  })

  it('is the whole shorter month, uncut, when the matched date is clamped', () => {
    expect(comparisonWindow('2026-10-01', '2026-10-31', '2026-10-31')).toEqual({
      from: '2026-09-01',
      through: '2026-09-30',
      cut: false,
    })
    expect(comparisonWindow('2026-03-01', '2026-03-30', '2026-03-30')).toEqual({
      from: '2026-02-01',
      through: '2026-02-28',
      cut: false,
    })
  })

  it('compares the 1st with last month’s 1st, cut', () => {
    expect(comparisonWindow('2026-10-01', '2026-10-01', '2026-10-01')).toEqual({
      from: '2026-09-01',
      through: '2026-09-01',
      cut: true,
    })
  })

  it('compares a whole past month with the whole month before, uncut', () => {
    expect(comparisonWindow('2026-09-01', '2026-09-30', '2026-10-15')).toEqual({
      from: '2026-08-01',
      through: '2026-08-31',
      cut: false,
    })
    expect(comparisonWindow('2026-02-01', '2026-02-28', '2026-10-15')).toEqual({
      from: '2026-01-01',
      through: '2026-01-31',
      cut: false,
    })
  })

  it('crosses a year', () => {
    expect(comparisonWindow('2027-01-01', '2027-01-09', '2027-01-09')).toEqual({
      from: '2026-12-01',
      through: '2026-12-09',
      cut: true,
    })
  })
})

describe('windowsFor', () => {
  it('reproduces equal adjacent windows', () => {
    expect(windowsFor('2026-10-09', '2026-10-15', 3, 'equal', '2026-10-15')).toEqual([
      { first: '2026-10-09', last: '2026-10-15', cut: false },
      { first: '2026-10-02', last: '2026-10-08', cut: true },
      { first: '2026-09-25', last: '2026-10-01', cut: true },
    ])
  })

  it('aligns month windows by day of the month', () => {
    expect(windowsFor('2026-10-01', '2026-10-15', 3, 'month', '2026-10-15')).toEqual([
      { first: '2026-10-01', last: '2026-10-15', cut: false },
      { first: '2026-09-01', last: '2026-09-15', cut: true },
      { first: '2026-08-01', last: '2026-08-15', cut: true },
    ])
  })

  it('cuts nothing when the window does not end today', () => {
    expect(windowsFor('2026-10-02', '2026-10-08', 2, 'equal', '2026-10-15')).toEqual([
      { first: '2026-10-02', last: '2026-10-08', cut: false },
      { first: '2026-09-25', last: '2026-10-01', cut: false },
    ])
  })
})

describe('cutInstant', () => {
  it('is the same time of day on the matched date', () => {
    // 15:40 Kolkata on 15 October; the day changes at 04:00.
    const now = Date.parse('2026-10-15T15:40:00+05:30')
    expect(cutInstant('2026-09-15', '2026-10-15', now, '04:00')).toBe(
      new Date('2026-09-15T15:40:00+05:30').toISOString(),
    )
  })

  it('lands after midnight on the matched business date', () => {
    // 02:30 on 16 October is still business date 15 October.
    const now = Date.parse('2026-10-16T02:30:00+05:30')
    expect(cutInstant('2026-10-14', '2026-10-15', now, '04:00')).toBe(
      new Date('2026-10-15T02:30:00+05:30').toISOString(),
    )
  })
})

function day(
  businessDate: string,
  over: Partial<MonthDayInput> & { channels?: MonthDayInput['channels'] } = {},
): MonthDayInput {
  return {
    businessDate,
    cashPaise: 0,
    upiPaise: 0,
    discountPaise: 0,
    channels: [],
    expenses: [],
    drawerState: 'counted',
    ...over,
  }
}

const zomato = (grossPaise: number, netPaise: number | null) => ({
  channel: 'zomato',
  grossPaise,
  commissionPaise: netPaise === null ? null : grossPaise - netPaise,
  netPaise,
  asOfAt: null,
})

describe('commissionOf', () => {
  it('is what the platform kept, once stated', () => {
    expect(commissionOf(zomato(200_000, 140_000))).toBe(60_000)
  })

  it('is the whole charge on a day with no orders', () => {
    expect(commissionOf(zomato(0, -61_107))).toBe(61_107)
  })

  it('is unknown until stated', () => {
    expect(commissionOf(zomato(50_000, null))).toBeNull()
  })
})

describe('readMonthFigures', () => {
  const days = [
    day('2026-10-01', {
      cashPaise: 100_000,
      upiPaise: 50_000,
      channels: [zomato(0, -61_107)],
      expenses: [
        {
          businessDate: '2026-10-01',
          category: 'Groceries',
          note: null,
          amountPaise: 20_000,
          isCash: true,
        },
      ],
    }),
    day('2026-10-02', { cashPaise: 80_000, channels: [zomato(200_000, 140_000)] }),
    day('2026-10-03', { upiPaise: 30_000, channels: [zomato(50_000, null)] }),
  ]
  const reading = readMonth(days, { expectedChannels: ['zomato'] })
  const figures = readMonthFigures(days, reading)

  it('counts delivery before commission in revenue', () => {
    expect(figures.revenuePaise).toBe(100_000 + 50_000 + 80_000 + 30_000 + 0 + 200_000 + 50_000)
    expect(figures.deliveryPaise).toBe(250_000)
  })

  it('adds stated commission to expenses, per day, and waits for the rest', () => {
    expect(figures.commissionPaise).toBe(61_107 + 60_000)
    expect(figures.waitingDays).toBe(1)
    expect(figures.expensesPaise).toBe(20_000 + 61_107 + 60_000)
  })

  it('leaves profit exactly where the earlier basis put it', () => {
    expect(figures.profitPaise).toBe(reading.profitPaise)
  })

  it('lists commission as a category of dated lines, sorted with the others', () => {
    const [first, second] = figures.expensesByCategory
    expect(first!.category).toBe('Delivery commission')
    expect(first!.amountPaise).toBe(121_107)
    expect(first!.lines).toEqual([
      {
        businessDate: '2026-10-01',
        category: 'Delivery commission',
        note: 'Zomato',
        amountPaise: 61_107,
        isCash: false,
      },
      {
        businessDate: '2026-10-02',
        category: 'Delivery commission',
        note: 'Zomato',
        amountPaise: 60_000,
        isCash: false,
      },
    ])
    expect(second!.category).toBe('Groceries')
  })

  it('offers no profit for a month nobody sold in', () => {
    const empty = [day('2026-10-01')]
    expect(readMonthFigures(empty, readMonth(empty)).profitPaise).toBeNull()
  })

  it('refuses a non-integer amount', () => {
    const broken = [day('2026-10-01', { channels: [zomato(100.5, 50)] })]
    expect(() => readMonthFigures(broken, { ...reading, profitPaise: 0 })).toThrow()
  })
})
