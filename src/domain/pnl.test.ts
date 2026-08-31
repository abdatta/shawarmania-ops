import { describe, expect, it } from 'vitest'

import {
  cashBasisProfitPaise,
  profitEstimate,
  PROFIT_BASIS_LABELS,
  totalExpensesPaise,
} from './pnl'

describe('cash-basis operating profit', () => {
  const inputs = {
    salesPaise: 1_000_000,
    expenses: [
      { category: 'Chicken', amountPaise: 300_000 },
      { category: 'Rent', amountPaise: 100_000 },
    ],
  }

  it('subtracts every recorded operating expense exactly once', () => {
    expect(totalExpensesPaise(inputs.expenses)).toBe(400_000)
    expect(cashBasisProfitPaise(inputs)).toBe(600_000)
  })

  it('always names the single available basis', () => {
    const estimate = profitEstimate('cash', inputs)
    expect(estimate).toMatchObject({
      basis: 'cash',
      salesPaise: 1_000_000,
      expensesPaise: 400_000,
      profitPaise: 600_000,
      isCeiling: false,
    })
    expect(PROFIT_BASIS_LABELS.cash).toMatch(/cash-basis operating estimate/i)
  })

  it('carries the ceiling state without changing the arithmetic', () => {
    const estimate = profitEstimate('cash', { ...inputs, isCeiling: true })
    expect(estimate.isCeiling).toBe(true)
    expect(estimate.profitPaise).toBe(600_000)
  })

  it('rejects fractional paise', () => {
    expect(() => cashBasisProfitPaise({ ...inputs, salesPaise: 1.5 })).toThrow()
  })
})
