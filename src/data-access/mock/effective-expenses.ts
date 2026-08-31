import type { DemoStore } from './store'

/**
 * The mock's half of `public.effective_expenses`: the promoted expense record,
 * with withdrawn rows excluded and its event instant resolved.
 */
export interface EffectiveExpense {
  id: string
  outletId: string
  businessDate: string
  category: string
  description: string | null
  amountPaise: number
  isCash: boolean
  /** `coalesce(occurred_at, created_at)`, already resolved. */
  instant: string
  recordedBy: string | null
}

export function effectiveExpenses(store: DemoStore): EffectiveExpense[] {
  return store.expenses
    .filter((row) => row.voided_at === null)
    .map((row) => ({
      id: row.id,
      outletId: row.outlet_id,
      businessDate: row.business_date,
      category: row.category,
      description: row.description,
      amountPaise: row.amount_paise,
      isCash: row.is_cash,
      instant: row.occurred_at ?? row.created_at,
      recordedBy: row.recorded_by,
    }))
}

/** The same list, narrowed to one outlet's cash in `(from, to]`. */
export function cashExpensesIn(
  store: DemoStore,
  outletId: string,
  from: string | null,
  to: string,
): EffectiveExpense[] {
  return effectiveExpenses(store).filter(
    (expense) =>
      expense.outletId === outletId &&
      expense.isCash &&
      (from === null || expense.instant > from) &&
      expense.instant <= to,
  )
}
