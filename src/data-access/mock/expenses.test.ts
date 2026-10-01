import { describe, expect, it } from 'vitest'

import { createDemoData, createMockAdapters } from './index'
import { OUTLET_KALYANI_ID } from './fixtures/outlets'

const STAFF_CASH_ONLY =
  'staff record only what leaves the drawer; a manager or the owner records the rest'

/**
 * Demo mode mirrors staff-see-only-what-leaves-the-drawer: a Biller or Employee
 * reads and records only cash, while the owner and a manager reach everything.
 */
describe('mock expenses adapter — staff see only what leaves the drawer', () => {
  async function seededDay() {
    const data = createDemoData()
    const owner = createMockAdapters('super_admin', data).expenses
    const salary = await owner.createExpense({
      outletId: OUTLET_KALYANI_ID,
      businessDate: data.store.today,
      category: 'Salary',
      amountPaise: 1_500_000,
      isCash: false,
    })
    const onions = await owner.createExpense({
      outletId: OUTLET_KALYANI_ID,
      businessDate: data.store.today,
      category: 'Vegetables',
      amountPaise: 18_000,
      isCash: true,
    })
    return { data, salary, onions }
  }

  it.each(['biller', 'employee'] as const)(
    'a %s reads the cash row and not the salary',
    async (role) => {
      const { data, salary, onions } = await seededDay()
      const staff = createMockAdapters(role, data).expenses

      const ids = (await staff.listRecentExpenses(OUTLET_KALYANI_ID, [data.store.today])).map(
        (row) => row.id,
      )
      expect(ids).toContain(onions.id)
      expect(ids).not.toContain(salary.id)

      const day = (await staff.listExpenses(OUTLET_KALYANI_ID, data.store.today)).map(
        (row) => row.id,
      )
      expect(day).not.toContain(salary.id)
      expect(
        (await staff.listExpenses(OUTLET_KALYANI_ID, data.store.today)).every((row) => row.isCash),
      ).toBe(true)
    },
  )

  it('a manager and the owner still read the salary', async () => {
    const { data, salary } = await seededDay()
    for (const role of ['super_admin', 'franchise_admin'] as const) {
      const rows = await createMockAdapters(role, data).expenses.listExpenses(
        OUTLET_KALYANI_ID,
        data.store.today,
      )
      expect(rows.map((row) => row.id)).toContain(salary.id)
    }
  })

  it('refuses a staff non-cash expense with the database’s own sentence', async () => {
    const data = createDemoData()
    const biller = createMockAdapters('biller', data).expenses
    await expect(
      biller.createExpense({
        outletId: OUTLET_KALYANI_ID,
        businessDate: data.store.today,
        category: 'Gas',
        amountPaise: 90_000,
        isCash: false,
      }),
    ).rejects.toThrow(STAFF_CASH_ONLY)
  })

  it('refuses turning a staff cash expense into a non-cash one, and leaves it cash', async () => {
    const data = createDemoData()
    const biller = createMockAdapters('biller', data).expenses
    const gas = await biller.createExpense({
      outletId: OUTLET_KALYANI_ID,
      businessDate: data.store.today,
      category: 'Gas',
      amountPaise: 90_000,
      isCash: true,
    })

    await expect(biller.updateExpense(gas.id, { isCash: false })).rejects.toThrow(STAFF_CASH_ONLY)
    expect(data.store.expenses.find((row) => row.id === gas.id)?.is_cash).toBe(true)

    await expect(biller.updateExpense(gas.id, { amountPaise: 95_000 })).resolves.toMatchObject({
      amountPaise: 95_000,
      isCash: true,
    })
  })
})
