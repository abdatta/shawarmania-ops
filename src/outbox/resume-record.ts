import type {
  BillingBill,
  BillingOrder,
  CustomerIdentity,
  MenuCategoryWithItems,
} from '@/data-access/adapters'
import type { Tables } from '@/data-access/database.types'

import { BillingDeliveryDatabase } from './schema'

export const COUNTER_RESUME_SCHEMA_VERSION = 1
export const REMEMBERED_CUSTOMER_RETENTION_MS = 24 * 60 * 60 * 1000
export const REMEMBERED_CUSTOMER_LIMIT = 50
export const MATERIAL_CLOCK_SKEW_MS = 2 * 60 * 1000

export interface RememberedCustomerResult extends CustomerIdentity {
  rememberedAt: string
}

/**
 * One complete, self-describing server snapshot. There are no independently
 * readable menu/order/bill caches: a crash before this row commits leaves the
 * previous complete row as the only resumable answer.
 */
export interface CounterResumeRecord {
  tabletId: string
  schemaVersion: number
  complete: true
  tablet: { id: string; label: string; outletId: string }
  shift: {
    id: string
    personId: string
    operatorName: string
    outletId: string
    openedAt: string
    businessDate: string
    expiresAt: string
  }
  outlet: Tables<'outlets'>
  outletCutover: string
  outletCutoverAt: string
  menu: MenuCategoryWithItems[]
  pipeline: BillingOrder[]
  bills: BillingBill[]
  rememberedCustomers: Record<string, RememberedCustomerResult>
  lastSuccessfulReadAt: string
  serverObservedAt: string
  deviceObservedAt: string
}

export type CounterResumeRead =
  | { status: 'ready'; record: CounterResumeRecord }
  | { status: 'missing' | 'incomplete' | 'unsupported' | 'foreign' | 'expired' }

function isCompleteRecord(value: unknown): value is CounterResumeRecord {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<CounterResumeRecord>
  return Boolean(
    row.complete === true &&
    row.tabletId &&
    row.tablet?.id &&
    row.tablet?.outletId &&
    row.shift?.id &&
    row.shift?.expiresAt &&
    row.outlet?.id &&
    row.outletCutoverAt &&
    Array.isArray(row.menu) &&
    Array.isArray(row.pipeline) &&
    Array.isArray(row.bills) &&
    row.rememberedCustomers &&
    row.lastSuccessfulReadAt &&
    row.serverObservedAt &&
    row.deviceObservedAt,
  )
}

export function counterResumeStopAt(record: CounterResumeRecord): number {
  return Math.min(Date.parse(record.shift.expiresAt), Date.parse(record.outletCutoverAt))
}

export function hasMaterialClockSkew(record: CounterResumeRecord): boolean {
  return (
    Math.abs(Date.parse(record.serverObservedAt) - Date.parse(record.deviceObservedAt)) >=
    MATERIAL_CLOCK_SKEW_MS
  )
}

export async function readCounterResume(
  installationId: string,
  nowMs = Date.now(),
  database = new BillingDeliveryDatabase(),
): Promise<CounterResumeRead> {
  const raw = await database.resumeRecords.get(installationId)
  if (!raw) return { status: 'missing' }
  if (!isCompleteRecord(raw)) return { status: 'incomplete' }
  if (raw.schemaVersion !== COUNTER_RESUME_SCHEMA_VERSION) return { status: 'unsupported' }
  if (raw.tabletId !== installationId || raw.tablet.id !== installationId) {
    return { status: 'foreign' }
  }
  if (counterResumeStopAt(raw) <= nowMs) return { status: 'expired' }
  return { status: 'ready', record: structuredClone(raw) }
}

export async function writeCounterResume(
  record: CounterResumeRecord,
  database = new BillingDeliveryDatabase(),
): Promise<void> {
  if (!isCompleteRecord(record)) throw new Error('A counter resume record must be complete.')
  await database.transaction('rw', database.resumeRecords, async () => {
    await database.resumeRecords.put(structuredClone(record))
  })
}

export function retainRememberedCustomers(
  customers: Record<string, RememberedCustomerResult>,
  nowMs = Date.now(),
): Record<string, RememberedCustomerResult> {
  return Object.fromEntries(
    Object.entries(customers)
      .filter(
        ([, customer]) =>
          nowMs - Date.parse(customer.rememberedAt) <= REMEMBERED_CUSTOMER_RETENTION_MS,
      )
      .sort(([, left], [, right]) => right.rememberedAt.localeCompare(left.rememberedAt))
      .slice(0, REMEMBERED_CUSTOMER_LIMIT),
  )
}
