import 'fake-indexeddb/auto'

import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BillingCommand } from '../../shared/billing-command'
import { BillingDeliveryDatabase } from './schema'
import { BillingUnsentReporter } from './reporter'
import { BillingDeliveryStore } from './store'

const names = new Set<string>()

function databaseName(): string {
  const name = `billing-reporter-${crypto.randomUUID()}`
  names.add(name)
  return name
}

function command(): BillingCommand {
  const commandId = crypto.randomUUID()
  return {
    commandId,
    schemaVersion: 1,
    tabletId: 'tablet-1',
    shiftId: 'shift-1',
    type: 'cancel_order',
    createdAt: '2026-08-11T12:00:00.000Z',
    payload: { orderId: 'order-1', reason: 'No customer facts in telemetry' },
    payloadHash: 'a'.repeat(64),
  }
}

afterEach(async () => {
  await Promise.all([...names].map((name) => Dexie.delete(name)))
  names.clear()
})

describe('BillingUnsentReporter', () => {
  it('reports only the current tablet count as envelopes enter and leave the queue', async () => {
    const database = new BillingDeliveryDatabase(databaseName())
    const store = new BillingDeliveryStore(database)
    const reportState = vi.fn(async (_unsent: number) => undefined)
    const reporter = new BillingUnsentReporter({ store, tabletId: 'tablet-1', reportState })
    reporter.start()
    await vi.waitFor(() => expect(reportState).toHaveBeenLastCalledWith(0))

    const serverCommand = command()
    await store.accept({
      command: serverCommand,
      tabletId: 'tablet-1',
      outletId: 'outlet-1',
      businessDate: '2026-08-11',
      chainId: 'order-1',
      eligibleAtMs: 0,
      nowMs: 0,
    })
    await vi.waitFor(() => expect(reportState).toHaveBeenLastCalledWith(1))

    await store.recordResult(
      serverCommand.commandId,
      { status: 'accepted', commandId: serverCommand.commandId },
      1,
    )
    await vi.waitFor(() => expect(reportState).toHaveBeenLastCalledWith(0))
    expect(reportState.mock.calls.every(([value]) => typeof value === 'number')).toBe(true)

    await reporter.stop()
    database.close()
  })
})
