import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  billingCommandRpcArguments,
  createBillingCommand,
  type BillingCommand,
  type CreateOrderPayload,
  type PayNowPayload,
  type PayOrderPayload,
} from '../../../shared/billing-command'
import type { Database, Json } from '../../../src/data-access/database.types'
import { resolveBusinessDate } from '../../../src/domain/datetime'

const SUPABASE_URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321'
const SUPABASE_ANON_KEY =
  process.env['SUPABASE_ANON_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SUPABASE_SERVICE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY']
if (!SUPABASE_SERVICE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for billing race setup')
}
const PASSWORD = 'shawarmania-local'

const OUTLET = '00000000-0000-4000-a000-000000000001'
const TABLET = '10000000-0000-4000-a000-000000000004'
const SHIFT = '90000000-0000-4000-a000-000000000001'
const MENU_ITEM = '31000000-0000-4000-a000-000000000001'

type Client = SupabaseClient<Database>
type BillingRpcArgs = Database['public']['Functions']['pay_billing_now']['Args']

async function signIn(alias: string): Promise<Client> {
  const client = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.auth.signInWithPassword({
    email: `${alias}@login.shawarmania.invalid`,
    password: PASSWORD,
  })
  if (error) throw new Error(`sign-in failed for ${alias}: ${error.message}`)
  return client
}

function rpcArgs(command: BillingCommand): BillingRpcArgs {
  return billingCommandRpcArguments(command) as unknown as BillingRpcArgs
}

function status(data: Json | null): string | undefined {
  if (data === null || Array.isArray(data) || typeof data !== 'object') return undefined
  return typeof data['status'] === 'string' ? data['status'] : undefined
}

function line(id: string) {
  return {
    id,
    menuItemId: MENU_ITEM,
    itemName: 'Classic Chicken Shawarma',
    unitPricePaise: 13900,
    quantity: 1,
    lineTotalPaise: 13900,
  } as const
}

function payNowPayload(billId: string, lineId: string, businessDate: string): PayNowPayload {
  return {
    billId,
    businessDate,
    paymentBusinessDate: businessDate,
    customerId: null,
    customerName: null,
    customerPhone: null,
    subtotalPaise: 13900,
    discountPaise: 0,
    taxPaise: 0,
    totalPaise: 13900,
    pricingMode: 'no_tax',
    paymentMethod: 'cash',
    lines: [line(lineId)],
  }
}

let tablet: Client
let manager: Client
let service: Client

beforeAll(async () => {
  ;[tablet, manager] = await Promise.all([signIn('tablet.kalyani'), signIn('admin.kalyani')])
  service = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}, 30_000)

describe.sequential('billing command races over PostgREST', () => {
  it('serializes two exact retries into one bill and one permanent number', async () => {
    const businessDate = resolveBusinessDate(new Date(), '04:00')
    const createdAt = new Date().toISOString()
    const command = await createBillingCommand({
      commandId: 'fa100000-0000-4000-a000-000000000001',
      tabletId: TABLET,
      shiftId: SHIFT,
      type: 'pay_now',
      createdAt,
      payload: payNowPayload(
        'fa200000-0000-4000-a000-000000000001',
        'fa300000-0000-4000-a000-000000000001',
        businessDate,
      ),
    })

    const [first, second] = await Promise.all([
      tablet.rpc('pay_billing_now', rpcArgs(command)),
      tablet.rpc('pay_billing_now', rpcArgs(command)),
    ])

    expect(first.error).toBeNull()
    expect(second.error).toBeNull()
    expect([status(first.data), status(second.data)].sort()).toEqual(['accepted', 'replay'])

    const bills = await manager
      .from('bills')
      .select('id, bill_number')
      .eq('id', 'fa200000-0000-4000-a000-000000000001')
    expect(bills.error).toBeNull()
    expect(bills.data).toHaveLength(1)

    const changedPayload = { ...command.payload, paymentMethod: 'upi' as const }
    const changed = await createBillingCommand({
      commandId: command.commandId,
      tabletId: command.tabletId,
      shiftId: command.shiftId,
      type: command.type,
      createdAt: command.createdAt,
      payload: changedPayload,
    })
    const conflict = await tablet.rpc('pay_billing_now', rpcArgs(changed))
    expect(conflict.error).toBeNull()
    expect(status(conflict.data)).toBe('identity_conflict')
  })

  it('serializes pay versus manager cancellation without a partial bill or number gap', async () => {
    const businessDate = resolveBusinessDate(new Date(), '04:00')
    const orderId = 'fa400000-0000-4000-a000-000000000001'
    const billId = 'fa500000-0000-4000-a000-000000000001'
    const createdAt = new Date().toISOString()
    const orderPayload: CreateOrderPayload = {
      orderId,
      businessDate,
      customerId: null,
      customerName: null,
      customerPhone: null,
      subtotalPaise: 13900,
      discountPaise: 0,
      taxPaise: 0,
      totalPaise: 13900,
      pricingMode: 'no_tax',
      lines: [line('fa600000-0000-4000-a000-000000000001')],
    }
    const create = await createBillingCommand({
      commandId: 'fa100000-0000-4000-a000-000000000002',
      tabletId: TABLET,
      shiftId: SHIFT,
      type: 'create_order',
      createdAt,
      payload: orderPayload,
    })
    const created = await tablet.rpc('create_billing_order', rpcArgs(create))
    expect(created.error).toBeNull()
    expect(status(created.data)).toBe('accepted')

    const before = await manager
      .from('bills')
      .select('bill_number')
      .eq('outlet_id', OUTLET)
      .order('bill_number', { ascending: false })
      .limit(1)
      .single()
    expect(before.error).toBeNull()

    const paidAt = new Date().toISOString()
    const payPayload: PayOrderPayload = {
      billId,
      orderId,
      paymentMethod: 'cash',
      paidAt,
      paymentBusinessDate: businessDate,
    }
    const pay = await createBillingCommand({
      commandId: 'fa100000-0000-4000-a000-000000000003',
      tabletId: TABLET,
      shiftId: SHIFT,
      type: 'pay_order',
      createdAt: paidAt,
      payload: payPayload,
    })
    const cancel = await createBillingCommand({
      commandId: 'fa100000-0000-4000-a000-000000000004',
      tabletId: null,
      shiftId: null,
      type: 'manager_cancel_order',
      createdAt: new Date().toISOString(),
      payload: { orderId, reason: 'Concurrent manager cancellation probe' },
    })

    const [payment, cancellation] = await Promise.all([
      tablet.rpc('pay_billing_order', rpcArgs(pay)),
      manager.rpc('manager_cancel_billing_order', rpcArgs(cancel)),
    ])
    expect(payment.error).toBeNull()
    expect(cancellation.error).toBeNull()
    expect([status(payment.data), status(cancellation.data)].sort()).toEqual([
      'accepted',
      'order_not_open',
    ])

    const racedBill = await manager.from('bills').select('id, bill_number').eq('id', billId)
    expect(racedBill.error).toBeNull()
    expect(racedBill.data).toHaveLength(status(payment.data) === 'accepted' ? 1 : 0)

    const finalCommand = await createBillingCommand({
      commandId: 'fa100000-0000-4000-a000-000000000005',
      tabletId: TABLET,
      shiftId: SHIFT,
      type: 'pay_now',
      createdAt: new Date().toISOString(),
      payload: payNowPayload(
        'fa500000-0000-4000-a000-000000000002',
        'fa600000-0000-4000-a000-000000000002',
        businessDate,
      ),
    })
    const final = await tablet.rpc('pay_billing_now', rpcArgs(finalCommand))
    expect(final.error).toBeNull()
    expect(status(final.data)).toBe('accepted')

    const landed = await manager
      .from('bills')
      .select('bill_number')
      .eq('id', 'fa500000-0000-4000-a000-000000000002')
      .single()
    expect(landed.error).toBeNull()
    if (!before.data || !landed.data) throw new Error('bill-number query returned no row')
    const expected = before.data.bill_number + (status(payment.data) === 'accepted' ? 2 : 1)
    expect(landed.data.bill_number).toBe(expected)
  })

  it('orders receipt claims before day locks across different command types', async () => {
    const historical = new Date()
    historical.setUTCDate(historical.getUTCDate() - 45)
    const businessDate = historical.toISOString().slice(0, 10)
    const shiftId = 'fa700000-0000-4000-a000-000000000020'
    const seeded = await service.from('counter_shifts').insert({
      id: shiftId,
      device_id: TABLET,
      outlet_id: OUTLET,
      person_id: '10000000-0000-4000-a000-00000000000a',
      opened_at: `${businessDate}T10:00:00+05:30`,
      business_date: businessDate,
      expires_at: `${businessDate}T11:00:00+05:30`,
      ended_at: `${businessDate}T11:00:00+05:30`,
      ended_reason: 'operator',
    })
    expect(seeded.error).toBeNull()

    const commandId = 'fa100000-0000-4000-a000-000000000020'
    const create = await createBillingCommand({
      commandId,
      tabletId: TABLET,
      shiftId,
      type: 'create_order',
      createdAt: `${businessDate}T10:30:00+05:30`,
      payload: {
        orderId: 'fa400000-0000-4000-a000-000000000020',
        businessDate,
        customerId: null,
        customerName: null,
        customerPhone: null,
        subtotalPaise: 13900,
        discountPaise: 0,
        taxPaise: 0,
        totalPaise: 13900,
        pricingMode: 'no_tax',
        lines: [line('fa600000-0000-4000-a000-000000000020')],
      },
    })
    const confirm = await createBillingCommand({
      commandId,
      tabletId: TABLET,
      shiftId: null,
      type: 'confirm_end_of_day',
      createdAt: new Date().toISOString(),
      payload: { outletId: OUTLET, businessDate, unsentCount: 0, needsAttentionCount: 0 },
    })
    const [created, confirmed] = await Promise.all([
      tablet.rpc('create_billing_order', rpcArgs(create)),
      tablet.rpc('confirm_billing_end_of_day', rpcArgs(confirm)),
    ])
    expect(created.error).toBeNull()
    expect(confirmed.error).toBeNull()
    expect([status(created.data), status(confirmed.data)].sort()).toEqual([
      'accepted',
      'identity_conflict',
    ])
  })

  it('serializes close against a new order and a new shift', async () => {
    const historical = new Date()
    historical.setUTCDate(historical.getUTCDate() - 30)
    const businessDate = historical.toISOString().slice(0, 10)
    const openedAt = `${businessDate}T10:00:00+05:30`
    const endedAt = `${businessDate}T11:00:00+05:30`
    const shiftId = 'fa700000-0000-4000-a000-000000000001'
    const seeded = await service.from('counter_shifts').insert({
      id: shiftId,
      device_id: TABLET,
      outlet_id: OUTLET,
      person_id: '10000000-0000-4000-a000-00000000000a',
      opened_at: openedAt,
      business_date: businessDate,
      expires_at: endedAt,
      ended_at: endedAt,
      ended_reason: 'operator',
    })
    expect(seeded.error).toBeNull()

    const confirmation = await createBillingCommand({
      commandId: 'fa100000-0000-4000-a000-000000000010',
      tabletId: TABLET,
      shiftId: null,
      type: 'confirm_end_of_day',
      createdAt: new Date().toISOString(),
      payload: { outletId: OUTLET, businessDate, unsentCount: 0, needsAttentionCount: 0 },
    })
    const confirmed = await tablet.rpc('confirm_billing_end_of_day', rpcArgs(confirmation))
    expect(confirmed.error).toBeNull()
    expect(status(confirmed.data)).toBe('accepted')

    const order = await createBillingCommand({
      commandId: 'fa100000-0000-4000-a000-000000000011',
      tabletId: TABLET,
      shiftId,
      type: 'create_order',
      createdAt: `${businessDate}T10:30:00+05:30`,
      payload: {
        orderId: 'fa400000-0000-4000-a000-000000000011',
        businessDate,
        customerId: null,
        customerName: null,
        customerPhone: null,
        subtotalPaise: 13900,
        discountPaise: 0,
        taxPaise: 0,
        totalPaise: 13900,
        pricingMode: 'no_tax',
        lines: [line('fa600000-0000-4000-a000-000000000011')],
      },
    })
    const [created, closed] = await Promise.all([
      tablet.rpc('create_billing_order', rpcArgs(order)),
      manager.rpc('close_business_day', {
        p_outlet_id: OUTLET,
        p_business_date: businessDate,
        p_opening_cash_paise: 0,
        p_actual_closing_paise: 0,
        p_notes: 'create/close race probe',
      }),
    ])
    const createWon = status(created.data) === 'accepted'
    const closeWon = closed.error === null
    expect(createWon).not.toBe(closeWon)

    const future = new Date()
    future.setUTCDate(future.getUTCDate() + 1)
    const shiftRaceDate = future.toISOString().slice(0, 10)
    const futureExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const [newShift, secondClose] = await Promise.all([
      service.from('counter_shifts').insert({
        id: 'fa700000-0000-4000-a000-000000000002',
        device_id: '10000000-0000-4000-a000-000000000009',
        outlet_id: OUTLET,
        person_id: '10000000-0000-4000-a000-00000000000a',
        opened_at: new Date().toISOString(),
        business_date: shiftRaceDate,
        expires_at: futureExpiry,
      }),
      manager.rpc('close_business_day', {
        p_outlet_id: OUTLET,
        p_business_date: shiftRaceDate,
        p_opening_cash_paise: 0,
        p_actual_closing_paise: 0,
        p_notes: 'shift/close race probe',
      }),
    ])
    expect(newShift.error === null).not.toBe(secondClose.error === null)
  })
})
