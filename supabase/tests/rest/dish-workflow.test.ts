import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Database, Json } from '../../../src/data-access/database.types'
import {
  createBillingCommand,
  billingCommandRpcArguments,
  type BillingCommand,
} from '../../../shared/billing-command'
import { resolveBusinessDate } from '../../../src/domain/datetime'

const url = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321'
const kpa = '00000000-0000-4000-a000-000000000002'
const kal = '00000000-0000-4000-a000-000000000001'
type Client = SupabaseClient<Database>
const rpcArgs = (command: BillingCommand) => ({
  ...billingCommandRpcArguments(command),
  p_shift_id: command.shiftId!,
  p_payload: command.payload as unknown as Json,
})

describe('dish records enforce isolation over hand-crafted HTTP requests', () => {
  let service: Client
  let counter: Client
  let kitchen: Client
  let kitchenOwn: Client
  let kitchenOwnId: string
  let kitchenId: string
  let counterId: string
  let counterShiftId: string
  let otherCounterId: string
  const callers: [string, Client][] = []
  const orderId = randomUUID()
  const lineId = randomUUID()
  const readyId = randomUUID()

  beforeAll(async () => {
    if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname))
      throw new Error('local stack required')
    const keys = JSON.parse(
      execSync('npx supabase status -o json', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    ) as { ANON_KEY: string; SERVICE_ROLE_KEY: string }
    const client = (key: string) =>
      createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    service = client(keys.SERVICE_ROLE_KEY)
    const signIn = async (name: string) => {
      const c = client(keys.ANON_KEY)
      const { error } = await c.auth.signInWithPassword({
        email: `${name}@login.shawarmania.invalid`,
        password: 'shawarmania-local',
      })
      if (error) throw error
      return c
    }
    // Dedicated kitchen devices avoid changing the spare used by other suites.
    const makeDevice = async (outletId: string, personId: string, kind: 'counter' | 'kitchen') => {
      const name = `dish.${randomUUID()}`
      const { data, error } = await service.auth.admin.createUser({
        email: `${name}@login.shawarmania.invalid`,
        password: 'shawarmania-local',
        email_confirm: true,
      })
      if (error || !data.user) throw error ?? new Error('missing kitchen user')
      const id = data.user.id
      const device = await service.from('counter_devices').insert({
        id,
        outlet_id: outletId,
        label: `Dish isolation ${kind}`,
        kind,
        session_proven_at: new Date().toISOString(),
      })
      if (device.error) throw device.error
      const shiftId = randomUUID()
      const shift = await service.from('counter_shifts').insert({
        id: shiftId,
        device_id: id,
        outlet_id: outletId,
        person_id: personId,
        kind,
        opened_at: new Date(Date.now() - 1000).toISOString(),
        business_date: resolveBusinessDate(new Date(), '04:00'),
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      })
      if (shift.error) throw shift.error
      return { id, shiftId, client: await signIn(name) }
    }
    const own = await makeDevice(kpa, '10000000-0000-4000-a000-00000000000b', 'kitchen')
    kitchenOwn = own.client
    kitchenOwnId = own.id
    const other = await makeDevice(kal, '10000000-0000-4000-a000-000000000010', 'kitchen')
    kitchen = other.client
    kitchenId = other.id
    const ownCounter = await makeDevice(kpa, '10000000-0000-4000-a000-00000000000b', 'counter')
    counter = ownCounter.client
    counterId = ownCounter.id
    counterShiftId = ownCounter.shiftId
    const otherCounter = await makeDevice(kal, '10000000-0000-4000-a000-000000000010', 'counter')
    otherCounterId = otherCounter.id
    for (const [label, alias] of [
      ['owner', 'owner'],
      ['admin', 'admin.kalyani'],
      ['biller', 'biller.kalyani'],
      ['employee', 'staff.kalyani'],
    ] as const)
      callers.push([label, await signIn(alias)])
    callers.push(['kitchen', kitchen])
    callers.push(['counter', otherCounter.client])
    const shiftId = counterShiftId
    const command = await createBillingCommand({
      commandId: randomUUID(),
      tabletId: counterId,
      shiftId,
      type: 'create_order',
      createdAt: new Date().toISOString(),
      payload: {
        orderId,
        businessDate: resolveBusinessDate(new Date(), '04:00'),
        customerId: null,
        customerName: null,
        customerPhone: null,
        subtotalPaise: 13900,
        discountPaise: 0,
        taxPaise: 0,
        roundingPaise: 0,
        totalPaise: 13900,
        pricingMode: 'no_tax',
        serviceType: null,
        tableNumber: null,
        discounts: [],
        lines: [
          {
            id: lineId,
            menuItemId: null,
            itemName: 'Isolation dish',
            unitPricePaise: 13900,
            quantity: 1,
            lineTotalPaise: 13900,
            discountPaise: 0,
            discountPercentBp: null,
            categoryName: null,
            kind: 'item',
            note: 'No sauce',
          },
        ],
      },
    })
    const created = await counter.rpc('create_billing_order', rpcArgs(command))
    expect(created.error).toBeNull()
    expect(created.data).toMatchObject({ status: 'accepted' })
    const ready = await kitchenOwn.rpc('kitchen_ready', {
      p_id: readyId,
      p_order_id: orderId,
      p_lines: [{ id: lineId, quantity: 1 }],
    })
    expect(ready.error).toBeNull()
    expect(ready.data).toMatchObject({ status: 'accepted' })
    const tick = await createBillingCommand({
      commandId: randomUUID(),
      tabletId: command.tabletId,
      shiftId,
      type: 'prepare_order_lines',
      createdAt: new Date().toISOString(),
      payload: { orderId, lines: [{ id: lineId, prepared: true }] },
    })
    const prepared = await counter.rpc('prepare_order_lines', rpcArgs(tick))
    expect(prepared.error).toBeNull()
    expect(prepared.data).toMatchObject({ status: 'accepted' })
  })

  afterAll(async () => {
    if (counter) {
      const cancel = await createBillingCommand({
        commandId: randomUUID(),
        tabletId: counterId,
        shiftId: counterShiftId,
        type: 'cancel_order',
        createdAt: new Date().toISOString(),
        payload: { orderId, reason: 'Isolation probe finished' },
      })
      await counter.rpc('cancel_billing_order', rpcArgs(cancel))
    }
    // Leave immutable history; remove only these test devices from active use.
    for (const id of [kitchenId, kitchenOwnId, counterId, otherCounterId].filter(Boolean)) {
      await service
        .from('counter_devices')
        .update({ removed_at: new Date().toISOString() })
        .eq('id', id)
      await service
        .from('counter_shifts')
        .update({ ended_at: new Date().toISOString(), ended_reason: 'device_removed' })
        .eq('device_id', id)
        .is('ended_at', null)
    }
    await Promise.all(
      [...callers.map(([, c]) => c), counter, kitchenOwn]
        .filter(Boolean)
        .map((c) => c.auth.signOut({ scope: 'local' })),
    )
  })

  it('proves its fixture exists, then hides the other outlet from counter, kitchen and admin', async () => {
    for (const table of ['order_line_preparations', 'kitchen_readies'] as const) {
      const own = await callers
        .find(([label]) => label === 'owner')![1]
        .from(table)
        .select('*')
        .eq('order_id', orderId)
      expect(own.error).toBeNull()
      expect(own.data).toHaveLength(1)
      for (const [label, caller] of callers.filter(([label]) =>
        ['admin', 'counter', 'kitchen'].includes(label),
      )) {
        const { data, error } = await caller
          .from(table)
          .select('*')
          .eq('outlet_id', kpa)
          .eq('order_id', orderId)
        expect(error, label).toBeNull()
        expect(data, label).toEqual([])
      }
    }
    const refused = await kitchen.rpc('kitchen_ready', {
      p_id: randomUUID(),
      p_order_id: orderId,
      p_lines: [{ id: lineId, quantity: 1 }],
    })
    expect(refused.error).toBeNull()
    expect(refused.data).toMatchObject({ status: 'not_authorised' })
  })

  it('refuses direct insert, update and delete to every client role', async () => {
    for (const [label, caller] of callers) {
      for (const operation of [
        caller.from('order_line_preparations').insert({
          order_item_id: lineId,
          outlet_id: kpa,
          order_id: orderId,
          quantity: 1,
          prepared_at: new Date().toISOString(),
          shift_id: '90000000-0000-4000-a000-000000000002',
          person_id: '10000000-0000-4000-a000-00000000000b',
        }),
        caller.from('order_line_preparations').update({ quantity: 99 }).eq('order_item_id', lineId),
        caller.from('order_line_preparations').delete().eq('order_item_id', lineId),
        caller.from('kitchen_readies').insert({
          id: randomUUID(),
          outlet_id: kpa,
          order_id: orderId,
          device_id: kitchenOwnId,
          shift_id: '90000000-0000-4000-a000-000000000002',
          person_id: '10000000-0000-4000-a000-00000000000b',
          lines: [],
        }),
        caller.from('kitchen_readies').update({ lines: [] }).eq('id', readyId),
        caller.from('kitchen_readies').delete().eq('id', readyId),
      ]) {
        const { error } = await operation
        expect(error?.code, label).toBe('42501')
      }
    }
  })
})
