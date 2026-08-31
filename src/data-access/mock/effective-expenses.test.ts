import { describe, expect, it } from 'vitest'

import { OUTLET_KALYANI_ID } from './fixtures/outlets'
import { createMockAdapters } from './index'

/**
 * The defect the owner found on 2026-08-28, pinned at the seam that hid it.
 *
 * Two tables hold expenses. `public.expenses` is what the derived Ledger and the
 * drawer's interval arithmetic read; `manual_ledger_expenses` is what every live
 * Expenses surface writes, and has done since #36. Nothing has ever written the
 * first one — 0 rows against 118 in production — so the Ledger's Expenses card
 * said "Nothing recorded" on days with real expenses, and the drawer's expected
 * balance was overstated by every cash expense since the last count.
 *
 * **The demo could not catch it, and that is the point of this file.** The mock
 * store also holds two arrays, and the seed fills both — so the Ledger always
 * had something to show and the split never surfaced. A walkthrough that is
 * self-consistent by construction proves nothing about a system that is not.
 *
 * So this drives the two adapters through the door a person actually uses: it
 * records an expense the way the Expenses tab records one, then asks the Ledger
 * and the drawer whether they can see it. Both must, or the seam is lying again.
 */

describe('an expense recorded the way the app records one is visible to both readers', () => {
  it('reaches the derived Ledger day', async () => {
    const adapters = createMockAdapters('super_admin')
    const businessDate = '2026-08-20'

    const before = await adapters.ledgerStatement.getDay(OUTLET_KALYANI_ID, businessDate)

    await adapters.expenses.createExpense({
      outletId: OUTLET_KALYANI_ID,
      businessDate,
      category: 'Gas cylinder',
      isCash: true,
      amountPaise: 90000,
      note: null,
    })

    const after = await adapters.ledgerStatement.getDay(OUTLET_KALYANI_ID, businessDate)

    expect(after.expenses.totalPaise).toBe(before.expenses.totalPaise + 90000)
    expect(after.expenses.rows.map((row) => row.label)).toContain('Gas cylinder')
    expect(after.expenses.rows.find((row) => row.label === 'Gas cylinder')?.isCash).toBe(true)
  })

  it('moves the drawer, so the next count is not short by it', async () => {
    const adapters = createMockAdapters('super_admin')
    const businessDate = new Date().toISOString().slice(0, 10)

    const before = await adapters.cashDrawer.getState(OUTLET_KALYANI_ID)

    await adapters.expenses.createExpense({
      outletId: OUTLET_KALYANI_ID,
      businessDate,
      category: 'Gas cylinder',
      isCash: true,
      amountPaise: 90000,
      note: null,
    })

    const after = await adapters.cashDrawer.getState(OUTLET_KALYANI_ID)

    // The whole of the second defect, as arithmetic: cash left the drawer, so
    // what should be in it falls by exactly that much. Before the fix this
    // difference was nought however much had been spent, and the shortfall
    // appeared at the next count instead — a fiction of the kind #11 exists to
    // remove.
    expect(after.cashExpensesSincePaise).toBe(before.cashExpensesSincePaise + 90000)
    expect(after.cashExpensesSinceCount).toBe(before.cashExpensesSinceCount + 1)
    expect(after.expectedNowPaise).toBe((before.expectedNowPaise ?? 0) - 90000)
  })

  it('leaves the drawer alone when it was not paid in cash', async () => {
    const adapters = createMockAdapters('super_admin')
    const businessDate = new Date().toISOString().slice(0, 10)

    const before = await adapters.cashDrawer.getState(OUTLET_KALYANI_ID)

    await adapters.expenses.createExpense({
      outletId: OUTLET_KALYANI_ID,
      businessDate,
      category: 'Supplier by UPI',
      isCash: false,
      amountPaise: 500000,
      note: null,
    })

    const after = await adapters.cashDrawer.getState(OUTLET_KALYANI_ID)

    expect(after.expectedNowPaise).toBe(before.expectedNowPaise)
    expect(after.cashExpensesSincePaise).toBe(before.cashExpensesSincePaise)
  })

  it('drops an expense that was voided', async () => {
    const adapters = createMockAdapters('super_admin')
    const businessDate = '2026-08-20'

    const created = await adapters.expenses.createExpense({
      outletId: OUTLET_KALYANI_ID,
      businessDate,
      category: 'Entered twice',
      isCash: true,
      amountPaise: 77700,
      note: null,
    })

    const withIt = await adapters.ledgerStatement.getDay(OUTLET_KALYANI_ID, businessDate)
    expect(withIt.expenses.rows.map((row) => row.label)).toContain('Entered twice')

    await adapters.expenses.voidExpense(created.id, 'entered twice')

    const withoutIt = await adapters.ledgerStatement.getDay(OUTLET_KALYANI_ID, businessDate)
    // A withdrawn row stays on the record and must not reach a total.
    expect(withoutIt.expenses.rows.map((row) => row.label)).not.toContain('Entered twice')
    expect(withoutIt.expenses.totalPaise).toBe(withIt.expenses.totalPaise - 77700)
  })
})
