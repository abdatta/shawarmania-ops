import { NotPaiseError } from './money'

/**
 * Profit estimation. Pure, no I/O.
 *
 * **Raw materials appear twice in the natural reading of this schema** — once as
 * an `expenses` row with category `raw_materials` when stock is bought, and
 * again as inventory `used` / `wasted` movements valued at purchase cost.
 * Summing "all expenses" *and* "food cost" double-counts, and that is the first
 * of the two modelling traps `docs/DATA_MODEL.md` names.
 *
 * So there are two bases and never a blend of them:
 *
 *   cash basis         = sales − all expenses
 *   consumption basis  = sales − non-raw-material expenses − inventory consumed
 *
 * Cash basis matches the drawer. Consumption basis is more accurate month to
 * month, because it does not punish a period for a bulk purchase. Neither is
 * more correct in general; silently mixing them is always wrong, which is why
 * every surface showing one of these figures has to state which it is showing.
 *
 * Integer paise throughout, and a non-integer throws rather than rounding —
 * the same rule the rest of the money path follows.
 */

export type ProfitBasis = 'cash' | 'consumption'

/** What a surface puts beside the figure. Never optional — see the module note. */
export const PROFIT_BASIS_LABELS: Record<ProfitBasis, string> = {
  cash: 'Cash basis',
  consumption: 'Consumption basis',
}

/** One line of the explanation each basis owes the reader. */
export const PROFIT_BASIS_DESCRIPTIONS: Record<ProfitBasis, string> = {
  cash: 'Sales minus everything spent. Answers: did more money come in than went out?',
  consumption:
    'Sales minus running costs minus the stock actually used. Answers: did we make money on what we sold?',
}

/**
 * The expense category that must never be counted alongside stock consumed.
 *
 * **This word no longer identifies anything a person types.** Categories became
 * free text in `expense-categories-grow-from-use`, so a real stock purchase
 * arrives as `Chicken` or a supplier's name and never matches here. Only the
 * demo fixtures still carry it, which is why the demo reads correctly and
 * proves nothing. The consumption basis needs a different way to recognise a
 * stock purchase, and it will not get one: inventory is shelved
 * (`openspec/todos/inventory-is-shelved.md`), so `retire-the-manual-ledger`
 * (#12) withdraws the consumption basis entirely rather than repairing a matcher
 * that feeds a mode nobody can compute. Both return together or not at all.
 */
export const RAW_MATERIALS_CATEGORY = 'raw_materials'

function assertPaise(value: number, what: string): void {
  if (!Number.isInteger(value)) {
    // Reuse the money path's own error, so a float that leaks in here reads the
    // same way it would anywhere else in the system.
    const error = new NotPaiseError(value)
    error.message = `${error.message} (${what})`
    throw error
  }
}

export interface ExpenseAmount {
  category: string
  amountPaise: number
}

/** One consumed-stock line: a signed movement and what the item cost to buy. */
export interface ConsumedMovement {
  movementType: 'added' | 'used' | 'wasted' | 'correction'
  /** Signed, as stored: `used` and `wasted` are negative. */
  quantityDelta: number
  /** The item's purchase cost per unit, in integer paise. */
  purchaseCostPaise: number
}

/** Everything spent in a period, whatever it was spent on. */
export function totalExpensesPaise(expenses: readonly ExpenseAmount[]): number {
  return expenses.reduce((running, expense) => {
    assertPaise(expense.amountPaise, 'expense amount')
    return running + expense.amountPaise
  }, 0)
}

/** Everything spent that was not stock — what the consumption basis subtracts. */
export function nonRawMaterialExpensesPaise(expenses: readonly ExpenseAmount[]): number {
  return totalExpensesPaise(
    expenses.filter((expense) => expense.category !== RAW_MATERIALS_CATEGORY),
  )
}

/** Only what was bought as stock. Shown so the two bases can be reconciled on screen. */
export function rawMaterialExpensesPaise(expenses: readonly ExpenseAmount[]): number {
  return totalExpensesPaise(
    expenses.filter((expense) => expense.category === RAW_MATERIALS_CATEGORY),
  )
}

/**
 * The value of stock that actually left the kitchen, at purchase cost.
 *
 * **Only `used` and `wasted` count.** An `added` movement is a purchase, which
 * the expenses side already knows about; and a `correction` is a counting fix,
 * not food leaving — treating one as consumption would charge a period for a
 * mistake somebody made with a clipboard.
 *
 * The result is rounded to the nearest paisa once, at the end: quantities are
 * `numeric` and a per-line rounding would accumulate a drift the ledger cannot
 * explain.
 */
export function inventoryConsumedPaise(movements: readonly ConsumedMovement[]): number {
  const total = movements.reduce((running, movement) => {
    if (movement.movementType !== 'used' && movement.movementType !== 'wasted') return running
    assertPaise(movement.purchaseCostPaise, 'purchase cost')
    return running + Math.abs(movement.quantityDelta) * movement.purchaseCostPaise
  }, 0)

  return Math.round(total)
}

export interface ProfitInputs {
  salesPaise: number
  expenses: readonly ExpenseAmount[]
  movements: readonly ConsumedMovement[]
}

export interface ProfitEstimate {
  basis: ProfitBasis
  salesPaise: number
  /** What was subtracted, itemised, so the figure can be checked rather than trusted. */
  expensesPaise: number
  /** Zero on the cash basis: stock consumed is not a cost that basis recognises. */
  consumedPaise: number
  profitPaise: number
}

/** Sales minus everything spent. */
export function cashBasisProfitPaise(inputs: ProfitInputs): number {
  assertPaise(inputs.salesPaise, 'sales')
  return inputs.salesPaise - totalExpensesPaise(inputs.expenses)
}

/** Sales minus running costs minus stock consumed — food counted exactly once. */
export function consumptionBasisProfitPaise(inputs: ProfitInputs): number {
  assertPaise(inputs.salesPaise, 'sales')
  return (
    inputs.salesPaise -
    nonRawMaterialExpensesPaise(inputs.expenses) -
    inventoryConsumedPaise(inputs.movements)
  )
}

/**
 * The figure and the working behind it, on the basis asked for.
 *
 * There is deliberately no way to obtain a profit figure without naming a
 * basis: the surface has to state which one it is showing, and a function that
 * defaulted would make forgetting to say so possible.
 */
export function profitEstimate(basis: ProfitBasis, inputs: ProfitInputs): ProfitEstimate {
  if (basis === 'cash') {
    return {
      basis,
      salesPaise: inputs.salesPaise,
      expensesPaise: totalExpensesPaise(inputs.expenses),
      consumedPaise: 0,
      profitPaise: cashBasisProfitPaise(inputs),
    }
  }

  return {
    basis,
    salesPaise: inputs.salesPaise,
    expensesPaise: nonRawMaterialExpensesPaise(inputs.expenses),
    consumedPaise: inventoryConsumedPaise(inputs.movements),
    profitPaise: consumptionBasisProfitPaise(inputs),
  }
}
