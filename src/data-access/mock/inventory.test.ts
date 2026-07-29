import { describe, expect, it } from 'vitest'

import { sumQuantities } from '@/domain'

import { INVENTORY_CHICKEN_ID, INVENTORY_PITA_ID } from './fixtures/operations'
import { createMockInventoryAdapter } from './inventory'
import { createDemoStore, DEMO_OUTLET_ID } from './store'

/**
 * The ledger is the truth and the quantity is a cache of it. Everything here
 * holds the mock to that, because a demo where the two could drift would make
 * "why does it say 4 kg?" unanswerable — which is the question the ledger exists
 * for.
 */
describe('mock inventory adapter', () => {
  const adapterOver = () => {
    const store = createDemoStore()
    return { store, adapter: createMockInventoryAdapter(store) }
  }

  it('lists items with quantities that equal their own ledgers', async () => {
    const { store, adapter } = adapterOver()
    const items = await adapter.listItems(DEMO_OUTLET_ID)

    expect(items.length).toBeGreaterThan(0)
    for (const item of items) {
      const fromLedger = sumQuantities(
        store.inventoryMovements
          .filter((movement) => movement.inventory_item_id === item.id)
          .map((movement) => movement.quantity_delta),
      )
      expect(item.currentQuantity).toBe(fromLedger)
    }
  })

  it('marks the item that is at its threshold, and not the ones above it', async () => {
    const { adapter } = adapterOver()
    const items = await adapter.listItems(DEMO_OUTLET_ID)

    const pita = items.find((item) => item.id === INVENTORY_PITA_ID)
    expect(pita?.isLow).toBe(true)
    expect(items.find((item) => item.id === INVENTORY_CHICKEN_ID)?.isLow).toBe(false)
  })

  it('takes stock down on a used movement and up on an added one', async () => {
    const { store, adapter } = adapterOver()
    const before = (await adapter.getItem(INVENTORY_CHICKEN_ID))!.currentQuantity

    const afterUse = await adapter.recordMovement({
      inventoryItemId: INVENTORY_CHICKEN_ID,
      movementType: 'used',
      quantity: 2.5,
      businessDate: store.today,
    })
    expect(afterUse.currentQuantity).toBe(before - 2.5)

    const afterAdd = await adapter.recordMovement({
      inventoryItemId: INVENTORY_CHICKEN_ID,
      movementType: 'added',
      quantity: 10,
      businessDate: store.today,
    })
    expect(afterAdd.currentQuantity).toBe(before - 2.5 + 10)
  })

  it('does not let repeated fractional movements drift', async () => {
    const { store, adapter } = adapterOver()
    const created = await adapter.createItem({
      outletId: DEMO_OUTLET_ID,
      name: 'Tahini',
      unit: 'litre',
      lowStockThreshold: 1,
    })
    expect(created.currentQuantity).toBe(0)

    await adapter.recordMovement({
      inventoryItemId: created.id,
      movementType: 'added',
      quantity: 0.1,
      businessDate: store.today,
    })
    const after = await adapter.recordMovement({
      inventoryItemId: created.id,
      movementType: 'added',
      quantity: 0.2,
      businessDate: store.today,
    })

    expect(after.currentQuantity).toBe(0.3)
  })

  it('keeps both rows when a mistake is corrected', async () => {
    const { store, adapter } = adapterOver()
    const before = (await adapter.listMovements(INVENTORY_CHICKEN_ID)).length
    // Read, not pinned: the scenario's quantities move with the trade they are
    // chosen to reconcile with. What is being asserted is that the pair cancels.
    const started = (await adapter.getItem(INVENTORY_CHICKEN_ID))!.currentQuantity

    await adapter.recordMovement({
      inventoryItemId: INVENTORY_CHICKEN_ID,
      movementType: 'used',
      quantity: 3,
      businessDate: store.today,
    })
    await adapter.recordMovement({
      inventoryItemId: INVENTORY_CHICKEN_ID,
      movementType: 'correction',
      quantity: 3,
      note: 'The 3 kg above was never actually used.',
      businessDate: store.today,
    })

    const movements = await adapter.listMovements(INVENTORY_CHICKEN_ID)
    expect(movements.length).toBe(before + 2)
    // And the two cancel out, which is what "corrected, not edited" means.
    expect((await adapter.getItem(INVENTORY_CHICKEN_ID))!.currentQuantity).toBe(started)
  })

  it('refuses a correction with no note', async () => {
    const { store, adapter } = adapterOver()
    await expect(
      adapter.recordMovement({
        inventoryItemId: INVENTORY_CHICKEN_ID,
        movementType: 'correction',
        quantity: -1,
        businessDate: store.today,
      }),
    ).rejects.toThrow(/needs a note/)
  })

  it('refuses a movement of nothing', async () => {
    const { store, adapter } = adapterOver()
    await expect(
      adapter.recordMovement({
        inventoryItemId: INVENTORY_CHICKEN_ID,
        movementType: 'used',
        quantity: 0,
        businessDate: store.today,
      }),
    ).rejects.toThrow(/cannot be zero/)
  })

  it('reads the ledger newest first, carrying what was left after each row', async () => {
    const { adapter } = adapterOver()
    const movements = await adapter.listMovements(INVENTORY_PITA_ID)

    const dates = movements.map((movement) => movement.businessDate)
    expect([...dates]).toEqual([...dates].sort((a, b) => b.localeCompare(a)))

    // The newest row's running figure is the item's current quantity.
    expect(movements[0]?.quantityAfter).toBe(
      (await adapter.getItem(INVENTORY_PITA_ID))!.currentQuantity,
    )
  })

  it('offers no way to change or remove a movement', () => {
    const { adapter } = adapterOver()
    // Stated as a test because it is a contract, not an omission: history is
    // corrected by a further row, never edited.
    expect(Object.keys(adapter).sort()).toEqual([
      'createItem',
      'getItem',
      'listItems',
      'listMovements',
      'recordMovement',
      'updateItem',
    ])
  })
})
