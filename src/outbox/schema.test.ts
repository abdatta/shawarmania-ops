import 'fake-indexeddb/auto'

import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

import type { BillingCommand } from '../../shared/billing-command'
import {
  BILLING_DELIVERY_DATABASE_VERSION,
  BillingDeliveryDatabase,
  dependencyRecordId,
  type BillingDeliveryEnvelopeRecord,
} from './schema'

const openedNames = new Set<string>()

function databaseName(label: string): string {
  const name = `billing-delivery-${label}-${crypto.randomUUID()}`
  openedNames.add(name)
  return name
}

function command(commandId = crypto.randomUUID()): BillingCommand {
  return {
    commandId,
    schemaVersion: 1,
    tabletId: 'tablet-1',
    shiftId: 'shift-1',
    type: 'cancel_order',
    createdAt: '2026-08-11T12:00:00.000Z',
    payload: { orderId: 'order-1', reason: 'Customer changed their mind' },
    payloadHash: 'a'.repeat(64),
  }
}

function envelope(serverCommand = command()): BillingDeliveryEnvelopeRecord {
  return {
    commandId: serverCommand.commandId,
    tabletId: 'tablet-1',
    shiftId: 'shift-1',
    outletId: 'outlet-1',
    businessDate: '2026-08-11',
    type: serverCommand.type,
    schemaVersion: serverCommand.schemaVersion,
    payloadHash: serverCommand.payloadHash,
    createdAtMs: Date.parse(serverCommand.createdAt),
    chainId: 'order-1',
    state: 'pending',
    eligibleAtMs: Date.parse(serverCommand.createdAt),
    nextAttemptAtMs: null,
    attemptCount: 0,
    command: serverCommand,
  }
}

afterEach(async () => {
  await Promise.all([...openedNames].map((name) => Dexie.delete(name)))
  openedNames.clear()
})

describe('BillingDeliveryDatabase', () => {
  it('keeps envelopes, dependency edges, results, tombstones and leases separate', async () => {
    const database = new BillingDeliveryDatabase(databaseName('shape'))
    const record = envelope()
    const parentId = crypto.randomUUID()

    await database.transaction(
      'rw',
      database.envelopes,
      database.dependencies,
      database.results,
      database.tombstones,
      database.leases,
      async () => {
        await database.envelopes.add(record)
        await database.dependencies.add({
          id: dependencyRecordId(record.commandId, parentId),
          commandId: record.commandId,
          dependsOnCommandId: parentId,
        })
        await database.results.add({
          commandId: record.commandId,
          recordedAtMs: 1,
          result: { status: 'accepted', commandId: record.commandId },
          refusedTrace: null,
        })
        await database.tombstones.add({
          commandId: record.commandId,
          resolution: 'corrected',
          actorId: 'person-1',
          reason: 'Corrected tender',
          replacementCommandId: 'replacement-1',
          recordedAtMs: 2,
        })
        await database.leases.add({
          name: 'drain',
          ownerId: 'tab-1',
          renewedAtMs: 3,
          expiresAtMs: 4,
        })
      },
    )

    expect(await database.envelopes.get(record.commandId)).toEqual(record)
    expect(await database.dependencies.where('commandId').equals(record.commandId).count()).toBe(1)
    expect((await database.results.get(record.commandId))?.result.status).toBe('accepted')
    expect((await database.tombstones.get(record.commandId))?.replacementCommandId).toBe(
      'replacement-1',
    )
    expect((await database.leases.get('drain'))?.ownerId).toBe('tab-1')
    database.close()
  })

  it('upgrades an older database without losing its unsent envelope', async () => {
    const name = databaseName('upgrade')
    const serverCommand = command()
    const legacy = new Dexie(name)
    legacy.version(1).stores({ envelopes: '&commandId' })
    await legacy.open()
    await legacy.table('envelopes').add({
      commandId: serverCommand.commandId,
      command: serverCommand,
    })
    legacy.close()

    const database = new BillingDeliveryDatabase(name)
    await database.open()
    const restored = await database.envelopes.get(serverCommand.commandId)

    expect(database.verno).toBe(BILLING_DELIVERY_DATABASE_VERSION)
    expect(restored?.command).toEqual(serverCommand)
    expect(restored).toMatchObject({
      commandId: serverCommand.commandId,
      tabletId: 'tablet-1',
      shiftId: 'shift-1',
      type: 'cancel_order',
      schemaVersion: 1,
      state: 'pending',
      attemptCount: 0,
    })
    expect(await database.dependencies.count()).toBe(0)
    expect(await database.results.count()).toBe(0)
    expect(await database.tombstones.count()).toBe(0)
    expect(await database.leases.count()).toBe(0)
    expect(await database.resumeRecords.count()).toBe(0)
    expect(await database.expenseEnvelopes.count()).toBe(0)
    database.close()
  })

  it('adds resume storage to version three without touching delivery evidence', async () => {
    const name = databaseName('resume-upgrade')
    const delivery = envelope()
    const legacy = new Dexie(name)
    legacy.version(3).stores({
      envelopes:
        '&commandId, tabletId, shiftId, outletId, businessDate, type, state, eligibleAtMs, nextAttemptAtMs, [tabletId+state], [chainId+createdAtMs]',
      dependencies: '&id, commandId, dependsOnCommandId',
      results: '&commandId, recordedAtMs',
      tombstones: '&commandId, resolution, recordedAtMs, replacementCommandId',
      leases: '&name, ownerId, expiresAtMs',
    })
    await legacy.open()
    await legacy.table('envelopes').put(delivery)
    await legacy.table('dependencies').put({
      id: dependencyRecordId(delivery.commandId, 'parent-1'),
      commandId: delivery.commandId,
      dependsOnCommandId: 'parent-1',
    })
    await legacy.table('results').put({
      commandId: 'parent-1',
      recordedAtMs: 1,
      result: { status: 'accepted', commandId: 'parent-1' },
      refusedTrace: null,
    })
    await legacy.table('tombstones').put({
      commandId: 'old-1',
      resolution: 'discarded',
      actorId: 'person-1',
      reason: 'duplicate',
      replacementCommandId: null,
      recordedAtMs: 2,
    })
    legacy.close()

    const database = new BillingDeliveryDatabase(name)
    await database.open()

    expect(await database.envelopes.get(delivery.commandId)).toEqual(delivery)
    expect(await database.dependencies.count()).toBe(1)
    expect(await database.results.count()).toBe(1)
    expect(await database.tombstones.count()).toBe(1)
    expect(await database.resumeRecords.count()).toBe(0)
    expect(await database.expenseEnvelopes.count()).toBe(0)
    database.close()
  })
})
