import { describe, expect, it } from 'vitest'

import { createMockBillingAdapter } from './billing'
import { createDemoData, createMockAdapters } from './index'
import { DEMO_BILLER_ID, DEMO_COUNTER_DEVICE_ID } from './fixtures/billing'
import { createDemoStore, DEMO_OUTLET_ID, DEMO_SECOND_OUTLET_ID } from './store'

/**
 * The demo counter's shift lifecycle, and the one fact it is built on.
 *
 * The demo used to hold a shift twice: once in the handshake module and once in
 * the store the billing adapter reads. Nothing kept them together, so the
 * Tablets surface reported an operator that no phone could see, a confirmed
 * request opened a shift no bill was ever attributed to, and ending one from a
 * phone left the other open. These tests exist because that class of bug is
 * invisible on any single screen — it only shows when two surfaces are asked the
 * same question.
 *
 * They also pin the part production cares about most: which table the demo
 * writes. `public.shifts` is the retired pre-tablet model, and a demo storing
 * its ids in columns that reference `counter_shifts` was storing values the real
 * database would refuse.
 */

function demo(role: 'super_admin' | 'biller' = 'biller') {
  const data = createDemoData()
  return { data, adapters: createMockAdapters(role, data) }
}

describe('the demo counter shift', () => {
  it('is one fact: Tablets and the phone name the same holder', async () => {
    const { data, adapters } = demo('super_admin')

    const [snapshot] = await adapters.counter.readDeviceOperations([DEMO_OUTLET_ID])
    const live = await adapters.counter.listLiveShifts()
    const mine = live.filter((shift) => shift.deviceId === DEMO_COUNTER_DEVICE_ID)

    expect(snapshot?.operations).not.toBeNull()
    expect(mine).toHaveLength(1)
    // The same row, reached two ways.
    expect(mine[0]!.id).toBe(snapshot!.operations!.shiftId)
    expect(mine[0]!.personId).toBe(DEMO_BILLER_ID)
    expect(mine[0]!.openedAt).toBe(snapshot!.operations!.openedAt)
    expect(data.store.shifts.filter((row) => row.ended_at === null)).toHaveLength(1)
  })

  it('never writes a retired shift id into a live column', () => {
    const { data } = demo()

    for (const bill of data.store.bills) {
      // `bills.shift_id` is the pre-tablet model, left alive only for history the
      // demo does not have. Every demo bill is within four days of today.
      expect(bill.shift_id).toBeNull()
      expect(bill.counter_shift_id).not.toBeNull()
      expect(data.store.shifts.some((row) => row.id === bill.counter_shift_id)).toBe(true)
    }

    // Every one of these columns is `references public.counter_shifts (id)` in
    // production, so an id from the other table is a value the real database's
    // foreign keys would reject outright.
    const references = [
      ...data.store.billingCommands.map((command) => command.shift_id),
      ...data.store.orders.flatMap((order) => [
        order.created_shift_id,
        order.changed_shift_id,
        order.paid_shift_id,
        order.cancelled_shift_id,
      ]),
    ]
    expect(references.some((reference) => reference != null)).toBe(true)
    for (const reference of references) {
      if (reference == null) continue
      expect(data.store.shifts.some((row) => row.id === reference)).toBe(true)
    }
  })

  it('expires at the outlet’s own cutover rather than a fixed span', () => {
    const { data } = demo()

    for (const row of data.store.shifts) {
      // `app_next_cutover`: the cutover on the day after the business date.
      expect(row.expires_at > row.opened_at).toBe(true)
      const expiry = new Date(row.expires_at)
      const dayAfter = new Date(`${row.business_date}T00:00:00+05:30`)
      dayAfter.setUTCDate(dayAfter.getUTCDate() + 1)
      expect(expiry.toISOString().slice(0, 10)).toBe(dayAfter.toISOString().slice(0, 10))
    }
  })

  it('opens a shift a bill is then attributed to, when a request is confirmed', async () => {
    const { data, adapters } = demo('super_admin')
    const opened = await adapters.counter.requestShift('Demo Owner')

    await adapters.counter.confirmShift(opened.requestId, opened.code)

    const live = await adapters.counter.listLiveShifts()
    const shift = live.find((candidate) => candidate.deviceId === DEMO_COUNTER_DEVICE_ID)!
    // The previous holder's shift ended in the same breath, exactly as the
    // database's one-open-shift-per-device index forces.
    expect(live.filter((candidate) => candidate.deviceId === DEMO_COUNTER_DEVICE_ID)).toHaveLength(
      1,
    )
    expect(shift.personId).not.toBe(DEMO_BILLER_ID)

    const departed = data.store.shifts.find((row) => row.person_id === DEMO_BILLER_ID)!
    expect(departed.ended_at).not.toBeNull()
    expect(departed.ended_reason).toBe('operator')

    // And billing can attribute to the new one, which is the whole point.
    const row = data.store.shifts.find((candidate) => candidate.id === shift.id)!
    expect(row.ended_at).toBeNull()
    expect(row.business_date).toBe(data.store.today)
  })

  it('records why a shift ended, so the reasons stay distinguishable', async () => {
    const leaving = demo('super_admin')
    const openRow = leaving.data.store.shifts.find((row) => row.ended_at === null)!
    await leaving.adapters.counter.endShift(openRow.id)
    expect(leaving.data.store.shifts.find((row) => row.id === openRow.id)!.ended_reason).toBe(
      'operator',
    )

    // A store without the lifecycle seeds, because Finish Day rightly refuses
    // while the seeded needs-attention command is still queued — that refusal is
    // its own behaviour and is proved in the billing suite.
    const quiet = createDemoStore()
    const billing = createMockBillingAdapter(quiet)
    const finished = quiet.shifts.find((row) => row.ended_at === null)!
    await billing.closeShift(finished.id)
    expect(quiet.shifts.find((row) => row.id === finished.id)!.ended_reason).toBe('day_finished')

    const removing = demo('super_admin')
    const removed = removing.data.store.shifts.find((row) => row.ended_at === null)!
    await removing.adapters.counter.removeDevice(DEMO_COUNTER_DEVICE_ID)
    expect(removing.data.store.shifts.find((row) => row.id === removed.id)!.ended_reason).toBe(
      'device_removed',
    )
  })

  it('leaves the counter with no live shift, which the tablet reads as its resting state', async () => {
    const { data, adapters } = demo('super_admin')
    const openRow = data.store.shifts.find((row) => row.ended_at === null)!

    await adapters.counter.endShift(openRow.id)

    const live = await adapters.counter.listLiveShifts()
    expect(live.some((shift) => shift.deviceId === DEMO_COUNTER_DEVICE_ID)).toBe(false)
    const [snapshot] = await adapters.counter.readDeviceOperations([DEMO_OUTLET_ID])
    // Tablets agrees rather than still naming the person who left.
    expect(snapshot?.operations).toBeNull()
  })

  it('does not let one outlet’s counter answer for the other’s', async () => {
    const { data } = createSecondOutletShift()

    // Kalyani's biller reaches only Kalyani, so the shift it finds is its own
    // even though a second outlet now has one open too.
    const kalyani = createMockAdapters('biller', data)
    const { shift } = kalyani.billing.getCounterState()

    expect(shift?.outletId).toBe(DEMO_OUTLET_ID)
    expect(data.store.shifts.filter((row) => row.ended_at === null)).toHaveLength(2)
  })
})

/** Kanchrapara's seeded shift is closed; this reopens it to make two live. */
function createSecondOutletShift() {
  const data = createDemoData()
  const kanchrapara = data.store.shifts.find((row) => row.outlet_id === DEMO_SECOND_OUTLET_ID)!
  kanchrapara.ended_at = null
  kanchrapara.ended_reason = null
  return { data }
}
