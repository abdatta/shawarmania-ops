import 'fake-indexeddb/auto'

import Dexie from 'dexie'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Database } from '../database.types'
import {
  BILLING_DELIVERY_DATABASE_NAME,
  BillingDeliveryDatabase,
  COUNTER_RESUME_SCHEMA_VERSION,
  type CounterResumeRecord,
} from '@/outbox'
import type { CounterDeviceSession } from '@/session/counter-session'

import { createSupabaseExpensesAdapter } from './expenses'

const resume: CounterResumeRecord = {
  tabletId: 'tablet-1',
  schemaVersion: COUNTER_RESUME_SCHEMA_VERSION,
  complete: true,
  tablet: { id: 'tablet-1', outletId: 'outlet-1', label: 'Till' },
  shift: {
    id: 'shift-1',
    personId: 'person-1',
    operatorName: 'Rina',
    outletId: 'outlet-1',
    openedAt: '2026-09-01T03:30:00.000Z',
    businessDate: '2026-09-01',
    expiresAt: '2026-09-01T18:30:00.000Z',
  },
  outlet: { id: 'outlet-1', business_day_cutover: '03:00' } as CounterResumeRecord['outlet'],
  outletCutover: '03:00',
  outletCutoverAt: '2026-09-01T21:30:00.000Z',
  menu: [],
  pipeline: [],
  bills: [],
  rememberedCustomers: {},
  lastSuccessfulReadAt: '2026-09-01T10:00:00.000Z',
  serverObservedAt: '2026-09-01T10:00:00.000Z',
  deviceObservedAt: '2026-09-01T10:00:00.000Z',
}

const resumedSession: CounterDeviceSession = {
  kind: 'counter-device',
  device: {
    deviceId: resume.tablet.id,
    outletId: resume.tablet.outletId,
    label: resume.tablet.label,
  },
  shift: {
    id: resume.shift.id,
    personId: resume.shift.personId,
    outletId: resume.shift.outletId,
    openedAt: resume.shift.openedAt,
    businessDate: resume.shift.businessDate,
    expiresAt: resume.shift.expiresAt,
  },
  offlineResume: resume,
}

const expense = {
  outletId: 'outlet-1',
  businessDate: '2026-09-01',
  category: 'Packaging',
  isCash: true,
  amountPaise: 12_500,
  note: 'Paper bags',
}

function unusedClient(): SupabaseClient<Database> {
  return { from: vi.fn(), rpc: vi.fn() } as unknown as SupabaseClient<Database>
}

beforeEach(async () => Dexie.delete(BILLING_DELIVERY_DATABASE_NAME))
afterEach(async () => Dexie.delete(BILLING_DELIVERY_DATABASE_NAME))

describe('counter expenses after an offline cold start', () => {
  it('keeps the expense under a client UUID and reads it without contacting the backend', async () => {
    const client = unusedClient()
    const adapter = createSupabaseExpensesAdapter(client, resumedSession)

    const created = await adapter.createExpense(expense)
    await expect(
      adapter.listExpenses(expense.outletId, expense.businessDate),
    ).resolves.toMatchObject([{ id: created.id, amountPaise: 12_500, category: 'Packaging' }])

    const database = new BillingDeliveryDatabase()
    await expect(database.expenseEnvelopes.get(created.id)).resolves.toMatchObject({
      id: created.id,
      tabletId: resume.tabletId,
      shiftId: resume.shift.id,
      input: expense,
    })
    expect(client.from).not.toHaveBeenCalled()
    database.close()
  })

  it('replays the exact row identity once after the same live shift resolves online', async () => {
    const offline = createSupabaseExpensesAdapter(unusedClient(), resumedSession)
    const created = await offline.createExpense(expense)
    const inserted: Record<string, unknown>[] = []

    const empty = { data: [], error: null }
    const from = vi.fn((table: string) => {
      if (table === 'expenses') {
        const query = {
          insert: (row: Record<string, unknown>) => {
            inserted.push(row)
            return Promise.resolve({ data: null, error: null })
          },
          select: () => query,
          eq: () => query,
          order: () => query,
          then: (resolve: (value: typeof empty) => unknown) => Promise.resolve(empty).then(resolve),
        }
        return query
      }
      throw new Error(`unexpected table ${table}`)
    })
    const client = {
      from,
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    } as unknown as SupabaseClient<Database>
    const { offlineResume: _offlineResume, ...onlineSession } = resumedSession
    const online = createSupabaseExpensesAdapter(client, onlineSession)

    await online.listExpenses(expense.outletId, expense.businessDate)
    await online.listExpenses(expense.outletId, expense.businessDate)

    expect(inserted).toEqual([
      expect.objectContaining({ id: created.id, outlet_id: 'outlet-1', amount_paise: 12_500 }),
    ])
    const database = new BillingDeliveryDatabase()
    await expect(database.expenseEnvelopes.count()).resolves.toBe(0)
    database.close()
  })
})
