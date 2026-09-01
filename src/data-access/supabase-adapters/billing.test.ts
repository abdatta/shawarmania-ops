import 'fake-indexeddb/auto'

import Dexie from 'dexie'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BillDraft, BillingOrder, PaymentMethod } from '../adapters'
import type { Database } from '../database.types'
import {
  BILLING_DELIVERY_DATABASE_NAME,
  BillingDeliveryDatabase,
  BillingDrainCoordinator,
  BillingDeliveryStore,
  COUNTER_RESUME_SCHEMA_VERSION,
  type CounterResumeRecord,
} from '@/outbox'
import type { CounterDeviceSession } from '@/session/counter-session'

import { createBillingCommand } from '../../../shared/billing-command'
import { splitPipeline } from '@/features/billing/pipeline'

import { createSupabaseBillingAdapter } from './billing'
import { createSupabaseBillingCommandAdapter } from './billing-command'

const session: CounterDeviceSession = {
  kind: 'counter-device',
  device: { deviceId: '10000000-0000-4000-a000-000000000004', outletId: 'outlet-1', label: 'Till' },
  shift: {
    id: 'shift-1',
    personId: 'person-1',
    outletId: 'outlet-1',
    openedAt: '2026-08-11T05:30:00.000Z',
    businessDate: '2026-08-11',
    expiresAt: '2099-08-12T00:00:00.000Z',
  },
}

const draft: BillDraft = {
  clientId: '10000000-0000-4000-a000-000000000099',
  outletId: 'outlet-1',
  shiftId: 'shift-1',
  businessDate: '2026-08-11',
  payments: [
    { method: 'cash', amountPaise: 10_000 },
    { method: 'upi', amountPaise: 3_900 },
  ],
  lines: [
    {
      menuItemId: 'item-1',
      itemName: 'Classic Chicken Shawarma',
      unitPricePaise: 13_900,
      quantity: 1,
    },
  ],
  customerName: 'Asha',
  customerPhone: '+919876543210',
}

const orderInput = {
  clientId: '10000000-0000-4000-a000-000000000088',
  outletId: session.device.outletId,
  shiftId: session.shift!.id,
  businessDate: session.shift!.businessDate,
  lines: draft.lines,
  customerName: 'Asha',
  customerPhone: null,
}

function clientWithRpc(rpc = vi.fn()) {
  return { rpc } as unknown as SupabaseClient<Database>
}

function offlineClient() {
  const failed = { data: null, error: new Error('backend unavailable') }
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    order: () => query,
    maybeSingle: () => Promise.resolve(failed),
    then: (resolve: (value: typeof failed) => unknown) => Promise.resolve(failed).then(resolve),
  }
  return { rpc: vi.fn(), from: () => query } as unknown as SupabaseClient<Database>
}

function emptyReadableClient() {
  const response = { data: [], error: null }
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    limit: () => query,
    order: () => query,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (resolve: (value: typeof response) => unknown) => Promise.resolve(response).then(resolve),
  }
  return { rpc: vi.fn(), from: () => query } as unknown as SupabaseClient<Database>
}

function managerHistoryClient() {
  const bill = {
    id: 'bill-1',
    outlet_id: 'outlet-1',
    bill_number: 42,
    business_date: '2026-08-11',
    ordered_at: '2026-08-11T12:00:00.000Z',
    paid_at: '2026-08-11T12:05:00.000Z',
    payment_business_date: '2026-08-11',
    total_paise: 13_900,
    payment_method: 'upi',
    status: 'settled',
    customer_name: 'Demo Customer',
    customer_phone: '9000000000',
    void_reason: null,
    voided_at: null,
    voider: null,
    bill_items: [
      {
        id: 'line-1',
        menu_item_id: 'item-1',
        item_name: 'Classic Chicken Shawarma',
        unit_price_paise: 13_900,
        quantity: 1,
      },
    ],
    bill_payments: [{ method: 'upi', amount_paise: 13_900 }],
    order: { order_number: 9 },
    biller: { full_name: 'Demo Biller' },
  }
  const selected: string[] = []
  const from = vi.fn((table: string) => {
    if (table === 'effective_bill_payments') {
      const query = {
        select: () => query,
        in: () => Promise.resolve({ data: [], error: null }),
      }
      return query
    }
    const query = {
      select: (columns: string) => {
        selected.push(columns)
        return query
      },
      eq: () => query,
      order: () => Promise.resolve({ data: [bill], error: null }),
    }
    return query
  })
  return {
    client: { rpc: vi.fn(), from } as unknown as SupabaseClient<Database>,
    selected,
  }
}

beforeEach(async () => Dexie.delete(BILLING_DELIVERY_DATABASE_NAME))
afterEach(async () => Dexie.delete(BILLING_DELIVERY_DATABASE_NAME))

describe('the live tablet acceptance boundary', () => {
  it('resolves existing biller attribution for manager history', async () => {
    const { client, selected } = managerHistoryClient()
    const billing = createSupabaseBillingAdapter(client)

    await expect(billing.listManagerHistory({ outletId: 'outlet-1' })).resolves.toMatchObject([
      {
        id: 'bill-1',
        billerName: 'Demo Biller',
        customerName: 'Demo Customer',
        customerPhone: '9000000000',
      },
    ])
    expect(selected[0]).toContain('biller:profiles!bills_biller_profile_id_fkey(full_name)')
    expect(selected[0]).toContain('voider:profiles!bills_voided_by_fkey(id, full_name)')
  })

  it('commits an exact split-tender, zero-discount command locally before any request', async () => {
    const rpc = vi.fn()
    const billing = createSupabaseBillingAdapter(clientWithRpc(rpc), session)

    await billing.settleBill(draft)

    const database = new BillingDeliveryDatabase()
    const envelope = await database.envelopes.get(draft.clientId)
    expect(rpc).not.toHaveBeenCalled()
    expect(envelope).toMatchObject({
      state: 'pending',
      tabletId: session.device.deviceId,
      shiftId: session.shift?.id,
      businessDate: draft.businessDate,
      type: 'pay_now',
    })
    expect(envelope?.command.type === 'pay_now' && envelope.command.payload).toMatchObject({
      discountPaise: 0,
      taxPaise: 0,
      totalPaise: 13_900,
      payments: draft.payments,
    })
    // "Immediate" means no retry/backoff delay. Hashing and IndexedDB can take
    // several event-loop turns when the full suite is exercising them in parallel.
    expect((envelope?.eligibleAtMs ?? 0) - (envelope?.createdAtMs ?? 0)).toBeLessThan(250)
    database.close()
  })

  it('rebuilds an offline payment and its correction from IndexedDB after restart', async () => {
    const firstAdapter = createSupabaseBillingAdapter(emptyReadableClient(), session)
    await firstAdapter.settleBill(draft)
    await firstAdapter.correctBillPayment(draft.clientId, 0, [
      { method: 'upi', amountPaise: 13_900 },
    ])

    const restartedAdapter = createSupabaseBillingAdapter(emptyReadableClient(), session)
    await expect(restartedAdapter.listShiftHistory(session.shift!.id)).resolves.toMatchObject({
      bills: [
        {
          id: draft.clientId,
          paymentRevision: 1,
          payments: [{ method: 'upi', amountPaise: 13_900 }],
        },
      ],
      totals: [
        { method: 'cash', totalPaise: 0 },
        { method: 'upi', totalPaise: 13_900 },
      ],
    })

    const database = new BillingDeliveryDatabase()
    const corrections = await database.envelopes
      .where('type')
      .equals('correct_bill_payment')
      .toArray()
    const dependencies = await database.dependencies
      .where('commandId')
      .equals(corrections[0]!.commandId)
      .toArray()
    expect(dependencies).toMatchObject([{ dependsOnCommandId: draft.clientId }])
    database.close()
  })

  it.each(['swiggy', 'zomato', 'card', 'other'])(
    'rejects a hand-crafted %s allocation before it reaches storage',
    async (method) => {
      const billing = createSupabaseBillingAdapter(clientWithRpc(), session)
      const bad = {
        ...draft,
        clientId: crypto.randomUUID(),
        payments: [{ method: method as PaymentMethod, amountPaise: 13_900 }],
      }

      await expect(billing.settleBill(bad)).rejects.toMatchObject({ code: 'invalid_payment' })
      const database = new BillingDeliveryDatabase()
      await expect(database.envelopes.count()).resolves.toBe(0)
      database.close()
    },
  )

  it('rejects expired and mismatched shift scope before anything reaches IndexedDB', async () => {
    const expired = createSupabaseBillingAdapter(clientWithRpc(), {
      ...session,
      shift: { ...session.shift!, expiresAt: '2020-01-01T00:00:00.000Z' },
    })
    await expect(expired.settleBill(draft)).rejects.toMatchObject({ code: 'no_shift' })

    // The record governs, not the session object beside it. The shift on this
    // session is still years ahead; the remembered shift it resumed from has
    // passed its expiry — which IS the outlet cutover, authored by
    // `app_next_cutover` when the shift opened — so new work stops.
    const cutOver = createSupabaseBillingAdapter(clientWithRpc(), {
      ...session,
      offlineResume: {
        shift: { expiresAt: '2020-01-01T00:00:00.000Z' },
      } as CounterResumeRecord,
    })
    await expect(cutOver.settleBill(draft)).rejects.toMatchObject({ code: 'no_shift' })

    const billing = createSupabaseBillingAdapter(clientWithRpc(), session)
    await expect(
      billing.saveOrder({
        clientId: crypto.randomUUID(),
        outletId: 'another-outlet',
        shiftId: session.shift!.id,
        businessDate: session.shift!.businessDate,
        lines: draft.lines,
        customerName: 'Asha',
        customerPhone: null,
      }),
    ).rejects.toMatchObject({ code: 'not_permitted' })

    const database = new BillingDeliveryDatabase()
    await expect(database.envelopes.count()).resolves.toBe(0)
    database.close()
  })

  it('keeps an offline order usable through its dependency chain under a local reference', async () => {
    const billing = createSupabaseBillingAdapter(offlineClient(), session)
    const orderId = orderInput.clientId

    const created = await billing.saveOrder(orderInput)
    expect(created.localReference).toMatch(/^Local · [0-9A-Z]{4}$/)
    await expect(billing.listOpenOrders(session.device.outletId)).resolves.toMatchObject([
      { id: orderId, localReference: created.localReference, lines: [{ quantity: 1 }] },
    ])

    await billing.reviseOrder(orderId, {
      lines: [{ ...draft.lines[0]!, quantity: 2 }],
      customerName: 'Asha',
      customerPhone: null,
    })
    await expect(billing.listOpenOrders(session.device.outletId)).resolves.toMatchObject([
      { id: orderId, lines: [{ quantity: 2 }], totalPaise: 27_800 },
    ])

    await billing.cancelOrder(orderId, 'Customer changed mind')
    await expect(billing.listOpenOrders(session.device.outletId)).resolves.toEqual([])

    const database = new BillingDeliveryDatabase()
    const envelopes = (await database.envelopes.toArray()).sort(
      (left, right) => left.createdAtMs - right.createdAtMs,
    )
    const dependencies = await database.dependencies.toArray()
    expect(envelopes.map((envelope) => envelope.type)).toEqual([
      'create_order',
      'revise_order',
      'cancel_order',
    ])
    expect(dependencies).toHaveLength(2)
    database.close()
  })

  it('overlays new durable commands onto the persisted server base after a cold start', async () => {
    const rememberedOrder: BillingOrder = {
      id: orderInput.clientId,
      outletId: 'outlet-1',
      deviceId: session.device.deviceId,
      orderNumber: 17,
      localReference: null,
      businessDate: '2026-08-11',
      orderedAt: '2026-08-11T12:00:00.000Z',
      preparedAt: null,
      status: 'open',
      creatorId: 'person-1',
      creatorName: 'Asha',
      customerName: null,
      customerPhone: null,
      lines: draft.lines,
      totalPaise: 13_900,
      cancelReason: null,
      cancelledAt: null,
      cancelledByName: null,
      paidAt: null,
      billId: null,
    }
    const resume = {
      tabletId: session.device.deviceId,
      schemaVersion: COUNTER_RESUME_SCHEMA_VERSION,
      complete: true,
      tablet: {
        id: session.device.deviceId,
        label: session.device.label,
        outletId: session.device.outletId,
      },
      shift: { ...session.shift! },
      outlet: { id: 'outlet-1', business_day_cutover: '04:00:00' },
      menu: [],
      pipeline: [rememberedOrder],
      bills: [],
      rememberedCustomers: {},
      lastSuccessfulReadAt: '2026-08-11T12:00:00.000Z',
      serverObservedAt: '2026-08-11T12:00:00.000Z',
      deviceObservedAt: '2026-08-11T12:00:00.000Z',
    } as unknown as CounterResumeRecord
    const billing = createSupabaseBillingAdapter(offlineClient(), {
      ...session,
      offlineResume: resume,
    })

    await expect(billing.listOpenOrders('outlet-1')).resolves.toMatchObject([
      { id: rememberedOrder.id, orderNumber: 17, preparedAt: null },
    ])
    await billing.markOrderPrepared(rememberedOrder.id, true)
    await expect(billing.listOpenOrders('outlet-1')).resolves.toMatchObject([
      { id: rememberedOrder.id, preparedAt: expect.any(String) },
    ])
  })

  it('reports an explicitly offline Finish Day check without waiting for a network timeout', async () => {
    const previous = Object.getOwnPropertyDescriptor(navigator, 'onLine')
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    try {
      const billing = createSupabaseBillingAdapter(offlineClient(), session)
      const readiness = await billing.inspectFinishDay(session.shift!.id)

      expect(readiness.serverReachable).toBe(false)
      expect(readiness.canFinish).toBe(false)
    } finally {
      if (previous) Object.defineProperty(navigator, 'onLine', previous)
      else Reflect.deleteProperty(navigator, 'onLine')
    }
  })

  // Spec: preparation commands ride the same outbox as every sibling, unwinds
  // chain behind the payment they reverse, and reads project all of it before
  // anything is delivered.
  it('lands an offline order → prepare → pay → un-pay → prepare sequence exactly once, in chain order', async () => {
    const billing = createSupabaseBillingAdapter(offlineClient(), session)
    const orderId = orderInput.clientId
    const settle = () => new Promise((resolve) => setTimeout(resolve, 2))

    await billing.saveOrder(orderInput)
    await settle()
    await billing.markOrderPrepared(orderId, true)
    await settle()
    const paid = await billing.payOrder(orderId, [
      { method: 'cash', amountPaise: draft.lines[0]!.unitPricePaise },
    ])
    if (!paid) throw new Error('a prepared order settles into a bill')
    await settle()

    // Paid *and* prepared has crossed into Bills this shift — it no longer
    // lists in the rail. The rail keeps only paid-but-still-unprepared work.
    await expect(billing.listOpenOrders(session.device.outletId)).resolves.toEqual([])

    await billing.unpayOrder(orderId, paid.id, 'Rung the wrong total')
    await settle()
    // The unwind reopens the order with its preparation intact.
    await expect(billing.listOpenOrders(session.device.outletId)).resolves.toMatchObject([
      { id: orderId, status: 'open', preparedAt: expect.any(String), billId: null },
    ])

    // Unpaid again, so reprepare is legal — back to Preparing it goes.
    await billing.markOrderPrepared(orderId, false)
    await settle()
    await expect(billing.listOpenOrders(session.device.outletId)).resolves.toMatchObject([
      { id: orderId, status: 'open', preparedAt: null, billId: null },
    ])

    const database = new BillingDeliveryDatabase()
    const envelopes = await database.envelopes.toArray()
    expect(new Set(envelopes.map((envelope) => envelope.commandId)).size).toBe(envelopes.length)

    // Walk the dependency graph from its root: that ordering, not wall-clock
    // milliseconds, is what delivery follows.
    const dependencies = await database.dependencies.toArray()
    const byId = new Map(envelopes.map((envelope) => [envelope.commandId, envelope]))
    let cursor = envelopes.find(
      (envelope) => !dependencies.some((d) => d.commandId === envelope.commandId),
    )
    const ordered: NonNullable<typeof cursor>[] = []
    while (cursor) {
      ordered.push(cursor)
      const next = dependencies.find((d) => d.dependsOnCommandId === cursor!.commandId)
      cursor = next ? byId.get(next.commandId) : undefined
    }
    expect(ordered).toHaveLength(envelopes.length)
    expect(dependencies).toHaveLength(envelopes.length - 1)
    expect(ordered.map((envelope) => envelope.type)).toEqual([
      'create_order',
      'set_order_preparation',
      'pay_order',
      'void_order_payment',
      'set_order_preparation',
    ])
    database.close()
  })

  it('drains twenty mixed cold-start commands exactly once with every chain intact', async () => {
    const resumed = createSupabaseBillingAdapter(offlineClient(), session)
    const pause = () => new Promise((resolve) => setTimeout(resolve, 2))
    const nextOrder = (suffix: string) => ({
      ...orderInput,
      clientId: `20000000-0000-4000-a000-${suffix.padStart(12, '0')}`,
    })

    const first = nextOrder('1')
    await resumed.saveOrder(first)
    await pause()
    await resumed.reviseOrder(first.clientId, { ...first, customerName: 'Asha revised' })
    await pause()
    await resumed.markOrderPrepared(first.clientId, true)
    await pause()
    const firstBill = await resumed.payOrder(first.clientId, [
      { method: 'cash', amountPaise: 13_900 },
    ])
    if (!firstBill) throw new Error('the prepared order should settle locally')
    await pause()
    await resumed.correctBillPayment(firstBill.id, 0, [{ method: 'upi', amountPaise: 13_900 }])
    await pause()
    await resumed.unpayOrder(first.clientId, firstBill.id, 'Tender correction needed')
    await pause()
    await resumed.markOrderPrepared(first.clientId, false)
    await pause()
    await resumed.cancelOrder(first.clientId, 'Customer changed their mind')

    const second = nextOrder('2')
    await pause()
    await resumed.saveOrder(second)
    await pause()
    await resumed.markOrderPrepared(second.clientId, true)
    await pause()
    const secondBill = await resumed.payOrder(second.clientId, [
      { method: 'cash', amountPaise: 13_900 },
    ])
    if (!secondBill) throw new Error('the second prepared order should settle locally')
    await pause()
    await resumed.cancelPaidOrder(second.clientId, 'Duplicate order')

    const third = nextOrder('3')
    await pause()
    await resumed.saveOrder(third)
    await pause()
    await resumed.markOrderPrepared(third.clientId, true)
    await pause()
    await resumed.markOrderPrepared(third.clientId, false)
    await pause()
    await resumed.cancelOrder(third.clientId, 'Kitchen stopped it')

    for (let index = 4; index <= 7; index += 1) {
      await pause()
      await resumed.settleBill({
        ...draft,
        clientId: `20000000-0000-4000-a000-${String(index).padStart(12, '0')}`,
        customerName: `Mixed command ${index}`,
      })
    }

    const database = new BillingDeliveryDatabase()
    const store = new BillingDeliveryStore(database)
    const commands = await database.envelopes.toArray()
    expect(commands).toHaveLength(20)
    expect(new Set(commands.map((row) => row.commandId)).size).toBe(20)

    const delivered: string[] = []
    const drain = new BillingDrainCoordinator({
      store,
      tabletId: session.device.deviceId,
      ownerId: 'twenty-command-test',
      locks: null,
      now: () => Date.now() + 60_000,
      connectivityTarget: null,
      execute: async (command) => {
        delivered.push(command.commandId)
        return { status: 'accepted', commandId: command.commandId }
      },
    })

    await expect(drain.runOnce()).resolves.toBe(20)
    await expect(drain.runOnce()).resolves.toBe(0)
    expect(delivered).toHaveLength(20)
    expect(new Set(delivered).size).toBe(20)
    await expect(database.envelopes.count()).resolves.toBe(0)
    await drain.stop()
    database.close()
  })

  it('refuses to reprepare a paid order before anything reaches storage', async () => {
    const rpc = vi.fn()
    const billing = createSupabaseBillingAdapter(clientWithRpc(rpc), session)
    await billing.saveOrder(orderInput)
    await billing.payOrder(orderInput.clientId, [
      { method: 'cash', amountPaise: draft.lines[0]!.unitPricePaise },
    ])

    await expect(billing.markOrderPrepared(orderInput.clientId, false)).rejects.toMatchObject({
      code: 'not_open',
    })
    const database = new BillingDeliveryDatabase()
    const types = (await database.envelopes.toArray()).map((envelope) => envelope.type)
    expect([...types].sort()).toEqual(['create_order', 'pay_order'])
    database.close()
  })

  it('uses missing-response evidence to show the queue stopped sending immediately', async () => {
    const rpc = vi.fn(async (name: string) =>
      name === 'create_billing_order'
        ? { data: null, error: new Error('no response'), status: 0 }
        : { data: null, error: null, status: 200 },
    )
    const billing = createSupabaseBillingAdapter(clientWithRpc(rpc), session)
    await billing.saveOrder(orderInput)
    const unsubscribe = billing.subscribeCounter(() => {})

    await vi.waitFor(() => expect(billing.getCounterState().sync.kind).toBe('stalled'))
    unsubscribe()
  })

  it('keeps removed-tablet evidence but refuses more work after the server says it was removed', async () => {
    const rpc = vi.fn(async (name: string) =>
      name === 'create_billing_order'
        ? {
            data: { status: 'removed_tablet', commandId: orderInput.clientId },
            error: null,
            status: 200,
          }
        : { data: null, error: null, status: 200 },
    )
    const billing = createSupabaseBillingAdapter(clientWithRpc(rpc), session)
    await billing.saveOrder(orderInput)
    const unsubscribe = billing.subscribeCounter(() => {})
    const database = new BillingDeliveryDatabase()

    await vi.waitFor(async () =>
      expect(await database.envelopes.get(orderInput.clientId)).toMatchObject({
        state: 'needs_attention',
      }),
    )
    await expect(
      billing.saveOrder({ ...orderInput, clientId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: 'removed_tablet' })

    unsubscribe()
    database.close()
  })

  it('gives a correction a new identity without falsifying its historical shift time', async () => {
    const billing = createSupabaseBillingAdapter(clientWithRpc(), session)
    await billing.saveOrder(orderInput)
    const database = new BillingDeliveryDatabase()
    const store = new BillingDeliveryStore(database)
    const original = (await database.envelopes.get(orderInput.clientId))!
    await store.recordResult(
      orderInput.clientId,
      { status: 'identity_conflict', commandId: orderInput.clientId },
      Date.now(),
    )
    const correctionId = crypto.randomUUID()

    await billing.correctAttention(orderInput.clientId, correctionId)

    expect(await database.envelopes.get(correctionId)).toMatchObject({
      command: {
        commandId: correctionId,
        shiftId: original.command.shiftId,
        createdAt: original.command.createdAt,
        payloadHash: original.command.payloadHash,
      },
    })
    database.close()
  })
})

describe('the server command seam', () => {
  it('sends every declared envelope key and parses an accepted result', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { status: 'accepted', commandId: draft.clientId, billNumber: 12 },
      error: null,
    })
    const command = await (async () => {
      const billing = createSupabaseBillingAdapter(clientWithRpc(), session)
      await billing.settleBill(draft)
      const database = new BillingDeliveryDatabase()
      const stored = await database.envelopes.get(draft.clientId)
      database.close()
      if (!stored) throw new Error('Expected a stored command')
      return stored.command
    })()

    await expect(
      createSupabaseBillingCommandAdapter(clientWithRpc(rpc)).execute(command),
    ).resolves.toMatchObject({
      status: 'accepted',
      billNumber: 12,
    })
    expect(rpc).toHaveBeenCalledWith(
      'pay_billing_now',
      expect.objectContaining({
        p_command_id: command.commandId,
        p_schema_version: 1,
        p_payload_hash: command.payloadHash,
        p_created_at: command.createdAt,
        p_shift_id: command.shiftId,
        p_payload: command.payload,
      }),
    )
  })

  it.each([
    [401, 'authorization_refused'],
    [404, 'unsupported_schema'],
    [422, 'malformed_payload'],
    [503, 'retryable_failure'],
  ] as const)(
    'classifies a received HTTP %s response as %s, not missing transport',
    async (status, expected) => {
      const rpc = vi
        .fn()
        .mockResolvedValue({ data: null, error: new Error('received response'), status })
      const billing = createSupabaseBillingAdapter(clientWithRpc(), session)
      await billing.settleBill(draft)
      const database = new BillingDeliveryDatabase()
      const command = (await database.envelopes.get(draft.clientId))!.command
      database.close()

      await expect(
        createSupabaseBillingCommandAdapter(clientWithRpc(rpc)).execute(command),
      ).resolves.toMatchObject({
        status: expected,
        commandId: command.commandId,
      })
    },
  )

  it('keeps a missing response as transport evidence for the drain to retry', async () => {
    const error = new Error('no response')
    const rpc = vi.fn().mockResolvedValue({ data: null, error, status: 0 })
    const billing = createSupabaseBillingAdapter(clientWithRpc(), session)
    await billing.settleBill(draft)
    const database = new BillingDeliveryDatabase()
    const command = (await database.envelopes.get(draft.clientId))!.command
    database.close()

    await expect(
      createSupabaseBillingCommandAdapter(clientWithRpc(rpc)).execute(command),
    ).rejects.toBe(error)
  })
})

const PREPARED_ORDER_ID = '10000000-0000-4000-a000-0000000000a1'

function openPreparedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PREPARED_ORDER_ID,
    outlet_id: 'outlet-1',
    device_id: session.device.deviceId,
    order_number: 26,
    business_date: '2026-08-11',
    ordered_at: '2026-08-11T12:00:00.000Z',
    // Prepared and open is the payable band, which is exactly the shape that
    // came back onto the counter wearing a Pay button.
    prepared_at: '2026-08-11T12:02:00.000Z',
    status: 'open',
    created_by: 'person-1',
    creator: { full_name: 'Counter operator' },
    canceller: null,
    customer_name: null,
    customer_phone: null,
    order_items: [
      {
        id: 'oi-1',
        menu_item_id: 'item-1',
        item_name: 'Classic Chicken Shawarma',
        unit_price_paise: 48_000,
        quantity: 1,
        line_total_paise: 48_000,
      },
    ],
    total_paise: 48_000,
    discount_paise: 0,
    tax_paise: 0,
    subtotal_paise: 48_000,
    cancel_reason: null,
    cancelled_at: null,
    paid_at: null,
    bill_id: null,
    ...overrides,
  }
}

/**
 * A server whose `orders` read lands the acceptance *while it is in flight*.
 *
 * `duringRead` runs when the query is awaited, which is the gap the defect
 * lived in: the server row is fetched before the accept, and the envelope is
 * deleted by it. Reading the outbox first survives that; reading it second does
 * not, so this fails on the tree before the fix rather than by timing luck.
 */
function raceOrdersClient(row: unknown, duringRead: () => Promise<void>) {
  const from = vi.fn((table: string) => {
    if (table === 'orders') {
      const query: Record<string, unknown> = {
        select: () => query,
        eq: () => query,
        in: () => query,
        order: () => query,
        maybeSingle: () => duringRead().then(() => ({ data: row, error: null })),
        then: (resolve: (value: unknown) => unknown) =>
          duringRead()
            .then(() => ({ data: [row], error: null }))
            .then(resolve),
      }
      return query
    }
    const other: Record<string, unknown> = {
      select: () => other,
      eq: () => other,
      in: () => Promise.resolve({ data: [], error: null }),
      limit: () => other,
      order: () => other,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve),
    }
    return other
  })
  return { rpc: vi.fn(), from } as unknown as SupabaseClient<Database>
}

async function queuePayment(orderId: string, commandId: string) {
  const database = new BillingDeliveryDatabase()
  const store = new BillingDeliveryStore(database)
  const command = await createBillingCommand({
    commandId,
    tabletId: session.device.deviceId,
    shiftId: session.shift!.id,
    type: 'pay_order',
    createdAt: '2026-08-11T12:05:00.000Z',
    payload: {
      billId: '10000000-0000-4000-a000-0000000000b1',
      orderId,
      payments: [{ method: 'upi' as PaymentMethod, amountPaise: 48_000 }],
      paidAt: '2026-08-11T12:05:00.000Z',
      paymentBusinessDate: '2026-08-11',
    },
  })
  await store.accept({
    command,
    tabletId: session.device.deviceId,
    outletId: 'outlet-1',
    businessDate: '2026-08-11',
    chainId: orderId,
    eligibleAtMs: 0,
    nowMs: 0,
  })
  return { database, store, command }
}

describe('the delivery handoff cannot lose accepted work', () => {
  it('repairs a lost final heartbeat after a committed command replays on restart', async () => {
    const commandId = '10000000-0000-4000-a000-0000000000d1'
    const { database, store } = await queuePayment(PREPARED_ORDER_ID, commandId)
    const committed = new Set<string>()
    const reportedCount = (args: Record<string, unknown> | undefined) =>
      args?.p_unresolved ?? args?.p_unsent
    const firstReports: Record<string, unknown>[] = []
    const firstRpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'report_counter_device_state') {
        firstReports.push(args)
        return { data: 'ok', error: null, status: 200 }
      }
      committed.add(String(args.p_command_id))
      // The database committed, but the response never reached the tablet.
      return { data: null, error: new Error('response lost'), status: 0 }
    })
    const first = createSupabaseBillingAdapter(clientWithRpc(firstRpc), session)
    const stopFirst = first.subscribeCounter(() => undefined)

    await vi.waitFor(() => expect(reportedCount(firstReports.at(-1))).toBe(1))
    await vi.waitFor(async () =>
      expect(await database.envelopes.get(commandId)).toMatchObject({ state: 'retrying' }),
    )
    stopFirst()
    await vi.waitFor(() => expect(database.leases.count()).resolves.toBe(0))

    // A restarted online app makes retrying work immediately eligible. The
    // server recognises the immutable command id and returns replay, not a
    // second bill.
    await store.hintRetry(session.device.deviceId, 0)
    const restartedReports: Record<string, unknown>[] = []
    const restartedRpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'report_counter_device_state') {
        restartedReports.push(args)
        return { data: 'ok', error: null, status: 200 }
      }
      const id = String(args.p_command_id)
      return {
        data: { status: committed.has(id) ? 'replay' : 'accepted', commandId: id },
        error: null,
        status: 200,
      }
    })
    const restarted = createSupabaseBillingAdapter(clientWithRpc(restartedRpc), session)
    const stopRestarted = restarted.subscribeCounter(() => undefined)

    await vi.waitFor(() => expect(reportedCount(restartedReports.at(-1))).toBe(0))
    expect(await database.envelopes.get(commandId)).toBeUndefined()
    expect(committed).toEqual(new Set([commandId]))

    stopRestarted()
    database.close()
  })

  it('keeps a payment accepted mid-refresh off the payable band', async () => {
    const commandId = '10000000-0000-4000-a000-0000000000c1'
    const { database, store } = await queuePayment(PREPARED_ORDER_ID, commandId)

    // The drain lands inside the server read: the row is already fetched and
    // still says open, and the envelope is gone by the time anyone looks.
    const client = raceOrdersClient(openPreparedRow(), async () => {
      await store.recordResult(commandId, { status: 'accepted', commandId }, 1)
    })
    const billing = createSupabaseBillingAdapter(client, session)

    const orders = await billing.listOpenOrders('outlet-1')

    // The envelope really is gone, so the projection had only the stale server
    // row to work from. Paid and prepared is finished work: it belongs among the
    // bills, not on the pipeline, and above all not in the payable band.
    expect(await database.envelopes.get(commandId)).toBeUndefined()
    expect(orders.some((order) => order.id === PREPARED_ORDER_ID)).toBe(false)
    expect(splitPipeline(orders).unpaidPrepared).toHaveLength(0)
  })

  it('refuses a second payment for an order it already holds as paid', async () => {
    const commandId = '10000000-0000-4000-a000-0000000000c2'
    await queuePayment(PREPARED_ORDER_ID, commandId)
    const client = raceOrdersClient(openPreparedRow(), async () => undefined)
    const billing = createSupabaseBillingAdapter(client, session)

    await expect(
      billing.payOrder(PREPARED_ORDER_ID, [
        { method: 'upi' as PaymentMethod, amountPaise: 48_000 },
      ]),
    ).rejects.toMatchObject({ code: 'already_paid' })

    // Refused in place: no second command was ever minted.
    const database = new BillingDeliveryDatabase()
    const payments = (await database.envelopes.toArray()).filter(
      (envelope) => envelope.type === 'pay_order',
    )
    expect(payments).toHaveLength(1)
  })

  it('lets a payment be taken back and taken again', async () => {
    const paidId = '10000000-0000-4000-a000-0000000000c3'
    const { store } = await queuePayment(PREPARED_ORDER_ID, paidId)
    const unwind = await createBillingCommand({
      commandId: '10000000-0000-4000-a000-0000000000c4',
      tabletId: session.device.deviceId,
      shiftId: session.shift!.id,
      type: 'void_order_payment',
      createdAt: '2026-08-11T12:06:00.000Z',
      payload: {
        orderId: PREPARED_ORDER_ID,
        billId: '10000000-0000-4000-a000-0000000000b1',
        reason: 'Wrong tender',
      },
    })
    await store.accept({
      command: unwind,
      tabletId: session.device.deviceId,
      outletId: 'outlet-1',
      businessDate: '2026-08-11',
      chainId: PREPARED_ORDER_ID,
      eligibleAtMs: 0,
      nowMs: 1,
    })

    const client = raceOrdersClient(openPreparedRow(), async () => undefined)
    const billing = createSupabaseBillingAdapter(client, session)

    // The guard reads projected state, not history. An order that has been paid
    // and unwound is open again, so this must succeed. A history-keyed guard
    // would break repay at the counter with every other test still green.
    await expect(
      billing.payOrder(PREPARED_ORDER_ID, [
        { method: 'cash' as PaymentMethod, amountPaise: 48_000 },
      ]),
    ).resolves.toMatchObject({ totalPaise: 48_000 })
  })

  it('shows a command created during an in-flight read on the next read', async () => {
    const commandId = '10000000-0000-4000-a000-0000000000c5'
    const client = raceOrdersClient(openPreparedRow(), async () => undefined)
    const billing = createSupabaseBillingAdapter(client, session)

    const before = await billing.listOpenOrders('outlet-1')
    expect(splitPipeline(before).unpaidPrepared).toHaveLength(1)

    await queuePayment(PREPARED_ORDER_ID, commandId)

    // The mirror gap D2 accepts is bounded, not permanent: whatever a read in
    // flight missed, the read after it carries.
    const after = await billing.listOpenOrders('outlet-1')
    expect(splitPipeline(after).unpaidPrepared).toHaveLength(0)
  })
})
