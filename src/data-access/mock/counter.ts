import {
  CounterActionError,
  type AccountSummary,
  type AppRole,
  type CounterAdapter,
  type CounterDeviceOperationalSnapshot,
  type CounterDeviceSummary,
  type CounterShiftRequest,
  type IssuedShiftRequest,
  type LiveCounterShift,
} from '../adapters'
import {
  counterDeviceFixtures,
  DEMO_COUNTER_DEVICE_ID,
  DEMO_KANCHRAPARA_DEVICE_ID,
} from './fixtures/billing'
import { resolveBusinessDate } from '@/domain'

import { outletFixtures } from './fixtures/outlets'
import { nextCutover, type DemoStore } from './store'
import type { Tables } from '../database.types'

/**
 * The mock counter tablets and handshake.
 *
 * It reproduces the **observable states** of the real thing — a code that shows
 * once, a request waiting with four digits on it, a wrong code counted, a
 * request that expires, a tablet whose telemetry has gone stale — and none of
 * its security. There is no hashing here and no Postgres transaction; a demo
 * that pretended otherwise would be teaching the wrong lesson about where the
 * boundary is.
 *
 * Two rules from the real design are mirrored deliberately, because they are
 * behaviour a walkthrough should show rather than read about:
 *
 *  - **an unknown username is indistinguishable from a known one.** The request
 *    is created either way, with the same code, the same wait and the same
 *    timeout. Nothing in this file branches on whether the name is real.
 *  - **three wrong codes destroy the request.** A typo loop ends in a fresh
 *    start rather than an indefinite retry.
 */

/**
 * The state one demo session holds. Outlives a role switch, like the rest.
 *
 * **Shifts are deliberately not here.** They live in the demo store, on the same
 * `counter_shifts` rows billing attributes to, because a handshake that opened a
 * shift only this module could see is how the Tablets surface came to say Priya
 * was on the counter while every phone said nobody was.
 */
export interface DemoCounter {
  devices: CounterDeviceSummary[]
  requests: MockRequest[]
  listeners: Set<() => void>
}

interface MockRequest extends CounterShiftRequest {
  /** In the real system this is a hash no client may read. Here it is the code. */
  code: string
  username: string
  attempts: number
  resolution: string | null
}

const SHIFT_REQUEST_VALID_MS = 2 * 60 * 1000
const MAX_ATTEMPTS = 3

function outletName(outletId: string): string | null {
  return outletFixtures.find((outlet) => outlet.id === outletId)?.name ?? null
}

function outletCutover(outletId: string): string {
  const outlet = outletFixtures.find((candidate) => candidate.id === outletId)
  if (!outlet) throw new Error(`The demo outlet fixture ${outletId} is missing.`)
  return outlet.business_day_cutover
}

/** A stored shift as the handshake surfaces describe it. */
function toLiveShift(row: Tables<'counter_shifts'>): LiveCounterShift {
  return {
    id: row.id,
    personId: row.person_id,
    deviceId: row.device_id,
    deviceLabel: counterDeviceFixtures.find((device) => device.id === row.device_id)?.label ?? null,
    outletId: row.outlet_id,
    outletName: outletName(row.outlet_id),
    openedAt: row.opened_at,
    businessDate: row.business_date,
    expiresAt: row.expires_at,
  }
}

export function createDemoCounter(): DemoCounter {
  return {
    devices: counterDeviceFixtures
      .filter((device) => device.removed_at === null)
      .map((device) => ({
        id: device.id,
        outletId: device.outlet_id,
        label: device.label,
        setUpAt: device.set_up_at,
        // Kalyani reported a minute ago; Kanchrapara has said nothing for two
        // days, so the management surface has something genuinely stale to mark
        // rather than a screenshot of one healthy row.
        lastSeenAt:
          device.id === DEMO_COUNTER_DEVICE_ID
            ? new Date(Date.now() - 60_000).toISOString()
            : device.id === DEMO_KANCHRAPARA_DEVICE_ID
              ? new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
              : null,
        // Both outlets hold work, in different amounts, and Kalyani holds some
        // deliberately: it is the outlet the drawer opens on, so this is what
        // puts an **explainable chip on the demo's first screen** — the walk
        // through this surface should include tapping one and reading why the
        // balance may be understated, without first having to know that the
        // other outlet is the one carrying it.
        //
        // The degrees still differ, which is the state the tablet management
        // surface is for: Kanchrapara has said nothing for two days AND holds
        // three, while Kalyani reported a minute ago and holds one.
        lastReportedUnresolved:
          device.id === DEMO_KANCHRAPARA_DEVICE_ID
            ? 3
            : device.id === DEMO_COUNTER_DEVICE_ID
              ? 1
              : 0,
        lastReportedOldestUnresolvedAt:
          device.id === DEMO_COUNTER_DEVICE_ID
            ? new Date(Date.now() - 5 * 60_000).toISOString()
            : device.id === DEMO_KANCHRAPARA_DEVICE_ID
              ? new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
              : null,
      })),
    requests: [],
    listeners: new Set(),
  }
}

function announce(counter: DemoCounter): void {
  for (const listener of [...counter.listeners]) listener()
}

function fourDigits(): string {
  return String(Math.floor(Math.random() * 10000)).padStart(4, '0')
}

/** Loose enough that "Priya Sharma", "priya.sharma" and "PriyaSharma" all match. */
function looseName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * The requests waiting for this persona.
 *
 * Demo mode has no usernames, so the name typed on the tablet is matched against
 * the persona's own name. A name that matches nobody produces a request exactly
 * like one that does — it simply never appears on anybody's phone, and times out
 * — which is the enumeration-safety property, demonstrable rather than asserted.
 */
function livePendingFor(counter: DemoCounter, displayName: string): MockRequest[] {
  const now = Date.now()
  const me = looseName(displayName)
  return counter.requests.filter(
    (request) =>
      request.resolution === null &&
      Date.parse(request.expiresAt) > now &&
      looseName(request.username) === me,
  )
}

/**
 * @param role         who is asking, so the tablet list is scoped as RLS will scope it
 * @param personId     the caller, so a shift they open is attributed to them
 * @param displayName  the caller's name, which stands in for their username here
 * @param reach        the outlets this caller manages or works at
 */
export function createMockCounterAdapter(
  counter: DemoCounter,
  store: DemoStore,
  accounts: readonly AccountSummary[],
  role: AppRole,
  personId: string,
  displayName: string,
  reach: readonly string[],
): CounterAdapter {
  const mayAdminister = (outletId: string) =>
    role === 'super_admin' || (role === 'franchise_admin' && reach.includes(outletId))

  /**
   * End whatever shift a tablet is holding, for a stated reason.
   *
   * One open shift per device is a unique index in the database, so every path
   * that opens one has to close the previous one in the same breath. Recording
   * *why* matters as much as recording *that*: an operator leaving, a day being
   * finished and a tablet being removed are three different facts, and #50 made
   * them behave differently for work that arrives afterwards.
   */
  function endOpenShiftOn(deviceId: string, reason: 'operator' | 'device_removed'): void {
    for (const row of store.shifts) {
      if (row.device_id === deviceId && row.ended_at === null) {
        row.ended_at = new Date().toISOString()
        row.ended_reason = reason
      }
    }
  }

  return {
    async listDevices(): Promise<CounterDeviceSummary[]> {
      return counter.devices
        .filter((device) => mayAdminister(device.outletId))
        .sort((a, b) => a.label.localeCompare(b.label))
    },

    async readDeviceOperations(
      outletIds: readonly string[],
    ): Promise<CounterDeviceOperationalSnapshot[]> {
      // One timestamp for the whole read, exactly like statement_timestamp()
      // in the live RPC. Nothing in this snapshot moves again until re-read.
      const readAt = new Date().toISOString()
      return counter.devices
        .filter((device) => mayAdminister(device.outletId) && outletIds.includes(device.outletId))
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((device) => {
          const shift = store.shifts.find(
            (candidate) =>
              candidate.device_id === device.id &&
              candidate.outlet_id === device.outletId &&
              candidate.ended_at === null,
          )
          if (!shift) return { ...device, readAt, operations: null }

          const bills = store.bills.filter((bill) => bill.counter_shift_id === shift.id)
          const totalFor = (method: 'cash' | 'upi') =>
            bills
              .filter((bill) => bill.status === 'settled')
              .flatMap((bill) => store.billPayments.get(bill.id) ?? [])
              .filter((payment) => payment.method === method)
              .reduce((total, payment) => total + payment.amountPaise, 0)
          const cashTotalPaise = totalFor('cash')
          const operator = accounts.find((account) => account.id === shift.person_id)

          return {
            ...device,
            readAt,
            operations: {
              shiftId: shift.id,
              operatorName: operator?.fullName ?? 'Unknown operator',
              openedAt: shift.opened_at,
              businessDate: shift.business_date,
              billCount: bills.length,
              cashTotalPaise,
              upiTotalPaise: totalFor('upi'),
              openOrderCount: store.orders.filter(
                (order) =>
                  order.outlet_id === shift.outlet_id &&
                  order.device_id === shift.device_id &&
                  order.business_date === shift.business_date &&
                  order.status === 'open',
              ).length,
              drawerCashPaise: cashTotalPaise,
            },
          }
        })
    },

    async issueSetupCode(outletId: string, label: string) {
      if (!mayAdminister(outletId)) {
        throw new CounterActionError('forbidden', 'You are not allowed to do that.')
      }
      if (counter.devices.some((device) => device.outletId === outletId)) {
        throw new CounterActionError(
          'tablet_exists',
          'This outlet already has a tablet. Remove that one first.',
        )
      }
      // Shown once here too, because "write it down now" is the habit the real
      // flow depends on and a demo that let you look again would not teach it.
      void label
      return { code: 'DEMO0-SETUP', validFor: '15 minutes' }
    },

    async removeDevice(deviceId: string): Promise<void> {
      const device = counter.devices.find((candidate) => candidate.id === deviceId)
      if (!device || !mayAdminister(device.outletId)) {
        throw new CounterActionError('forbidden', 'You are not allowed to do that.')
      }
      counter.devices = counter.devices.filter((candidate) => candidate.id !== deviceId)
      endOpenShiftOn(deviceId, 'device_removed')
      counter.requests = counter.requests.map((request) =>
        request.deviceId === deviceId && request.resolution === null
          ? { ...request, resolution: 'cancelled' }
          : request,
      )
      announce(counter)
    },

    async requestShift(username: string): Promise<IssuedShiftRequest> {
      const device = counter.devices[0]
      if (!device) throw new CounterActionError('request_failed', 'No tablet is set up.')

      // One open request per tablet: the previous one is superseded rather than
      // left to be answered after the name was corrected.
      counter.requests = counter.requests.map((request) =>
        request.deviceId === device.id && request.resolution === null
          ? { ...request, resolution: 'superseded' }
          : request,
      )

      const code = fourDigits()
      const expiresAt = new Date(Date.now() + SHIFT_REQUEST_VALID_MS).toISOString()
      const requestId = crypto.randomUUID()
      counter.requests.push({
        id: requestId,
        deviceId: device.id,
        deviceLabel: device.label,
        outletId: device.outletId,
        outletName: outletName(device.outletId),
        createdAt: new Date().toISOString(),
        expiresAt,
        code,
        username,
        attempts: 0,
        resolution: null,
      })
      announce(counter)
      return { requestId, code, expiresAt }
    },

    async cancelRequest(): Promise<void> {
      counter.requests = counter.requests.map((request) =>
        request.resolution === null ? { ...request, resolution: 'cancelled' } : request,
      )
      announce(counter)
    },

    async getRequestResolution(requestId: string): Promise<string | null> {
      const request = counter.requests.find((candidate) => candidate.id === requestId)
      if (!request) return null
      if (request.resolution === null && Date.parse(request.expiresAt) <= Date.now()) {
        return 'expired'
      }
      return request.resolution
    },

    async listPendingRequests(): Promise<CounterShiftRequest[]> {
      return livePendingFor(counter, displayName).map((request) => ({
        id: request.id,
        deviceId: request.deviceId,
        deviceLabel: request.deviceLabel,
        outletId: request.outletId,
        outletName: request.outletName,
        createdAt: request.createdAt,
        expiresAt: request.expiresAt,
      }))
    },

    /**
     * Every live shift in the demo session, read from the store rather than from
     * a list this module keeps privately.
     *
     * The real adapter selects unexpired, unended `counter_shifts` and lets
     * `counter_shifts_select` scope them; the caller then asks "is this mine?"
     * using `personId`. This does the same filtering and leaves the same question
     * to the caller, so a manager reading their own home does not meet a card
     * about somebody else's counter.
     */
    async listLiveShifts(): Promise<LiveCounterShift[]> {
      const now = Date.now()
      return store.shifts
        .filter((row) => row.ended_at === null && Date.parse(row.expires_at) > now)
        .sort((a, b) => b.opened_at.localeCompare(a.opened_at))
        .map(toLiveShift)
    },

    async confirmShift(requestId: string, code: string): Promise<void> {
      const request = counter.requests.find((candidate) => candidate.id === requestId)
      if (!request || request.resolution !== null || Date.parse(request.expiresAt) <= Date.now()) {
        throw new CounterActionError('invalid_request', 'That request is no longer waiting.')
      }
      if (request.code !== code.replace(/\D/g, '')) {
        request.attempts += 1
        if (request.attempts >= MAX_ATTEMPTS) {
          request.resolution = 'exhausted'
          announce(counter)
          throw new CounterActionError(
            'exhausted',
            'Too many wrong codes. Ask the tablet to try again with a new one.',
          )
        }
        throw new CounterActionError(
          'wrong_code',
          'That is not the code on the tablet. Check it and try again.',
        )
      }

      // The order the database uses: end whatever that tablet holds, then open
      // the next shift, so the counter is never attributable to two people and
      // never to nobody. Confirming IS the handover.
      request.resolution = 'confirmed'
      endOpenShiftOn(request.deviceId, 'operator')
      const openedAt = new Date()
      const cutover = outletCutover(request.outletId)
      const businessDate = resolveBusinessDate(openedAt, cutover)
      store.shifts.push({
        id: crypto.randomUUID(),
        outlet_id: request.outletId,
        person_id: personId,
        device_id: request.deviceId,
        // Through the outlet's own cutover, exactly as `app_business_date` and
        // `app_next_cutover` resolve them. A demo walked at 00:30 opened a shift
        // on tomorrow's date under the old device-clock arithmetic, while every
        // other surface still read tonight's.
        business_date: businessDate,
        opened_at: openedAt.toISOString(),
        expires_at: nextCutover(businessDate, request.outletId),
        ended_at: null,
        ended_reason: null,
      })
      announce(counter)
    },

    async rejectRequest(requestId: string): Promise<void> {
      const request = counter.requests.find((candidate) => candidate.id === requestId)
      if (!request || request.resolution !== null) {
        throw new CounterActionError('invalid_request', 'That request is no longer waiting.')
      }
      request.resolution = 'rejected'
      announce(counter)
    },

    async endShift(shiftId: string): Promise<void> {
      // Leave counter, from the holder's own phone. `operator` is the reason the
      // database records for it, and it is what tells a later flagged bill apart
      // from one rung after a deliberately finished day.
      const row = store.shifts.find((candidate) => candidate.id === shiftId)
      if (row && row.ended_at === null) {
        row.ended_at = new Date().toISOString()
        row.ended_reason = 'operator'
      }
      announce(counter)
    },

    subscribeToOwnHandshake(_personId: string, onChange: () => void): () => void {
      counter.listeners.add(onChange)
      return () => {
        counter.listeners.delete(onChange)
      }
    },

    subscribeToDeviceHandshake(_deviceId: string, onChange: () => void): () => void {
      counter.listeners.add(onChange)
      return () => {
        counter.listeners.delete(onChange)
      }
    },

    subscribeToOutletBilling(_outletId: string, _onChange: () => void): () => void {
      return () => {}
    },

    async reportState(): Promise<void> {
      // A demo tablet has nothing unsent that anybody else can see.
    },
  }
}
