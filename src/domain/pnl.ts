import { NotPaiseError } from './money'

/** Profit is one honest operating estimate until inventory accounting returns. */
export type ProfitBasis = 'cash'

export const PROFIT_BASIS_LABELS: Record<ProfitBasis, string> = {
  cash: 'Cash-basis operating estimate',
}

export const PROFIT_BASIS_DESCRIPTIONS: Record<ProfitBasis, string> = {
  cash: 'Sales less recorded operating expenses. Drawer spends such as equipment stay outside it.',
}

function assertPaise(value: number, what: string): void {
  if (!Number.isInteger(value)) {
    const error = new NotPaiseError(value)
    error.message = `${error.message} (${what})`
    throw error
  }
}

export interface ExpenseAmount {
  category: string
  amountPaise: number
}

export function totalExpensesPaise(expenses: readonly ExpenseAmount[]): number {
  return expenses.reduce((running, expense) => {
    assertPaise(expense.amountPaise, 'expense amount')
    return running + expense.amountPaise
  }, 0)
}

export interface ProfitInputs {
  salesPaise: number
  expenses: readonly ExpenseAmount[]
  /** True when at least one contributing channel commission is undetermined. */
  isCeiling?: boolean
}

export interface ProfitEstimate {
  basis: ProfitBasis
  salesPaise: number
  expensesPaise: number
  profitPaise: number
  isCeiling: boolean
}

export function cashBasisProfitPaise(inputs: ProfitInputs): number {
  assertPaise(inputs.salesPaise, 'sales')
  return inputs.salesPaise - totalExpensesPaise(inputs.expenses)
}

export function profitEstimate(basis: ProfitBasis, inputs: ProfitInputs): ProfitEstimate {
  return {
    basis,
    salesPaise: inputs.salesPaise,
    expensesPaise: totalExpensesPaise(inputs.expenses),
    profitPaise: cashBasisProfitPaise(inputs),
    isCeiling: inputs.isCeiling ?? false,
  }
}
