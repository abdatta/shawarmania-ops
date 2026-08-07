import {
  ExpenseActionError,
  type ExpenseRecord,
  type ExpensesAdapter,
  type NewExpense,
} from '../adapters'
import type { Tables } from '../database.types'
import { personaFixtures } from './fixtures/personas'
import type { DemoStore } from './store'
import { captureMockCategory } from './expense-categories'

/**
 * The mock expenses adapter.
 *
 * The only rule with teeth here is the one that connects this screen to the
 * cash screen: **an expense's payment method decides whether it touched the
 * drawer**. Nothing filters on it in this file — the daily-cash adapter does —
 * but the amounts are integer paise and the method is stored faithfully, which
 * is what makes that filter mean something.
 */

const RECORDED_BY = personaFixtures.franchise_admin.profile.id

function toRecord(row: Tables<'expenses'>): ExpenseRecord {
  return {
    id: row.id,
    outletId: row.outlet_id,
    businessDate: row.business_date,
    category: row.category,
    amountPaise: row.amount_paise,
    paymentMethod: row.payment_method,
    description: row.description,
    createdAt: row.created_at,
  }
}

export function createMockExpensesAdapter(store: DemoStore): ExpensesAdapter {
  let nextId = 1

  return {
    async listExpenses(outletId: string, businessDate: string) {
      return store.expenses
        .filter(
          (expense) => expense.outlet_id === outletId && expense.business_date === businessDate,
        )
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map(toRecord)
    },

    async createExpense(expense: NewExpense) {
      if (!Number.isInteger(expense.amountPaise) || expense.amountPaise <= 0) {
        throw new ExpenseActionError(
          'bad_amount',
          'An expense needs an amount above zero, as a number of rupees.',
        )
      }

      const created: Tables<'expenses'> = {
        id: `db000000-0000-4000-b000-${String(nextId++).padStart(12, '0')}`,
        outlet_id: expense.outletId,
        business_date: expense.businessDate,
        category: captureMockCategory(store, expense.category, RECORDED_BY),
        amount_paise: expense.amountPaise,
        payment_method: expense.paymentMethod,
        description: expense.description?.trim() || null,
        created_at: new Date().toISOString(),
        recorded_by: RECORDED_BY,
      }
      store.expenses.push(created)
      return toRecord(created)
    },
  }
}
