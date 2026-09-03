import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  billingCommandRpcArguments,
  billingPayloadHash,
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
const TABLET_TWO = '10000000-0000-4000-a000-00000000000f'
const SHIFT_TWO = '90000000-0000-4000-a000-000000000003'
const BILLER_TWO = '10000000-0000-4000-a000-000000000010'
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
    discountPaise: 0,
    discountPercentBp: null,
    categoryName: null,
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
    roundingPaise: 0,
    totalPaise: 13900,
    pricingMode: 'no_tax',
    discounts: [],
    payments: [{ method: 'cash', amountPaise: 13900 }],
    lines: [line(lineId)],
  }
}

let tablet: Client
let tabletTwo: Client
let manager: Client
let otherOutletManager: Client
let service: Client

beforeAll(async () => {
  ;[tablet, tabletTwo, manager, otherOutletManager] = await Promise.all([
    signIn('tablet.kalyani'),
    signIn('tablet.kalyani.two'),
    signIn('admin.kalyani'),
    signIn('admin.kanchrapara'),
  ])
  // The local Auth and PostgREST containers can straddle a one-second clock
  // boundary immediately after reset. Let a freshly issued token become
  // unambiguously current before the first deliberately concurrent request.
  await new Promise((resolve) => setTimeout(resolve, 5_000))
  service = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  /*
    Bring the spare till into service, because the seed does not.

    The seed is one active tablet per outlet: that is what the business runs,
    what a third outlet would open with, and therefore the shape almost every
    other suite has to keep seeing. Two tills is a state the handful of files
    that need it ask for, and this is one of them asking.

    Done with the service key rather than through the setup code because this
    file is about what happens when two tills submit at once; setup itself is
    proved in `23_counter_tablet_and_shift.sql`.
  */
  const { error: revive } = await service
    .from('counter_devices')
    .update({ removed_at: null, last_seen_at: new Date().toISOString() })
    .eq('id', TABLET_TWO)
  if (revive) throw new Error(`could not bring the spare till into service: ${revive.message}`)

  const outlet = await service
    .from('outlets')
    .select('business_day_cutover')
    .eq('id', OUTLET)
    .single()
  if (outlet.error) throw new Error(`could not read the outlet cutover: ${outlet.error.message}`)

  const { error: shift } = await service.from('counter_shifts').upsert({
    id: SHIFT_TWO,
    device_id: TABLET_TWO,
    outlet_id: OUTLET,
    person_id: BILLER_TWO,
    opened_at: new Date(Date.now() - 60 * 60_000).toISOString(),
    business_date: resolveBusinessDate(new Date(), outlet.data.business_day_cutover),
    expires_at: new Date(Date.now() + 6 * 60 * 60_000).toISOString(),
  })
  if (shift) throw new Error(`could not open a shift on the spare till: ${shift.message}`)
}, 30_000)

/*
  Put the spare till back out of service.

  The seed is one active tablet per outlet on purpose, and a suite that
  activates a second one owes it to the phases after it to leave the shop as it
  found it. The shift is ended rather than deleted, because bills taken above
  reference it and money history is never removed -- which is what removal does
  in production too.
*/
afterAll(async () => {
  if (!service) return
  await service
    .from('counter_shifts')
    .update({ ended_at: new Date().toISOString(), ended_reason: 'device_removed' })
    .eq('id', SHIFT_TWO)
    .is('ended_at', null)
  await service
    .from('counter_devices')
    .update({ removed_at: new Date().toISOString() })
    .eq('id', TABLET_TWO)
})

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

    const changedPayload = {
      ...command.payload,
      payments: [{ method: 'upi' as const, amountPaise: 13900 }],
    }
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

  /*
   * The receipt link is minted by a trigger on `bills` rather than by the
   * commands, and this is the case that proves it. `pay_billing_now` is the path
   * the counter actually uses, so if the minting lived in a command instead the
   * real path would be the one path producing an unshareable bill. pgTAP can
   * only assert the trigger is unconditional; this asserts the outcome.
   */
  it('mints a receipt link for a bill created through a billing command', async () => {
    const businessDate = resolveBusinessDate(new Date(), '04:00')
    const billId = 'fa500000-0000-4000-a000-000000000050'
    const command = await createBillingCommand({
      commandId: 'fa100000-0000-4000-a000-000000000050',
      tabletId: TABLET,
      shiftId: SHIFT,
      type: 'pay_now',
      createdAt: new Date().toISOString(),
      payload: payNowPayload(billId, 'fa600000-0000-4000-a000-000000000050', businessDate),
    })

    const paid = await tablet.rpc('pay_billing_now', rpcArgs(command))
    expect(paid.error).toBeNull()
    expect(status(paid.data)).toBe('accepted')

    const links = await manager
      .from('bill_public_links')
      .select('token, revoked_at')
      .eq('bill_id', billId)
    expect(links.error).toBeNull()
    expect(links.data).toHaveLength(1)
    expect(links.data?.[0]?.revoked_at).toBeNull()
    // URL-safe, and long enough to be the token rather than a placeholder.
    expect(links.data?.[0]?.token).toMatch(/^[A-Za-z0-9_-]{10,}$/)

    // The counter's own session can read the link on a bill it can see, which is
    // what the Share button does, and cannot write it.
    const asTablet = await tablet.from('bill_public_links').select('token').eq('bill_id', billId)
    expect(asTablet.error).toBeNull()
    expect(asTablet.data).toHaveLength(1)

    const forged = await tablet
      .from('bill_public_links')
      .update({ revoked_at: new Date().toISOString() })
      .eq('bill_id', billId)
    expect(forged.error).not.toBeNull()
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
      roundingPaise: 0,
      totalPaise: 13900,
      pricingMode: 'no_tax',
      discounts: [],
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
      payments: [{ method: 'cash', amountPaise: 13900 }],
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
        roundingPaise: 0,
        totalPaise: 13900,
        pricingMode: 'no_tax',
        discounts: [],
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

  /**
   * Two tills paying at the same instant.
   *
   * The command layer was written for this before there was anything concurrent
   * to run on it, and a unique index made a second tablet unwritable, so it had
   * never been run. Numbering is the part that cannot be argued: it is allocated
   * inside the paying transaction and per outlet, so two simultaneous payments
   * either serialize into two distinct sequential numbers or the claim was
   * wrong.
   */
  it('gives two tills paying at once two distinct sequential numbers', async () => {
    const businessDate = resolveBusinessDate(new Date(), '04:00')
    const createdAt = new Date().toISOString()

    const before = await manager
      .from('bills')
      .select('bill_number')
      .eq('outlet_id', OUTLET)
      .order('bill_number', { ascending: false })
      .limit(1)
    const high = before.data?.[0]?.bill_number ?? 0

    const tills = [
      {
        client: tablet,
        tabletId: TABLET,
        shiftId: SHIFT,
        commandId: 'fb100000-0000-4000-a000-000000000001',
        billId: 'fb200000-0000-4000-a000-000000000001',
        lineId: 'fb300000-0000-4000-a000-000000000001',
      },
      {
        client: tabletTwo,
        tabletId: TABLET_TWO,
        shiftId: SHIFT_TWO,
        commandId: 'fb100000-0000-4000-a000-000000000002',
        billId: 'fb200000-0000-4000-a000-000000000002',
        lineId: 'fb300000-0000-4000-a000-000000000002',
      },
    ]
    const commands = await Promise.all(
      tills.map((till) =>
        createBillingCommand({
          commandId: till.commandId,
          tabletId: till.tabletId,
          shiftId: till.shiftId,
          type: 'pay_now',
          createdAt,
          payload: payNowPayload(till.billId, till.lineId, businessDate),
        }),
      ),
    )
    // Submitted together, so the allocator is genuinely contended rather than
    // handed one request at a time.
    const [one, two] = await Promise.all(
      commands.map((command, index) =>
        tills[index]!.client.rpc('pay_billing_now', rpcArgs(command)),
      ),
    )

    expect(status(one!.data)).toBe('accepted')
    expect(status(two!.data)).toBe('accepted')

    const bills = await manager
      .from('bills')
      .select('id, bill_number, counter_device_id')
      .in('id', ['fb200000-0000-4000-a000-000000000001', 'fb200000-0000-4000-a000-000000000002'])
      .order('bill_number')

    expect(bills.data).toHaveLength(2)
    const numbers = bills.data!.map((bill) => bill.bill_number)
    // Distinct, sequential from wherever the outlet had reached, and one per
    // till. A shared counter would have produced a duplicate or a gap.
    expect(new Set(numbers).size).toBe(2)
    expect(numbers).toEqual([high + 1, high + 2])
    expect(new Set(bills.data!.map((bill) => bill.counter_device_id)).size).toBe(2)
  })

  /**
   * A lost response replayed against a live competitor.
   *
   * The retry is the same command; what differs from the single-tablet case is
   * that the other till is paying into the same per-outlet sequence while it
   * happens. The replay must return its ORIGINAL number rather than the next
   * one, or a bill somebody has already been handed gets renumbered.
   */
  it('replays a lost response to its original number while the other till pays', async () => {
    const businessDate = resolveBusinessDate(new Date(), '04:00')
    const createdAt = new Date().toISOString()
    const command = await createBillingCommand({
      commandId: 'fb400000-0000-4000-a000-000000000001',
      tabletId: TABLET,
      shiftId: SHIFT,
      type: 'pay_now',
      createdAt,
      payload: payNowPayload(
        'fb500000-0000-4000-a000-000000000001',
        'fb600000-0000-4000-a000-000000000001',
        businessDate,
      ),
    })
    const first = await tablet.rpc('pay_billing_now', rpcArgs(command))
    expect(status(first.data)).toBe('accepted')

    const original = await manager
      .from('bills')
      .select('bill_number')
      .eq('id', 'fb500000-0000-4000-a000-000000000001')
      .single()
    const originalNumber = original.data!.bill_number

    // The neighbour trades, moving the outlet's sequence on, and only then is
    // the lost response retried.
    const neighbour = await createBillingCommand({
      commandId: 'fb400000-0000-4000-a000-000000000002',
      tabletId: TABLET_TWO,
      shiftId: SHIFT_TWO,
      type: 'pay_now',
      createdAt: new Date().toISOString(),
      payload: payNowPayload(
        'fb500000-0000-4000-a000-000000000002',
        'fb600000-0000-4000-a000-000000000002',
        businessDate,
      ),
    })
    expect(status((await tabletTwo.rpc('pay_billing_now', rpcArgs(neighbour))).data)).toBe(
      'accepted',
    )

    const retry = await tablet.rpc('pay_billing_now', rpcArgs(command))
    expect(status(retry.data)).toBe('replay')

    const after = await manager
      .from('bills')
      .select('id, bill_number')
      .eq('id', 'fb500000-0000-4000-a000-000000000001')
    expect(after.data).toHaveLength(1)
    expect(after.data![0]!.bill_number).toBe(originalNumber)
  })

  /**
   * One command identity, two tills.
   *
   * `billing_commands` is keyed on the command UUID, and a UUID minted on one
   * tablet must not be usable from another: it would let a till claim a
   * neighbour's accepted work as its own replay.
   */
  it('refuses a command identity borrowed from the other till', async () => {
    const businessDate = resolveBusinessDate(new Date(), '04:00')
    const command = await createBillingCommand({
      commandId: 'fb700000-0000-4000-a000-000000000001',
      tabletId: TABLET,
      shiftId: SHIFT,
      type: 'pay_now',
      createdAt: new Date().toISOString(),
      payload: payNowPayload(
        'fb800000-0000-4000-a000-000000000001',
        'fb900000-0000-4000-a000-000000000001',
        businessDate,
      ),
    })
    expect(status((await tablet.rpc('pay_billing_now', rpcArgs(command))).data)).toBe('accepted')

    // The same command id, submitted by the neighbour under its own shift.
    const borrowed = await createBillingCommand({
      commandId: command.commandId,
      tabletId: TABLET_TWO,
      shiftId: SHIFT_TWO,
      type: 'pay_now',
      createdAt: new Date().toISOString(),
      payload: payNowPayload(
        'fb800000-0000-4000-a000-000000000002',
        'fb900000-0000-4000-a000-000000000002',
        businessDate,
      ),
    })
    const stolen = await tabletTwo.rpc('pay_billing_now', rpcArgs(borrowed))

    // Refused, and no second bill exists under the borrowed identity.
    expect(status(stolen.data)).not.toBe('accepted')
    const bills = await manager
      .from('bills')
      .select('id')
      .eq('id', 'fb800000-0000-4000-a000-000000000002')
    expect(bills.data).toEqual([])
  })

  it('keeps remote-leave work on the old operator, flags it, and isolates its review', async () => {
    const businessDate = resolveBusinessDate(new Date(), '04:00')
    const endedAt = new Date(Date.now() - 1_000).toISOString()
    const ended = await service
      .from('counter_shifts')
      .update({ ended_at: endedAt, ended_reason: 'operator' })
      .eq('id', SHIFT)
      .select('expires_at')
      .single()
    expect(ended.error).toBeNull()
    if (!ended.data) throw new Error('seeded shift did not end')

    const command = await createBillingCommand({
      commandId: 'fa100000-0000-4000-a000-000000000030',
      tabletId: TABLET,
      shiftId: SHIFT,
      type: 'pay_now',
      createdAt: new Date().toISOString(),
      payload: payNowPayload(
        'fa500000-0000-4000-a000-000000000030',
        'fa600000-0000-4000-a000-000000000030',
        businessDate,
      ),
    })
    const first = await tablet.rpc('pay_billing_now', rpcArgs(command))
    const replay = await tablet.rpc('pay_billing_now', rpcArgs(command))
    expect(first.error).toBeNull()
    expect(replay.error).toBeNull()
    expect([status(first.data), status(replay.data)]).toEqual(['accepted', 'replay'])

    const bill = await manager
      .from('bills')
      .select('id, biller_profile_id, recorded_after_shift_end, attribution_shift_ended_at')
      .eq('id', 'fa500000-0000-4000-a000-000000000030')
      .single()
    expect(bill.error).toBeNull()
    expect(bill.data).toMatchObject({
      biller_profile_id: '10000000-0000-4000-a000-00000000000a',
      recorded_after_shift_end: true,
    })
    expect(new Date(bill.data!.attribution_shift_ended_at!).toISOString()).toBe(endedAt)

    const hidden = await otherOutletManager
      .from('bills')
      .select('id')
      .eq('id', 'fa500000-0000-4000-a000-000000000030')
    expect(hidden.error).toBeNull()
    expect(hidden.data).toEqual([])

    const reviewed = await manager.rpc('review_billing_attribution', {
      p_bill_id: 'fa500000-0000-4000-a000-000000000030',
      p_outcome: 'confirmed_original',
    })
    expect(reviewed.error).toBeNull()

    const refusedReview = await otherOutletManager.rpc('review_billing_attribution', {
      p_bill_id: 'fa500000-0000-4000-a000-000000000030',
      p_outcome: 'operator_unknown',
      p_reason: 'Unknown',
    })
    expect(refusedReview.error).not.toBeNull()

    const laterShift = await service.from('counter_shifts').insert({
      id: 'fa700000-0000-4000-a000-000000000030',
      device_id: TABLET,
      outlet_id: OUTLET,
      person_id: '10000000-0000-4000-a000-00000000000a',
      opened_at: new Date().toISOString(),
      business_date: businessDate,
      expires_at: ended.data.expires_at,
    })
    expect(laterShift.error).toBeNull()

    const stale = await createBillingCommand({
      commandId: 'fa100000-0000-4000-a000-000000000031',
      tabletId: TABLET,
      shiftId: SHIFT,
      type: 'pay_now',
      createdAt: new Date(Date.now() + 1_000).toISOString(),
      payload: payNowPayload(
        'fa500000-0000-4000-a000-000000000031',
        'fa600000-0000-4000-a000-000000000031',
        businessDate,
      ),
    })
    const staleResult = await tablet.rpc('pay_billing_now', rpcArgs(stale))
    expect(staleResult.error).toBeNull()
    expect(status(staleResult.data)).toBe('authorization_refused')
  })

  /**
   * The crossing this change is most able to break.
   *
   * A till that went offline before discounts existed and reconnects after they
   * do is holding envelopes at schema version 1, carrying the payload shape
   * without `roundingPaise` or `discounts`, with hashes computed over that
   * shape. The key check is an exact set match, so refusing them was one
   * `||` away — and refusing them loses a trading day to a deployment.
   *
   * This builds that envelope by hand rather than through `createBillingCommand`,
   * because that function now stamps version 2 by construction. A till from
   * before the release is exactly a client that cannot do that.
   */
  it('settles work a till captured before discounts existed, exactly once', async () => {
    const billId = 'fa500000-0000-4000-a000-000000000040'
    const businessDate = resolveBusinessDate(new Date(), '04:00')
    const createdAt = new Date(Date.now() - 60_000).toISOString()

    const legacyPayload = {
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
      payments: [{ method: 'cash', amountPaise: 13900 }],
      lines: [
        {
          id: 'fa600000-0000-4000-a000-000000000040',
          menuItemId: MENU_ITEM,
          itemName: 'Classic Chicken Shawarma',
          unitPricePaise: 13900,
          quantity: 1,
          lineTotalPaise: 13900,
        },
      ],
    }

    const legacyEnvelope = {
      p_command_id: 'fa100000-0000-4000-a000-000000000040',
      p_schema_version: 1,
      p_payload_hash: await billingPayloadHash(legacyPayload as never),
      p_created_at: createdAt,
      p_shift_id: SHIFT,
      p_payload: legacyPayload,
    } as unknown as BillingRpcArgs

    const first = await tablet.rpc('pay_billing_now', legacyEnvelope)
    expect(first.error).toBeNull()
    expect(status(first.data)).toBe('accepted')

    // The queue retries; the day must not be billed twice for it.
    const replay = await tablet.rpc('pay_billing_now', legacyEnvelope)
    expect(replay.error).toBeNull()
    expect(status(replay.data)).toBe('replay')

    const bills = await manager
      .from('bills')
      .select('id, total_paise, discount_paise, rounding_paise')
      .eq('id', billId)
    expect(bills.error).toBeNull()
    expect(bills.data).toHaveLength(1)
    // Read as it was written: no discount, no rounding, the same total.
    expect(bills.data?.[0]).toMatchObject({
      total_paise: 13900,
      discount_paise: 0,
      rounding_paise: 0,
    })

    const lines = await manager
      .from('bill_items')
      .select('discount_paise, discount_percent_bp, category_name')
      .eq('bill_id', billId)
    expect(lines.error).toBeNull()
    expect(lines.data).toEqual([
      { discount_paise: 0, discount_percent_bp: null, category_name: null },
    ])
  })
})
