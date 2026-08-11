import 'fake-indexeddb/auto'

import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

import type { BillingCommand } from '../../shared/billing-command'
import { UNDO_WINDOW_MS } from '@/domain'
import { BillingDeliveryDatabase, dependencyRecordId } from './schema'
import { BillingDeliveryStore, BillingDeliveryStoreError } from './store'

const names = new Set<string>()
const NOW = 1_000

function databaseName(): string {
  const name = `billing-store-${crypto.randomUUID()}`
  names.add(name)
  return name
}

function command(commandId = crypto.randomUUID(), payloadHash = 'a'.repeat(64)): BillingCommand {
  return {
    commandId,
    schemaVersion: 1,
    tabletId: 'tablet-1',
    shiftId: 'shift-1',
    type: 'cancel_order',
    createdAt: '2026-08-11T12:00:00.000Z',
    payload: { orderId: 'order-1', reason: 'Customer changed their mind' },
    payloadHash,
  }
}

function acceptedInput(serverCommand = command()) {
  return {
    command: serverCommand,
    tabletId: 'tablet-1',
    outletId: 'outlet-1',
    businessDate: '2026-08-11',
    chainId: 'order-1',
    eligibleAtMs: NOW + UNDO_WINDOW_MS,
    nowMs: NOW,
  } as const
}

afterEach(async () => {
  await Promise.all([...names].map((name) => Dexie.delete(name)))
  names.clear()
})

describe('BillingDeliveryStore', () => {
  it('acknowledges only after the envelope and every dependency commit together', async () => {
    const database = new BillingDeliveryDatabase(databaseName())
    const store = new BillingDeliveryStore(database)
    const serverCommand = command()
    const parentId = crypto.randomUUID()

    await store.accept({ ...acceptedInput(serverCommand), dependsOnCommandIds: [parentId] })

    expect(await database.envelopes.get(serverCommand.commandId)).toMatchObject({
      state: 'held',
      eligibleAtMs: NOW + UNDO_WINDOW_MS,
      attemptCount: 0,
    })
    expect(
      await database.dependencies.get(dependencyRecordId(serverCommand.commandId, parentId)),
    ).toMatchObject({ commandId: serverCommand.commandId, dependsOnCommandId: parentId })
    database.close()
  })

  it('rolls the envelope back when any part of the IndexedDB transaction fails', async () => {
    const database = new BillingDeliveryDatabase(databaseName())
    const store = new BillingDeliveryStore(database)
    const serverCommand = command()
    const parentId = crypto.randomUUID()
    await database.dependencies.add({
      id: dependencyRecordId(serverCommand.commandId, parentId),
      commandId: 'some-other-command',
      dependsOnCommandId: parentId,
    })

    await expect(
      store.accept({ ...acceptedInput(serverCommand), dependsOnCommandIds: [parentId] }),
    ).rejects.toMatchObject({ code: 'storage_failed' })
    expect(await database.envelopes.get(serverCommand.commandId)).toBeUndefined()
    database.close()
  })

  it('treats an exact local replay as success and conflicting contents as identity conflict', async () => {
    const database = new BillingDeliveryDatabase(databaseName())
    const store = new BillingDeliveryStore(database)
    const commandId = crypto.randomUUID()
    await store.accept(acceptedInput(command(commandId)))

    await expect(store.accept(acceptedInput(command(commandId)))).resolves.toBeUndefined()
    await expect(store.accept(acceptedInput(command(commandId, 'b'.repeat(64))))).rejects.toEqual(
      expect.objectContaining<Partial<BillingDeliveryStoreError>>({ code: 'identity_conflict' }),
    )
    expect(await database.envelopes.count()).toBe(1)
    database.close()
  })

  it('removes a held payment on Undo while retaining an attributed tombstone', async () => {
    const database = new BillingDeliveryDatabase(databaseName())
    const store = new BillingDeliveryStore(database)
    const serverCommand = command()
    await store.accept(acceptedInput(serverCommand))

    await store.undo(serverCommand.commandId, 'person-1', NOW + UNDO_WINDOW_MS - 1)

    expect(await database.envelopes.get(serverCommand.commandId)).toBeUndefined()
    expect(await database.tombstones.get(serverCommand.commandId)).toMatchObject({
      resolution: 'undone',
      actorId: 'person-1',
      recordedAtMs: NOW + UNDO_WINDOW_MS - 1,
    })
    database.close()
  })

  it('refuses Undo once the six-second hold has expired', async () => {
    const database = new BillingDeliveryDatabase(databaseName())
    const store = new BillingDeliveryStore(database)
    const serverCommand = command()
    await store.accept(acceptedInput(serverCommand))

    await expect(
      store.undo(serverCommand.commandId, 'person-1', NOW + UNDO_WINDOW_MS),
    ).rejects.toMatchObject({ code: 'not_undoable' })
    expect(await database.envelopes.get(serverCommand.commandId)).toBeDefined()
    database.close()
  })

  it.each(['accepted', 'replay'] as const)(
    'records %s as a terminal server result and removes the unsent envelope',
    async (status) => {
      const database = new BillingDeliveryDatabase(databaseName())
      const store = new BillingDeliveryStore(database)
      const serverCommand = command()
      await store.accept({ ...acceptedInput(serverCommand), eligibleAtMs: NOW })

      await store.recordResult(
        serverCommand.commandId,
        { status, commandId: serverCommand.commandId },
        NOW + 1,
      )

      expect(await database.envelopes.get(serverCommand.commandId)).toBeUndefined()
      expect(await database.results.get(serverCommand.commandId)).toMatchObject({
        result: { status },
        refusedTrace: null,
      })
      database.close()
    },
  )

  it.each([
    'order_not_open',
    'identity_conflict',
    'authorization_refused',
    'malformed_payload',
  ] as const)('retains a %s refusal as durable needs-attention evidence', async (status) => {
    const database = new BillingDeliveryDatabase(databaseName())
    const store = new BillingDeliveryStore(database)
    const serverCommand = command()
    await store.accept({ ...acceptedInput(serverCommand), eligibleAtMs: NOW })

    await store.recordResult(
      serverCommand.commandId,
      { status, commandId: serverCommand.commandId },
      NOW + 1,
    )

    expect(await database.envelopes.get(serverCommand.commandId)).toMatchObject({
      state: 'needs_attention',
    })
    expect(await database.results.get(serverCommand.commandId)).toMatchObject({
      result: { status },
      refusedTrace: expect.stringContaining(status),
    })
    database.close()
  })

  it('corrects only on the originating tablet under a live shift, retaining the refused trace', async () => {
    const database = new BillingDeliveryDatabase(databaseName())
    const store = new BillingDeliveryStore(database)
    const refused = command()
    const dependant = command(crypto.randomUUID(), 'b'.repeat(64))
    const replacement = command(crypto.randomUUID(), 'c'.repeat(64))
    await store.accept({ ...acceptedInput(refused), eligibleAtMs: NOW })
    await store.accept({
      ...acceptedInput(dependant),
      dependsOnCommandIds: [refused.commandId],
      eligibleAtMs: NOW,
    })
    await store.recordResult(
      refused.commandId,
      { status: 'identity_conflict', commandId: refused.commandId },
      NOW + 1,
    )

    await expect(
      store.correctAttention(
        {
          commandId: refused.commandId,
          tabletId: 'another-tablet',
          shiftId: 'shift-1',
          actorId: 'person-1',
          nowMs: NOW + 2,
        },
        { ...acceptedInput(replacement), eligibleAtMs: NOW },
      ),
    ).rejects.toMatchObject({ code: 'not_permitted' })

    await store.correctAttention(
      {
        commandId: refused.commandId,
        tabletId: 'tablet-1',
        // Old work may surface after its original shift ended. A fresh live
        // shift on the same tablet must still be able to resolve it.
        shiftId: 'shift-2',
        actorId: 'person-1',
        nowMs: NOW + 2,
      },
      { ...acceptedInput(replacement), eligibleAtMs: NOW },
    )

    expect(await database.envelopes.get(refused.commandId)).toBeUndefined()
    expect(await database.envelopes.get(replacement.commandId)).toBeDefined()
    expect(await database.results.get(refused.commandId)).toMatchObject({
      refusedTrace: expect.stringContaining('identity_conflict'),
    })
    expect(await database.tombstones.get(refused.commandId)).toMatchObject({
      resolution: 'corrected',
      actorId: 'person-1',
      replacementCommandId: replacement.commandId,
    })
    expect(
      await database.dependencies.get(
        dependencyRecordId(dependant.commandId, replacement.commandId),
      ),
    ).toBeDefined()
    database.close()
  })

  it('requires a reason and discards a refused command with its blocked descendants', async () => {
    const database = new BillingDeliveryDatabase(databaseName())
    const store = new BillingDeliveryStore(database)
    const refused = command()
    const dependant = command(crypto.randomUUID(), 'b'.repeat(64))
    await store.accept({ ...acceptedInput(refused), eligibleAtMs: NOW })
    await store.accept({
      ...acceptedInput(dependant),
      dependsOnCommandIds: [refused.commandId],
      eligibleAtMs: NOW,
    })
    await store.recordResult(
      refused.commandId,
      { status: 'order_not_open', commandId: refused.commandId },
      NOW + 1,
    )
    const authority = {
      commandId: refused.commandId,
      tabletId: 'tablet-1',
      shiftId: 'shift-1',
      actorId: 'person-1',
      nowMs: NOW + 2,
    }

    await expect(store.discardAttention(authority, '   ')).rejects.toMatchObject({
      code: 'blank_reason',
    })
    await store.discardAttention(authority, 'Customer order was cancelled')

    expect(await database.envelopes.get(refused.commandId)).toBeUndefined()
    expect(await database.envelopes.get(dependant.commandId)).toBeUndefined()
    expect(await database.tombstones.get(refused.commandId)).toMatchObject({
      resolution: 'discarded',
      reason: 'Customer order was cancelled',
      actorId: 'person-1',
    })
    expect(await database.tombstones.get(dependant.commandId)).toMatchObject({
      resolution: 'discarded',
    })
    database.close()
  })
})
