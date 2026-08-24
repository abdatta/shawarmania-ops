import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PAYMENT_EDIT_WINDOW_MS, SYNC_ESCALATION_COUNT, SYNC_ESCALATION_MS } from '@/domain'

import type { BillDraft, SaveOrderInput } from '../adapters'
import { createMockBillingAdapter } from './billing'
import { DEMO_BILLER_PIN, DEMO_MORNING_BILLER_ID, DEMO_OPEN_SHIFT_ID } from './fixtures/billing'
import { MENU_ITEM_CLASSIC_ID } from './fixtures/menu'
import { personaFixtures } from './fixtures/personas'
import { createDemoStore, DEMO_OUTLET_ID, type DemoStore } from './store'

/**
 * The mock counter has one job beyond looking right: to behave the way
 * `openspec/specs/counter-billing/spec.md` says the real thing will. Each test
 * below names the clause it is holding the mock to.
 */

/** Comfortably past the mock's immediate delivery latency. */
const AFTER_SEND_MS = 2_000

function draft(store: DemoStore, clientId: string, quantity = 1): BillDraft {
  return {
    clientId,
    outletId: DEMO_OUTLET_ID,
    shiftId: DEMO_OPEN_SHIFT_ID,
    businessDate: store.today,
    payments: [{ method: 'cash', amountPaise: 13900 * quantity }],
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

function orderDraft(store: DemoStore, clientId: string): SaveOrderInput {
  const bill = draft(store, clientId)
  return {
    clientId,
    outletId: bill.outletId,
    shiftId: bill.shiftId,
    businessDate: bill.businessDate,
    lines: bill.lines,
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

  it('applies a correction before delivery without changing the bill identity', async () => {
    const store = createDemoStore()
    const adapter = createMockBillingAdapter(store)
    const highestBefore = store.billNumbers.get(DEMO_OUTLET_ID)!

    const billId = 'cccccccc-0000-4000-8000-000000000001'
    await adapter.settleBill(draft(store, billId))
    const corrected = await adapter.correctBillPayment(billId, 0, [
      { method: 'upi', amountPaise: 13900 },
    ])
    expect(corrected.id).toBe(billId)
    expect(corrected.paymentRevision).toBe(1)
    expect((await adapter.listShiftHistory(DEMO_OPEN_SHIFT_ID)).totals).toContainEqual({
      method: 'upi',
      totalPaise: expect.any(Number),
    })
    await vi.advanceTimersByTimeAsync(AFTER_SEND_MS)
    const landed = store.bills.find((bill) => bill.id === billId)
    expect(landed?.bill_number).toBe(highestBefore + 1)
  })

  it('removes payment editing at the original five-minute deadline', async () => {
    const store = createDemoStore()
    const adapter = createMockBillingAdapter(store)

    await adapter.settleBill(draft(store, 'eeeeeeee-0000-4000-8000-000000000001'))
    await vi.advanceTimersByTimeAsync(PAYMENT_EDIT_WINDOW_MS)
    await expect(
      adapter.correctBillPayment('eeeeeeee-0000-4000-8000-000000000001', 0, [
        { method: 'upi', amountPaise: 13900 },
      ]),
    ).rejects.toThrow(/no longer be edited/)
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

  it('saves zero-discount orders, lists the outlet-wide pipeline, and acts only on its own tablet', async () => {
    const store = createDemoStore()
    const adapter = createMockBillingAdapter(store)
    const saved = await adapter.saveOrder(orderDraft(store, '10000000-0000-4000-8000-000000000001'))
    // The order exists locally first; the row lands with its number at delivery.
    expect(saved.orderNumber).toBe(0)
    expect(saved.localReference).toMatch(/^Local · [0-9A-Z]{4}$/)
    await vi.advanceTimersByTimeAsync(AFTER_SEND_MS)

    expect(store.orders.find((order) => order.id === saved.id)?.discount_paise).toBe(0)
    store.orders.find((order) => order.id === saved.id)!.device_id = 'another-tablet'
    // The pipeline list is the whole outlet's — another tablet's order shows,
    // creator chip and all. Acting on it is what stays tablet-scoped.
    expect((await adapter.listOpenOrders(DEMO_OUTLET_ID)).map((order) => order.id)).toContain(
      saved.id,
    )
    await expect(adapter.markOrderPrepared(saved.id, true)).rejects.toThrow(/not on this tablet/)
  })

  it('reports a manager-cancelled order by name when the tablet tries to pay it', async () => {
    const store = createDemoStore()
    const biller = createMockBillingAdapter(store)
    const managerPersona = personaFixtures.franchise_admin
    const manager = createMockBillingAdapter(store, {
      role: 'franchise_admin',
      userId: managerPersona.profile.id,
      outletIds: [DEMO_OUTLET_ID],
    })
    const saved = await biller.saveOrder(orderDraft(store, '20000000-0000-4000-8000-000000000001'))
    await vi.advanceTimersByTimeAsync(AFTER_SEND_MS)
    await manager.managerCancelOrder(saved.id, 'Kitchen closed')

    await expect(
      biller.payOrder(saved.id, [{ method: 'cash', amountPaise: saved.totalPaise }]),
    ).rejects.toThrow(/cancelled by Demo Manager/)
    expect(store.bills.some((bill) => bill.order_id === saved.id)).toBe(false)
  })

  it('pays an order as a new immutable bill and voids it without changing its contents', async () => {
    const store = createDemoStore()
    const biller = createMockBillingAdapter(store)
    const managerPersona = personaFixtures.franchise_admin
    const manager = createMockBillingAdapter(store, {
      role: 'franchise_admin',
      userId: managerPersona.profile.id,
      outletIds: [DEMO_OUTLET_ID],
    })
    const saved = await biller.saveOrder(orderDraft(store, '30000000-0000-4000-8000-000000000001'))
    await biller.markOrderPrepared(saved.id, true)
    const paid = await biller.payOrder(saved.id, [{ method: 'upi', amountPaise: saved.totalPaise }])
    if (!paid) throw new Error('a prepared order settles into a bill')
    const shiftHistory = await biller.listShiftHistory(DEMO_OPEN_SHIFT_ID)
    const corrected = await biller.correctBillPayment(paid.id, 0, [
      { method: 'cash', amountPaise: saved.totalPaise },
    ])
    // The manager can only void a delivered bill, so the payment lands first.
    await vi.advanceTimersByTimeAsync(AFTER_SEND_MS)
    const beforeLines = structuredClone(paid.lines)
    const voided = await manager.voidBill(paid.id, 'Wrong item rung')

    expect(corrected).toMatchObject({
      id: paid.id,
      orderNumber: paid.orderNumber,
      paymentRevision: 1,
      payments: [{ method: 'cash', amountPaise: saved.totalPaise }],
    })
    expect(shiftHistory.bills[0]).toMatchObject({
      id: paid.id,
      orderNumber: paid.orderNumber,
      paymentEditableUntil: expect.any(String),
    })
    expect(voided.status).toBe('void')
    expect(voided.voidReason).toBe('Wrong item rung')
    expect(voided.voidedBy).toEqual({ id: managerPersona.profile.id, name: 'Demo Manager' })
    expect(voided.lines).toEqual(beforeLines)
    expect(store.orders.find((order) => order.id === saved.id)?.discount_paise).toBe(0)
    expect(store.bills.find((bill) => bill.id === paid.id)?.discount_paise).toBe(0)
  })

  it('preserves an exact split and attributes only each allocation to its tender total', async () => {
    const store = createDemoStore()
    const biller = createMockBillingAdapter(store)
    const before = await biller.listShiftHistory(DEMO_OPEN_SHIFT_ID)
    const saved = await biller.saveOrder(orderDraft(store, '31000000-0000-4000-8000-000000000001'))
    await biller.markOrderPrepared(saved.id, true)
    const paid = await biller.payOrder(saved.id, [
      { method: 'cash', amountPaise: 10000 },
      { method: 'upi', amountPaise: 3900 },
    ])
    if (!paid) throw new Error('a prepared order settles into a bill')
    const history = await biller.listShiftHistory(DEMO_OPEN_SHIFT_ID)

    expect(paid.paymentMethod).toBe('mixed')
    expect(paid.payments).toEqual([
      { method: 'cash', amountPaise: 10000 },
      { method: 'upi', amountPaise: 3900 },
    ])
    // Delivered, the split bill carries no single payment_method of its own.
    await vi.advanceTimersByTimeAsync(AFTER_SEND_MS)
    expect(store.bills.find((bill) => bill.id === paid.id)?.payment_method).toBeNull()
    const totalFor = (method: 'cash' | 'upi', source: typeof history) =>
      source.totals.find((total) => total.method === method)?.totalPaise ?? 0
    expect(totalFor('cash', history) - totalFor('cash', before)).toBe(10000)
    expect(totalFor('upi', history) - totalFor('upi', before)).toBe(3900)
    expect(history.totals.map((total) => total.method)).toEqual(['cash', 'upi'])
  })

  it('limits My shift to the open shift business date and tablet', async () => {
    const store = createDemoStore()
    const adapter = createMockBillingAdapter(store)
    const history = await adapter.listShiftHistory(DEMO_OPEN_SHIFT_ID)

    expect(history.bills.length).toBeGreaterThan(0)
    expect(history.bills.every((bill) => bill.businessDate === store.today)).toBe(true)
    expect(history.bills.length).toBeLessThan(
      store.bills.filter((bill) => bill.shift_id === DEMO_OPEN_SHIFT_ID).length,
    )
  })

  it('attributes manager history to the biller and keeps outlet scope intact', async () => {
    const store = createDemoStore()
    const managerPersona = personaFixtures.franchise_admin
    const manager = createMockBillingAdapter(store, {
      role: 'franchise_admin',
      userId: managerPersona.profile.id,
      outletIds: [DEMO_OUTLET_ID],
    })

    const history = await manager.listManagerHistory({ outletId: DEMO_OUTLET_ID })
    expect(history.length).toBeGreaterThan(0)
    expect(history[0]?.billerName).toMatch(/^Demo /)
    await expect(manager.listManagerHistory({ outletId: 'another-outlet' })).rejects.toThrow(
      /not manage/,
    )
  })

  it('keeps needs-attention resolution on the originating tablet and diagnostics read-only', async () => {
    const store = createDemoStore()
    const biller = createMockBillingAdapter(store)
    const managerPersona = personaFixtures.franchise_admin
    const manager = createMockBillingAdapter(store, {
      role: 'franchise_admin',
      userId: managerPersona.profile.id,
      outletIds: [DEMO_OUTLET_ID],
    })
    const [item] = await biller.listAttention()
    expect(item?.state).toBe('needs_attention')
    const corrected = await biller.correctAttention(
      item!.reference,
      '40000000-0000-4000-8000-000000000001',
    )
    expect(corrected.linkedCorrectionId).not.toBe(corrected.reference)
    expect(corrected.refusedTrace).toMatch(/server refused/)

    const diagnostics = await manager.listDeliveryDiagnostics(DEMO_OUTLET_ID)
    expect(diagnostics[0]).toEqual(expect.objectContaining({ reference: item!.reference }))
    expect(diagnostics[0]).not.toHaveProperty('refusedTrace')
    expect(diagnostics[0]).not.toHaveProperty('customerPhone')
    await expect(manager.correctAttention(item!.reference, 'different')).rejects.toThrow(
      /originating tablet/,
    )
  })

  it('requires reasons for cancellation and discard, and a fresh store resets both', async () => {
    const store = createDemoStore()
    const adapter = createMockBillingAdapter(store)
    const saved = await adapter.saveOrder(orderDraft(store, '50000000-0000-4000-8000-000000000001'))
    await expect(adapter.cancelOrder(saved.id, ' ')).rejects.toThrow(/reason/)
    const [item] = await adapter.listAttention()
    await expect(adapter.discardAttention(item!.reference, '')).rejects.toThrow(/reason/)
    await adapter.discardAttention(item!.reference, 'Duplicate attempt')

    const resetStore = createDemoStore()
    const reset = createMockBillingAdapter(resetStore)
    expect(resetStore.orders.some((order) => order.id === saved.id)).toBe(false)
    expect((await reset.listAttention())[0]?.state).toBe('needs_attention')
  })

  describe('the uniform command queue', () => {
    // Spec: every counter write queues; numbers are server-assigned at send.
    it('queues an order like a bill and mints its number at delivery', async () => {
      const store = createDemoStore()
      const adapter = createMockBillingAdapter(store)
      const ordersBefore = store.orders.length
      const highestBefore = store.orderNumbers.get(`${DEMO_OUTLET_ID}:${store.today}`)!

      const saved = await adapter.saveOrder(
        orderDraft(store, '60000000-0000-4000-8000-000000000001'),
      )

      // Waiting: visible under a local reference, unwritten and unnumbered.
      expect(adapter.getCounterState().sync.pending).toBe(1)
      expect(store.orders.length).toBe(ordersBefore)
      expect(store.orderNumbers.get(`${DEMO_OUTLET_ID}:${store.today}`)).toBe(highestBefore)
      const listed = await adapter.listOpenOrders(DEMO_OUTLET_ID)
      expect(listed.find((order) => order.id === saved.id)?.localReference).toMatch(
        /^Local · [0-9A-Z]{4}$/,
      )

      await vi.advanceTimersByTimeAsync(AFTER_SEND_MS)
      const delivered = store.orders.find((order) => order.id === saved.id)
      expect(delivered?.order_number).toBe(highestBefore + 1)
      const afterDelivery = await adapter.listOpenOrders(DEMO_OUTLET_ID)
      expect(afterDelivery.find((order) => order.id === saved.id)?.localReference).toBeNull()
    })

    // Spec: the queue drains when the screen subscribes, not only on reconnect.
    it('delivers the seeded pending bill on subscribe without a network event', async () => {
      const store = createDemoStore({ billingLifecycle: true })
      const adapter = createMockBillingAdapter(store)
      const before = store.bills.length

      // Not subscribed yet: the seeded bill waits exactly as it was seeded.
      expect(adapter.getCounterState().queued).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(AFTER_SEND_MS)
      expect(store.bills.length).toBe(before)

      const unsubscribe = adapter.subscribeCounter(() => {})
      await vi.advanceTimersByTimeAsync(AFTER_SEND_MS)

      expect(store.bills.length).toBe(before + 1)
      expect(adapter.getCounterState().queued).toHaveLength(0)
      unsubscribe()
    })

    it('marks prepared, refuses to reprepare once paid, and allows prepare-after-pay', async () => {
      const store = createDemoStore()
      const adapter = createMockBillingAdapter(store)
      const saved = await adapter.saveOrder(
        orderDraft(store, '61000000-0000-4000-8000-000000000001'),
      )
      await vi.advanceTimersByTimeAsync(AFTER_SEND_MS)

      const prepared = await adapter.markOrderPrepared(saved.id, true)
      expect(prepared.preparedAt).not.toBeNull()
      await vi.advanceTimersByTimeAsync(AFTER_SEND_MS)
      expect(store.orders.find((order) => order.id === saved.id)?.prepared_at).not.toBeNull()

      const paid = await adapter.payOrder(saved.id, [
        { method: 'cash', amountPaise: saved.totalPaise },
      ])
      if (!paid) throw new Error('a prepared order settles into a bill')
      await vi.advanceTimersByTimeAsync(AFTER_SEND_MS)

      // Reprepare dies at the bills border.
      await expect(adapter.markOrderPrepared(saved.id, false)).rejects.toThrow(/paid/)

      // Back to open with its preparation preserved...
      const reopened = await adapter.unpayOrder(saved.id, paid.id, 'Wrong total rung')
      expect(reopened.status).toBe('open')
      await vi.advanceTimersByTimeAsync(AFTER_SEND_MS)

      // ...so clearing the mark is legal again, and the upfront payer's path
      // opens: paying an unprepared order holds the money without a bill, and
      // marking prepared is what settles it.
      await adapter.markOrderPrepared(saved.id, false)
      await vi.advanceTimersByTimeAsync(AFTER_SEND_MS)
      const billsBeforeHeldPay = store.bills.length
      const held = await adapter.payOrder(saved.id, [
        { method: 'cash', amountPaise: saved.totalPaise },
      ])
      expect(held).toBeNull()
      expect(store.bills.length).toBe(billsBeforeHeldPay)
      await vi.advanceTimersByTimeAsync(AFTER_SEND_MS)

      // Preparation is what mints the bill for the upfront payer.
      await adapter.markOrderPrepared(saved.id, true)
      expect(store.bills.length).toBe(billsBeforeHeldPay)
      await vi.advanceTimersByTimeAsync(AFTER_SEND_MS)
      expect(store.bills.length).toBe(billsBeforeHeldPay + 1)
      const settledRow = store.bills.find(
        (bill) => bill.order_id === saved.id && bill.status === 'settled',
      )
      expect(settledRow).toBeDefined()
      expect(store.orders.find((order) => order.id === saved.id)?.bill_id).toBe(settledRow!.id)
      void prepared
    })

    it('keeps a paid-but-unprepared order in the pipeline wearing its paid state', async () => {
      const store = createDemoStore()
      const adapter = createMockBillingAdapter(store)
      const saved = await adapter.saveOrder(
        orderDraft(store, '62000000-0000-4000-8000-000000000001'),
      )
      await vi.advanceTimersByTimeAsync(AFTER_SEND_MS)

      // No bill yet: an order enters Bills only when prepared AND paid.
      const held = await adapter.payOrder(saved.id, [
        { method: 'cash', amountPaise: saved.totalPaise },
      ])
      expect(held).toBeNull()
      expect(store.bills.some((bill) => bill.order_id === saved.id)).toBe(false)
      const listed = await adapter.listOpenOrders(DEMO_OUTLET_ID)
      const card = listed.find((order) => order.id === saved.id)
      expect(card).toMatchObject({ status: 'paid', preparedAt: null, billId: null })

      // Preparation is what carries it across the bills border.
      await adapter.markOrderPrepared(saved.id, true)
      await vi.advanceTimersByTimeAsync(AFTER_SEND_MS)
      expect(store.bills.some((bill) => bill.order_id === saved.id)).toBe(true)
      const settled = await adapter.listOpenOrders(DEMO_OUTLET_ID)
      expect(settled.find((order) => order.id === saved.id)).toBeUndefined()
    })

    it('takes a payment back within the window as one atomic unwind, and refuses outside it', async () => {
      const store = createDemoStore()
      const adapter = createMockBillingAdapter(store)
      const saved = await adapter.saveOrder(
        orderDraft(store, '63000000-0000-4000-8000-000000000001'),
      )
      await vi.advanceTimersByTimeAsync(AFTER_SEND_MS)
      await adapter.markOrderPrepared(saved.id, true)
      const paid = await adapter.payOrder(saved.id, [
        { method: 'cash', amountPaise: saved.totalPaise },
      ])
      if (!paid) throw new Error('a prepared order settles into a bill')
      await vi.advanceTimersByTimeAsync(AFTER_SEND_MS)
      const billsBefore = store.bills.length

      const reopened = await adapter.unpayOrder(saved.id, paid.id, 'Wrong tender')
      expect(reopened).toMatchObject({ status: 'open', billId: null })

      await vi.advanceTimersByTimeAsync(AFTER_SEND_MS)
      const billRow = store.bills.find((bill) => bill.id === paid.id)!
      expect(store.bills.length).toBe(billsBefore)
      expect(billRow).toMatchObject({
        status: 'void',
        void_kind: 'counter_unpay',
        void_reason: 'Wrong tender',
      })
      const orderRow = store.orders.find((order) => order.id === saved.id)!
      expect(orderRow).toMatchObject({ status: 'open', bill_id: null, paid_by: null })
    })

    it('refuses an unwind outside the five-minute window', async () => {
      const store = createDemoStore()
      const adapter = createMockBillingAdapter(store)
      const saved = await adapter.saveOrder(
        orderDraft(store, '65000000-0000-4000-8000-000000000001'),
      )
      await vi.advanceTimersByTimeAsync(AFTER_SEND_MS)
      await adapter.markOrderPrepared(saved.id, true)
      const paid = await adapter.payOrder(saved.id, [
        { method: 'cash', amountPaise: saved.totalPaise },
      ])
      if (!paid) throw new Error('a prepared order settles into a bill')
      await vi.advanceTimersByTimeAsync(AFTER_SEND_MS)

      // The clock is measured from when the money changed hands, never a timer.
      adapter.advanceDemoPaymentClock!(PAYMENT_EDIT_WINDOW_MS)
      await expect(adapter.unpayOrder(saved.id, paid.id, 'Too late')).rejects.toThrow(
        /no longer be taken back/,
      )
      // And nothing queued: the refusal left no trace in the outbox.
      expect(adapter.getCounterState().sync.pending).toBe(0)
    })

    it('cancels a paid order with one reasoned act that voids and cancels together', async () => {
      const store = createDemoStore()
      const adapter = createMockBillingAdapter(store)
      const saved = await adapter.saveOrder(
        orderDraft(store, '64000000-0000-4000-8000-000000000001'),
      )
      await vi.advanceTimersByTimeAsync(AFTER_SEND_MS)
      await adapter.markOrderPrepared(saved.id, true)
      const paid = await adapter.payOrder(saved.id, [
        { method: 'upi', amountPaise: saved.totalPaise },
      ])
      if (!paid) throw new Error('a prepared order settles into a bill')
      await vi.advanceTimersByTimeAsync(AFTER_SEND_MS)

      await expect(adapter.cancelPaidOrder(saved.id, ' ')).rejects.toThrow(/reason/)
      const cancelled = await adapter.cancelPaidOrder(saved.id, 'Customer left')
      expect(cancelled).toMatchObject({ status: 'cancelled', cancelReason: 'Customer left' })

      await vi.advanceTimersByTimeAsync(AFTER_SEND_MS)
      expect(store.bills.find((bill) => bill.id === paid.id)).toMatchObject({
        status: 'void',
        void_kind: 'cancelled_after_paid',
        void_reason: 'Customer left',
      })
      expect(store.orders.find((order) => order.id === saved.id)).toMatchObject({
        status: 'cancelled',
        bill_id: null,
        paid_at: null,
        paid_by: null,
        cancel_reason: 'Customer left',
      })
      // Cancelled work is off the pipeline for good.
      expect(
        (await adapter.listOpenOrders(DEMO_OUTLET_ID)).some((order) => order.id === saved.id),
      ).toBe(false)
    })
  })
})
