import { describe, expect, it } from 'vitest'

import { readMonth, type MonthChannelDay, type MonthDayInput } from './ledger-month'
import { NotPaiseError } from './money'

/** A settled channel day: commission stated, so it contributes its net. */
function settled(channel: string, grossPaise: number, commissionPaise: number): MonthChannelDay {
  return {
    channel,
    grossPaise,
    commissionPaise,
    netPaise: grossPaise - commissionPaise,
    asOfAt: '2026-08-10T00:00:00.000Z',
  }
}

/** An unsettled channel day: commission not known yet, so it is a ceiling. */
function waiting(
  channel: string,
  grossPaise: number,
  asOfAt: string | null = null,
): MonthChannelDay {
  return { channel, grossPaise, commissionPaise: null, netPaise: null, asOfAt }
}

function day(businessDate: string, over: Partial<MonthDayInput> = {}): MonthDayInput {
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

describe('readMonth — the ceiling', () => {
  it('nets each day at its OWN rate, so a mid-month change is right on both sides', () => {
    // 20% for the first half, renegotiated to 10% for the second. Netting once
    // at either rate over the whole month gives 160000 or 180000; per day gives
    // 170000. This is the test that fails if the netting leaves the loop.
    const reading = readMonth([
      day('2026-08-01', { channels: [settled('zomato', 100000, 20000)] }),
      day('2026-08-20', { channels: [settled('zomato', 100000, 10000)] }),
    ])

    const zomato = reading.channels.find((c) => c.channel === 'zomato')
    expect(zomato?.grossPaise).toBe(200000)
    expect(zomato?.netPaise).toBe(170000)
    expect(zomato?.commissionPaise).toBe(30000)
  })

  it('lets an undetermined day contribute its GROSS, not nothing', () => {
    // The alternative — skipping the day — reports a month smaller than the
    // shop earned. 100000 net + 100000 gross = 200000, not 100000.
    const reading = readMonth([
      day('2026-08-01', { channels: [settled('swiggy', 120000, 20000)] }),
      day('2026-08-02', { channels: [waiting('swiggy', 100000)] }),
    ])

    const swiggy = reading.channels.find((c) => c.channel === 'swiggy')
    expect(swiggy?.grossPaise).toBe(220000)
    expect(swiggy?.netPaise).toBe(200000)
    expect(swiggy?.undeterminedDays).toBe(1)
  })

  it('derives the commission from gross less net, so the three figures always add up', () => {
    // The discriminating case, and it is a real one: the adapter prefers a
    // STORED net over `gross - commission`, and settlement can leave the two
    // disagreeing by a rounding adjustment. Here the stated commission is 20000
    // but the net Zomato actually paid is 99000, not 100000.
    //
    // Accumulating the commission separately would put 20000 on screen beside a
    // gross of 120000 and a net of 99000 — three numbers that do not reconcile,
    // and a reader who subtracts two of them gets a third answer. Deriving it
    // means what is shown always adds up.
    const reading = readMonth([
      day('2026-08-01', {
        channels: [
          {
            channel: 'zomato',
            grossPaise: 120000,
            commissionPaise: 20000,
            netPaise: 99000,
            asOfAt: null,
          },
        ],
      }),
      day('2026-08-02', { channels: [waiting('zomato', 500000)] }),
    ])

    const zomato = reading.channels.find((c) => c.channel === 'zomato')
    expect(zomato?.grossPaise).toBe(620000)
    expect(zomato?.netPaise).toBe(599000)
    // 21000, not the 20000 a separate accumulator would have reported.
    expect(zomato?.commissionPaise).toBe(21000)
    expect(zomato?.commissionPaise).toBe(zomato!.grossPaise - zomato!.netPaise)
  })

  it('counts a date as undetermined once, however many of its channels are waiting', () => {
    const reading = readMonth([
      day('2026-08-01', { channels: [waiting('zomato', 1000), waiting('swiggy', 2000)] }),
    ])

    expect(reading.undeterminedDays).toBe(1)
  })

  it('counts the DATES still waiting, not a boolean', () => {
    const three = readMonth([
      day('2026-08-01', { channels: [waiting('zomato', 1000)] }),
      day('2026-08-02', { channels: [waiting('zomato', 1000)] }),
      day('2026-08-03', { channels: [waiting('zomato', 1000)] }),
      day('2026-08-04', { channels: [settled('zomato', 1000, 100)] }),
    ])

    expect(three.undeterminedDays).toBe(3)
  })

  it('states no ceiling at all when every day is settled', () => {
    const reading = readMonth([
      day('2026-08-01', { channels: [settled('zomato', 100000, 20000)] }),
      day('2026-08-02', { channels: [settled('swiggy', 50000, 5000)] }),
    ])

    expect(reading.undeterminedDays).toBe(0)
    expect(reading.netRevenuePaise).toBe(80000 + 45000)
  })

  it('carries the LATEST as-of instant per channel, comparing strings', () => {
    const reading = readMonth([
      day('2026-08-01', { channels: [waiting('zomato', 1000, '2026-08-01T10:00:00.000Z')] }),
      day('2026-08-02', { channels: [waiting('zomato', 1000, '2026-08-09T10:00:00.000Z')] }),
      day('2026-08-03', { channels: [waiting('zomato', 1000, '2026-08-05T10:00:00.000Z')] }),
    ])

    expect(reading.channels[0]?.asOfAt).toBe('2026-08-09T10:00:00.000Z')
  })

  it('accumulates a third channel without being taught about it', () => {
    const reading = readMonth([day('2026-08-01', { channels: [settled('magicpin', 40000, 4000)] })])

    expect(reading.channels.map((c) => c.channel)).toEqual(['magicpin'])
    expect(reading.channels[0]?.netPaise).toBe(36000)
  })
})

describe('readMonth — dates with no sales', () => {
  it('names the dates nothing was rung up on, and still reports the aggregate', () => {
    const reading = readMonth([
      day('2026-08-01'),
      day('2026-08-02'),
      day('2026-08-03', { cashPaise: 50000 }),
    ])

    expect(reading.datesWithoutSales).toEqual(['2026-08-01', '2026-08-02'])
    expect(reading.daysWithSales).toBe(1)
    expect(reading.netRevenuePaise).toBe(50000)
  })

  it('does not count a date as saleless when only an aggregator sold', () => {
    const reading = readMonth([day('2026-08-01', { channels: [settled('zomato', 30000, 3000)] })])

    expect(reading.datesWithoutSales).toEqual([])
  })

  it('does not count a date as saleless when an undetermined channel sold', () => {
    // Its net is null, but its GROSS is not nought, so trade happened.
    const reading = readMonth([day('2026-08-01', { channels: [waiting('zomato', 30000)] })])

    expect(reading.datesWithoutSales).toEqual([])
    expect(reading.daysWithSales).toBe(1)
  })

  it('offers NO profit figure when no date in the month carries a sale', () => {
    // Expenses are real and still reported; the profit is not a smaller number,
    // it is not a number. Rendering -40000 here would invent a loss.
    const reading = readMonth([
      day('2026-08-01', {
        expenses: [
          {
            businessDate: '2026-08-01',
            category: 'Gas',
            note: null,
            amountPaise: 40000,
            isCash: true,
          },
        ],
      }),
      day('2026-08-02'),
    ])

    expect(reading.profitPaise).toBeNull()
    expect(reading.totalExpensesPaise).toBe(40000)
    expect(reading.daysWithSales).toBe(0)
  })

  it('still offers a profit figure when only SOME dates are saleless', () => {
    const reading = readMonth([
      day('2026-08-01', {
        expenses: [
          {
            businessDate: '2026-08-01',
            category: 'Gas',
            note: null,
            amountPaise: 40000,
            isCash: true,
          },
        ],
      }),
      day('2026-08-02', { cashPaise: 100000 }),
    ])

    expect(reading.profitPaise).toBe(60000)
    expect(reading.datesWithoutSales).toEqual(['2026-08-01'])
  })
})

describe('readMonth — expenses', () => {
  const lines = [
    { businessDate: '2026-08-01', category: 'Gas', note: null, amountPaise: 40000, isCash: true },
    {
      businessDate: '2026-08-02',
      category: 'Chicken',
      note: '12 kg',
      amountPaise: 300000,
      isCash: true,
    },
    { businessDate: '2026-08-03', category: 'Gas', note: null, amountPaise: 20000, isCash: false },
  ]

  it('groups by category, heaviest first, keeping every line', () => {
    const reading = readMonth([
      day('2026-08-01', { cashPaise: 1, expenses: [lines[0]!] }),
      day('2026-08-02', { cashPaise: 1, expenses: [lines[1]!] }),
      day('2026-08-03', { cashPaise: 1, expenses: [lines[2]!] }),
    ])

    expect(reading.expensesByCategory.map((c) => c.category)).toEqual(['Chicken', 'Gas'])
    expect(reading.expensesByCategory[1]?.amountPaise).toBe(60000)
    expect(reading.expensesByCategory[1]?.lines).toHaveLength(2)
  })

  it('separates what came out of the drawer from everything spent', () => {
    const reading = readMonth([day('2026-08-01', { cashPaise: 1, expenses: lines })])

    expect(reading.totalExpensesPaise).toBe(360000)
    expect(reading.cashExpensesPaise).toBe(340000)
  })
})

describe('readMonth — the drawer tally', () => {
  it('counts counted and carried separately, and neither for a date not tracked yet', () => {
    const reading = readMonth([
      day('2026-08-01', { drawerState: 'not-tracked-yet' }),
      day('2026-08-02', { drawerState: 'counted' }),
      day('2026-08-03', { drawerState: 'counted' }),
      day('2026-08-04', { drawerState: 'carried' }),
    ])

    expect(reading.countedDays).toBe(2)
    expect(reading.carriedDays).toBe(1)
    expect(reading.notTrackedDays).toBe(1)
  })
})

describe('readMonth — integer paise', () => {
  it('throws rather than rounding a fractional revenue', () => {
    expect(() => readMonth([day('2026-08-01', { cashPaise: 100.5 })])).toThrow(NotPaiseError)
  })

  it('throws rather than rounding a fractional channel gross', () => {
    expect(() => readMonth([day('2026-08-01', { channels: [waiting('zomato', 100.5)] })])).toThrow(
      NotPaiseError,
    )
  })

  it('throws rather than rounding a fractional expense', () => {
    expect(() =>
      readMonth([
        day('2026-08-01', {
          expenses: [
            {
              businessDate: '2026-08-01',
              category: 'Gas',
              note: null,
              amountPaise: 40000.25,
              isCash: true,
            },
          ],
        }),
      ]),
    ).toThrow(NotPaiseError)
  })
})

describe('readMonth — a month still in progress', () => {
  const september = [
    day('2026-09-01', { cashPaise: 500000, drawerState: 'counted' }),
    day('2026-09-02'),
    day('2026-09-03'),
    day('2026-09-30'),
  ]

  it('does not report dates that have not happened as dates with no sales', () => {
    // The defect this pins, found by opening the built screen on 1 September:
    // an unbounded fold called 29 future dates "dates with no sales" and 30
    // future dates "carried", which reads as a sales collapse and a drawer
    // failure in a month that is one day old.
    const reading = readMonth(september, { throughBusinessDate: '2026-09-01' })

    expect(reading.datesWithoutSales).toEqual([])
    expect(reading.daysWithSales).toBe(1)
  })

  it('does not count a date that has not happened as carried', () => {
    const reading = readMonth(september, { throughBusinessDate: '2026-09-01' })

    expect(reading.countedDays).toBe(1)
    expect(reading.carriedDays).toBe(0)
  })

  it('includes a date once it arrives', () => {
    const reading = readMonth(september, { throughBusinessDate: '2026-09-03' })

    expect(reading.datesWithoutSales).toEqual(['2026-09-02', '2026-09-03'])
    expect(reading.daysWithSales).toBe(1)
  })

  it('changes no money, only the counts', () => {
    const bounded = readMonth(september, { throughBusinessDate: '2026-09-01' })
    const whole = readMonth(september)

    expect(bounded.netRevenuePaise).toBe(whole.netRevenuePaise)
    expect(bounded.totalExpensesPaise).toBe(whole.totalExpensesPaise)
    expect(bounded.profitPaise).toBe(whole.profitPaise)
  })

  it('reads a past month whole when no bound is given', () => {
    const reading = readMonth(september)

    expect(reading.datesWithoutSales).toHaveLength(3)
  })
})

describe('readMonth — a channel that reported nothing', () => {
  it('still emits an expected channel that produced no rows at all', () => {
    // The bug this pins: with the channel discovered only from the rows, a
    // broken sync produces no rows, the channel vanishes from the breakdown,
    // and the revenue total reads as complete when it is not.
    const reading = readMonth([day('2026-08-01', { cashPaise: 50000 })], {
      expectedChannels: ['zomato', 'swiggy'],
    })

    expect(reading.channels.map((c) => c.channel)).toEqual(['swiggy', 'zomato'])
    expect(reading.channels.every((c) => c.reportedDays === 0)).toBe(true)
  })

  it('counts the dates a channel actually reported on', () => {
    const reading = readMonth(
      [
        day('2026-08-01', { channels: [settled('zomato', 10000, 1000)] }),
        day('2026-08-02', { channels: [settled('zomato', 10000, 1000)] }),
        day('2026-08-03', { cashPaise: 1 }),
      ],
      { expectedChannels: ['zomato', 'swiggy'] },
    )

    const zomato = reading.channels.find((c) => c.channel === 'zomato')
    const swiggy = reading.channels.find((c) => c.channel === 'swiggy')
    expect(zomato?.reportedDays).toBe(2)
    expect(swiggy?.reportedDays).toBe(0)
  })

  it('adds nothing to the revenue for a channel that reported nothing', () => {
    const reading = readMonth([day('2026-08-01', { cashPaise: 50000 })], {
      expectedChannels: ['zomato', 'swiggy'],
    })

    expect(reading.netRevenuePaise).toBe(50000)
  })

  it('still discovers a channel nobody expected', () => {
    const reading = readMonth(
      [day('2026-08-01', { channels: [settled('magicpin', 40000, 4000)] })],
      {
        expectedChannels: ['zomato'],
      },
    )

    expect(reading.channels.map((c) => c.channel)).toEqual(['magicpin', 'zomato'])
    expect(reading.channels.find((c) => c.channel === 'magicpin')?.reportedDays).toBe(1)
  })
})

describe('readMonth — which channels the month shows', () => {
  it('omits a channel the outlet does not trade on and never reported revenue for', () => {
    // Kanchrapara does not sell on Swiggy [owner, 2026-09-01], and the sync
    // writes it a month of ₹0 rows anyway. Three nought rows on the screen every
    // month is wrong, and so is an alarm about a channel nobody expected.
    const reading = readMonth(
      [
        day('2026-08-01', {
          cashPaise: 50000,
          channels: [settled('zomato', 100000, 20000), settled('swiggy', 0, 0)],
        }),
      ],
      { expectedChannels: ['zomato'] },
    )

    expect(reading.channels.map((c) => c.channel)).toEqual(['zomato'])
  })

  it('shows an unexpected channel the moment it reports real money', () => {
    // Money is never hidden because a mapping is missing.
    const reading = readMonth([day('2026-08-01', { channels: [settled('swiggy', 30000, 3000)] })], {
      expectedChannels: ['zomato'],
    })

    expect(reading.channels.map((c) => c.channel)).toEqual(['swiggy', 'zomato'])
    expect(reading.channels.find((c) => c.channel === 'swiggy')?.netPaise).toBe(27000)
  })

  it('still counts a hidden channel toward the revenue total', () => {
    // Hiding a channel and losing its revenue must not be the same edit. A ₹0
    // channel adds nothing, which is why this asserts the total rather than the
    // list: the total is read over every channel that reported.
    const reading = readMonth(
      [
        day('2026-08-01', {
          cashPaise: 50000,
          channels: [settled('swiggy', 0, 0)],
        }),
      ],
      { expectedChannels: ['zomato'] },
    )

    expect(reading.channels.map((c) => c.channel)).toEqual(['zomato'])
    expect(reading.netRevenuePaise).toBe(50000)
  })

  it('still raises the alarm for an expected channel that reported nothing', () => {
    const reading = readMonth([day('2026-08-01', { cashPaise: 50000 })], {
      expectedChannels: ['zomato', 'swiggy'],
    })

    expect(reading.channels.every((c) => c.reportedDays === 0)).toBe(true)
    expect(reading.channels).toHaveLength(2)
  })
})
