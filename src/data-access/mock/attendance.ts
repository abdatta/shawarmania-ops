import { distanceMetres, resolveBusinessDate, shiftBusinessDate } from '@/domain'
import type { PositionReading } from '@/lib/geolocation'

import type {
  AttendanceAdapter,
  AttendanceEvent,
  AttendanceRecord,
  AttendanceStatus,
} from '../adapters'
import { AttendanceActionError } from '../adapters'
import { accountFixtures } from './fixtures/accounts'
import { attendanceSeeds, type AttendanceSeed } from './fixtures/attendance'
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
 *
 * People are accounts: rows key on profile ids, and the person lookup reads
 * the accounts fixture — the one list of people the whole demo shares.
 */

function outletFor(outletId: string) {
  const outlet = outletFixtures.find((candidate) => candidate.id === outletId)
  if (!outlet) throw new Error(`No demo outlet: ${outletId}`)
  return outlet
}

function personFor(personId: string) {
  const person = accountFixtures.find((candidate) => candidate.id === personId)
  if (!person) throw new Error(`No demo person: ${personId}`)
  return person
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
      enteredBy: null,
      enteredByName: null,
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
    enteredBy: null,
    enteredByName: null,
  }
}

/**
 * The database's rule, restated where the demo can feel it. Kept in step with
 * `attendance_evaluate_geofence()` — a demo that adjudicated differently from
 * production would be demonstrating a system nobody is building. A manual
 * event is never judged: it carries no evidence, and the enterer stamp is the
 * accountability in its place.
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
    seed: AttendanceSeed['checkIn'],
  ): AttendanceEvent | null => {
    if (!seed) return null
    if (seed.manual) {
      return {
        at: instantAt(businessDate, seed.time),
        latitude: null,
        longitude: null,
        accuracyMetres: null,
        distanceMetres: null,
        source: 'manual',
        enteredBy: seed.manual.byId,
        enteredByName: seed.manual.byName,
      }
    }
    const outlet = outletFor(outletId)
    return {
      at: instantAt(businessDate, seed.time),
      latitude: seed.latitude ?? null,
      longitude: seed.longitude ?? null,
      accuracyMetres: seed.accuracyMetres ?? null,
      distanceMetres:
        outlet.latitude === null ||
        outlet.longitude === null ||
        seed.latitude === undefined ||
        seed.longitude === undefined
          ? null
          : distanceMetres(
              { latitude: outlet.latitude, longitude: outlet.longitude },
              { latitude: seed.latitude, longitude: seed.longitude },
            ),
      source: 'phone',
      enteredBy: null,
      enteredByName: null,
    }
  }

  const materialise = (seed: AttendanceSeed, index: number): AttendanceRecord => {
    const person = personFor(seed.personId)
    if (!person.outlet_id) throw new Error(`Demo person has no outlet: ${seed.personId}`)
    const businessDate = shiftBusinessDate(today, -seed.daysAgo)
    const checkIn = eventFrom(businessDate, person.outlet_id, seed.checkIn)
    const outlet = outletFor(person.outlet_id)

    return {
      id: `d3000000-0000-4000-a000-${String(index + 1).padStart(12, '0')}`,
      outletId: person.outlet_id,
      personId: person.id,
      staffCode: person.staff_code,
      personName: person.full_name,
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
      checkOut: eventFrom(businessDate, person.outlet_id, seed.checkOut),
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
    async getDay(personId, businessDate) {
      const record = records.find(
        (candidate) => candidate.personId === personId && candidate.businessDate === businessDate,
      )
      return record ? clone(record) : null
    },

    async listHistory(personId, limit = 30) {
      return records
        .filter((record) => record.personId === personId)
        .sort((a, b) => b.businessDate.localeCompare(a.businessDate))
        .slice(0, limit)
        .map(clone)
    },

    async listOutletDay(outletId, businessDate) {
      return records
        .filter((record) => record.outletId === outletId && record.businessDate === businessDate)
        .sort((a, b) => a.personName.localeCompare(b.personName))
        .map(clone)
    },

    async checkIn({ personId, outletId, businessDate, reading }) {
      const existing = records.find(
        (candidate) => candidate.personId === personId && candidate.businessDate === businessDate,
      )
      if (existing?.checkIn) {
        throw new AttendanceActionError(
          'already_started',
          'Your day has already been started. Reload to see today’s status.',
        )
      }

      const person = personFor(personId)
      const outlet = outletFor(outletId)
      const event = eventFromReading(outlet, reading)

      const record: AttendanceRecord = {
        id: `d3000000-0000-4000-a000-${String(nextId++).padStart(12, '0')}`,
        outletId,
        personId,
        staffCode: person.staff_code,
        personName: person.full_name,
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

    /**
     * Mirrors the guard where the demo can feel it: past times only, the
     * enterer stamped from the recording session, no coordinates ever. Role
     * authority is the surface's business here, as it is for overrides — the
     * real boundary lives in the database this mock stands in for.
     */
    async recordManualEntry({ personId, outletId, businessDate, event, at, enteredBy }) {
      if (new Date(at).getTime() > Date.now()) {
        throw new AttendanceActionError('future_entry', 'A manual entry cannot be in the future.')
      }

      const entererAccount = accountFixtures.find((candidate) => candidate.id === enteredBy)
      const stamp = {
        source: 'manual' as const,
        latitude: null,
        longitude: null,
        accuracyMetres: null,
        distanceMetres: null,
        enteredBy,
        enteredByName: entererAccount?.full_name ?? null,
      }

      const existing = records.find(
        (candidate) => candidate.personId === personId && candidate.businessDate === businessDate,
      )

      if (event === 'check-in') {
        if (existing?.checkIn) {
          throw new AttendanceActionError(
            'already_checked_in',
            'A check-in is already recorded for this day.',
          )
        }
        const person = personFor(personId)
        const record: AttendanceRecord = existing ?? {
          id: `d3000000-0000-4000-a000-${String(nextId++).padStart(12, '0')}`,
          outletId,
          personId,
          staffCode: person.staff_code,
          personName: person.full_name,
          businessDate,
          status: 'present',
          checkIn: null,
          checkOut: null,
          override: null,
        }
        record.status = 'present'
        record.checkIn = { at, ...stamp }
        if (!existing) records.push(record)
        return clone(record)
      }

      if (!existing?.checkIn) {
        throw new AttendanceActionError('not_started', 'There is no check-in to close.')
      }
      if (existing.checkOut) {
        throw new AttendanceActionError(
          'already_checked_out',
          'A check-out is already recorded for this day.',
        )
      }
      existing.checkOut = { at, ...stamp }
      return clone(existing)
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
