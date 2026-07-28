import { describe, expect, it } from 'vitest'

import { expectedClosingPaise } from '@/domain'

import { createMockDailyCashAdapter } from './daily-cash'
import { createMockExpensesAdapter } from './expenses'
import { createDemoStore, DEMO_OUTLET_ID, type DemoStore } from './store'

/**
 * The three clauses of `daily-cash-reconciliation` that this mock has to honour,
 * because #12 will have to honour them in Postgres: the figures are computed
 * rather than supplied, only cash moves them, and a closed day is a snapshot
 * that a late bill cannot rewrite.
 */
describe('mock daily cash adapter', () => {
  const over = (): { store: DemoStore; adapter: ReturnType<typeof createMockDailyCashAdapter> } => {
    const store = createDemoStore()
    return { store, adapter: createMockDailyCashAdapter(store) }
  }

  it('counts only cash bills towards the day’s takings', async () => {
    const { store, adapter } = over()
    const day = await adapter.getDay(DEMO_OUTLET_ID, store.today)

    const cashOnly = store.bills
      .filter(
        (bill) => bill.business_date === store.today && bill.payment_method === 'cash',
      )
      .reduce((running, bill) => running + bill.total_paise, 0)
    const everything = store.bills
      .filter((bill) => bill.business_date === store.today)
      .reduce((running, bill) => running + bill.total_paise, 0)

    expect(day.cashSalesPaise).toBe(cashOnly)
    expect(day.cashSalesPaise).toBeLessThan(everything)
  })

  it('counts only cash expenses against the drawer', async () => {
    const { store, adapter } = over()
    const expenses = createMockExpensesAdapter(store)
    const before = (await adapter.getDay(DEMO_OUTLET_ID, store.today)).cashExpensesPaise

    await expenses.createExpense({
      outletId: DEMO_OUTLET_ID,
      businessDate: store.today,
      category: 'packaging',
      amountPaise: 50000,
      paymentMethod: 'upi',
    })
    expect((await adapter.getDay(DEMO_OUTLET_ID, store.today)).cashExpensesPaise).toBe(before)

    await expenses.createExpense({
      outletId: DEMO_OUTLET_ID,
      businessDate: store.today,
      category: 'packaging',
      amountPaise: 50000,
      paymentMethod: 'cash',
    })
    expect((await adapter.getDay(DEMO_OUTLET_ID, store.today)).cashExpensesPaise).toBe(
      before + 50000,
    )
  })

  it('satisfies the expected-closing equation from its own derived figures', async () => {
    const { store, adapter } = over()
    const day = await adapter.getDay(DEMO_OUTLET_ID, store.today)

    expect(day.expectedClosingPaise).toBe(
      expectedClosingPaise({
        openingCashPaise: day.openingCashPaise,
        cashSalesPaise: day.cashSalesPaise,
        cashExpensesPaise: day.cashExpensesPaise,
        cashWithdrawnPaise: day.cashWithdrawnPaise,
      }),
    )
  })

  it('reduces the expected closing by exactly what was withdrawn', async () => {
    const { store, adapter } = over()
    const before = await adapter.getDay(DEMO_OUTLET_ID, store.today)

    const after = await adapter.recordWithdrawal({
      outletId: DEMO_OUTLET_ID,
      businessDate: store.today,
      amountPaise: 150000,
      withdrawnBy: 'Demo Owner',
    })

    expect(after.cashWithdrawnPaise).toBe(before.cashWithdrawnPaise + 150000)
    expect(after.expectedClosingPaise).toBe(before.expectedClosingPaise - 150000)
  })

  it('computes the stored figures itself rather than taking them from the caller', async () => {
    const { store, adapter } = over()
    const day = await adapter.getDay(DEMO_OUTLET_ID, store.today)

    const record = await adapter.closeDay({
      outletId: DEMO_OUTLET_ID,
      businessDate: store.today,
      actualClosingPaise: day.expectedClosingPaise - 24000,
    })

    expect(record.cash_sales_paise).toBe(day.cashSalesPaise)
    expect(record.cash_expenses_paise).toBe(day.cashExpensesPaise)
    expect(record.cash_withdrawn_paise).toBe(day.cashWithdrawnPaise)
    expect(record.expected_closing_paise).toBe(day.expectedClosingPaise)
    expect(record.difference_paise).toBe(-24000)
  })

  it('refuses a second close of the same day', async () => {
    const { store, adapter } = over()
    const day = await adapter.getDay(DEMO_OUTLET_ID, store.today)

    await adapter.closeDay({
      outletId: DEMO_OUTLET_ID,
      businessDate: store.today,
      actualClosingPaise: day.expectedClosingPaise,
    })

    await expect(
      adapter.closeDay({
        outletId: DEMO_OUTLET_ID,
        businessDate: store.today,
        actualClosingPaise: 1,
      }),
    ).rejects.toThrow(/already been closed/)
  })

  it('refuses a withdrawal against a day that is already closed', async () => {
    const { store, adapter } = over()
    await expect(
      adapter.recordWithdrawal({
        outletId: DEMO_OUTLET_ID,
        businessDate: store.businessDate(1),
        amountPaise: 1000,
        withdrawnBy: 'Demo Owner',
      }),
    ).rejects.toThrow(/is closed/)
  })

  describe('yesterday — closed, with a mismatch and a late bill', () => {
    it('shows a real difference between two derived figures', async () => {
      const { store, adapter } = over()
      const day = await adapter.getDay(DEMO_OUTLET_ID, store.businessDate(1))

      expect(day.closed).not.toBeNull()
      expect(day.closed!.difference_paise).toBeLessThan(0)
      expect(day.closed!.actual_closing_paise).toBe(
        day.closed!.expected_closing_paise + day.closed!.difference_paise,
      )
    })

    it('does not fold the late bill into the signed-off figures', async () => {
      const { store, adapter } = over()
      const yesterday = store.businessDate(1)
      const day = await adapter.getDay(DEMO_OUTLET_ID, yesterday)

      const everyCashBill = store.bills
        .filter(
          (bill) => bill.business_date === yesterday && bill.payment_method === 'cash',
        )
        .reduce((running, bill) => running + bill.total_paise, 0)

      // The stored figure is smaller than the rows now say, because one of them
      // had not arrived when the drawer was counted. That gap is the point.
      expect(day.cashSalesPaise).toBeLessThan(everyCashBill)
    })

    it('reports the late arrival as an exception naming the bill', async () => {
      const { store, adapter } = over()
      const day = await adapter.getDay(DEMO_OUTLET_ID, store.businessDate(1))

      expect(day.exceptions).toHaveLength(1)
      const [exception] = day.exceptions
      expect(exception!.totalPaise).toBeGreaterThan(0)
      expect(exception!.syncedAt > day.closed!.closed_at).toBe(true)
      // Rung during the day it belongs to; it was the arrival that came late.
      expect(exception!.createdAt < day.closed!.closed_at).toBe(true)
    })

    it('raises no exception on a day that was never closed', async () => {
      const { store, adapter } = over()
      const day = await adapter.getDay(DEMO_OUTLET_ID, store.today)
      expect(day.closed).toBeNull()
      expect(day.exceptions).toEqual([])
    })
  })
})
