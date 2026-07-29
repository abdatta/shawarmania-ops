import { describe, expect, it } from 'vitest'

import { sumQuantities } from '@/domain'

import { createDemoStore, DEMO_OUTLET_ID, DEMO_SECOND_OUTLET_ID } from './store'

/**
 * The scenario dataset's own invariants.
 *
 * The store asserts these at construction and throws if they fail, which is the
 * behaviour that matters — a contradictory demo must not reach a screen. These
 * tests exist so that a change which *weakens* the assertions is caught too: a
 * removed check would make construction pass silently, and only an independent
 * restatement of the invariant notices that.
 */
describe('the demo scenario dataset', () => {
  it('trades at both outlets, over the same recent days', () => {
    const store = createDemoStore()

    for (const outletId of [DEMO_OUTLET_ID, DEMO_SECOND_OUTLET_ID]) {
      const outletBills = store.bills.filter((bill) => bill.outlet_id === outletId)
      expect(outletBills.length).toBeGreaterThan(0)
      expect(outletBills.some((bill) => bill.business_date === store.today)).toBe(true)
      expect(outletBills.some((bill) => bill.business_date === store.businessDate(1))).toBe(true)
    }
  })

  it('numbers every outlet’s bills from one, independently and without gaps', () => {
    const store = createDemoStore()

    for (const outletId of store.tradingOutletIds) {
      const numbers = store.bills
        .filter((bill) => bill.outlet_id === outletId)
        .map((bill) => bill.bill_number)
        .sort((a, b) => a - b)

      expect(numbers[0]).toBe(1)
      expect(numbers).toEqual(numbers.map((_, index) => index + 1))
    }

    // Independent, not shared: both outlets own a bill number 1, which is what
    // `(outlet_id, bill_number)` unique means and a single global counter could
    // never produce.
    const ones = store.bills.filter((bill) => bill.bill_number === 1)
    expect(new Set(ones.map((bill) => bill.outlet_id)).size).toBe(store.tradingOutletIds.length)
  })

  it('keeps every item’s stored quantity equal to the sum of its own ledger', () => {
    const store = createDemoStore()

    for (const item of store.inventoryItems) {
      const fromLedger = sumQuantities(
        store.inventoryMovements
          .filter((movement) => movement.inventory_item_id === item.id)
          .map((movement) => movement.quantity_delta),
      )
      expect(fromLedger).toBe(item.current_quantity)
    }
  })

  it('records each movement against the outlet of the item it moves', () => {
    const store = createDemoStore()

    for (const movement of store.inventoryMovements) {
      const item = store.inventoryItems.find(
        (candidate) => candidate.id === movement.inventory_item_id,
      )
      expect(item?.outlet_id).toBe(movement.outlet_id)
    }
  })

  it('closes yesterday at both outlets, short at one and exact at the other', () => {
    const store = createDemoStore()
    const yesterday = store.businessDate(1)

    const closed = store.tradingOutletIds.map((outletId) => {
      const record = store.dailyCashRecords.find(
        (candidate) => candidate.outlet_id === outletId && candidate.business_date === yesterday,
      )
      expect(record).toBeDefined()
      return record
    })

    // The awkward state and the calm one, so a difference reads as a difference
    // rather than as how the app always looks (design D2).
    expect(closed.some((record) => record?.difference_paise !== 0)).toBe(true)
    expect(closed.some((record) => record?.difference_paise === 0)).toBe(true)
  })

  it('keeps a closed day’s figures free of the bill that arrived after it', () => {
    const store = createDemoStore()
    const yesterday = store.businessDate(1)

    const record = store.dailyCashRecords.find(
      (candidate) =>
        candidate.outlet_id === DEMO_OUTLET_ID && candidate.business_date === yesterday,
    )
    const late = store.bills.find(
      (bill) =>
        bill.outlet_id === DEMO_OUTLET_ID &&
        bill.business_date === yesterday &&
        bill.synced_at > bill.created_at,
    )

    expect(late).toBeDefined()
    // The snapshot is what was counted. Recomputing would have folded the late
    // bill in, which is precisely what a closed day must never do.
    const recomputed = store.bills
      .filter(
        (bill) =>
          bill.outlet_id === DEMO_OUTLET_ID &&
          bill.business_date === yesterday &&
          bill.payment_method === 'cash',
      )
      .reduce((running, bill) => running + bill.total_paise, 0)
    expect(record?.cash_sales_paise).toBe(recomputed - (late?.total_paise ?? 0))
  })

  it('gives each outlet its own menu rows rather than sharing one set', () => {
    const store = createDemoStore()

    for (const outletId of store.tradingOutletIds) {
      expect(store.menuItems.some((item) => item.outlet_id === outletId)).toBe(true)
      expect(store.menuCategories.some((category) => category.outlet_id === outletId)).toBe(true)
    }

    const ids = store.menuItems.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps every bill line pointing at a menu item of the bill’s own outlet', () => {
    const store = createDemoStore()

    for (const line of store.billItems) {
      const bill = store.bills.find((candidate) => candidate.id === line.bill_id)
      const item = store.menuItems.find((candidate) => candidate.id === line.menu_item_id)
      expect(item?.outlet_id).toBe(bill?.outlet_id)
    }
  })

  it('leaves the low stock at one outlet only', () => {
    const store = createDemoStore()

    const lowByOutlet = new Map<string, number>()
    for (const item of store.inventoryItems) {
      if (item.current_quantity <= item.low_stock_threshold) {
        lowByOutlet.set(item.outlet_id, (lowByOutlet.get(item.outlet_id) ?? 0) + 1)
      }
    }

    expect(lowByOutlet.get(DEMO_OUTLET_ID)).toBeGreaterThan(0)
    expect(lowByOutlet.get(DEMO_SECOND_OUTLET_ID) ?? 0).toBe(0)
  })
})
