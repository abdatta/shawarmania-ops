import { describe, expect, it } from 'vitest'

import { resolveBusinessDate } from '@/domain'
import { describeChangeGate } from '@/test/change-gates'

import { AttendanceActionError } from '../adapters'
import { createDemoData, createMockAdapters, OUTLET_KALYANI_ID } from '.'
import { outletFixtures } from './fixtures/outlets'
import { personaFixtures } from './fixtures/personas'

/**
 * The demo's copy of the rule `attendance_submit_attempt_v3` enforces live
 * (a-check-in-at-the-shop-approves-itself, design D3–D5): a check-in at the shop
 * approves itself, the outlet's two rules, and today's behaviour with the gate
 * off.
 */

const EMPLOYEE = personaFixtures.employee.profile.id
const KALYANI = outletFixtures.find((outlet) => outlet.id === OUTLET_KALYANI_ID)!
const today = () => resolveBusinessDate(new Date(), KALYANI.business_day_cutover)

const reading = (latitude: number, longitude: number, accuracyMetres: number) => ({
  latitude,
  longitude,
  accuracyMetres,
  at: new Date().toISOString(),
})
/** At Kalyani's counter. */
const AT_COUNTER = reading(22.97505, 88.4346, 14)
/** About 2.6 km away. */
const FAR_AWAY = reading(22.997, 88.4346, 20)

function demo(on: boolean) {
  const data = createDemoData({ autoApproving: () => on })
  return {
    staff: createMockAdapters('employee', data),
    owner: createMockAdapters('super_admin', data),
    manager: createMockAdapters('franchise_admin', data),
  }
}

describeChangeGate('auto-approve-at-the-shop', (on) => {
  it(
    on ? 'approves a check-in at the shop by itself' : 'leaves a check-in at the shop waiting',
    async () => {
      const { staff } = demo(on)

      const day = await staff.attendance.checkIn({
        personId: EMPLOYEE,
        outletId: OUTLET_KALYANI_ID,
        businessDate: today(),
        reading: AT_COUNTER,
      })

      if (on) {
        expect(day.status).toBe('present')
        expect(day.currentAttemptId).toBeNull()
        expect(day.approval).toBeNull()
        expect(day.retry).toEqual({ allowed: false, reason: 'prevented' })
        const decision = day.decisions.at(-1)
        expect(decision).toMatchObject({
          kind: 'auto_approved',
          by: null,
          byName: null,
          newStatus: 'present',
          fenceRadiusMetres: KALYANI.geofence_radius_m,
        })
      } else {
        expect(day.status).toBe('absent')
        expect(day.currentAttemptId).not.toBeNull()
        expect(day.decisions).toHaveLength(0)
      }
    },
  )

  it('leaves a check-in from away waiting, as before', async () => {
    const { staff } = demo(on)

    const day = await staff.attendance.checkIn({
      personId: EMPLOYEE,
      outletId: OUTLET_KALYANI_ID,
      businessDate: today(),
      reading: FAR_AWAY,
    })

    expect(day.status).toBe('absent')
    expect(day.currentAttemptId).not.toBeNull()
    expect(day.retry.reason).toBe('outside-current')
  })

  it(
    on
      ? 'refuses a check-in from away where the outlet blocks them, and writes nothing'
      : 'records a check-in from away even where the outlet blocks them',
    async () => {
      const { staff, manager } = demo(on)
      await manager.outlets.updateAttendanceRules(OUTLET_KALYANI_ID, {
        needsManager: false,
        blocksAway: true,
      })

      const attempt = staff.attendance.checkIn({
        personId: EMPLOYEE,
        outletId: OUTLET_KALYANI_ID,
        businessDate: today(),
        reading: FAR_AWAY,
      })

      if (on) {
        await expect(attempt).rejects.toMatchObject({ code: 'blocked_away' })
        await expect(attempt).rejects.toBeInstanceOf(AttendanceActionError)
        expect(await staff.attendance.getDay(EMPLOYEE, today())).toBeNull()
      } else {
        await expect(attempt).resolves.toMatchObject({ status: 'absent' })
      }
    },
  )

  it(
    on
      ? 'refuses a check-in with no position where the outlet blocks them'
      : 'records a check-in with no position',
    async () => {
      const { staff, owner } = demo(on)
      await owner.outlets.updateAttendanceRules(OUTLET_KALYANI_ID, {
        needsManager: false,
        blocksAway: true,
      })

      const attempt = staff.attendance.checkIn({
        personId: EMPLOYEE,
        outletId: OUTLET_KALYANI_ID,
        businessDate: today(),
        reading: null,
      })

      if (on) await expect(attempt).rejects.toMatchObject({ code: 'blocked_away' })
      else await expect(attempt).resolves.toMatchObject({ status: 'absent' })
    },
  )

  it('leaves a check-in at the shop waiting where the outlet asks a manager for every one', async () => {
    const { staff, manager } = demo(on)
    await manager.outlets.updateAttendanceRules(OUTLET_KALYANI_ID, {
      needsManager: true,
      blocksAway: false,
    })

    const day = await staff.attendance.checkIn({
      personId: EMPLOYEE,
      outletId: OUTLET_KALYANI_ID,
      businessDate: today(),
      reading: AT_COUNTER,
    })

    expect(day.status).toBe('absent')
    expect(day.retry.reason).toBe('inside-current')
  })
})

describe('an outlet’s attendance rules in the demo', () => {
  it('are changed by the owner and the outlet’s manager, and refused to staff', async () => {
    const { staff, owner, manager } = demo(true)

    await expect(
      manager.outlets.updateAttendanceRules(OUTLET_KALYANI_ID, {
        needsManager: true,
        blocksAway: false,
      }),
    ).resolves.toMatchObject({ attendance_needs_manager: true })
    await expect(
      owner.outlets.updateAttendanceRules(OUTLET_KALYANI_ID, {
        needsManager: false,
        blocksAway: true,
      }),
    ).resolves.toMatchObject({ attendance_needs_manager: false, attendance_blocks_away: true })
    await expect(
      staff.outlets.updateAttendanceRules(OUTLET_KALYANI_ID, {
        needsManager: false,
        blocksAway: false,
      }),
    ).rejects.toMatchObject({ code: 'not_permitted' })
  })

  it('reach every role’s reading of the outlet, a role switch included', async () => {
    const { staff, manager } = demo(true)
    await manager.outlets.updateAttendanceRules(OUTLET_KALYANI_ID, {
      needsManager: false,
      blocksAway: true,
    })

    expect((await staff.outlets.getOutlet(OUTLET_KALYANI_ID))?.attendance_blocks_away).toBe(true)
  })

  it('leave the seeds as they were when the gate is off', () => {
    const off = createDemoData({ autoApproving: () => false })
    const on = createDemoData({ autoApproving: () => true })
    return Promise.all([
      off.attendance.listHistory(EMPLOYEE, '2000-01-01', '2100-01-01'),
      on.attendance.listHistory(EMPLOYEE, '2000-01-01', '2100-01-01'),
    ]).then(([before, after]) => {
      expect(before.some((day) => day.decisions.some((d) => d.kind === 'auto_approved'))).toBe(
        false,
      )
      expect(after.some((day) => day.decisions.some((d) => d.kind === 'auto_approved'))).toBe(true)
    })
  })
})
