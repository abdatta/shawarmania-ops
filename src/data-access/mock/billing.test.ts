import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SYNC_ESCALATION_COUNT, SYNC_ESCALATION_MS, UNDO_WINDOW_MS } from '@/domain'

import type { BillDraft } from '../adapters'
import { createMockBillingAdapter } from './billing'
import { DEMO_BILLER_PIN, DEMO_MORNING_BILLER_ID, DEMO_OPEN_SHIFT_ID } from './fixtures/billing'
import { MENU_ITEM_CLASSIC_ID } from './fixtures/menu'
import { createDemoStore, DEMO_OUTLET_ID, type DemoStore } from './store'

/**
 * The mock counter has one job beyond looking right: to behave the way
 * `openspec/specs/counter-billing/spec.md` says the real thing will. Each test
 * below names the clause it is holding the mock to.
 */

/** Comfortably past the undo window and the simulated send. */
const AFTER_SEND_MS = UNDO_WINDOW_MS + 2000

function draft(store: DemoStore, clientId: string, quantity = 1): BillDraft {
  return {
    clientId,
    outletId: DEMO_OUTLET_ID,
    shiftId: DEMO_OPEN_SHIFT_ID,
    businessDate: store.today,
    paymentMethod: 'cash',
    lines: [
      {
        menuItemId: MENU_ITEM_CLASSIC_ID,
        itemName: 'Classic Chicken Shawarma',
        unitPricePaise: 13900,
        quantity,
      },
    ],
  }
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: online })
  window.dispatchEvent(new Event(online ? 'online' : 'offline'))
}

describe('mock billing adapter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setOnline(true)
  })

  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(navigator, 'onLine')
  })

  it('starts with a shift open, so the counter is usable on arrival', () => {
    const adapter = createMockBillingAdapter(createDemoStore())
    expect(adapter.getCounterState().shift?.billerName).toBe('Demo Biller')
  })

  it('lists this outlet’s active billers, and only those', async () => {
    const adapter = createMockBillingAdapter(createDemoStore())
    const billers = await adapter.listBillers(DEMO_OUTLET_ID)

    expect(billers.map((biller) => biller.fullName)).toEqual(['Demo Biller', 'Demo Morning Biller'])
    // The Kanchrapara biller belongs to another counter entirely.
    expect(billers.map((biller) => biller.fullName)).not.toContain('Demo Evening Biller')
  })

  it('refuses a wrong PIN and an unknown biller with one identical sentence', async () => {
    const adapter = createMockBillingAdapter(createDemoStore())
    await adapter.closeShift(DEMO_OPEN_SHIFT_ID)

    const wrongPin = adapter
      .openShift({ outletId: DEMO_OUTLET_ID, billerProfileId: DEMO_MORNING_BILLER_ID, pin: '9999' })
      .catch((error: Error) => error.message)
    const unknownBiller = adapter
      .openShift({ outletId: DEMO_OUTLET_ID, billerProfileId: 'nobody', pin: DEMO_BILLER_PIN })
      .catch((error: Error) => error.message)

    expect(await wrongPin).toBe(await unknownBiller)
  })

  it('hands a shift over to the incoming biller', async () => {
    const adapter = createMockBillingAdapter(createDemoStore())
    await adapter.closeShift(DEMO_OPEN_SHIFT_ID)
    expect(adapter.getCounterState().shift).toBeNull()

    await adapter.openShift({
      outletId: DEMO_OUTLET_ID,
      billerProfileId: DEMO_MORNING_BILLER_ID,
      pin: DEMO_BILLER_PIN,
    })
    expect(adapter.getCounterState().shift?.billerName).toBe('Demo Morning Biller')
  })

  // Spec: counter writes are idempotent by client identity.
  it('stores one bill when the same client identity arrives twice', async () => {
    const store = createDemoStore()
    const adapter = createMockBillingAdapter(store)
    const before = store.bills.length

    await adapter.settleBill(draft(store, 'aaaaaaaa-0000-4000-8000-000000000001'))
    await expect(
      adapter.settleBill(draft(store, 'aaaaaaaa-0000-4000-8000-000000000001')),
    ).rejects.toThrow(/already been recorded/)

    await vi.advanceTimersByTimeAsync(AFTER_SEND_MS)
    expect(store.bills.length).toBe(before + 1)
  })

  // Spec: bill numbers are server-assigned; a duplicate retry burns no number.
  it('assigns a bill number only when the bill lands, never when it is queued', async () => {
    const store = createDemoStore()
    const adapter = createMockBillingAdapter(store)
    const highestBefore = store.billNumbers.get(DEMO_OUTLET_ID)!

    await adapter.settleBill(draft(store, 'bbbbbbbb-0000-4000-8000-000000000001'))

    // Waiting, and nothing has been written or numbered.
    expect(adapter.getCounterState().queued).toHaveLength(1)
    expect(store.billNumbers.get(DEMO_OUTLET_ID)).toBe(highestBefore)
    expect(store.bills.some((bill) => bill.id === 'bbbbbbbb-0000-4000-8000-000000000001')).toBe(
      false,
    )

    await vi.advanceTimersByTimeAsync(AFTER_SEND_MS)

    // Delivered: it has left the outbox, and only now has a number.
    expect(adapter.getCounterState().queued).toHaveLength(0)
    const landed = store.bills.find((bill) => bill.id === 'bbbbbbbb-0000-4000-8000-000000000001')
    expect(landed?.bill_number).toBe(highestBefore + 1)
  })

  // Spec: a cancelled bill consumes no number.
  it('leaves no gap in the sequence when a queued bill is cancelled', async () => {
    const store = createDemoStore()
    const adapter = createMockBillingAdapter(store)
    const highestBefore = store.billNumbers.get(DEMO_OUTLET_ID)!

    await adapter.settleBill(draft(store, 'cccccccc-0000-4000-8000-000000000001'))
    await adapter.cancelQueuedBill('cccccccc-0000-4000-8000-000000000001')

    // Nothing was written at all: an unsent bill is not in the database.
    expect(store.bills.some((bill) => bill.id === 'cccccccc-0000-4000-8000-000000000001')).toBe(
      false,
    )

    await adapter.settleBill(draft(store, 'dddddddd-0000-4000-8000-000000000001'))
    await vi.advanceTimersByTimeAsync(AFTER_SEND_MS)

    const landed = store.bills.find((bill) => bill.id === 'dddddddd-0000-4000-8000-000000000001')
    expect(landed?.bill_number).toBe(highestBefore + 1)
  })

  it('refuses an undo once the bill has gone', async () => {
    const store = createDemoStore()
    const adapter = createMockBillingAdapter(store)

    await adapter.settleBill(draft(store, 'eeeeeeee-0000-4000-8000-000000000001'))
    await vi.advanceTimersByTimeAsync(AFTER_SEND_MS)

    await expect(adapter.cancelQueuedBill('eeeeeeee-0000-4000-8000-000000000001')).rejects.toThrow(
      /already gone/,
    )
  })

  it('snapshots the line, so a later menu price change cannot rewrite it', async () => {
    const store = createDemoStore()
    const adapter = createMockBillingAdapter(store)

    await adapter.settleBill(draft(store, 'ffffffff-0000-4000-8000-000000000001', 2))
    // The menu moves while the bill is still in the queue.
    store.menuItems.find((item) => item.id === MENU_ITEM_CLASSIC_ID)!.price_paise = 19900
    await vi.advanceTimersByTimeAsync(AFTER_SEND_MS)

    const line = store.billItems.find(
      (item) => item.bill_id === 'ffffffff-0000-4000-8000-000000000001',
    )!
    expect(line.unit_price_paise).toBe(13900)
    expect(line.line_total_paise).toBe(27800)

    const bill = store.bills.find((row) => row.id === 'ffffffff-0000-4000-8000-000000000001')!
    expect(bill.total_paise).toBe(27800)
  })

  it('refuses a bill with no shift open, and one with nothing on it', async () => {
    const store = createDemoStore()
    const adapter = createMockBillingAdapter(store)

    await expect(adapter.settleBill({ ...draft(store, 'a1'), lines: [] })).rejects.toThrow(
      /nothing on this bill/,
    )

    await adapter.closeShift(DEMO_OPEN_SHIFT_ID)
    await expect(adapter.settleBill(draft(store, 'a2'))).rejects.toThrow(/No shift is open/)
  })

  describe('offline', () => {
    it('accumulates while offline, escalates, and drains when the link returns', async () => {
      const store = createDemoStore()
      const adapter = createMockBillingAdapter(store)
      const before = store.bills.length
      // The counter chrome is always subscribed in the app, and connectivity is
      // watched only while something is. Subscribing here is what makes this a
      // test of the counter rather than of an adapter nobody is looking at.
      const unsubscribe = adapter.subscribeCounter(() => {})

      setOnline(false)

      for (let index = 0; index < SYNC_ESCALATION_COUNT; index += 1) {
        await adapter.settleBill(draft(store, `0a000000-0000-4000-8000-00000000000${index}`))
      }
      await vi.advanceTimersByTimeAsync(AFTER_SEND_MS)

      // Nothing left, and the indicator has stopped calling it busy.
      expect(store.bills.length).toBe(before)
      expect(adapter.getCounterState().sync).toEqual({
        kind: 'stalled',
        pending: SYNC_ESCALATION_COUNT,
      })

      setOnline(true)
      await vi.advanceTimersByTimeAsync(AFTER_SEND_MS)

      expect(store.bills.length).toBe(before + SYNC_ESCALATION_COUNT)
      expect(adapter.getCounterState().sync).toEqual({ kind: 'synced', pending: 0 })

      // Exactly once each, numbered consecutively with no duplicates.
      const numbers = store.bills.slice(before).map((bill) => bill.bill_number)
      expect(new Set(numbers).size).toBe(SYNC_ESCALATION_COUNT)
      unsubscribe()
    })

    it('escalates on age even when only one bill is waiting', async () => {
      const store = createDemoStore()
      const adapter = createMockBillingAdapter(store)
      const unsubscribe = adapter.subscribeCounter(() => {})

      setOnline(false)
      await adapter.settleBill(draft(store, '0b000000-0000-4000-8000-000000000001'))
      expect(adapter.getCounterState().sync.kind).toBe('pending')

      await vi.advanceTimersByTimeAsync(SYNC_ESCALATION_MS)
      expect(adapter.getCounterState().sync.kind).toBe('stalled')
      unsubscribe()
    })
  })

  it('notifies subscribers and stops when they leave', async () => {
    const store = createDemoStore()
    const adapter = createMockBillingAdapter(store)
    const listener = vi.fn()

    const unsubscribe = adapter.subscribeCounter(listener)
    await adapter.settleBill(draft(store, '0c000000-0000-4000-8000-000000000001'))
    expect(listener).toHaveBeenCalled()

    const calls = listener.mock.calls.length
    unsubscribe()
    await adapter.settleBill(draft(store, '0c000000-0000-4000-8000-000000000002'))
    expect(listener.mock.calls.length).toBe(calls)
  })

  it('keeps the snapshot stable between changes', async () => {
    const store = createDemoStore()
    const adapter = createMockBillingAdapter(store)

    const first = adapter.getCounterState()
    expect(adapter.getCounterState()).toBe(first)

    await adapter.settleBill(draft(store, '0d000000-0000-4000-8000-000000000001'))
    expect(adapter.getCounterState()).not.toBe(first)
  })
})
