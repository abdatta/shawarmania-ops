import type {
  BillingBill,
  BillingOrder,
  CustomerIdentity,
  MenuCategoryWithItems,
} from '@/data-access/adapters'
import type { Tables } from '@/data-access/database.types'
import type { CounterDeviceSession } from '@/session/counter-session'

import { BillingDeliveryDatabase } from './schema'
import {
  COUNTER_RESUME_SCHEMA_VERSION,
  readCounterResume,
  retainRememberedCustomers,
  writeCounterResume,
  type CounterResumeRecord,
  type RememberedCustomerResult,
} from './resume-record'

/**
 * Collects successful authorised reads made by the four real adapters. It
 * never persists a partial answer; the previous row remains current until all
 * startup facts have arrived and one transaction replaces it.
 */
export class CounterResumeCoordinator {
  private outlet: Tables<'outlets'> | null = null
  private menu: MenuCategoryWithItems[] | null = null
  private pipeline: BillingOrder[] | null = null
  private bills: BillingBill[] | null = null
  private rememberedCustomers: Record<string, RememberedCustomerResult> = {}
  private clock: { serverObservedAt: string; deviceObservedAt: string } | null = null
  private commitSequence = Promise.resolve()
  private readonly previous: Promise<void>

  constructor(
    private readonly session: CounterDeviceSession,
    private readonly database = new BillingDeliveryDatabase(),
  ) {
    this.previous = readCounterResume(session.device.deviceId, Number.MIN_SAFE_INTEGER, database)
      .then((read) => {
        if (read.status === 'ready') {
          this.rememberedCustomers = retainRememberedCustomers(read.record.rememberedCustomers)
        }
      })
      .catch(() => undefined)
  }

  noteOutlet(outlet: Tables<'outlets'>): void {
    if (outlet.id !== this.session.device.outletId) return
    this.outlet = structuredClone(outlet)
    this.queueCommit()
  }

  noteMenu(outletId: string, menu: readonly MenuCategoryWithItems[]): void {
    if (outletId !== this.session.device.outletId) return
    this.menu = [...structuredClone(menu)]
    this.queueCommit()
  }

  notePipeline(outletId: string, orders: readonly BillingOrder[]): void {
    if (outletId !== this.session.device.outletId) return
    this.pipeline = [...structuredClone(orders)]
    this.queueCommit()
  }

  noteBills(shiftId: string, bills: readonly BillingBill[]): void {
    if (shiftId !== this.session.shift?.id) return
    this.bills = [...structuredClone(bills)]
    this.queueCommit()
  }

  noteCustomer(customer: CustomerIdentity): void {
    this.rememberedCustomers[customer.phone] = {
      ...structuredClone(customer),
      rememberedAt: new Date().toISOString(),
    }
    this.rememberedCustomers = retainRememberedCustomers(this.rememberedCustomers)
    this.queueCommit()
  }

  noteServerTime(serverObservedAt: string, deviceObservedAt = new Date().toISOString()): void {
    if (!Number.isFinite(Date.parse(serverObservedAt))) return
    this.clock = { serverObservedAt, deviceObservedAt }
    this.queueCommit()
  }

  private queueCommit(): void {
    // Each commit is chained onto the last so a partial record can never
    // interleave with a complete one — and each one catches, because a
    // rejection here would otherwise poison the chain and silently stop every
    // later write for the life of this coordinator.
    this.commitSequence = this.commitSequence
      .then(async () => {
        await this.previous
        const shift = this.session.shift
        if (!shift || !this.outlet || !this.menu || !this.pipeline || !this.bills || !this.clock)
          return
        const now = new Date().toISOString()
        const record: CounterResumeRecord = {
          tabletId: this.session.device.deviceId,
          schemaVersion: COUNTER_RESUME_SCHEMA_VERSION,
          complete: true,
          tablet: {
            id: this.session.device.deviceId,
            label: this.session.device.label,
            outletId: this.session.device.outletId,
          },
          shift: {
            id: shift.id,
            personId: shift.personId,
            outletId: shift.outletId,
            openedAt: shift.openedAt,
            businessDate: shift.businessDate,
            expiresAt: shift.expiresAt,
          },
          outlet: structuredClone(this.outlet),
          menu: structuredClone(this.menu),
          pipeline: structuredClone(this.pipeline),
          bills: structuredClone(this.bills),
          rememberedCustomers: retainRememberedCustomers(this.rememberedCustomers),
          lastSuccessfulReadAt: now,
          serverObservedAt: this.clock.serverObservedAt,
          deviceObservedAt: this.clock.deviceObservedAt,
        }
        await writeCounterResume(record, this.database)
      })
      .catch((cause) => {
        // Resuming is a convenience over an outage; failing to save must never
        // break the online counter that is working right now. Say so once, out
        // loud, and let the next successful read try again.
        console.error('The counter resume record could not be written.', cause)
      })
  }
}
