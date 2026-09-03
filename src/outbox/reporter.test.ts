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
    schemaVersion: 2,
    tabletId: 'tablet-1',
    shiftId: 'shift-1',
    type: 'cancel_order',
    createdAt: '2026-08-11T12:00:00.000Z',
    payload: { orderId: 'order-1', reason: 'No customer facts in telemetry' },
    payloadHash: 'a'.repeat(64),
  }
}

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all([...names].map((name) => Dexie.delete(name)))
  names.clear()
})

describe('BillingUnsentReporter', () => {
  it('reports only the current tablet summary as envelopes enter and leave the queue', async () => {
    const database = new BillingDeliveryDatabase(databaseName())
    const store = new BillingDeliveryStore(database)
    const reportState = vi.fn(async () => undefined)
    const reporter = new BillingUnsentReporter({ store, tabletId: 'tablet-1', reportState })
    reporter.start()
    await vi.waitFor(() =>
      expect(reportState).toHaveBeenLastCalledWith({ count: 0, oldestCreatedAtMs: null }),
    )

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
    await vi.waitFor(() =>
      expect(reportState).toHaveBeenLastCalledWith({
        count: 1,
        oldestCreatedAtMs: Date.parse(serverCommand.createdAt),
      }),
    )

    await store.recordResult(
      serverCommand.commandId,
      { status: 'accepted', commandId: serverCommand.commandId },
      1,
    )
    await vi.waitFor(() =>
      expect(reportState).toHaveBeenLastCalledWith({ count: 0, oldestCreatedAtMs: null }),
    )

    await reporter.stop()
    database.close()
  })

  it('repairs a lost zero on the periodic heartbeat by re-reading IndexedDB', async () => {
    const database = new BillingDeliveryDatabase(databaseName())
    const store = new BillingDeliveryStore(database)
    const readSummary = vi.spyOn(store, 'unresolvedSummary')
    vi.useFakeTimers()
    const reportState = vi
      .fn()
      .mockRejectedValueOnce(new Error('response was lost'))
      .mockResolvedValue(undefined)
    const reporter = new BillingUnsentReporter({
      store,
      tabletId: 'tablet-1',
      reportState,
      visibilityTarget: null,
    })
    reporter.start()
    await vi.waitFor(() => expect(reportState).toHaveBeenCalledTimes(1))
    const readsBeforeHeartbeat = readSummary.mock.calls.length

    await vi.advanceTimersByTimeAsync(60_000)
    await vi.waitFor(() => expect(reportState).toHaveBeenCalledTimes(2))
    expect(reportState).toHaveBeenLastCalledWith({ count: 0, oldestCreatedAtMs: null })
    expect(readSummary.mock.calls.length).toBeGreaterThan(readsBeforeHeartbeat)

    await reporter.stop()
    database.close()
  })

  it('retries the final zero after the server command committed and its report was lost', async () => {
    const database = new BillingDeliveryDatabase(databaseName())
    const store = new BillingDeliveryStore(database)
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
    let heartbeat: (() => void) | null = null
    const reportState = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('zero response was lost'))
      .mockResolvedValue(undefined)
    const reporter = new BillingUnsentReporter({
      store,
      tabletId: 'tablet-1',
      reportState,
      visibilityTarget: null,
      setInterval: (callback) => {
        heartbeat = callback
        return 1
      },
      clearInterval: () => undefined,
    })
    reporter.start()
    await vi.waitFor(() =>
      expect(reportState).toHaveBeenLastCalledWith({
        count: 1,
        oldestCreatedAtMs: Date.parse(serverCommand.createdAt),
      }),
    )

    await store.recordResult(
      serverCommand.commandId,
      { status: 'accepted', commandId: serverCommand.commandId },
      1,
    )
    await vi.waitFor(() => expect(reportState).toHaveBeenCalledTimes(2))
    if (heartbeat) (heartbeat as () => void)()
    await vi.waitFor(() => expect(reportState).toHaveBeenCalledTimes(3))
    expect(reportState).toHaveBeenLastCalledWith({ count: 0, oldestCreatedAtMs: null })

    await reporter.stop()
    database.close()
  })

  it('re-reads on foreground and removes every trigger on stop', async () => {
    const database = new BillingDeliveryDatabase(databaseName())
    const store = new BillingDeliveryStore(database)
    const reportState = vi.fn(async () => undefined)
    const visibility = new EventTarget() as EventTarget & {
      visibilityState: DocumentVisibilityState
    }
    visibility.visibilityState = 'hidden'
    let interval: (() => void) | null = null
    const clearInterval = vi.fn()
    const reporter = new BillingUnsentReporter({
      store,
      tabletId: 'tablet-1',
      reportState,
      visibilityTarget: visibility,
      setInterval: (callback) => {
        interval = callback
        return 1 as unknown as ReturnType<typeof setInterval>
      },
      clearInterval,
    })
    reporter.start()
    await vi.waitFor(() => expect(reportState).toHaveBeenCalledTimes(1))

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
    await vi.waitFor(() =>
      expect(reportState).toHaveBeenLastCalledWith(expect.objectContaining({ count: 1 })),
    )

    visibility.visibilityState = 'visible'
    visibility.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(reportState.mock.calls.length).toBeGreaterThanOrEqual(3))
    const foregroundCalls = reportState.mock.calls.length

    await reporter.stop()
    expect(clearInterval).toHaveBeenCalledOnce()
    visibility.dispatchEvent(new Event('visibilitychange'))
    if (interval) (interval as () => void)()
    await Promise.resolve()
    expect(reportState).toHaveBeenCalledTimes(foregroundCalls)
    database.close()
  })
})
