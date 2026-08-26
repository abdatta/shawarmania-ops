import {
  DailyCashActionError,
  ExpenseActionError,
  InventoryActionError,
  type DailyCashAdapter,
  type DailyCashDay,
  type ExpensesAdapter,
  type InventoryAdapter,
} from '../adapters'

/**
 * The real stock, expenses and daily-cash adapters — **deliberately not
 * connected yet**.
 *
 * `DataAdapters` is total, so the real tree has to supply all three today. The
 * surfaces are `demo`-gated and never mount against them.
 * `cash-is-counted-not-closed` (#11) replaces the daily-cash stub with real
 * drawer queries and deletes the inventory one, because stock is shelved
 * (openspec/todos/inventory-is-shelved.md). There is no `close_business_day`
 * call to write: that function is removed rather than wired up.
 *
 * Writing those queries now would ship code no gate in this change can exercise,
 * which is how a `*-live` change discovers its adapter was wrong. So the reads
 * answer honestly — a real outlet has no stock rows and no closed days yet — and
 * the writes refuse in this app's voice rather than throwing something raw.
 */

const NOT_LIVE = 'This is not connected to real data yet. It is being demonstrated first.'

export function createSupabaseInventoryAdapter(): InventoryAdapter {
  const notLive = () => Promise.reject(new InventoryActionError('not_live', NOT_LIVE))

  return {
    async listItems() {
      return []
    },
    async getItem() {
      return null
    },
    async listMovements() {
      return []
    },
    createItem: notLive,
    updateItem: notLive,
    recordMovement: notLive,
  }
}

export function createSupabaseExpensesAdapter(): ExpensesAdapter {
  return {
    async listExpenses() {
      return []
    },
    createExpense: () => Promise.reject(new ExpenseActionError('not_live', NOT_LIVE)),
  }
}

export function createSupabaseDailyCashAdapter(): DailyCashAdapter {
  const notLive = () => Promise.reject(new DailyCashActionError('not_live', NOT_LIVE))

  return {
    async getDay(outletId: string, businessDate: string): Promise<DailyCashDay> {
      return {
        outletId,
        businessDate,
        openingCashPaise: 0,
        cashSalesPaise: 0,
        cashExpensesPaise: 0,
        cashWithdrawnPaise: 0,
        expectedClosingPaise: 0,
        withdrawals: [],
        closed: null,
        exceptions: [],
      }
    },
    recordWithdrawal: notLive,
    closeDay: notLive,
  }
}
