import 'fake-indexeddb/auto'

import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BillingCommand } from '../../shared/billing-command'
import { BillingDeliveryDatabase } from './schema'
import {
  MAX_BILLING_RETRY_MS,
  BillingDrainCoordinator,
  billingRetryDelayMs,
  type BillingLockManager,
} from './drain'
import { BillingDeliveryStore } from './store'

const names = new Set<string>()

function databaseName(): string {
  const name = `billing-drain-${crypto.randomUUID()}`
  names.add(name)
  return name
}

function command(commandId: string, orderId: string): BillingCommand {
  return {
    commandId,
    schemaVersion: 1,
    tabletId: 'tablet-1',
    shiftId: 'shift-1',
    type: 'cancel_order',
    createdAt: '2026-08-11T12:00:00.000Z',
    payload: { orderId, reason: 'Test cancellation' },
    payloadHash: commandId.replaceAll('-', '').padEnd(64, 'a').slice(0, 64),
  }
}

function createOrderCommand(
  commandId: string,
  orderId: string,
): Extract<BillingCommand, { type: 'create_order' }> {
  return {
    commandId,
    schemaVersion: 1,
    tabletId: 'tablet-1',
    shiftId: 'shift-1',
    type: 'create_order',
    createdAt: '2026-08-11T12:00:00.000Z',
    payload: {
      orderId,
      businessDate: '2026-08-11',
      customerId: null,
      customerName: null,
      customerPhone: null,
      subtotalPaise: 13_900,
      discountPaise: 0,
      taxPaise: 0,
      totalPaise: 13_900,
      pricingMode: 'no_tax',
      lines: [
        {
          id: crypto.randomUUID(),
          menuItemId: null,
          itemName: 'Classic Chicken Shawarma',
          unitPricePaise: 13_900,
          quantity: 1,
          lineTotalPaise: 13_900,
        },
      ],
    },
    payloadHash: commandId.replaceAll('-', '').padEnd(64, 'b').slice(0, 64),
  }
}

async function accept(
  store: BillingDeliveryStore,
  serverCommand: BillingCommand,
  chainId: string,
  dependencies: readonly string[] = [],
) {
  await store.accept({
    command: serverCommand,
    tabletId: 'tablet-1',
    outletId: 'outlet-1',
    businessDate: '2026-08-11',
    chainId,
    dependsOnCommandIds: dependencies,
    eligibleAtMs: 0,
    nowMs: 0,
  })
}

afterEach(async () => {
  await Promise.all([...names].map((name) => Dexie.delete(name)))
  names.clear()
})

describe('BillingDrainCoordinator', () => {
  it('uses bounded exponential backoff with bounded jitter', () => {
    expect(billingRetryDelayMs(1, () => 0)).toBe(750)
    expect(billingRetryDelayMs(2, () => 0.5)).toBe(2_000)
    expect(billingRetryDelayMs(50, () => 1)).toBe(MAX_BILLING_RETRY_MS)
  })

  it('drains an order chain in dependency order without freezing an unrelated command', async () => {
    const database = new BillingDeliveryDatabase(databaseName())
    const store = new BillingDeliveryStore(database)
    const parent = command(crypto.randomUUID(), 'order-a')
    const child = command(crypto.randomUUID(), 'order-a')
    const unrelated = command(crypto.randomUUID(), 'order-b')
    await accept(store, child, 'order-a', [parent.commandId])
    await accept(store, unrelated, 'order-b')
    await accept(store, parent, 'order-a')
    const sent: string[] = []
    const coordinator = new BillingDrainCoordinator({
      store,
      tabletId: 'tablet-1',
      ownerId: 'tab-a',
      locks: null,
      now: () => 10,
      isVisible: () => true,
      execute: async (serverCommand) => {
        sent.push(serverCommand.commandId)
        return { status: 'accepted', commandId: serverCommand.commandId }
      },
    })

    await expect(coordinator.runOnce()).resolves.toBe(3)
    expect(sent.indexOf(parent.commandId)).toBeLessThan(sent.indexOf(child.commandId))
    expect(sent).toContain(unrelated.commandId)
    expect(await database.envelopes.count()).toBe(0)
    await coordinator.stop()
    database.close()
  })

  it('keeps a child blocked when its parent needs attention and still drains another chain', async () => {
    const database = new BillingDeliveryDatabase(databaseName())
    const store = new BillingDeliveryStore(database)
    const blockedParent = command(crypto.randomUUID(), 'order-a')
    const blockedChild = command(crypto.randomUUID(), 'order-a')
    const unrelated = command(crypto.randomUUID(), 'order-b')
    await accept(store, blockedParent, 'order-a')
    await accept(store, blockedChild, 'order-a', [blockedParent.commandId])
    await accept(store, unrelated, 'order-b')
    await database.envelopes.update(blockedParent.commandId, { state: 'needs_attention' })
    const execute = vi.fn(async (serverCommand: BillingCommand) => ({
      status: 'accepted' as const,
      commandId: serverCommand.commandId,
    }))
    const coordinator = new BillingDrainCoordinator({
      store,
      tabletId: 'tablet-1',
      ownerId: 'tab-a',
      locks: null,
      now: () => 10,
      isVisible: () => true,
      execute,
    })

    await expect(coordinator.runOnce()).resolves.toBe(1)
    expect(execute).toHaveBeenCalledWith(unrelated)
    expect(await database.envelopes.get(blockedChild.commandId)).toBeDefined()
    await coordinator.stop()
    database.close()
  })

  it('backs off a missing response while another chain continues', async () => {
    const database = new BillingDeliveryDatabase(databaseName())
    const store = new BillingDeliveryStore(database)
    const unreachable = command(crypto.randomUUID(), 'order-a')
    const unrelated = command(crypto.randomUUID(), 'order-b')
    await accept(store, unreachable, 'order-a')
    await accept(store, unrelated, 'order-b')
    const reachability = vi.fn()
    const coordinator = new BillingDrainCoordinator({
      store,
      tabletId: 'tablet-1',
      ownerId: 'tab-a',
      locks: null,
      now: () => 10_000,
      random: () => 0.5,
      isVisible: () => true,
      onReachability: reachability,
      execute: async (serverCommand) => {
        if (serverCommand.commandId === unreachable.commandId) throw new TypeError('fetch failed')
        return { status: 'accepted', commandId: serverCommand.commandId }
      },
    })

    await expect(coordinator.runOnce()).resolves.toBe(1)
    expect(await database.envelopes.get(unreachable.commandId)).toMatchObject({
      state: 'retrying',
      attemptCount: 1,
      nextAttemptAtMs: 11_000,
    })
    expect(await database.envelopes.get(unrelated.commandId)).toBeUndefined()
    expect(reachability).toHaveBeenCalledWith(false)
    expect(reachability).toHaveBeenCalledWith(true)
    await coordinator.stop()
    database.close()
  })

  it('resolves a retained create order when its committed response replays', async () => {
    const database = new BillingDeliveryDatabase(databaseName())
    const store = new BillingDeliveryStore(database)
    const retained = createOrderCommand(crypto.randomUUID(), crypto.randomUUID())
    await accept(store, retained, retained.payload.orderId)
    let nowMs = 10_000
    let committed = false
    const execute = vi.fn(async () => {
      if (!committed) {
        committed = true
        // The server committed, but its accepted response never reached the
        // outbox. The immutable envelope therefore remains for exact replay.
        throw new TypeError('response lost after commit')
      }
      return {
        status: 'replay' as const,
        commandId: retained.commandId,
        orderId: retained.payload.orderId,
        orderNumber: 8,
      }
    })
    const coordinator = new BillingDrainCoordinator({
      store,
      tabletId: 'tablet-1',
      ownerId: 'tab-a',
      locks: null,
      now: () => nowMs,
      random: () => 0.5,
      isVisible: () => true,
      execute,
    })

    await expect(coordinator.runOnce()).resolves.toBe(0)
    expect(await database.envelopes.get(retained.commandId)).toMatchObject({
      state: 'retrying',
      attemptCount: 1,
      nextAttemptAtMs: 11_000,
    })

    nowMs = 11_000
    await expect(coordinator.runOnce()).resolves.toBe(1)
    expect(execute).toHaveBeenCalledTimes(2)
    expect(await database.envelopes.get(retained.commandId)).toBeUndefined()
    expect(await database.results.get(retained.commandId)).toMatchObject({
      result: { status: 'replay', orderNumber: 8 },
      refusedTrace: null,
    })
    expect(
      await database.envelopes
        .where('[tabletId+state]')
        .equals(['tablet-1', 'needs_attention'])
        .count(),
    ).toBe(0)
    await coordinator.stop()
    database.close()
  })

  it('treats the browser online event only as a retry hint', async () => {
    const database = new BillingDeliveryDatabase(databaseName())
    const store = new BillingDeliveryStore(database)
    const waiting = command(crypto.randomUUID(), 'order-a')
    await accept(store, waiting, 'order-a')
    await database.envelopes.update(waiting.commandId, {
      state: 'retrying',
      nextAttemptAtMs: 50_000,
      attemptCount: 1,
    })
    const target = new EventTarget()
    const reachability = vi.fn()
    const execute = vi.fn(async () => ({
      status: 'accepted' as const,
      commandId: waiting.commandId,
    }))
    const coordinator = new BillingDrainCoordinator({
      store,
      tabletId: 'tablet-1',
      ownerId: 'tab-a',
      locks: null,
      now: () => 10_000,
      isVisible: () => true,
      tickMs: 60_000,
      connectivityTarget: target,
      onReachability: reachability,
      execute,
    })
    coordinator.start()
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
    expect(execute).not.toHaveBeenCalled()
    expect(reachability).not.toHaveBeenCalled()

    target.dispatchEvent(new Event('online'))
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    expect(reachability).toHaveBeenCalledWith(true)
    expect(await database.envelopes.get(waiting.commandId)).toBeUndefined()
    await coordinator.stop()
    database.close()
  })

  it('allows only one fallback lease owner across two tabs', async () => {
    const name = databaseName()
    const firstDatabase = new BillingDeliveryDatabase(name)
    const secondDatabase = new BillingDeliveryDatabase(name)
    const first = new BillingDeliveryStore(firstDatabase)
    const second = new BillingDeliveryStore(secondDatabase)

    const [firstWon, secondWon] = await Promise.all([
      first.acquireLease('drain', 'tab-a', 100, 5_000),
      second.acquireLease('drain', 'tab-b', 100, 5_000),
    ])

    expect([firstWon, secondWon].filter(Boolean)).toHaveLength(1)
    firstDatabase.close()
    secondDatabase.close()
  })

  it('uses Web Locks when available so simultaneous pages never execute together', async () => {
    let held = false
    const locks: BillingLockManager = {
      async request(_name, _options, callback) {
        if (held) return callback(null)
        held = true
        try {
          return await callback({ name: 'drain' })
        } finally {
          held = false
        }
      },
    }
    const database = new BillingDeliveryDatabase(databaseName())
    const store = new BillingDeliveryStore(database)
    const serverCommand = command(crypto.randomUUID(), 'order-a')
    await accept(store, serverCommand, 'order-a')
    let release!: () => void
    const first = new BillingDrainCoordinator({
      store,
      tabletId: 'tablet-1',
      ownerId: 'tab-a',
      locks,
      now: () => 10,
      isVisible: () => true,
      execute: () =>
        new Promise(
          (resolve) =>
            (release = () =>
              resolve({
                status: 'accepted',
                commandId: serverCommand.commandId,
              })),
        ),
    })
    const secondExecute = vi.fn()
    const second = new BillingDrainCoordinator({
      store,
      tabletId: 'tablet-1',
      ownerId: 'tab-b',
      locks,
      now: () => 10,
      isVisible: () => true,
      execute: secondExecute,
    })

    const firstRun = first.runOnce()
    await Promise.resolve()
    await expect(second.runOnce()).resolves.toBe(0)
    expect(secondExecute).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    release()
    await expect(firstRun).resolves.toBe(1)
    database.close()
  })

  it('runs the secondary drain on every tick, even with no commands waiting', async () => {
    // The counter expense queue rides this hook. It has to run when the
    // command queue is empty — an outage that produced only expenses is the
    // ordinary case — and a failure in it must never fail command delivery.
    const database = new BillingDeliveryDatabase(databaseName())
    const store = new BillingDeliveryStore(database)
    let calls = 0
    const coordinator = new BillingDrainCoordinator({
      store,
      tabletId: 'tablet-1',
      ownerId: 'tab-a',
      locks: null,
      now: () => 10,
      isVisible: () => true,
      execute: async (serverCommand) => ({
        status: 'accepted',
        commandId: serverCommand.commandId,
      }),
      secondary: async () => {
        calls += 1
        throw new Error('the expense queue is having a bad time')
      },
    })

    await expect(coordinator.runOnce()).resolves.toBe(0)
    expect(calls).toBe(1)

    // And it still runs alongside commands, after they have gone.
    const only = command(crypto.randomUUID(), 'order-a')
    await accept(store, only, 'order-a')
    await expect(coordinator.runOnce()).resolves.toBe(1)
    expect(calls).toBe(2)
  })
})
