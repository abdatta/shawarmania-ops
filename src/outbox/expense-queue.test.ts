import 'fake-indexeddb/auto'

import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

import { BillingDeliveryDatabase } from './schema'
import {
  discardCounterExpense,
  drainCounterExpenses,
  enqueueCounterExpense,
  listCounterExpenses,
} from './expense-queue'

const names = new Set<string>()
const name = () => {
  const value = `counter-expenses-${crypto.randomUUID()}`
  names.add(value)
  return value
}

afterEach(async () => {
  await Promise.all([...names].map((databaseName) => Dexie.delete(databaseName)))
  names.clear()
})

const input = {
  outletId: 'outlet-1',
  businessDate: '2026-09-01',
  category: 'Gas',
  amountPaise: 12_500,
  isCash: true,
  note: ' cylinder ',
}

async function seed(database: BillingDeliveryDatabase, count: number) {
  for (let index = 0; index < count; index += 1) {
    await enqueueCounterExpense(database, {
      id: `expense-${index}`,
      tabletId: 'tablet-1',
      shiftId: 'shift-1',
      createdAtMs: 1_000 + index,
      input: { ...input, amountPaise: 100 * (index + 1) },
    })
  }
}

describe('the counter expense queue', () => {
  it('sends oldest first and deletes what the server accepted', async () => {
    const database = new BillingDeliveryDatabase(name())
    await seed(database, 3)

    const sent: string[] = []
    const delivered = await drainCounterExpenses(database, 'tablet-1', async (entry) => {
      sent.push(entry.id)
      return { error: null }
    })

    expect(sent).toEqual(['expense-0', 'expense-1', 'expense-2'])
    expect(delivered).toBe(3)
    expect(await listCounterExpenses(database, 'tablet-1')).toEqual([])
  })

  it('treats a replayed identity as delivered rather than as a second expense', async () => {
    const database = new BillingDeliveryDatabase(name())
    await seed(database, 1)

    const delivered = await drainCounterExpenses(database, 'tablet-1', async () => ({
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    }))

    expect(delivered).toBe(1)
    expect(await listCounterExpenses(database, 'tablet-1')).toEqual([])
  })

  it('stops on a transient failure and keeps its place in the queue', async () => {
    const database = new BillingDeliveryDatabase(name())
    await seed(database, 3)

    const sent: string[] = []
    await drainCounterExpenses(database, 'tablet-1', async (entry) => {
      sent.push(entry.id)
      if (entry.id === 'expense-1') throw new TypeError('Failed to fetch')
      return { error: null }
    })

    // It did not skip ahead to expense-2: order reaches the server as the
    // counter made it.
    expect(sent).toEqual(['expense-0', 'expense-1'])
    const remaining = await listCounterExpenses(database, 'tablet-1')
    expect(remaining.map((row) => row.id).sort()).toEqual(['expense-1', 'expense-2'])
    expect(remaining.every((row) => row.state === 'pending')).toBe(true)
    expect(remaining.find((row) => row.id === 'expense-1')?.attemptCount).toBe(1)
  })

  it('parks a refusal as needing attention instead of retrying it forever', async () => {
    const database = new BillingDeliveryDatabase(name())
    await seed(database, 2)

    const attempts: string[] = []
    const refuse = async (entry: { id: string }) => {
      attempts.push(entry.id)
      return entry.id === 'expense-0'
        ? { error: { code: '42501', message: 'new row violates row-level security policy' } }
        : { error: null }
    }

    await drainCounterExpenses(database, 'tablet-1', refuse)
    // One bad row must not strand the queue behind it.
    expect(attempts).toEqual(['expense-0', 'expense-1'])

    const parked = await listCounterExpenses(database, 'tablet-1')
    expect(parked).toHaveLength(1)
    expect(parked[0]).toMatchObject({
      id: 'expense-0',
      state: 'needs_attention',
      lastRefusal: 'new row violates row-level security policy',
    })

    // A second drain does not touch it again: a refusal is an answer.
    attempts.length = 0
    await drainCounterExpenses(database, 'tablet-1', refuse)
    expect(attempts).toEqual([])
  })

  it('discards only a refused expense, never one still waiting to send', async () => {
    const database = new BillingDeliveryDatabase(name())
    await seed(database, 2)
    await drainCounterExpenses(database, 'tablet-1', async (entry) =>
      entry.id === 'expense-0'
        ? { error: { code: '23514', message: 'amount must be above zero' } }
        : { error: { code: '503', message: 'service unavailable' } },
    )

    await discardCounterExpense(database, 'expense-1')
    expect((await listCounterExpenses(database, 'tablet-1')).map((row) => row.id).sort()).toEqual([
      'expense-0',
      'expense-1',
    ])

    await discardCounterExpense(database, 'expense-0')
    expect((await listCounterExpenses(database, 'tablet-1')).map((row) => row.id)).toEqual([
      'expense-1',
    ])
  })

  it('reads a row written before the queue had a state as pending and untried', async () => {
    const database = new BillingDeliveryDatabase(name())
    await database.expenseEnvelopes.add({
      id: 'legacy-1',
      tabletId: 'tablet-1',
      shiftId: 'shift-1',
      createdAtMs: 10,
      input,
    })

    const rows = await listCounterExpenses(database, 'tablet-1')
    expect(rows).toEqual([
      expect.objectContaining({
        id: 'legacy-1',
        state: 'pending',
        attemptCount: 0,
        lastRefusal: null,
      }),
    ])
  })
})
