import { describe, expect, it } from 'vitest'

import { createDemoData, createMockAdapters } from './index'
import { OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID } from './fixtures/outlets'

describe('mock expense categories adapter', () => {
  it('shares a newly typed category across outlets and preserves its first spelling', async () => {
    const data = createDemoData()
    const manager = createMockAdapters('franchise_admin', data)

    await manager.expenses.createExpense({
      outletId: OUTLET_KALYANI_ID,
      businessDate: data.store.today,
      category: '  Staff   meals  ',
      amountPaise: 12_000,
      paymentMethod: 'upi',
    })
    await manager.expenses.createExpense({
      outletId: OUTLET_KANCHRAPARA_ID,
      businessDate: data.store.today,
      category: 'staff meals',
      amountPaise: 8_000,
      paymentMethod: 'upi',
    })

    const names = (await createMockAdapters('biller', data).expenseCategories.list()).map(
      (category) => category.name,
    )
    expect(names.filter((name) => name.toLocaleLowerCase() === 'staff meals')).toEqual([
      'Staff meals',
    ])
  })

  it('renames without history, merges both tables with counts, and logs only mutations', async () => {
    const data = createDemoData()
    const owner = createMockAdapters('super_admin', data).expenseCategories

    const rename = await owner.rename('Chicken', 'Poultry', false)
    expect(rename).toEqual({ ledgerRowsMoved: 0, expenseRowsMoved: 0 })
    expect(data.store.manualLedgerExpenses.some((row) => row.category === 'Chicken')).toBe(true)

    const source = (await owner.list()).find((category) => category.name === 'maintenance')
    expect(source).toMatchObject({ ledgerUsageCount: 1, expenseUsageCount: 1 })
    const merged = await owner.merge('maintenance', 'Poultry')
    expect(merged).toEqual({ ledgerRowsMoved: 1, expenseRowsMoved: 1 })
    expect(data.store.manualLedgerExpenses.some((row) => row.category === 'maintenance')).toBe(
      false,
    )
    expect(data.store.expenses.some((row) => row.category === 'maintenance')).toBe(false)

    const operationCount = (await owner.listOperations()).length
    await owner.retire('Poultry')
    expect((await owner.listOperations()).length).toBe(operationCount)
    expect((await owner.list()).some((category) => category.name === 'Poultry')).toBe(false)
  })

  it('refuses curation to a non-owner', async () => {
    const categories = createMockAdapters('franchise_admin').expenseCategories
    await expect(categories.rename('Chicken', 'Poultry', true)).rejects.toMatchObject({
      code: 'not_permitted',
    })
  })
})
