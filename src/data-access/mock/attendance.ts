import { distanceMetres, resolveBusinessDate, shiftBusinessDate } from '@/domain'
import type { PositionReading } from '@/lib/geolocation'

import type {
  AttendanceAdapter,
  AttendanceApproval,
  AttendanceAttempt,
  AttendanceDecision,
  AttendanceDecisionItem,
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
  at: string,
): AttendanceEvent {
  return {
    at,
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

export function createMockAttendanceAdapter(
  options: {
    now?: () => Date
    /** Test/demo-only outlet cutover overrides, still read by the adapter. */
    businessDayCutovers?: Readonly<Record<string, string>>
  } = {},
): AttendanceAdapter {
  // Demo has no database, so its adapter owns one reference clock. Components
  // receive the resulting context and never use their device clock for
  // attendance authority.
  const referenceNow = options.now ?? (() => new Date())
  const businessDayCutover = (outlet: (typeof outletFixtures)[number]) =>
    options.businessDayCutovers?.[outlet.id] ?? outlet.business_day_cutover
  const today = resolveBusinessDate(
    referenceNow(),
    businessDayCutover(outletFor(OUTLET_KALYANI_ID)),
  )

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
            previousCheckInAt: null,
            newCheckInAt: null,
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
        previousCheckInAt: null,
        newCheckInAt: null,
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

  /**
   * What each command settled, so an exact replay answers with the same rows
   * instead of settling them twice. The database keys this on the decisions it
   * wrote; the mock keeps the same promise with a map, which is enough for the
   * only thing a surface can observe.
   */
  const commands = new Map<string, readonly string[]>()
  const checkInCommands = new Map<
    string,
    {
      personId: string
      outletId: string
      businessDate: string
      attemptedAt: string | null
      latitude: number | null
      longitude: number | null
      accuracyMetres: number | null
      expectedVersion: number | null
    }
  >()

  const replay = (commandId: string): AttendanceRecord[] | null => {
    const settled = commands.get(commandId)
    return settled ? settled.map((id) => clone(find(id))) : null
  }

  /**
   * The bound and the shape, refused here for the same reason the database
   * refuses them: a request nobody meant to send should fail identically in
   * demo mode and in production.
   */
  const guardSet = (items: readonly AttendanceDecisionItem[]) => {
    if (items.length > 100) {
      throw new AttendanceActionError(
        'set_too_large',
        'That is more people than one action can settle. Decide them in smaller sets.',
      )
    }
    const named = new Set(items.map((item) => item.attendanceId))
    if (named.size !== items.length) {
      throw new AttendanceActionError('changed_request', 'That set names one person twice.')
    }
    const spent = new Set(items.map((item) => item.decisionId))
    if (spent.size !== items.length) {
      throw new AttendanceActionError('changed_request', 'That set names one decision twice.')
    }
  }

  /**
   * The approval partition, per row: the reason is owed unless this one reading
   * is inside **this row's** outlet fence and **this row's** business date is
   * still current there.
   */
  const needsReason = (record: AttendanceRecord, reading: PositionReading | null) => {
    const outlet = outletFor(record.outletId)
    const distance = reading ? metresFromOutlet(outlet, reading.latitude, reading.longitude) : null
    const onSite = distance !== null && distance <= outlet.geofence_radius_m
    const sameDay =
      record.businessDate === resolveBusinessDate(referenceNow(), businessDayCutover(outlet))
    return !(onSite && sameDay)
  }

  const inRange = (record: AttendanceRecord, from: string, to: string) =>
    record.businessDate >= from && record.businessDate <= to

  return {
    async getCurrentContext(outletIds) {
      const serverAt = referenceNow().toISOString()
      const ids = [...new Set(outletIds)]
      return {
        serverAt,
        outlets: ids.flatMap((outletId) => {
          const outlet = outletFixtures.find((candidate) => candidate.id === outletId)
          return outlet
            ? [
                {
                  outletId,
                  businessDate: resolveBusinessDate(new Date(serverAt), businessDayCutover(outlet)),
                },
              ]
            : []
        }),
      }
    },

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
      const serverAt = referenceNow().toISOString()
      // Matched on person and date alone, mirroring
      // `attendance_one_per_person_day`: a day started at the other outlet is
      // the same day, and a second row for it is what the database refuses.
      const outlet = outletFor(outletId)
      if (!outlet.is_active) {
        throw new AttendanceActionError('outlet_closed', 'This outlet is not accepting check-ins.')
      }
      if (!assignedOutlets(assignmentFixtures[personId] ?? []).includes(outletId)) {
        throw new AttendanceActionError('not_permitted', 'You are not assigned to this outlet.')
      }
      const repeatedRecord = attemptId
        ? records.find((candidate) => candidate.attempts.some((item) => item.id === attemptId))
        : null
      if (repeatedRecord) {
        const saved = checkInCommands.get(attemptId!)
        if (
          !saved ||
          saved.personId !== personId ||
          saved.outletId !== outletId ||
          saved.businessDate !== businessDate ||
          saved.attemptedAt !== (reading?.at ?? null) ||
          saved.latitude !== (reading?.latitude ?? null) ||
          saved.longitude !== (reading?.longitude ?? null) ||
          saved.accuracyMetres !== (reading?.accuracyMetres ?? null) ||
          saved.expectedVersion !== (expectedVersion ?? null)
        ) {
          throw new AttendanceActionError(
            'changed_request',
            'This request ID was reused with changed evidence.',
          )
        }
        return clone(repeatedRecord)
      }
      const serverBusinessDate = resolveBusinessDate(new Date(serverAt), businessDayCutover(outlet))
      const named =
        expectedVersion == null
          ? null
          : records.find(
              (candidate) =>
                candidate.personId === personId && candidate.businessDate === businessDate,
            )
      if (named && named.businessDate !== serverBusinessDate) {
        throw new AttendanceActionError(
          'day_closed',
          'That outlet has moved to a new business day.',
        )
      }
      const existing =
        named ??
        records.find(
          (candidate) =>
            candidate.personId === personId && candidate.businessDate === serverBusinessDate,
        )
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
      const event = eventFromReading(outlet, reading, serverAt)

      const nextAttemptId = attemptId ?? crypto.randomUUID()
      checkInCommands.set(nextAttemptId, {
        personId,
        outletId,
        businessDate,
        attemptedAt: reading?.at ?? null,
        latitude: reading?.latitude ?? null,
        longitude: reading?.longitude ?? null,
        accuracyMetres: reading?.accuracyMetres ?? null,
        expectedVersion: expectedVersion ?? null,
      })
      const attempt: AttendanceAttempt = {
        id: nextAttemptId,
        outletId,
        outletName: outlet.name,
        businessDate: serverBusinessDate,
        ...event,
        arrivalDeadline: outlet.arrival_deadline,
        supersededAt: null,
        settledAt: null,
      }
      const priorAttempts = existing?.attempts ?? []
      const now = serverAt
      for (const prior of priorAttempts) {
        if (prior.id === existing?.currentAttemptId) prior.supersededAt = now
      }
      const record: AttendanceRecord = {
        id: `d3000000-0000-4000-a000-${String(nextId++).padStart(12, '0')}`,
        outletId,
        outletName: outlet.name,
        personId,
        personName: person.full_name,
        businessDate: serverBusinessDate,
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
      if (new Date(at).getTime() > referenceNow().getTime()) {
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
        at: referenceNow().toISOString(),
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
        previousCheckInAt: null,
        newCheckInAt: null,
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

    async approve(items, { commandId, reason, reading, approverId }) {
      if (items.length === 0) return []
      const trimmed = reason?.trim() ?? ''
      const approver = Object.values(personaFixtures).find(
        (persona) => persona.profile.id === approverId,
      )

      const replayed = replay(commandId)
      if (replayed) return replayed
      guardSet(items)

      // Every rule is checked across the whole set before a single row moves, so
      // a refusal settles nothing — the mock's stand-in for one statement in one
      // transaction. A permissive imitation here would mean demo mode and the
      // component tests exercising a contract the database does not have.
      const targets = items.map((item) => find(item.attendanceId))
      for (const [index, record] of targets.entries()) {
        const item = items[index]!
        if (!record.checkIn) {
          throw new AttendanceActionError(
            'nothing_to_approve',
            'There is no check-in on this day to approve.',
          )
        }
        if (
          record.stateVersion !== item.expectedVersion ||
          record.currentAttemptId !== item.expectedAttemptId
        ) {
          throw new AttendanceActionError(
            'stale_state',
            'Attendance changed while this action was open. The latest state has been reloaded.',
          )
        }
        if (needsReason(record, reading) && trimmed === '') {
          throw new AttendanceActionError(
            'reason_required',
            'You are not at the outlet, or this day has already closed, so this approval needs a reason.',
          )
        }
      }

      const now = referenceNow().toISOString()
      commands.set(
        commandId,
        items.map((each) => each.attendanceId),
      )
      return targets.map((record, index) => {
        const item = items[index]!
        const outlet = outletFor(record.outletId)
        // The reason reaches only the rows the rule asked it of. A row approved
        // on the plain terms keeps none, whatever the rest of the set needed.
        const stored = needsReason(record, reading) && trimmed !== '' ? trimmed : null
        const distance = reading
          ? metresFromOutlet(outlet, reading.latitude, reading.longitude)
          : null
        record.approval = {
          by: approverId,
          byName: approver?.profile.full_name ?? null,
          at: now,
          reason: stored,
          latitude: reading?.latitude ?? null,
          longitude: reading?.longitude ?? null,
          accuracyMetres: reading?.accuracyMetres ?? null,
          distanceMetres: distance,
        }
        record.status = 'present'
        const currentAttemptId = record.currentAttemptId
        record.decisions.push({
          id: item.decisionId,
          attemptId: currentAttemptId,
          outletId: record.outletId,
          outletName: record.outletName,
          kind: 'approve',
          by: approverId,
          byName: approver?.profile.full_name ?? null,
          at: now,
          reason: stored,
          preventsRetry: true,
          previousStatus: 'absent',
          newStatus: 'present',
          previousCheckInAt: null,
          newCheckInAt: null,
          latitude: reading?.latitude ?? null,
          longitude: reading?.longitude ?? null,
          accuracyMetres: reading?.accuracyMetres ?? null,
          distanceMetres: distance,
        })
        const attempt = record.attempts.find((candidate) => candidate.id === currentAttemptId)
        if (attempt) attempt.settledAt = now
        record.stateVersion += 1
        record.currentAttemptId = null
        record.outcomeAttemptId = currentAttemptId
        record.latestDecisionId = item.decisionId
        record.retryBlocked = true
        record.retry = { allowed: false, reason: 'prevented' }
        return clone(record)
      })
    },

    async deny(items, { commandId, reason, preventRetry }) {
      if (items.length === 0) return []
      const replayed = replay(commandId)
      if (replayed) return replayed
      guardSet(items)

      const trimmed = reason.trim()
      if (!trimmed)
        throw new AttendanceActionError('reason_required', 'Enter a reason before denying.')

      const targets = items.map((item) => find(item.attendanceId))
      for (const [index, record] of targets.entries()) {
        const item = items[index]!
        if (
          record.stateVersion !== item.expectedVersion ||
          record.currentAttemptId !== item.expectedAttemptId ||
          !record.attempts.some((candidate) => candidate.id === item.expectedAttemptId)
        ) {
          throw new AttendanceActionError(
            'stale_state',
            'Attendance changed while this action was open. The latest state has been reloaded.',
          )
        }
      }

      const now = referenceNow().toISOString()
      commands.set(
        commandId,
        items.map((each) => each.attendanceId),
      )
      return targets.map((record, index) => {
        const item = items[index]!
        const attempt = record.attempts.find(
          (candidate) => candidate.id === item.expectedAttemptId,
        )!
        record.decisions.push({
          id: item.decisionId,
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
          previousCheckInAt: null,
          newCheckInAt: null,
          // Denial vouches for nobody's position, at any size of set.
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
        record.latestDecisionId = item.decisionId
        record.retryBlocked = preventRetry
        record.stateVersion += 1
        record.approval = null
        record.retry = preventRetry
          ? { allowed: false, reason: 'prevented' }
          : { allowed: true, reason: 'open-denial' }
        return clone(record)
      })
    },

    async correct({
      attendanceId,
      expectedVersion,
      action,
      reason,
      reading,
      correctedAt,
      decisionId,
    }) {
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
      const now = referenceNow().toISOString()
      const id = decisionId ?? crypto.randomUUID()
      const newStatus =
        action === 'present'
          ? 'present'
          : action === 'absent' || action === 'absent_allow_retry'
            ? 'absent'
            : record.status
      const outlet = outletFor(attempt.outletId)
      if (action === 'time') {
        if (!correctedAt) {
          throw new AttendanceActionError('time_required', 'Choose the corrected check-in time.')
        }
        if (!record.checkIn || !record.outcomeAttemptId) {
          throw new AttendanceActionError(
            'time_refused',
            'Only settled attendance with an arrival can change check-in time.',
          )
        }
        const corrected = new Date(correctedAt)
        if (Number.isNaN(corrected.getTime())) {
          throw new AttendanceActionError('time_invalid', 'Choose a valid check-in time.')
        }
        if (corrected.getTime() > referenceNow().getTime()) {
          throw new AttendanceActionError(
            'time_future',
            'A corrected check-in time cannot be in the future.',
          )
        }
        if (resolveBusinessDate(corrected, outlet.business_day_cutover) !== record.businessDate) {
          throw new AttendanceActionError(
            'time_wrong_day',
            'The corrected time must remain on this attendance day.',
          )
        }
        if (correctedAt === record.checkIn.at) {
          throw new AttendanceActionError('time_unchanged', 'Choose a different check-in time.')
        }
      } else if (correctedAt) {
        throw new AttendanceActionError(
          'time_unexpected',
          'Only a check-in time correction accepts a time.',
        )
      }
      const preventsRetry =
        action === 'time' ? record.retryBlocked : action === 'present' || action === 'absent'
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
              : action === 'time'
                ? 'correct_time'
                : action,
        by: DEMO_MANAGER_ID,
        byName: personaFixtures.franchise_admin.profile.full_name,
        at: now,
        reason: trimmed,
        preventsRetry,
        previousStatus: record.status,
        newStatus,
        previousCheckInAt: action === 'time' ? (record.checkIn?.at ?? null) : null,
        newCheckInAt: action === 'time' ? (correctedAt ?? null) : null,
        latitude: action === 'present' ? (reading?.latitude ?? null) : null,
        longitude: action === 'present' ? (reading?.longitude ?? null) : null,
        accuracyMetres: action === 'present' ? (reading?.accuracyMetres ?? null) : null,
        distanceMetres: managerDistance,
      })
      record.status = newStatus
      if (action !== 'time') {
        record.latestDecisionId = id
        record.retryBlocked = preventsRetry
      }
      record.stateVersion += 1
      if (action === 'time') {
        if (record.checkIn && correctedAt) record.checkIn.at = correctedAt
      } else {
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
      }
      return clone(record)
    },
  }
}
