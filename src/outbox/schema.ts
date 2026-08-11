import Dexie, { type Table, type Transaction } from 'dexie'

import type { BillingCommand, BillingCommandType } from '../../shared/billing-command'
import type { BillingCommandResult } from '@/domain'

export const BILLING_DELIVERY_DATABASE_NAME = 'shawarmania-billing-delivery'
export const BILLING_DELIVERY_DATABASE_VERSION = 2

export type BillingDeliveryEnvelopeState = 'held' | 'pending' | 'retrying' | 'needs_attention'

/**
 * One immutable server command plus the mutable delivery coordinates that
 * belong to this tablet. Customer facts remain inside `command`; no index or
 * diagnostic field repeats them where they could be logged accidentally.
 */
export interface BillingDeliveryEnvelopeRecord {
  commandId: string
  tabletId: string
  shiftId: string | null
  outletId: string
  businessDate: string
  type: BillingCommandType
  schemaVersion: number
  payloadHash: string
  createdAtMs: number
  chainId: string
  state: BillingDeliveryEnvelopeState
  eligibleAtMs: number
  nextAttemptAtMs: number | null
  attemptCount: number
  command: BillingCommand
}

/** A directed edge: `commandId` cannot drain before `dependsOnCommandId`. */
export interface BillingDeliveryDependencyRecord {
  id: string
  commandId: string
  dependsOnCommandId: string
}

/** The authoritative server outcome retained while local dependants resolve. */
export interface BillingDeliveryResultRecord {
  commandId: string
  recordedAtMs: number
  result: BillingCommandResult
  refusedTrace: string | null
}

/**
 * An attributed local resolution. The refused envelope and its server result
 * remain untouched; this record says what the operator did about them.
 */
export interface BillingDeliveryTombstoneRecord {
  commandId: string
  resolution: 'undone' | 'discarded' | 'corrected'
  actorId: string | null
  reason: string | null
  replacementCommandId: string | null
  recordedAtMs: number
}

/** The IndexedDB fallback when Web Locks is unavailable. */
export interface BillingDeliveryLeaseRecord {
  name: string
  ownerId: string
  renewedAtMs: number
  expiresAtMs: number
}

export function dependencyRecordId(commandId: string, dependsOnCommandId: string): string {
  return `${commandId}:${dependsOnCommandId}`
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

/**
 * Upgrade the private development build that held envelopes in one table.
 * The command itself is the source of truth, so every derived delivery field
 * can be backfilled without replacing or re-hashing unsent work.
 */
function upgradeLegacyEnvelope(record: Record<string, unknown>): void {
  const command = record['command'] as BillingCommand | undefined
  if (!command) return

  const createdAtMs = Date.parse(command.createdAt)
  record['commandId'] = stringOr(record['commandId'], command.commandId)
  record['tabletId'] = stringOr(record['tabletId'], command.tabletId ?? 'unknown-tablet')
  record['shiftId'] = record['shiftId'] ?? command.shiftId
  record['outletId'] = stringOr(record['outletId'], 'unknown-outlet')
  record['businessDate'] = stringOr(record['businessDate'], 'unknown-business-date')
  record['type'] = stringOr(record['type'], command.type)
  record['schemaVersion'] = numberOr(record['schemaVersion'], command.schemaVersion)
  record['payloadHash'] = stringOr(record['payloadHash'], command.payloadHash)
  record['createdAtMs'] = numberOr(
    record['createdAtMs'],
    Number.isFinite(createdAtMs) ? createdAtMs : 0,
  )
  record['chainId'] = stringOr(record['chainId'], command.commandId)
  record['state'] = stringOr(record['state'], 'pending')
  record['eligibleAtMs'] = numberOr(record['eligibleAtMs'], record['createdAtMs'] as number)
  record['nextAttemptAtMs'] = record['nextAttemptAtMs'] ?? null
  record['attemptCount'] = numberOr(record['attemptCount'], 0)
}

export class BillingDeliveryDatabase extends Dexie {
  envelopes!: Table<BillingDeliveryEnvelopeRecord, string>
  dependencies!: Table<BillingDeliveryDependencyRecord, string>
  results!: Table<BillingDeliveryResultRecord, string>
  tombstones!: Table<BillingDeliveryTombstoneRecord, string>
  leases!: Table<BillingDeliveryLeaseRecord, string>

  constructor(name = BILLING_DELIVERY_DATABASE_NAME) {
    super(name)

    // Version 1 existed only in private development builds. Declaring it here
    // makes its upgrade path executable instead of assuming nobody has data.
    this.version(1).stores({
      envelopes: '&commandId',
    })

    this.version(BILLING_DELIVERY_DATABASE_VERSION)
      .stores({
        envelopes:
          '&commandId, tabletId, shiftId, outletId, businessDate, type, state, eligibleAtMs, nextAttemptAtMs, [tabletId+state], [chainId+createdAtMs]',
        dependencies: '&id, commandId, dependsOnCommandId',
        results: '&commandId, recordedAtMs',
        tombstones: '&commandId, resolution, recordedAtMs, replacementCommandId',
        leases: '&name, ownerId, expiresAtMs',
      })
      .upgrade((transaction: Transaction) =>
        transaction
          .table('envelopes')
          .toCollection()
          .modify((record: Record<string, unknown>) => upgradeLegacyEnvelope(record)),
      )
  }
}
