import { distanceMetres, resolveBusinessDate, shiftBusinessDate } from '@/domain'
import type { PositionReading } from '@/lib/geolocation'

import type {
  AttendanceAdapter,
  AttendanceApproval,
  AttendanceEvent,
  AttendanceRecord,
  AttendanceStatus,
  WaitingCount,
} from '../adapters'
import { AttendanceActionError, assignedOutlets } from '../adapters'
import { accountFixtures, assignmentFixtures } from './fixtures/accounts'
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
 * same domain function the database's trigger mirrors; a check-in with no
 * approval comes back `absent` here exactly as it would there; and an approval
 * taken away from the outlet is refused without a reason, here as there. A mock
 * that simply echoed its fixtures could demonstrate a system that could not
 * exist.
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

/** Metres from an outlet, or null when either end has no position to compare. */
function metresFromOutlet(
  outlet: { latitude: number | null; longitude: number | null },
  latitude: number | null,
  longitude: number | null,
): number | null {
  if (outlet.latitude === null || outlet.longitude === null) return null
  if (latitude === null || longitude === null) return null
  return distanceMetres(
    { latitude: outlet.latitude, longitude: outlet.longitude },
    { latitude, longitude },
  )
}

/** A live reading turned into a stored event, distance and all — as the trigger does. */
function eventFromReading(
  outlet: (typeof outletFixtures)[number],
  reading: PositionReading | null,
): AttendanceEvent {
  return {
    at: reading?.at ?? new Date().toISOString(),
    latitude: reading?.latitude ?? null,
    longitude: reading?.longitude ?? null,
    accuracyMetres: reading?.accuracyMetres ?? null,
    distanceMetres: reading ? metresFromOutlet(outlet, reading.latitude, reading.longitude) : null,
    source: 'phone',
    enteredBy: null,
    enteredByName: null,
  }
}

/**
 * The database's rule, restated where the demo can feel it. Kept in step with
 * `attendance_evaluate_geofence()` — a demo that adjudicated differently from
 * production would be demonstrating a system nobody is building.
 *
 * The fence no longer decides anything about status: an unapproved check-in is
 * `absent` whatever its distance, because only a recorded approval settles a
 * day. A manual entry is exempt, because recording it is itself the approval.
 */
function adjudicate(
  claimed: AttendanceStatus,
  checkIn: AttendanceEvent | null,
  approved: boolean,
): AttendanceStatus {
  if (claimed !== 'present' || approved || checkIn === null) return claimed
  return checkIn.source === 'manual' ? claimed : 'absent'
}

/** The demo manager, as the fallback author of a seeded manual arrival. */
const DEMO_MANAGER_ID = personaFixtures.franchise_admin.profile.id

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
    return {
      at: instantAt(businessDate, seed.time),
      latitude: seed.latitude ?? null,
      longitude: seed.longitude ?? null,
      accuracyMetres: seed.accuracyMetres ?? null,
      distanceMetres: metresFromOutlet(
        outletFor(outletId),
        seed.latitude ?? null,
        seed.longitude ?? null,
      ),
      source: 'phone',
      enteredBy: null,
      enteredByName: null,
    }
  }

  const approvalFrom = (
    businessDate: string,
    outletId: string,
    seed: AttendanceSeed['approval'],
    checkIn: AttendanceEvent | null,
  ): AttendanceApproval | null => {
    // A manual arrival is settled by the act of recording it, exactly as the
    // guard settles one: the admin attested to it by typing it in. A seed does
    // not have to say so, and one that did could forget to.
    if (!seed && checkIn?.source === 'manual') {
      return {
        by: checkIn.enteredBy ?? DEMO_MANAGER_ID,
        byName: checkIn.enteredByName,
        at: checkIn.at,
        reason: null,
        latitude: null,
        longitude: null,
        accuracyMetres: null,
        distanceMetres: null,
      }
    }
    if (!seed) return null
    return {
      by: personaFixtures.franchise_admin.profile.id,
      byName: seed.byName,
      at: instantAt(businessDate, seed.time),
      reason: seed.reason ?? null,
      latitude: seed.latitude ?? null,
      longitude: seed.longitude ?? null,
      accuracyMetres: seed.accuracyMetres ?? null,
      distanceMetres: metresFromOutlet(
        outletFor(outletId),
        seed.latitude ?? null,
        seed.longitude ?? null,
      ),
    }
  }

  /**
   * The one outlet a person is assigned to. A seed that does not name an outlet
   * is a person who only works at one — which is every seed but the split
   * shift's, and asking here keeps that assumption from spreading silently.
   */
  const soleOutletFor = (personId: string): string => {
    const outlets = assignedOutlets(assignmentFixtures[personId] ?? [])
    const [only] = outlets
    if (outlets.length !== 1 || !only) {
      throw new Error(
        `Demo person ${personId} is assigned to ${outlets.length} outlets; the seed must name one`,
      )
    }
    return only
  }

  const materialise = (seed: AttendanceSeed, index: number): AttendanceRecord => {
    const person = personFor(seed.personId)
    const outletId = seed.outletId ?? soleOutletFor(seed.personId)
    const businessDate = shiftBusinessDate(today, -seed.daysAgo)
    const checkIn = eventFrom(businessDate, outletId, seed.checkIn)
    const approval = approvalFrom(businessDate, outletId, seed.approval, checkIn)
    const outlet = outletFor(outletId)

    return {
      id: `d3000000-0000-4000-a000-${String(index + 1).padStart(12, '0')}`,
      outletId,
      outletName: outlet.name,
      personId: person.id,
      personName: person.full_name,
      businessDate,
      status: adjudicate(seed.status, checkIn, approval !== null),
      // Stamped from the outlet exactly as the guard stamps it, and only where a
      // check-in landed — a day with no arrival has no deadline to have applied.
      arrivalDeadline: checkIn ? outlet.arrival_deadline : null,
      checkIn,
      approval,
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

  const inRange = (record: AttendanceRecord, from: string, to: string) =>
    record.businessDate >= from && record.businessDate <= to

  return {
    async getDay(personId, businessDate) {
      const record = records.find(
        (candidate) => candidate.personId === personId && candidate.businessDate === businessDate,
      )
      return record ? clone(record) : null
    },

    async listHistory(personId, from, to) {
      return records
        .filter((record) => record.personId === personId && inRange(record, from, to))
        .sort((a, b) => b.businessDate.localeCompare(a.businessDate))
        .map(clone)
    },

    /**
     * No outlet filter, matching the real adapter: the demo's owner reads every
     * outlet, which is the whole point of the by-staff axis.
     */
    async listPersonRange(personId, from, to) {
      return records
        .filter((record) => record.personId === personId && inRange(record, from, to))
        .sort((a, b) => b.businessDate.localeCompare(a.businessDate))
        .map(clone)
    },

    async listOutletDay(outletIds, businessDate) {
      return records
        .filter(
          (record) => outletIds.includes(record.outletId) && record.businessDate === businessDate,
        )
        .sort((a, b) => a.personName.localeCompare(b.personName))
        .map(clone)
    },

    /**
     * The demo's stand-in for `attendance_elsewhere`. It reproduces the bound
     * rather than the query: only people on a selected outlet's staff list, only
     * the fact, and nothing when the row is already inside the selection. A mock
     * that answered more generously would demo a disclosure the database refuses.
     */
    async listElsewhere(outletIds, businessDate) {
      const onStaffHere = (personId: string) =>
        assignedOutlets(assignmentFixtures[personId] ?? []).some((id) => outletIds.includes(id))

      return [
        ...new Set(
          records
            .filter(
              (record) =>
                record.businessDate === businessDate &&
                !outletIds.includes(record.outletId) &&
                onStaffHere(record.personId),
            )
            .map((record) => record.personId),
        ),
      ]
    },

    async countWaitingByOutlet() {
      const byOutlet = new Map<string, WaitingCount>()
      for (const record of records) {
        if (!record.checkIn || record.approval || record.status !== 'absent') continue
        const seen = byOutlet.get(record.outletId)
        if (seen) {
          seen.waiting += 1
          if (record.businessDate < seen.oldest) seen.oldest = record.businessDate
          // The store is not ordered, so the extremes are tracked rather than
          // taken from the ends. Same answer as the Supabase adapter's, which is
          // what makes the derived day marks identical in demo and live.
          if (record.businessDate > seen.newest) seen.newest = record.businessDate
        } else {
          byOutlet.set(record.outletId, {
            outletId: record.outletId,
            outletName: record.outletName,
            waiting: 1,
            oldest: record.businessDate,
            newest: record.businessDate,
          })
        }
      }
      return [...byOutlet.values()].sort((a, b) =>
        (a.outletName ?? '').localeCompare(b.outletName ?? ''),
      )
    },

    async checkIn({ personId, outletId, businessDate, reading }) {
      // Matched on person and date alone, mirroring
      // `attendance_one_per_person_day`: a day started at the other outlet is
      // the same day, and a second row for it is what the database refuses.
      const existing = records.find(
        (candidate) => candidate.personId === personId && candidate.businessDate === businessDate,
      )
      if (existing?.checkIn) {
        throw new AttendanceActionError(
          'already_started',
          'This day has already been recorded, here or at another outlet. Reload to see it.',
        )
      }
      if (existing && existing.outletId !== outletId) {
        throw new AttendanceActionError(
          'recorded_elsewhere',
          'This day is already recorded at another outlet. One day belongs to one outlet.',
        )
      }

      const person = personFor(personId)
      const outlet = outletFor(outletId)
      const event = eventFromReading(outlet, reading)

      const record: AttendanceRecord = {
        id: `d3000000-0000-4000-a000-${String(nextId++).padStart(12, '0')}`,
        outletId,
        outletName: outlet.name,
        personId,
        personName: person.full_name,
        businessDate,
        status: adjudicate('present', event, false),
        arrivalDeadline: outlet.arrival_deadline,
        checkIn: event,
        approval: null,
      }

      if (existing) {
        Object.assign(existing, { ...record, id: existing.id })
        return clone(existing)
      }
      records.push(record)
      return clone(record)
    },

    /**
     * Mirrors the guard where the demo can feel it: past times only, the enterer
     * stamped from the recording session, no coordinates ever, and the recording
     * settles the day under the enterer's name rather than queueing a second
     * decision. Role authority is the surface's business here — the real
     * boundary lives in the database this mock stands in for.
     */
    async recordManualEntry({ personId, outletId, businessDate, at, enteredBy }) {
      if (new Date(at).getTime() > Date.now()) {
        throw new AttendanceActionError('future_entry', 'A manual entry cannot be in the future.')
      }

      const entererAccount = accountFixtures.find((candidate) => candidate.id === enteredBy)
      const entererName = entererAccount?.full_name ?? null
      const outlet = outletFor(outletId)

      const existing = records.find(
        (candidate) => candidate.personId === personId && candidate.businessDate === businessDate,
      )
      if (existing?.checkIn) {
        throw new AttendanceActionError(
          'already_checked_in',
          'A check-in is already recorded for this day.',
        )
      }
      if (existing && existing.outletId !== outletId) {
        throw new AttendanceActionError(
          'recorded_elsewhere',
          'This person already has a day recorded at another outlet. One day belongs to one outlet.',
        )
      }

      const person = personFor(personId)
      const record: AttendanceRecord = existing ?? {
        id: `d3000000-0000-4000-a000-${String(nextId++).padStart(12, '0')}`,
        outletId,
        outletName: outlet.name,
        personId,
        personName: person.full_name,
        businessDate,
        status: 'present',
        arrivalDeadline: null,
        checkIn: null,
        approval: null,
      }
      record.status = 'present'
      record.arrivalDeadline = outlet.arrival_deadline
      record.checkIn = {
        at,
        latitude: null,
        longitude: null,
        accuracyMetres: null,
        distanceMetres: null,
        source: 'manual',
        enteredBy,
        enteredByName: entererName,
      }
      // The recording is the decision, so no position is read and none is
      // claimed: the enterer stamp is the accountability in evidence's place.
      record.approval = {
        by: enteredBy,
        byName: entererName,
        at: new Date().toISOString(),
        reason: null,
        latitude: null,
        longitude: null,
        accuracyMetres: null,
        distanceMetres: null,
      }
      if (!existing) records.push(record)
      return clone(record)
    },

    async approve(attendanceIds, { reason, reading, approverId }) {
      const trimmed = reason?.trim() ?? ''
      const approver = Object.values(personaFixtures).find(
        (persona) => persona.profile.id === approverId,
      )
      const targets = attendanceIds.map(find)

      for (const record of targets) {
        if (!record.checkIn) {
          throw new AttendanceActionError(
            'nothing_to_approve',
            'There is no check-in on this day to approve.',
          )
        }
        if (record.approval) {
          throw new AttendanceActionError(
            'already_approved',
            'This day has already been approved. Reload to see who settled it.',
          )
        }
        const outlet = outletFor(record.outletId)
        const distance = reading
          ? metresFromOutlet(outlet, reading.latitude, reading.longitude)
          : null
        const onSite = distance !== null && distance <= outlet.geofence_radius_m
        const sameDay =
          record.businessDate === resolveBusinessDate(new Date(), outlet.business_day_cutover)
        if (!(onSite && sameDay) && trimmed === '') {
          throw new AttendanceActionError(
            'reason_required',
            'You are not at the outlet, or this day has already closed, so this approval needs a reason.',
          )
        }
      }

      // Written only once every row has passed, so a batch settles together or
      // not at all — the mock's stand-in for one statement in one transaction.
      const now = new Date().toISOString()
      return targets.map((record) => {
        const outlet = outletFor(record.outletId)
        record.approval = {
          by: approverId,
          byName: approver?.profile.full_name ?? null,
          at: now,
          reason: trimmed === '' ? null : trimmed,
          latitude: reading?.latitude ?? null,
          longitude: reading?.longitude ?? null,
          accuracyMetres: reading?.accuracyMetres ?? null,
          distanceMetres: reading
            ? metresFromOutlet(outlet, reading.latitude, reading.longitude)
            : null,
        }
        record.status = 'present'
        return clone(record)
      })
    },
  }
}
