import { distanceMetres, resolveBusinessDate, shiftBusinessDate } from '@/domain'
import type { PositionReading } from '@/lib/geolocation'

import type {
  AttendanceAdapter,
  AttendanceEvent,
  AttendanceRecord,
  AttendanceStatus,
} from '../adapters'
import { AttendanceActionError } from '../adapters'
import { attendanceSeeds, type AttendanceSeed } from './fixtures/attendance'
import { employeeFixtures } from './fixtures/employees'
import { OUTLET_KALYANI_ID, outletFixtures } from './fixtures/outlets'
import { personaFixtures } from './fixtures/personas'

/**
 * The mock attendance adapter.
 *
 * It holds state, like the accounts mock and for the same reason: the surfaces
 * it serves are about *doing* things, and a demo where checking in changes
 * nothing is a screenshot. The state lives in the closure and dies with the
 * demo tree.
 *
 * It also *adjudicates* rather than replays. Distances are computed with the
 * same domain function the database's trigger mirrors, and an out-of-fence
 * check-in with no override comes back `absent` here exactly as it would there.
 * A mock that simply echoed its fixtures could demonstrate a system that could
 * not exist.
 */

function outletFor(outletId: string) {
  const outlet = outletFixtures.find((candidate) => candidate.id === outletId)
  if (!outlet) throw new Error(`No demo outlet: ${outletId}`)
  return outlet
}

function employeeFor(employeeId: string) {
  const employee = employeeFixtures.find((candidate) => candidate.id === employeeId)
  if (!employee) throw new Error(`No demo employee: ${employeeId}`)
  return employee
}

/** A live reading turned into a stored event, distance and all — as the trigger does. */
function eventFromReading(
  outlet: (typeof outletFixtures)[number],
  reading: PositionReading | null,
): AttendanceEvent {
  if (!reading) {
    return {
      at: new Date().toISOString(),
      latitude: null,
      longitude: null,
      accuracyMetres: null,
      distanceMetres: null,
      source: 'phone',
    }
  }
  return {
    at: reading.at,
    latitude: reading.latitude,
    longitude: reading.longitude,
    accuracyMetres: reading.accuracyMetres,
    distanceMetres:
      outlet.latitude === null || outlet.longitude === null
        ? null
        : distanceMetres(
            { latitude: outlet.latitude, longitude: outlet.longitude },
            { latitude: reading.latitude, longitude: reading.longitude },
          ),
    source: 'phone',
  }
}

/**
 * The database's rule, restated where the demo can feel it. Kept in step with
 * `attendance_evaluate_geofence()` — a demo that adjudicated differently from
 * production would be demonstrating a system nobody is building.
 */
function adjudicate(
  claimed: AttendanceStatus,
  checkIn: AttendanceEvent | null,
  outlet: { latitude: number | null; longitude: number | null; radiusMetres: number },
  overridden: boolean,
): AttendanceStatus {
  const surveyed = outlet.latitude !== null && outlet.longitude !== null
  if (claimed !== 'present' || overridden || checkIn === null || !surveyed) return claimed

  // No coordinates from a phone: unjudgeable for exactly the reason the fence
  // exists, so it waits for a manager.
  if (checkIn.latitude === null || checkIn.longitude === null) {
    return checkIn.source === 'phone' ? 'absent' : claimed
  }
  return checkIn.distanceMetres !== null && checkIn.distanceMetres > outlet.radiusMetres
    ? 'absent'
    : claimed
}

export function createMockAttendanceAdapter(): AttendanceAdapter {
  const today = resolveBusinessDate(new Date(), outletFor(OUTLET_KALYANI_ID).business_day_cutover)

  /** `09:04` on a business date, as an instant. Demo data, so IST is assumed. */
  const instantAt = (businessDate: string, time: string): string =>
    new Date(`${businessDate}T${time}:00+05:30`).toISOString()

  const eventFrom = (
    businessDate: string,
    outletId: string,
    seed: { time: string; latitude: number; longitude: number; accuracyMetres: number } | undefined,
  ): AttendanceEvent | null => {
    if (!seed) return null
    const outlet = outletFor(outletId)
    return {
      at: instantAt(businessDate, seed.time),
      latitude: seed.latitude,
      longitude: seed.longitude,
      accuracyMetres: seed.accuracyMetres,
      distanceMetres:
        outlet.latitude === null || outlet.longitude === null
          ? null
          : distanceMetres(
              { latitude: outlet.latitude, longitude: outlet.longitude },
              { latitude: seed.latitude, longitude: seed.longitude },
            ),
      source: 'phone',
    }
  }

  const materialise = (seed: AttendanceSeed, index: number): AttendanceRecord => {
    const employee = employeeFor(seed.employeeId)
    const businessDate = shiftBusinessDate(today, -seed.daysAgo)
    const checkIn = eventFrom(businessDate, employee.outlet_id, seed.checkIn)
    const outlet = outletFor(employee.outlet_id)

    return {
      id: `d3000000-0000-4000-a000-${String(index + 1).padStart(12, '0')}`,
      outletId: employee.outlet_id,
      employeeId: employee.id,
      employeeCode: employee.employee_code,
      employeeName: employee.full_name,
      businessDate,
      status: adjudicate(
        seed.status,
        checkIn,
        {
          latitude: outlet.latitude,
          longitude: outlet.longitude,
          radiusMetres: outlet.geofence_radius_m,
        },
        Boolean(seed.override),
      ),
      checkIn,
      checkOut: eventFrom(businessDate, employee.outlet_id, seed.checkOut),
      override: seed.override
        ? {
            by: personaFixtures.franchise_admin.profile.id,
            byName: seed.override.byName,
            at: instantAt(businessDate, seed.override.time),
            reason: seed.override.reason,
          }
        : null,
    }
  }

  const records: AttendanceRecord[] = attendanceSeeds.map(materialise)

  let nextId = records.length + 1

  const find = (id: string): AttendanceRecord => {
    const record = records.find((candidate) => candidate.id === id)
    if (!record) throw new AttendanceActionError('missing', 'That record no longer exists.')
    return record
  }

  const clone = (record: AttendanceRecord) => structuredClone(record)

  return {
    async getDay(employeeId, businessDate) {
      const record = records.find(
        (candidate) =>
          candidate.employeeId === employeeId && candidate.businessDate === businessDate,
      )
      return record ? clone(record) : null
    },

    async listHistory(employeeId, limit = 30) {
      return records
        .filter((record) => record.employeeId === employeeId)
        .sort((a, b) => b.businessDate.localeCompare(a.businessDate))
        .slice(0, limit)
        .map(clone)
    },

    async listOutletDay(outletId, businessDate) {
      return records
        .filter((record) => record.outletId === outletId && record.businessDate === businessDate)
        .sort((a, b) => a.employeeName.localeCompare(b.employeeName))
        .map(clone)
    },

    async checkIn({ employeeId, outletId, businessDate, reading }) {
      const existing = records.find(
        (candidate) =>
          candidate.employeeId === employeeId && candidate.businessDate === businessDate,
      )
      if (existing?.checkIn) {
        throw new AttendanceActionError(
          'already_started',
          'Your day has already been started. Reload to see today’s status.',
        )
      }

      const employee = employeeFor(employeeId)
      const outlet = outletFor(outletId)
      const event = eventFromReading(outlet, reading)

      const record: AttendanceRecord = {
        id: `d3000000-0000-4000-a000-${String(nextId++).padStart(12, '0')}`,
        outletId,
        employeeId,
        employeeCode: employee.employee_code,
        employeeName: employee.full_name,
        businessDate,
        status: adjudicate(
          'present',
          event,
          {
            latitude: outlet.latitude,
            longitude: outlet.longitude,
            radiusMetres: outlet.geofence_radius_m,
          },
          false,
        ),
        checkIn: event,
        checkOut: null,
        override: null,
      }

      if (existing) {
        Object.assign(existing, { ...record, id: existing.id })
        return clone(existing)
      }
      records.push(record)
      return clone(record)
    },

    async checkOut({ attendanceId, reading }) {
      const record = find(attendanceId)
      if (!record.checkIn) {
        throw new AttendanceActionError('not_started', 'There is no check-in to close.')
      }
      if (record.checkOut) {
        throw new AttendanceActionError(
          'already_checked_out',
          'A check-out is already recorded for today.',
        )
      }

      record.checkOut = eventFromReading(outletFor(record.outletId), reading)
      return clone(record)
    },

    async approveOverride(attendanceId, reason, approverId) {
      const trimmed = reason.trim()
      if (!trimmed) {
        throw new AttendanceActionError('reason_required', 'An override needs a reason.')
      }

      const record = find(attendanceId)
      const approver = Object.values(personaFixtures).find(
        (persona) => persona.profile.id === approverId,
      )

      record.override = {
        by: approverId,
        byName: approver?.profile.full_name ?? null,
        at: new Date().toISOString(),
        reason: trimmed,
      }
      record.status = 'present'
      return clone(record)
    },
  }
}
