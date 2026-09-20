import type {
  BillingBill,
  BillingOrder,
  CustomerIdentity,
  MenuCategoryWithItems,
  OutletMenu,
} from '@/data-access/adapters'
import type { Tables } from '@/data-access/database.types'

import { BillingDeliveryDatabase } from './schema'

export const COUNTER_RESUME_SCHEMA_VERSION = 2
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
    outletId: string
    openedAt: string
    businessDate: string
    /**
     * The outlet's next cutover, authored by `app_next_cutover` when the shift
     * opened. This IS the outlet cutover for this shift — the server's own
     * `loadCounterShift` treats it as such — so the record keeps no second copy
     * to disagree with. The raw `HH:MM:SS` remains on `outlet`.
     */
    expiresAt: string
  }
  outlet: Tables<'outlets'>
  menu: MenuCategoryWithItems[]
  /**
   * The discounts and presets this till last read, beside the menu they price.
   *
   * Optional because a record written before discounts existed has none, and a
   * till holding one must still resume rather than be told its record is
   * incomplete. Absent reads as no discounts, which is what it meant.
   */
  outletMenu?: OutletMenu
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
    row.outlet?.business_day_cutover &&
    Array.isArray(row.menu) &&
    Array.isArray(row.pipeline) &&
    Array.isArray(row.bills) &&
    row.rememberedCustomers &&
    row.lastSuccessfulReadAt &&
    row.serverObservedAt &&
    row.deviceObservedAt,
  )
}

/**
 * Where new work stops: the earlier of the shift's expiry and the outlet
 * cutover. They are one instant, not two — `counter_shifts.expires_at` is
 * inserted as `app_next_cutover(now(), cutover)` and `loadCounterShift` admits
 * a shift only while it is ahead — so this reads the value the server itself
 * uses rather than recomputing the cutover from `HH:MM:SS` beside it.
 */
export function counterResumeStopAt(record: CounterResumeRecord): number {
  return Date.parse(record.shift.expiresAt)
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
  // Version before shape: a record this build cannot read is unsupported, not
  // malformed, however little of it a newer writer left recognisable.
  if ((raw as Partial<CounterResumeRecord>).schemaVersion !== COUNTER_RESUME_SCHEMA_VERSION) {
    return { status: 'unsupported' }
  }
  if (!isCompleteRecord(raw)) return { status: 'incomplete' }
  if (raw.tabletId !== installationId || raw.tablet.id !== installationId) {
    return { status: 'foreign' }
  }
  if (counterResumeStopAt(raw) <= nowMs) return { status: 'expired' }
  // Retention is enforced on the way out as well as the way in. Pruning only
  // on write would let a record that stopped being rewritten keep serving
  // phone numbers past the cap that `docs/SECURITY_AND_PRIVACY.md` states.
  const record = structuredClone(raw)
  record.rememberedCustomers = retainRememberedCustomers(record.rememberedCustomers)
  return { status: 'ready', record }
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

/**
 * The fifty customers this till resolved most recently, and no time limit
 * [owner, 2026-09-20].
 *
 * There was a twenty-four hour window here, and it was forgetting the weekly
 * regular — precisely the customer worth remembering, and the one a biller
 * would otherwise make type ten digits again. A count is the honest bound: it
 * caps what the device holds however long it trades.
 *
 * **The consequence is that fifty names and numbers now sit on the tablet
 * indefinitely**, which is why `forgetRememberedCustomers` exists and is called
 * the moment the device's enrolment is revoked.
 */
export function retainRememberedCustomers(
  customers: Record<string, RememberedCustomerResult>,
): Record<string, RememberedCustomerResult> {
  return Object.fromEntries(
    Object.entries(customers)
      .sort(([, left], [, right]) => right.rememberedAt.localeCompare(left.rememberedAt))
      .slice(0, REMEMBERED_CUSTOMER_LIMIT),
  )
}

/**
 * Drop every remembered customer from this device's resume record.
 *
 * Called when the server says the tablet is no longer a counter. The record
 * itself may still be wanted — it carries the menu and the shift — but customer
 * names and numbers are PII this device has lost the right to hold, and a
 * tablet taken out of service should not still be carrying them.
 */
export async function forgetRememberedCustomers(
  installationId: string,
  database = new BillingDeliveryDatabase(),
): Promise<void> {
  await database.transaction('rw', database.resumeRecords, async () => {
    const row = await database.resumeRecords.get(installationId)
    if (!row) return
    await database.resumeRecords.put({ ...row, rememberedCustomers: {} })
  })
}
