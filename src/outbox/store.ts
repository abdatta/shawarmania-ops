import type { BillingCommand } from '../../shared/billing-command'
import { isCorrectableRefusal, type BillingCommandResult } from '@/domain'
import {
  BillingDeliveryDatabase,
  dependencyRecordId,
  type BillingDeliveryEnvelopeRecord,
} from './schema'

export class BillingDeliveryStoreError extends Error {
  constructor(
    readonly code:
      | 'identity_conflict'
      | 'not_attention'
      | 'not_correctable'
      | 'not_permitted'
      | 'blank_reason'
      | 'storage_failed',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'BillingDeliveryStoreError'
  }
}

export interface AcceptBillingCommandInput {
  command: BillingCommand
  tabletId: string
  outletId: string
  businessDate: string
  chainId: string
  dependsOnCommandIds?: readonly string[]
  eligibleAtMs: number
  nowMs: number
}

export interface ResolveBillingAttentionInput {
  commandId: string
  tabletId: string
  shiftId: string
  actorId: string
  nowMs: number
}

/**
 * The transactional acknowledgement boundary. This class does not deliver;
 * it only makes a command durable (or proves that it already is) and exposes
 * the records the leader will drain in later tasks.
 */
export class BillingDeliveryStore {
  constructor(readonly database: BillingDeliveryDatabase) {}

  async accept(input: AcceptBillingCommandInput): Promise<void> {
    try {
      await this.database.transaction(
        'rw',
        this.database.envelopes,
        this.database.dependencies,
        async () => this.acceptInTransaction(input),
      )
    } catch (cause) {
      if (cause instanceof BillingDeliveryStoreError) throw cause
      throw new BillingDeliveryStoreError(
        'storage_failed',
        'This action was not saved on the tablet. Nothing was cleared; make space and try again.',
        { cause },
      )
    }
  }

  async countUnsent(tabletId: string): Promise<number> {
    return this.database.envelopes.where('tabletId').equals(tabletId).count()
  }

  async listReady(tabletId: string, nowMs: number): Promise<BillingDeliveryEnvelopeRecord[]> {
    const candidates = await this.database.envelopes.where('tabletId').equals(tabletId).toArray()
    const eligible = candidates
      .filter(
        (envelope) =>
          (envelope.state === 'pending' ||
            envelope.state === 'held' ||
            envelope.state === 'retrying') &&
          envelope.eligibleAtMs <= nowMs &&
          (envelope.nextAttemptAtMs === null || envelope.nextAttemptAtMs <= nowMs),
      )
      .sort((left, right) => left.createdAtMs - right.createdAtMs)

    const ready: BillingDeliveryEnvelopeRecord[] = []
    for (const envelope of eligible) {
      const dependencies = await this.database.dependencies
        .where('commandId')
        .equals(envelope.commandId)
        .toArray()
      if (dependencies.length === 0) {
        ready.push(envelope)
        continue
      }
      const results = await this.database.results.bulkGet(
        dependencies.map((dependency) => dependency.dependsOnCommandId),
      )
      if (
        results.every(
          (result) => result?.result.status === 'accepted' || result?.result.status === 'replay',
        )
      ) {
        ready.push(envelope)
      }
    }
    return ready
  }

  async recordResult(
    commandId: string,
    result: BillingCommandResult,
    nowMs: number,
  ): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.envelopes,
      this.database.results,
      async () => {
        await this.database.results.put({
          commandId,
          result,
          recordedAtMs: nowMs,
          refusedTrace:
            result.status === 'accepted' || result.status === 'replay'
              ? null
              : JSON.stringify(result),
        })
        if (result.status === 'accepted' || result.status === 'replay') {
          await this.database.envelopes.delete(commandId)
        } else {
          await this.database.envelopes.update(commandId, {
            state: 'needs_attention',
            nextAttemptAtMs: null,
          })
        }
      },
    )
  }

  async scheduleRetry(commandId: string, nextAttemptAtMs: number): Promise<void> {
    await this.database.transaction('rw', this.database.envelopes, async () => {
      const envelope = await this.database.envelopes.get(commandId)
      if (!envelope) return
      await this.database.envelopes.update(commandId, {
        state: 'retrying',
        attemptCount: envelope.attemptCount + 1,
        nextAttemptAtMs,
      })
    })
  }

  async hintRetry(tabletId: string, nowMs: number): Promise<void> {
    await this.database.envelopes
      .where('[tabletId+state]')
      .equals([tabletId, 'retrying'])
      .modify((envelope) => {
        envelope.nextAttemptAtMs = nowMs
      })
  }

  async correctAttention(
    authority: ResolveBillingAttentionInput,
    replacement: AcceptBillingCommandInput,
  ): Promise<void> {
    if (authority.commandId === replacement.command.commandId) {
      throw new BillingDeliveryStoreError(
        'identity_conflict',
        'A correction needs a new command identity.',
      )
    }
    try {
      await this.database.transaction(
        'rw',
        this.database.envelopes,
        this.database.dependencies,
        this.database.results,
        this.database.tombstones,
        async () => {
          await this.requireAttentionAuthority(authority)
          // A correction resends the same payload under a new identity, so it
          // can only help where the refusal was about the world rather than the
          // bytes. Enforced here and not only in a disabled button, because a
          // resend that is certain to be refused writes a permanent diagnostics
          // row every time it is attempted.
          const refusal = await this.database.results.get(authority.commandId)
          if (refusal && !isCorrectableRefusal(refusal.result.status)) {
            throw new BillingDeliveryStoreError(
              'not_correctable',
              'Sending this again cannot change the answer. Discard it with a reason instead.',
            )
          }
          await this.acceptInTransaction(replacement)

          const dependants = await this.database.dependencies
            .where('dependsOnCommandId')
            .equals(authority.commandId)
            .toArray()
          for (const dependency of dependants) {
            await this.database.dependencies.delete(dependency.id)
            await this.database.dependencies.put({
              id: dependencyRecordId(dependency.commandId, replacement.command.commandId),
              commandId: dependency.commandId,
              dependsOnCommandId: replacement.command.commandId,
            })
          }

          await this.database.tombstones.put({
            commandId: authority.commandId,
            resolution: 'corrected',
            actorId: authority.actorId,
            reason: null,
            replacementCommandId: replacement.command.commandId,
            recordedAtMs: authority.nowMs,
          })
          await this.database.dependencies.where('commandId').equals(authority.commandId).delete()
          await this.database.envelopes.delete(authority.commandId)
        },
      )
    } catch (cause) {
      if (cause instanceof BillingDeliveryStoreError) throw cause
      throw new BillingDeliveryStoreError('storage_failed', 'The correction was not saved.', {
        cause,
      })
    }
  }

  async discardAttention(authority: ResolveBillingAttentionInput, reason: string): Promise<void> {
    const trimmedReason = reason.trim()
    if (!trimmedReason) {
      throw new BillingDeliveryStoreError('blank_reason', 'A discard needs a reason.')
    }
    try {
      await this.database.transaction(
        'rw',
        this.database.envelopes,
        this.database.dependencies,
        this.database.results,
        this.database.tombstones,
        async () => {
          await this.requireAttentionAuthority(authority)
          const commandIds = await this.collectDescendants(authority.commandId)
          for (const commandId of commandIds) {
            await this.database.tombstones.put({
              commandId,
              resolution: 'discarded',
              actorId: authority.actorId,
              reason: trimmedReason,
              replacementCommandId: null,
              recordedAtMs: authority.nowMs,
            })
            await this.database.dependencies.where('commandId').equals(commandId).delete()
            await this.database.envelopes.delete(commandId)
          }
        },
      )
    } catch (cause) {
      if (cause instanceof BillingDeliveryStoreError) throw cause
      throw new BillingDeliveryStoreError('storage_failed', 'The discard was not saved.', {
        cause,
      })
    }
  }

  async acquireLease(name: string, ownerId: string, nowMs: number, durationMs: number) {
    return this.database.transaction('rw', this.database.leases, async () => {
      const current = await this.database.leases.get(name)
      if (current && current.ownerId !== ownerId && current.expiresAtMs > nowMs) return false
      await this.database.leases.put({
        name,
        ownerId,
        renewedAtMs: nowMs,
        expiresAtMs: nowMs + durationMs,
      })
      return true
    })
  }

  async releaseLease(name: string, ownerId: string): Promise<void> {
    await this.database.transaction('rw', this.database.leases, async () => {
      const current = await this.database.leases.get(name)
      if (current?.ownerId === ownerId) await this.database.leases.delete(name)
    })
  }

  private async acceptInTransaction(input: AcceptBillingCommandInput): Promise<void> {
    const existing = await this.database.envelopes.get(input.command.commandId)
    if (existing) {
      if (
        existing.payloadHash !== input.command.payloadHash ||
        existing.type !== input.command.type
      ) {
        throw new BillingDeliveryStoreError(
          'identity_conflict',
          'That local command identity already belongs to different contents.',
        )
      }
      return
    }

    if (input.command.tabletId !== input.tabletId) {
      throw new BillingDeliveryStoreError(
        'identity_conflict',
        'The command does not belong to this tablet.',
      )
    }

    const createdAtMs = Date.parse(input.command.createdAt)
    if (!Number.isFinite(createdAtMs)) {
      throw new BillingDeliveryStoreError(
        'identity_conflict',
        'The command has no valid creation time.',
      )
    }

    await this.database.envelopes.add({
      commandId: input.command.commandId,
      tabletId: input.tabletId,
      shiftId: input.command.shiftId,
      outletId: input.outletId,
      businessDate: input.businessDate,
      type: input.command.type,
      schemaVersion: input.command.schemaVersion,
      payloadHash: input.command.payloadHash,
      createdAtMs,
      chainId: input.chainId,
      state: input.eligibleAtMs > input.nowMs ? 'held' : 'pending',
      eligibleAtMs: input.eligibleAtMs,
      nextAttemptAtMs: null,
      attemptCount: 0,
      command: input.command,
    })

    const dependencies = [...new Set(input.dependsOnCommandIds ?? [])]
    if (dependencies.length > 0) {
      await this.database.dependencies.bulkAdd(
        dependencies.map((dependsOnCommandId) => ({
          id: dependencyRecordId(input.command.commandId, dependsOnCommandId),
          commandId: input.command.commandId,
          dependsOnCommandId,
        })),
      )
    }
  }

  private async requireAttentionAuthority(authority: ResolveBillingAttentionInput) {
    const [envelope, result] = await Promise.all([
      this.database.envelopes.get(authority.commandId),
      this.database.results.get(authority.commandId),
    ])
    if (!envelope || envelope.state !== 'needs_attention' || !result?.refusedTrace) {
      throw new BillingDeliveryStoreError(
        'not_attention',
        'That command does not need attention on this tablet.',
      )
    }
    if (
      envelope.tabletId !== authority.tabletId ||
      envelope.shiftId === null ||
      !authority.shiftId
    ) {
      throw new BillingDeliveryStoreError(
        'not_permitted',
        'Only the originating tablet under a live shift can resolve this command.',
      )
    }
    return envelope
  }

  private async collectDescendants(rootCommandId: string): Promise<string[]> {
    const collected = [rootCommandId]
    for (let index = 0; index < collected.length; index += 1) {
      const dependants = await this.database.dependencies
        .where('dependsOnCommandId')
        .equals(collected[index]!)
        .toArray()
      for (const dependant of dependants) {
        if (!collected.includes(dependant.commandId)) collected.push(dependant.commandId)
      }
    }
    return collected
  }
}
