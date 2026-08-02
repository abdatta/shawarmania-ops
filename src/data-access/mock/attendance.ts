import { distanceMetres, resolveBusinessDate, shiftBusinessDate } from '@/domain'
import type { PositionReading } from '@/lib/geolocation'

import type {
  AttendanceAdapter,
  AttendanceApproval,
  AttendanceAttempt,
  AttendanceDecision,
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
    const initialOutletId = seed.outletId ?? soleOutletFor(seed.personId)
    const businessDate = shiftBusinessDate(today, -seed.daysAgo)
    const initialCheckIn = eventFrom(businessDate, initialOutletId, seed.checkIn)
    const retryOutletId = seed.retryCheckIn?.outletId ?? null
    const retryCheckIn = retryOutletId
      ? eventFrom(businessDate, retryOutletId, seed.retryCheckIn)
      : null
    const checkIn = retryCheckIn ?? initialCheckIn
    const outletId = retryOutletId ?? initialOutletId
    const outlet = outletFor(outletId)
    const initialOutlet = outletFor(initialOutletId)
    const approval = approvalFrom(businessDate, initialOutletId, seed.approval, initialCheckIn)

    const id = `d3000000-0000-4000-a000-${String(index + 1).padStart(12, '0')}`
    const attemptId = initialCheckIn
      ? `d3100000-0000-4000-a000-${String(index + 1).padStart(12, '0')}`
      : null
    const retryAttemptId = retryCheckIn
      ? `d3110000-0000-4000-a000-${String(index + 1).padStart(12, '0')}`
      : null
    const decisionId =
      approval || seed.denial || (seed.status !== 'absent' && !initialCheckIn)
        ? `d3200000-0000-4000-a000-${String(index + 1).padStart(12, '0')}`
        : null
    const correctionId = seed.correction
      ? `d3300000-0000-4000-a000-${String(index + 1).padStart(12, '0')}`
      : null
    const decisionAt = seed.denial
      ? instantAt(businessDate, seed.denial.time)
      : (approval?.at ?? null)
    const attempts: AttendanceAttempt[] = []
    if (initialCheckIn && attemptId) {
      attempts.push({
        id: attemptId,
        outletId: initialOutletId,
        outletName: initialOutlet.name,
        businessDate,
        ...initialCheckIn,
        arrivalDeadline: initialOutlet.arrival_deadline,
        supersededAt: retryCheckIn ? retryCheckIn.at : null,
        settledAt: decisionId ? (decisionAt ?? initialCheckIn.at) : null,
      })
    }
    if (retryCheckIn && retryAttemptId && retryOutletId) {
      attempts.push({
        id: retryAttemptId,
        outletId: retryOutletId,
        outletName: outlet.name,
        businessDate,
        ...retryCheckIn,
        arrivalDeadline: outlet.arrival_deadline,
        supersededAt: null,
        settledAt: null,
      })
    }
    const decisions: AttendanceDecision[] = decisionId
      ? [
          {
            id: decisionId,
            attemptId,
            outletId: initialOutletId,
            outletName: initialOutlet.name,
            kind: seed.denial
              ? 'deny'
              : initialCheckIn?.source === 'manual'
                ? 'manual_present'
                : approval
                  ? 'approve'
                  : 'legacy_outcome',
            by: seed.denial ? DEMO_MANAGER_ID : (approval?.by ?? null),
            byName: seed.denial?.byName ?? approval?.byName ?? null,
            at: decisionAt ?? instantAt(businessDate, '23:59'),
            reason: seed.denial?.reason ?? approval?.reason ?? null,
            preventsRetry: seed.denial?.preventRetry ?? true,
            previousStatus: seed.status === 'present' ? 'absent' : seed.status,
            newStatus: seed.denial ? 'absent' : seed.status,
            latitude: approval?.latitude ?? null,
            longitude: approval?.longitude ?? null,
            accuracyMetres: approval?.accuracyMetres ?? null,
            distanceMetres: approval?.distanceMetres ?? null,
          },
        ]
      : []

    if (seed.correction && correctionId) {
      const at = instantAt(businessDate, seed.correction.time)
      decisions.push({
        id: correctionId,
        attemptId,
        outletId: initialOutletId,
        outletName: initialOutlet.name,
        kind: seed.correction.kind,
        by: DEMO_MANAGER_ID,
        byName: seed.correction.byName,
        at,
        reason: seed.correction.reason,
        preventsRetry: true,
        previousStatus: seed.status,
        newStatus: seed.correction.kind === 'correct_present' ? 'present' : 'absent',
        latitude: null,
        longitude: null,
        accuracyMetres: null,
        distanceMetres: null,
      })
    }

    const currentAttemptId = retryAttemptId ?? (initialCheckIn && !decisionId ? attemptId : null)
    const outcomeAttemptId = decisionId ? attemptId : null
    const latestDecisionId = correctionId ?? decisionId
    const retryBlocked = seed.denial
      ? retryCheckIn
        ? false
        : seed.denial.preventRetry
      : latestDecisionId !== null
    const status = seed.denial
      ? 'absent'
      : seed.correction
        ? seed.correction.kind === 'correct_present'
          ? 'present'
          : 'absent'
        : adjudicate(seed.status, checkIn, approval !== null)
    const retry = currentAttemptId
      ? checkIn?.distanceMetres === null
        ? ({ allowed: true, reason: 'unverifiable-current' } as const)
        : (checkIn?.distanceMetres ?? 0) > outlet.geofence_radius_m
          ? ({ allowed: true, reason: 'outside-current' } as const)
          : ({ allowed: false, reason: 'inside-current' } as const)
      : seed.denial && !seed.denial.preventRetry
        ? ({ allowed: true, reason: 'open-denial' } as const)
        : ({ allowed: false, reason: retryBlocked ? 'prevented' : 'settled' } as const)

    return {
      id,
      outletId,
      outletName: outlet.name,
      personId: person.id,
      personName: person.full_name,
      businessDate,
      status,
      stateVersion: 1 + (retryCheckIn ? 1 : 0) + decisions.length,
      currentAttemptId,
      outcomeAttemptId,
      latestDecisionId,
      retryBlocked,
      attempts,
      decisions,
      retry,
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
        if (!record.currentAttemptId) continue
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

    async checkIn({ personId, outletId, businessDate, reading, attemptId, expectedVersion }) {
      // Matched on person and date alone, mirroring
      // `attendance_one_per_person_day`: a day started at the other outlet is
      // the same day, and a second row for it is what the database refuses.
      const existing = records.find(
        (candidate) => candidate.personId === personId && candidate.businessDate === businessDate,
      )
      const outlet = outletFor(outletId)
      if (!outlet.is_active) {
        throw new AttendanceActionError('outlet_closed', 'This outlet is not accepting check-ins.')
      }
      if (!assignedOutlets(assignmentFixtures[personId] ?? []).includes(outletId)) {
        throw new AttendanceActionError('not_permitted', 'You are not assigned to this outlet.')
      }
      if (businessDate !== resolveBusinessDate(new Date(), outlet.business_day_cutover)) {
        throw new AttendanceActionError(
          'day_closed',
          'That outlet has moved to a new business day.',
        )
      }
      const repeated = attemptId
        ? existing?.attempts.find((candidate) => candidate.id === attemptId)
        : null
      if (repeated) {
        if (
          repeated.outletId !== outletId ||
          repeated.latitude !== (reading?.latitude ?? null) ||
          repeated.longitude !== (reading?.longitude ?? null) ||
          repeated.accuracyMetres !== (reading?.accuracyMetres ?? null)
        ) {
          throw new AttendanceActionError(
            'changed_request',
            'This request ID was reused with changed evidence.',
          )
        }
        return clone(existing as AttendanceRecord)
      }
      if (existing && expectedVersion != null && existing.stateVersion !== expectedVersion) {
        throw new AttendanceActionError(
          'stale_state',
          'Attendance changed while this action was open.',
        )
      }
      const current = existing?.attempts.find(
        (candidate) => candidate.id === existing.currentAttemptId,
      )
      if (
        current &&
        current.distanceMetres !== null &&
        current.distanceMetres <= outletFor(current.outletId).geofence_radius_m
      ) {
        throw new AttendanceActionError(
          'inside_retry_locked',
          'Your latest check-in is inside the fence and must be decided first.',
        )
      }
      if (existing && !existing.currentAttemptId && !existing.retry.allowed) {
        throw new AttendanceActionError(
          'retry_blocked',
          'Another check-in is not allowed for this day.',
        )
      }

      const person = personFor(personId)
      const event = eventFromReading(outlet, reading)

      const nextAttemptId = attemptId ?? crypto.randomUUID()
      const attempt: AttendanceAttempt = {
        id: nextAttemptId,
        outletId,
        outletName: outlet.name,
        businessDate,
        ...event,
        arrivalDeadline: outlet.arrival_deadline,
        supersededAt: null,
        settledAt: null,
      }
      const priorAttempts = existing?.attempts ?? []
      const now = new Date().toISOString()
      for (const prior of priorAttempts) {
        if (prior.id === existing?.currentAttemptId) prior.supersededAt = now
      }
      const record: AttendanceRecord = {
        id: `d3000000-0000-4000-a000-${String(nextId++).padStart(12, '0')}`,
        outletId,
        outletName: outlet.name,
        personId,
        personName: person.full_name,
        businessDate,
        status: adjudicate('present', event, false),
        stateVersion: (existing?.stateVersion ?? 0) + 1,
        currentAttemptId: nextAttemptId,
        outcomeAttemptId: existing?.outcomeAttemptId ?? null,
        latestDecisionId: existing?.latestDecisionId ?? null,
        retryBlocked: false,
        attempts: [...priorAttempts, attempt],
        decisions: existing?.decisions ?? [],
        retry:
          event.distanceMetres === null
            ? { allowed: true, reason: 'unverifiable-current' }
            : event.distanceMetres > outlet.geofence_radius_m
              ? { allowed: true, reason: 'outside-current' }
              : { allowed: false, reason: 'inside-current' },
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
        stateVersion: 0,
        currentAttemptId: null,
        outcomeAttemptId: null,
        latestDecisionId: null,
        retryBlocked: false,
        attempts: [],
        decisions: [],
        retry: { allowed: false, reason: 'settled' },
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
      const attemptId = crypto.randomUUID()
      const decisionId = crypto.randomUUID()
      record.attempts.push({
        id: attemptId,
        outletId,
        outletName: outlet.name,
        businessDate,
        ...record.checkIn,
        arrivalDeadline: outlet.arrival_deadline,
        supersededAt: null,
        settledAt: record.approval.at,
      })
      record.decisions.push({
        id: decisionId,
        attemptId,
        outletId,
        outletName: outlet.name,
        kind: 'manual_present',
        by: enteredBy,
        byName: entererName,
        at: record.approval.at,
        reason: null,
        preventsRetry: true,
        previousStatus: existing?.status ?? 'absent',
        newStatus: 'present',
        latitude: null,
        longitude: null,
        accuracyMetres: null,
        distanceMetres: null,
      })
      record.stateVersion += 1
      record.currentAttemptId = null
      record.outcomeAttemptId = attemptId
      record.latestDecisionId = decisionId
      record.retryBlocked = true
      record.retry = { allowed: false, reason: 'prevented' }
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
        const decisionId = crypto.randomUUID()
        const currentAttemptId = record.currentAttemptId
        record.decisions.push({
          id: decisionId,
          attemptId: currentAttemptId,
          outletId: record.outletId,
          outletName: record.outletName,
          kind: 'approve',
          by: approverId,
          byName: approver?.profile.full_name ?? null,
          at: now,
          reason: trimmed === '' ? null : trimmed,
          preventsRetry: true,
          previousStatus: 'absent',
          newStatus: 'present',
          latitude: reading?.latitude ?? null,
          longitude: reading?.longitude ?? null,
          accuracyMetres: reading?.accuracyMetres ?? null,
          distanceMetres: record.approval.distanceMetres,
        })
        const attempt = record.attempts.find((candidate) => candidate.id === currentAttemptId)
        if (attempt) attempt.settledAt = now
        record.stateVersion += 1
        record.currentAttemptId = null
        record.outcomeAttemptId = currentAttemptId
        record.latestDecisionId = decisionId
        record.retryBlocked = true
        record.retry = { allowed: false, reason: 'prevented' }
        return clone(record)
      })
    },

    async deny({
      attendanceId,
      expectedAttemptId,
      expectedVersion,
      reason,
      preventRetry,
      decisionId,
    }) {
      const record = find(attendanceId)
      if (
        record.stateVersion !== expectedVersion ||
        record.currentAttemptId !== expectedAttemptId
      ) {
        throw new AttendanceActionError(
          'stale_state',
          'Attendance changed while this action was open.',
        )
      }
      const trimmed = reason.trim()
      if (!trimmed)
        throw new AttendanceActionError('reason_required', 'Enter a reason before denying.')
      const attempt = record.attempts.find((candidate) => candidate.id === expectedAttemptId)
      if (!attempt)
        throw new AttendanceActionError(
          'stale_state',
          'Attendance changed while this action was open.',
        )
      const now = new Date().toISOString()
      const id = decisionId ?? crypto.randomUUID()
      record.decisions.push({
        id,
        attemptId: attempt.id,
        outletId: attempt.outletId,
        outletName: attempt.outletName,
        kind: 'deny',
        by: DEMO_MANAGER_ID,
        byName: personaFixtures.franchise_admin.profile.full_name,
        at: now,
        reason: trimmed,
        preventsRetry: preventRetry,
        previousStatus: record.status,
        newStatus: 'absent',
        latitude: null,
        longitude: null,
        accuracyMetres: null,
        distanceMetres: null,
      })
      attempt.settledAt = now
      record.outletId = attempt.outletId
      record.outletName = attempt.outletName
      record.status = 'absent'
      record.currentAttemptId = null
      record.outcomeAttemptId = attempt.id
      record.latestDecisionId = id
      record.retryBlocked = preventRetry
      record.stateVersion += 1
      record.approval = null
      record.retry = preventRetry
        ? { allowed: false, reason: 'prevented' }
        : { allowed: true, reason: 'open-denial' }
      return clone(record)
    },

    async correct({ attendanceId, expectedVersion, action, reason, reading, decisionId }) {
      const record = find(attendanceId)
      if (record.stateVersion !== expectedVersion || record.currentAttemptId !== null) {
        throw new AttendanceActionError(
          'stale_state',
          'Attendance changed while this action was open.',
        )
      }
      const trimmed = reason.trim()
      if (!trimmed) throw new AttendanceActionError('reason_required', 'Enter a correction reason.')
      const attempt =
        record.attempts.find((candidate) => candidate.id === record.outcomeAttemptId) ??
        record.attempts.at(-1)
      if (!attempt) throw new AttendanceActionError('missing', 'There is no attempt to correct.')
      if (action === 'allow_retry' && record.status !== 'absent') {
        throw new AttendanceActionError(
          'retry_refused',
          'Only an absent day can allow another check-in.',
        )
      }
      const now = new Date().toISOString()
      const id = decisionId ?? crypto.randomUUID()
      const newStatus =
        action === 'present'
          ? 'present'
          : action === 'absent' || action === 'absent_allow_retry'
            ? 'absent'
            : record.status
      const preventsRetry = action === 'present' || action === 'absent'
      const outlet = outletFor(attempt.outletId)
      const managerDistance =
        action === 'present' && reading
          ? metresFromOutlet(outlet, reading.latitude, reading.longitude)
          : null
      record.decisions.push({
        id,
        attemptId: attempt.id,
        outletId: attempt.outletId,
        outletName: attempt.outletName,
        kind:
          action === 'present'
            ? 'correct_present'
            : action === 'absent'
              ? 'correct_absent'
              : action,
        by: DEMO_MANAGER_ID,
        byName: personaFixtures.franchise_admin.profile.full_name,
        at: now,
        reason: trimmed,
        preventsRetry,
        previousStatus: record.status,
        newStatus,
        latitude: action === 'present' ? (reading?.latitude ?? null) : null,
        longitude: action === 'present' ? (reading?.longitude ?? null) : null,
        accuracyMetres: action === 'present' ? (reading?.accuracyMetres ?? null) : null,
        distanceMetres: managerDistance,
      })
      record.status = newStatus
      record.latestDecisionId = id
      record.retryBlocked = preventsRetry
      record.stateVersion += 1
      record.retry = preventsRetry
        ? { allowed: false, reason: 'prevented' }
        : { allowed: true, reason: 'open-denial' }
      record.approval =
        action === 'present'
          ? {
              by: DEMO_MANAGER_ID,
              byName: personaFixtures.franchise_admin.profile.full_name,
              at: now,
              reason: trimmed,
              latitude: reading?.latitude ?? null,
              longitude: reading?.longitude ?? null,
              accuracyMetres: reading?.accuracyMetres ?? null,
              distanceMetres: managerDistance,
            }
          : null
      return clone(record)
    },
  }
}
