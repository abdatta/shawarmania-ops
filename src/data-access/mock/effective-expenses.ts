import type { DemoStore } from './store'

/**
 * The mock's half of `public.effective_expenses`.
 *
 * **The demo is why the production defect went unnoticed, and this file is the
 * repair.** The store holds two arrays — `expenses` and `manualLedgerExpenses` —
 * and every mock reader used the first one, exactly as the live adapters used
 * `public.expenses`. In demo that was invisible, because the seed populates both
 * arrays and the Ledger therefore always had something to show. In production
 * `public.expenses` has never held a single row: every live Expenses surface
 * writes the notebook, so the Ledger's Expenses card read "Nothing recorded" on
 * days with real expenses and the drawer's expected balance was overstated by
 * every cash expense since the last count.
 *
 * A mock that reads one array while the database reads a union would let exactly
 * that class of defect through again, and the seam this repo is built on is only
 * worth anything if the two halves answer the same question. So this mirrors the
 * view: both sources, un-voided rows only, one normalised shape.
 *
 * `retire-the-manual-ledger` (#12) carries the notebook rows into `expenses`,
 * after which the second branch is empty and this collapses to the first.
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
  const typed: EffectiveExpense[] = store.expenses.map((row) => ({
    id: row.id,
    outletId: row.outlet_id,
    businessDate: row.business_date,
    category: row.category,
    description: row.description,
    amountPaise: row.amount_paise,
    isCash: row.payment_method === 'cash',
    instant: row.occurred_at ?? row.created_at,
    recordedBy: row.recorded_by,
  }))

  const notebook: EffectiveExpense[] = store.manualLedgerExpenses
    // A voided expense is a row somebody withdrew. It stays on the record and it
    // must not reach a total, a drawer interval or a month.
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

  return [...typed, ...notebook]
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
