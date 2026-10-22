import { describe, expect, it } from 'vitest'

import cases from './fixed-cost-cases.json'
import {
  addMonths,
  balance,
  balanceState,
  coverage,
  aheadOfCoveringPaise,
  coveredPercent,
  dailySpreadPaise,
  fixedCostLabel,
  monthCost,
  payEffect,
  payOwed,
  payPrompt,
  showsInApplies,
  showsInDefault,
  proRataPnl,
  readProRata,
  thisMonthStatus,
  unpaidEndedMonths,
  type FixedCostCategory,
  type FixedCostFacts,
  type FixedCostPayment,
} from './fixed-costs'
import { NotPaiseError } from './money'

let serial = 0

function payment(amountPaise: number, countsIn: string, paidOn = countsIn): FixedCostPayment {
  serial += 1
  return {
    id: `p${serial}`,
    expenseId: `e${serial}`,
    amountPaise,
    countsIn,
    paidOn,
    isCash: false,
    note: null,
    createdAt: `${countsIn}T10:00:${String(serial % 60).padStart(2, '0')}Z`,
  }
}

function salary(
  over: Partial<FixedCostFacts> & { monthlyPaise?: number; category?: FixedCostCategory } = {},
): FixedCostFacts {
  const { monthlyPaise = 1_000_000, ...rest } = over
  return {
    id: 'f1',
    name: 'Nayan',
    category: 'salary',
    note: null,
    startsOn: '2026-10-01',
    stopsOn: null,
    amounts: [
      { fromMonth: '2026-10-01', amountPaise: monthlyPaise, createdAt: '2026-10-01T00:00:00Z' },
    ],
    settlements: [],
    payments: [],
    ...rest,
  }
}

describe('monthCost, held to the shared cases', () => {
  for (const c of cases.monthCost)
    it(c.name, () => {
      const cost = salary({
        startsOn: c.startsOn,
        stopsOn: c.stopsOn,
        amounts: c.amounts.map((a, i) => ({ ...a, createdAt: `2026-01-01T00:00:0${i}Z` })),
        settlements: c.settlements.map((s, i) => ({
          id: `s${i}`,
          month: s.month,
          amountPaise: s.amountPaise,
          createdAt: `2026-12-01T00:00:0${i}Z`,
          voidedAt: s.voided ? '2026-12-02T00:00:00Z' : null,
        })),
      })
      expect(monthCost(cost, c.month)).toBe(c.costPaise)
    })

  it('rejects an amount that is not integer paise', () => {
    const cost = salary({
      amounts: [{ fromMonth: '2026-10-01', amountPaise: 10.5, createdAt: 'x' }],
    })
    expect(() => monthCost(cost, '2026-10-01')).toThrow(NotPaiseError)
  })
})

describe('the balance runs across months', () => {
  it('an advance of 15,000 against 10,000 is paid ahead by 5,000, then owes 5,000 in November', () => {
    const cost = salary({ payments: [payment(1_500_000, '2026-10-15')] })
    expect(balanceState(balance(cost, '2026-10-01'))).toEqual({ kind: 'ahead', paise: 500_000 })
    expect(balanceState(balance(cost, '2026-11-01'))).toEqual({ kind: 'to-pay', paise: 500_000 })
  })

  it('30,000 paid in October covers three months', () => {
    const cost = salary({ payments: [payment(3_000_000, '2026-10-05')] })
    const fifo = coverage(cost, '2026-12-01')
    expect(fifo.months.map((m) => m.coveredPaise)).toEqual([1_000_000, 1_000_000, 1_000_000])
    expect(balanceState(balance(cost, '2026-12-01')).kind).toBe('clear')
    expect(balanceState(balance(cost, '2027-01-01'))).toEqual({ kind: 'to-pay', paise: 1_000_000 })
  })

  it('a withdrawn payment leaves the balance: it is simply not among the effective payments', () => {
    const paid = salary({ payments: [payment(1_000_000, '2026-10-31')] })
    const withdrawn = salary({ payments: [] })
    expect(balance(paid, '2026-10-01')).toBe(0)
    expect(balance(withdrawn, '2026-10-01')).toBe(1_000_000)
  })

  it('names a month unpaid only once it has ended', () => {
    const cost = salary({ payments: [payment(800_000, '2026-10-20')] })
    expect(unpaidEndedMonths(cost, '2026-10-31')).toEqual([])
    expect(unpaidEndedMonths(cost, '2026-11-01')).toEqual([
      { month: '2026-10-01', costPaise: 1_000_000, coveredPaise: 800_000 },
    ])
  })

  it('a payment counted in October on 2 November clears October', () => {
    const cost = salary({ payments: [payment(1_000_000, '2026-10-31', '2026-11-02')] })
    expect(unpaidEndedMonths(cost, '2026-11-02')).toEqual([])
  })
})

describe('what a payment is compared with', () => {
  it('owes last month first, then what is left of this one', () => {
    const owed = payOwed(salary(), '2026-11-02')
    expect(owed).toEqual({
      overduePaise: 1_000_000,
      overdueMonths: ['2026-10-01'],
      thisMonthPaise: 1_000_000,
      suggestedPaise: 1_000_000,
    })
  })

  it('suggests this month when nothing earlier is owed', () => {
    const cost = salary({ payments: [payment(400_000, '2026-10-10')] })
    expect(payOwed(cost, '2026-10-19').suggestedPaise).toBe(600_000)
  })
})

describe('what the pay sheet asks', () => {
  it('asks nothing for last month in full', () => {
    expect(payPrompt(salary(), 1_000_000, '2026-11-02')).toEqual({ kind: 'none' })
  })

  it('names the month a payment leaves short, ended or this one, with what it settles at', () => {
    expect(payPrompt(salary(), 800_000, '2026-11-02')).toEqual({
      kind: 'short',
      month: '2026-10-01',
      restPaise: 200_000,
      settledAtPaise: 800_000,
      choices: ['settle', 'cut'],
    })
    expect(payPrompt(salary(), 1_400_000, '2026-11-02')).toMatchObject({
      kind: 'short',
      month: '2026-11-01',
      restPaise: 600_000,
    })
    expect(payPrompt(salary(), 400_000, '2026-10-10')).toMatchObject({
      kind: 'short',
      month: '2026-10-01',
    })
  })

  it('offers no pay cut in a prorated month', () => {
    const cost = salary({ startsOn: '2026-11-20' })
    expect(payPrompt(cost, 100_000, '2026-11-25')).toMatchObject({ choices: ['settle'] })
  })

  it('asks what the extra is when more than everything owed is paid', () => {
    expect(payPrompt(salary(), 1_200_000, '2026-10-19')).toMatchObject({
      kind: 'over',
      month: '2026-10-01',
      excessPaise: 200_000,
      choices: ['ahead', 'extra', 'new-amount'],
    })
  })

  it('withholds a new monthly amount in a prorated month', () => {
    const cost = salary({ startsOn: '2026-11-20' })
    expect(payPrompt(cost, 500_000, '2026-11-25')).toMatchObject({ choices: ['ahead', 'extra'] })
  })

  it('does not change with the date the payment shows in', () => {
    // The sheet reckons at today; which month's figures it lands in is asked below it.
    const cost = salary({
      startsOn: '2026-09-01',
      amounts: [{ fromMonth: '2026-09-01', amountPaise: 1_000_000, createdAt: 'a' }],
    })
    expect(payPrompt(cost, 1_500_000, '2026-10-19')).toMatchObject({
      kind: 'short',
      month: '2026-10-01',
      restPaise: 500_000,
    })
  })
})

describe('what each answer records', () => {
  it('a pay cut settles the short month and sets every later one', () => {
    const cost = salary()
    const prompt = payPrompt(cost, 800_000, '2026-11-02')
    expect(payEffect(cost, prompt, 'cut')).toEqual({
      settlement: { month: '2026-10-01', amountPaise: 800_000 },
      amount: { fromMonth: '2026-11-01', amountPaise: 800_000 },
    })
  })

  it('leave or a fine settles the short month at what it has covered', () => {
    const cost = salary()
    const prompt = payPrompt(cost, 800_000, '2026-11-02')
    expect(payEffect(cost, prompt, 'settle', 800_000, '2026-11-02')).toEqual({
      settlement: { month: '2026-10-01', amountPaise: 800_000 },
      amount: null,
    })
  })

  it('a bonus settles this month at its cost plus the extra', () => {
    const cost = salary()
    const prompt = payPrompt(cost, 1_200_000, '2026-10-19')
    expect(payEffect(cost, prompt, 'extra', 1_200_000, '2026-10-19').settlement).toEqual({
      month: '2026-10-01',
      amountPaise: 1_200_000,
    })
  })

  it('a raise settles this month and sets every later one', () => {
    const cost = salary()
    const prompt = payPrompt(cost, 1_200_000, '2026-10-19')
    expect(payEffect(cost, prompt, 'new-amount', 1_200_000, '2026-10-19')).toEqual({
      settlement: { month: '2026-10-01', amountPaise: 1_200_000 },
      amount: { fromMonth: '2026-11-01', amountPaise: 1_200_000 },
    })
  })

  it('an advance and paying the rest later record nothing more', () => {
    const cost = salary()
    const nothing = { settlement: null, amount: null }
    const over = payPrompt(cost, 1_500_000, '2026-10-19')
    const short = payPrompt(cost, 800_000, '2026-11-02')
    expect(payEffect(cost, over, 'ahead', 1_500_000, '2026-10-19')).toEqual(nothing)
    expect(payEffect(cost, short, null, 800_000, '2026-11-02')).toEqual(nothing)
  })

  it('refuses an answer the sheet would not offer', () => {
    const cost = salary({ startsOn: '2026-11-20' })
    const prompt = payPrompt(cost, 500_000, '2026-11-25')
    expect(() => payEffect(cost, prompt, 'new-amount', 500_000, '2026-11-25')).toThrow()
  })
})

describe('which month a payment shows in', () => {
  it('late pay for last month shows in last month', () => {
    expect(showsInDefault(salary(), 1_000_000, '2026-11-02', false)).toBe('2026-10-31')
    expect(showsInApplies(salary(), '2026-11-02', false)).toBe(true)
  })

  it('more than last month owes shows on the day paid', () => {
    expect(showsInDefault(salary(), 1_400_000, '2026-11-02', false)).toBe('2026-11-02')
  })

  it('cash shows on the day it left the drawer, and is not asked', () => {
    expect(showsInDefault(salary(), 1_000_000, '2026-11-02', true)).toBe('2026-11-02')
    expect(showsInApplies(salary(), '2026-11-02', true)).toBe(false)
  })
})

describe('Pro-rata P&L, held to the shared cases', () => {
  for (const c of cases.proRata)
    it(c.name, () => {
      const cost = salary({
        startsOn: `${c.today.slice(0, 7)}-01`,
        amounts: [
          { fromMonth: `${c.today.slice(0, 7)}-01`, amountPaise: c.monthlyPaise, createdAt: 'a' },
        ],
        payments: c.paidPaise ? [payment(c.paidPaise, c.today)] : [],
      })
      const reading = readProRata([cost], c.today)
      expect(reading.unpaidPaise).toBe(c.unpaidPaise)
      expect(proRataPnl(c.pnlPaise, reading)).toBe(c.proRataPnlPaise)
      expect(aheadOfCoveringPaise(c.pnlPaise, reading)).toBe(c.aheadOfCoveringPaise)
    })

  it('says how far through the month it is', () => {
    const reading = readProRata([salary()], '2026-10-18')
    expect([reading.daysSoFar, reading.daysInMonth]).toEqual([18, 31])
  })

  it('leaves last month’s unpaid balance out of this month', () => {
    const reading = readProRata([salary()], '2026-11-01')
    expect(reading.lines[0]).toMatchObject({ costPaise: 1_000_000, coveredPaise: 0 })
    expect(reading.unpaidPaise).toBe(33_333)
  })

  it('counts last month’s advance against this month', () => {
    const cost = salary({ payments: [payment(1_500_000, '2026-10-15')] })
    const reading = readProRata([cost], '2026-11-20')
    // 20/30 of 10,000 is 6,666.66, of which 5,000 was paid ahead in October.
    expect(reading.lines[0]).toMatchObject({ coveredPaise: 500_000, unpaidPaise: 166_666 })
    expect(reading.stillToPayPaise).toBe(500_000)
  })

  it('spreads a part month over its own days', () => {
    const cost = salary({
      startsOn: '2026-11-20',
      amounts: [{ fromMonth: '2026-11-01', amountPaise: 1_000_000, createdAt: 'a' }],
    })
    // Listed for the month it joins in, and charging nothing before its first day.
    expect(readProRata([cost], '2026-11-10').lines[0]).toMatchObject({
      spreadPaise: 0,
      unpaidPaise: 0,
    })
    expect(readProRata([cost], '2026-11-25').lines[0]).toMatchObject({
      costPaise: 366_666,
      spreadPaise: 199_999,
    })
  })

  it('covers the month’s fixed costs by P&L and what is paid, between 0 and 100%', () => {
    const reading = readProRata([salary({ monthlyPaise: 32_270_000 })], '2026-10-18')
    expect(coveredPercent(18_936_800, reading)).toBe(58)
    expect(coveredPercent(99_000_000, reading)).toBe(100)
    expect(coveredPercent(-5_000_000, reading)).toBe(0)
  })

  it('is short by the month and any loss, and ahead once P&L passes what is still to pay', () => {
    const reading = readProRata([salary({ monthlyPaise: 32_270_000 })], '2026-10-18')
    expect(aheadOfCoveringPaise(35_000_000, reading)).toBe(2_730_000)
    expect(aheadOfCoveringPaise(-5_000_000, reading)).toBe(-37_270_000)
    expect(coveredPercent(32_270_000, reading)).toBe(100)
    expect(aheadOfCoveringPaise(32_270_000, reading)).toBe(0)
  })

  it('does not charge again an advance paid last month', () => {
    const cost = salary({ payments: [payment(2_000_000, '2026-10-15')] })
    const reading = readProRata([cost], '2026-11-20')
    expect(aheadOfCoveringPaise(5_000_000, reading)).toBe(5_000_000)
    expect(coveredPercent(5_000_000, reading)).toBe(100)
  })

  it('adds back fixed-cost payments already in P&L when it measures what trading earned', () => {
    const cost = salary({ payments: [payment(1_000_000, '2026-10-10')] })
    const reading = readProRata([cost], '2026-10-18')
    expect(coveredPercent(-500_000, reading)).toBe(50)
  })
})

describe('the label a payment reads', () => {
  it('names the fixed cost and its category', () => {
    expect(fixedCostLabel('Nayan', 'salary')).toBe('Nayan (Salary)')
  })

  it('says one word once', () => {
    expect(fixedCostLabel('Rent', 'rent')).toBe('Rent')
  })
})

describe('the calendar', () => {
  it('steps across a year', () => {
    expect(addMonths('2026-12-01', 1)).toBe('2027-01-01')
    expect(addMonths('2026-01-01', -1)).toBe('2025-12-01')
  })
})

describe('this month, said in parts', () => {
  it('splits a balance into this month, overdue and paid ahead', () => {
    // Joined on 20 September (₹3,300 of ₹9,000), nothing paid by 19 October.
    const priyanka = salary({
      startsOn: '2026-09-20',
      monthlyPaise: 900_000,
      amounts: [{ fromMonth: '2026-09-01', amountPaise: 900_000, createdAt: 'a' }],
    })
    expect(thisMonthStatus(priyanka, '2026-10-19')).toEqual({
      active: true,
      costPaise: 900_000,
      paidPaise: 0,
      leftPaise: 900_000,
      aheadPaise: 0,
      overdue: [{ month: '2026-09-01', paise: 330_000 }],
    })
  })

  it('counts an earlier advance as paid for this month, and the rest as ahead', () => {
    const santu = salary({
      startsOn: '2026-09-01',
      amounts: [{ fromMonth: '2026-09-01', amountPaise: 1_000_000, createdAt: 'a' }],
      payments: [payment(2_500_000, '2026-09-25')],
    })
    expect(thisMonthStatus(santu, '2026-10-19')).toMatchObject({
      costPaise: 1_000_000,
      paidPaise: 1_000_000,
      leftPaise: 0,
      aheadPaise: 500_000,
      overdue: [],
    })
  })

  it('reads a fixed cost that stopped last month as not running, with what it still owes', () => {
    const gone = salary({
      startsOn: '2026-09-01',
      stopsOn: '2026-09-30',
      amounts: [{ fromMonth: '2026-09-01', amountPaise: 1_000_000, createdAt: 'a' }],
    })
    expect(thisMonthStatus(gone, '2026-10-19')).toMatchObject({
      active: false,
      costPaise: 0,
      leftPaise: 0,
      overdue: [{ month: '2026-09-01', paise: 1_000_000 }],
    })
  })
})

describe('what fixed costs come to per day', () => {
  it('spreads each cost over the days it runs this month, whatever has been paid', () => {
    // ₹2,71,900 over 31 days: Kalyani Cafe's thirteen in October.
    const cafe = salary({ monthlyPaise: 27_190_000 })
    expect(dailySpreadPaise([cafe], '2026-10-21')).toBe(877_096)
    expect(
      dailySpreadPaise([{ ...cafe, payments: [payment(27_190_000, '2026-10-02')] }], '2026-10-21'),
    ).toBe(877_096)
  })

  it('counts a part month over its own days, and nothing on a day it does not run', () => {
    // Joined on the 20th of a 30-day month: ₹10,000 × 11/30 over 11 days.
    const joiner = salary({ startsOn: '2026-11-20' })
    expect(dailySpreadPaise([joiner], '2026-11-25')).toBe(33_333)
    expect(dailySpreadPaise([joiner], '2026-11-10')).toBe(0)
    const leaver = salary({ stopsOn: '2026-11-12' })
    expect(dailySpreadPaise([leaver], '2026-11-12')).toBe(33_333)
    expect(dailySpreadPaise([leaver], '2026-11-13')).toBe(0)
  })

  it('adds the costs that run today', () => {
    const rent = salary({ id: 'r', monthlyPaise: 3_100_000 })
    const nayan = salary({ id: 'n', monthlyPaise: 1_240_000 })
    expect(dailySpreadPaise([rent, nayan], '2026-10-05')).toBe(100_000 + 40_000)
  })
})
