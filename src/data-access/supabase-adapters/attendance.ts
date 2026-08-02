import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

import type {
  AttendanceAdapter,
  AttendanceAttempt,
  AttendanceDecision,
  AttendanceEvent,
  AttendanceRecord,
  WaitingCount,
} from '../adapters'
import { AttendanceActionError } from '../adapters'
import type { Database } from '../database.types'

/**
 * The real attendance adapter.
 *
 * Every write here sends its evidence and lets the database adjudicate. A
 * check-in always claims `present` and always comes back `absent`, because the
 * fence is evidence and only a recorded approval settles a day. The client's own
 * verdict decides what to *show* someone before they write; it never decides
 * what is recorded.
 *
 * Rows key on the person's account since staff-as-accounts — the join is to
 * `profiles`, and there is no roster table behind it.
 */

const COLUMNS =
  'id, outlet_id, person_id, business_date, status, state_version, current_attempt_id, ' +
  'outcome_attempt_id, latest_decision_id, retry_blocked, arrival_deadline, ' +
  'check_in_at, check_in_lat, check_in_lng, check_in_accuracy_m, check_in_distance_m, check_in_source, ' +
  'check_in_entered_by, check_in_entered_by_name, ' +
  'approved_by, approved_by_name, approval_reason, approved_at, ' +
  'approver_lat, approver_lng, approver_accuracy_m, approver_distance_m, ' +
  'profiles!attendance_person_id_fkey!inner(full_name), ' +
  // Named on the row since multi-outlet-people: a person may work a morning at
  // one outlet and an evening at another, so their own history has to say which
  // day was where rather than let the reader assume.
  'outlets!attendance_outlet_id_fkey(name), ' +
  'attendance_attempts!attendance_attempts_attendance_id_fkey(id, outlet_id, business_date, attempted_at, latitude, longitude, accuracy_m, distance_m, source, entered_by, entered_by_name, arrival_deadline, superseded_at, settled_at, outlets!attendance_attempts_outlet_id_fkey(name, geofence_radius_m)), ' +
  'attendance_decisions!attendance_decisions_attendance_id_fkey(id, attempt_id, outlet_id, kind, actor_id, actor_name, decided_at, reason, prevents_retry, previous_status, new_status, manager_lat, manager_lng, manager_accuracy_m, manager_distance_m, outlets!attendance_decisions_outlet_id_fkey(name))'

interface JoinedAttempt {
  id: string
  outlet_id: string
  business_date: string
  attempted_at: string
  latitude: number | null
  longitude: number | null
  accuracy_m: number | null
  distance_m: number | null
  source: AttendanceEvent['source']
  entered_by: string | null
  entered_by_name: string | null
  arrival_deadline: string
  superseded_at: string | null
  settled_at: string | null
  outlets: { name: string; geofence_radius_m: number } | null
}

interface JoinedDecision {
  id: string
  attempt_id: string | null
  outlet_id: string
  kind: AttendanceDecision['kind']
  actor_id: string | null
  actor_name: string | null
  decided_at: string
  reason: string | null
  prevents_retry: boolean
  previous_status: AttendanceDecision['previousStatus']
  new_status: AttendanceDecision['newStatus']
  manager_lat: number | null
  manager_lng: number | null
  manager_accuracy_m: number | null
  manager_distance_m: number | null
  outlets: { name: string } | null
}

interface JoinedRow {
  id: string
  outlet_id: string
  person_id: string
  business_date: string
  status: AttendanceRecord['status']
  state_version: number
  current_attempt_id: string | null
  outcome_attempt_id: string | null
  latest_decision_id: string | null
  retry_blocked: boolean
  arrival_deadline: string | null
  check_in_at: string | null
  check_in_lat: number | null
  check_in_lng: number | null
  check_in_accuracy_m: number | null
  check_in_distance_m: number | null
  check_in_source: AttendanceEvent['source']
  check_in_entered_by: string | null
  check_in_entered_by_name: string | null
  approved_by: string | null
  approved_by_name: string | null
  approval_reason: string | null
  approved_at: string | null
  approver_lat: number | null
  approver_lng: number | null
  approver_accuracy_m: number | null
  approver_distance_m: number | null
  profiles: { full_name: string } | null
  outlets: { name: string } | null
  attendance_attempts: JoinedAttempt[]
  attendance_decisions: JoinedDecision[]
}

function retryEligibility(row: JoinedRow, attempts: AttendanceAttempt[]) {
  if (row.retry_blocked) return { allowed: false, reason: 'prevented' as const }
  if (row.current_attempt_id) {
    const current = attempts.find((attempt) => attempt.id === row.current_attempt_id)
    if (!current) return { allowed: false, reason: 'settled' as const }
    if (current.distanceMetres === null) {
      return { allowed: true, reason: 'unverifiable-current' as const }
    }
    return current.distanceMetres >
      (row.attendance_attempts.find((item) => item.id === current.id)?.outlets?.geofence_radius_m ??
        0)
      ? { allowed: true, reason: 'outside-current' as const }
      : { allowed: false, reason: 'inside-current' as const }
  }
  if (row.status !== 'absent') return { allowed: false, reason: 'not-absent' as const }
  const latest = row.attendance_decisions.find((decision) => decision.id === row.latest_decision_id)
  if (
    latest &&
    ['deny', 'correct_absent', 'allow_retry', 'absent_allow_retry'].includes(latest.kind)
  ) {
    return { allowed: true, reason: 'open-denial' as const }
  }
  return { allowed: false, reason: 'settled' as const }
}

function toRecord(row: JoinedRow): AttendanceRecord {
  const attempts: AttendanceAttempt[] = [...(row.attendance_attempts ?? [])]
    .sort((a, b) => a.attempted_at.localeCompare(b.attempted_at))
    .map((attempt) => ({
      id: attempt.id,
      outletId: attempt.outlet_id,
      outletName: attempt.outlets?.name ?? null,
      businessDate: attempt.business_date,
      at: attempt.attempted_at,
      latitude: attempt.latitude,
      longitude: attempt.longitude,
      accuracyMetres: attempt.accuracy_m,
      distanceMetres: attempt.distance_m,
      source: attempt.source,
      enteredBy: attempt.entered_by,
      enteredByName: attempt.entered_by_name,
      arrivalDeadline: attempt.arrival_deadline,
      supersededAt: attempt.superseded_at,
      settledAt: attempt.settled_at,
    }))
  const decisions: AttendanceDecision[] = [...(row.attendance_decisions ?? [])]
    .sort((a, b) => a.decided_at.localeCompare(b.decided_at))
    .map((decision) => ({
      id: decision.id,
      attemptId: decision.attempt_id,
      outletId: decision.outlet_id,
      outletName: decision.outlets?.name ?? null,
      kind: decision.kind,
      by: decision.actor_id,
      byName: decision.actor_name,
      at: decision.decided_at,
      reason: decision.reason,
      preventsRetry: decision.prevents_retry,
      previousStatus: decision.previous_status,
      newStatus: decision.new_status,
      latitude: decision.manager_lat,
      longitude: decision.manager_lng,
      accuracyMetres: decision.manager_accuracy_m,
      distanceMetres: decision.manager_distance_m,
    }))
  return {
    id: row.id,
    outletId: row.outlet_id,
    outletName: row.outlets?.name ?? null,
    personId: row.person_id,
    personName: row.profiles?.full_name ?? '',
    businessDate: row.business_date,
    status: row.status,
    stateVersion: row.state_version,
    currentAttemptId: row.current_attempt_id,
    outcomeAttemptId: row.outcome_attempt_id,
    latestDecisionId: row.latest_decision_id,
    retryBlocked: row.retry_blocked,
    attempts,
    decisions,
    retry: retryEligibility(row, attempts),
    arrivalDeadline: row.arrival_deadline,
    checkIn: row.check_in_at
      ? {
          at: row.check_in_at,
          latitude: row.check_in_lat,
          longitude: row.check_in_lng,
          accuracyMetres: row.check_in_accuracy_m,
          distanceMetres: row.check_in_distance_m,
          source: row.check_in_source,
          enteredBy: row.check_in_entered_by,
          enteredByName: row.check_in_entered_by_name,
        }
      : null,
    // The approver and the time travel together, enforced by
    // attendance_approval_complete; the reason does not, because an on-site
    // approval on the day is not asked for one.
    approval:
      row.approved_by && row.approved_at
        ? {
            by: row.approved_by,
            byName: row.approved_by_name,
            at: row.approved_at,
            reason: row.approval_reason,
            latitude: row.approver_lat,
            longitude: row.approver_lng,
            accuracyMetres: row.approver_accuracy_m,
            distanceMetres: row.approver_distance_m,
          }
        : null,
  }
}

/**
 * Turn a Postgres refusal into something worth reading at a counter. The
 * constraint and trigger names are the contract here — they are what the
 * schema chose to call these rules, and matching on them beats matching on
 * prose that a Postgres upgrade may reword.
 */
function toActionError(error: PostgrestError): AttendanceActionError {
  const detail = `${error.message} ${error.details ?? ''}`

  if (detail.includes('attendance state is stale')) {
    return new AttendanceActionError(
      'stale_state',
      'Attendance changed while this action was open. The latest state has been reloaded.',
    )
  }
  if (detail.includes('changed payload') || detail.includes('command id was reused')) {
    return new AttendanceActionError(
      'changed_request',
      'This saved request no longer matches the action. Start the action again.',
    )
  }
  if (detail.includes('current in-fence attempt')) {
    return new AttendanceActionError(
      'inside_retry_locked',
      'Your latest check-in is inside the fence and must be decided before another check-in.',
    )
  }
  if (detail.includes('another check-in is not allowed')) {
    return new AttendanceActionError(
      'retry_blocked',
      'Another check-in is not allowed for this business day.',
    )
  }
  if (detail.includes('retry target no longer')) {
    return new AttendanceActionError(
      'day_closed',
      'That outlet has moved to a new business day, so this check-in can no longer be retried.',
    )
  }
  if (detail.includes('requires a reason')) {
    return new AttendanceActionError(
      'reason_required',
      'This action needs a reason before it can be saved.',
    )
  }

  if (detail.includes('attendance_one_per_person_day')) {
    return new AttendanceActionError(
      'already_started',
      'This day has already been recorded, here or at another outlet. Reload to see it.',
    )
  }
  if (detail.includes('outlet is not trading')) {
    return new AttendanceActionError(
      'outlet_closed',
      'This outlet is marked closed, so check-in is not accepted. Ask your manager to reopen it.',
    )
  }
  if (detail.includes('captured check-in evidence is immutable')) {
    return new AttendanceActionError(
      'already_checked_in',
      'A check-in is already recorded for today and cannot be replaced.',
    )
  }
  if (detail.includes('a manual entry cannot be recorded for the future')) {
    return new AttendanceActionError('future_entry', 'A manual entry cannot be in the future.')
  }
  if (detail.includes('current business day')) {
    return new AttendanceActionError(
      'not_today',
      'A manual entry can only be recorded for the current business day.',
    )
  }
  if (detail.includes('manual entry')) {
    return new AttendanceActionError(
      'manual_refused',
      'Only a manager for this outlet can record an entry on someone’s behalf.',
    )
  }
  if (detail.includes('approval_reason_not_blank')) {
    return new AttendanceActionError(
      'reason_required',
      'You are not at the outlet, or this day has already closed, so this approval needs a reason.',
    )
  }
  if (detail.includes('an approval requires a check-in')) {
    return new AttendanceActionError(
      'nothing_to_approve',
      'There is no check-in on this day to approve.',
    )
  }
  if (detail.includes('a recorded approval is immutable')) {
    return new AttendanceActionError(
      'already_approved',
      'This day has already been approved. Reload to see who settled it.',
    )
  }
  if (detail.includes('approval') || detail.includes('approved_by')) {
    return new AttendanceActionError(
      'approval_refused',
      'Only a manager for this outlet can approve a check-in.',
    )
  }
  if (error.code === '42501' || error.code === 'PGRST116') {
    return new AttendanceActionError('not_permitted', 'That is not something this account can do.')
  }
  return new AttendanceActionError('failed', 'That did not work. Try again in a moment.')
}

export function createSupabaseAttendanceAdapter(
  client: SupabaseClient<Database>,
): AttendanceAdapter {
  const table = () => client.from('attendance')

  async function readOne(id: string): Promise<AttendanceRecord> {
    const { data, error } = await table().select(COLUMNS).eq('id', id).single()
    if (error) throw toActionError(error)
    return toRecord(data as unknown as JoinedRow)
  }

  async function readMany(ids: readonly string[]): Promise<AttendanceRecord[]> {
    const { data, error } = await table()
      .select(COLUMNS)
      .in('id', ids as string[])
    if (error) throw toActionError(error)
    return (data as unknown as JoinedRow[]).map(toRecord)
  }

  return {
    async getDay(personId, businessDate) {
      // No outlet filter: one person holds one row a business date, so naming
      // an outlet could only hide the row that exists.
      const { data, error } = await table()
        .select(COLUMNS)
        .eq('person_id', personId)
        .eq('business_date', businessDate)
        .maybeSingle()
      if (error) throw toActionError(error)
      return data ? toRecord(data as unknown as JoinedRow) : null
    },

    async listHistory(personId, from, to) {
      const { data, error } = await table()
        .select(COLUMNS)
        .eq('person_id', personId)
        .gte('business_date', from)
        .lte('business_date', to)
        .order('business_date', { ascending: false })
      if (error) throw toActionError(error)
      return (data as unknown as JoinedRow[]).map(toRecord)
    },

    /**
     * No outlet filter, on purpose (attendance-one-day-per-person, design D4).
     * The question this answers is "how many days did this person work", and
     * the honest scope for it is every outlet the reader may see — which is
     * exactly what `attendance_select` already resolves from their live
     * assignments. Naming a set here would either restate the policy or
     * disagree with it.
     */
    async listPersonRange(personId, from, to) {
      const { data, error } = await table()
        .select(COLUMNS)
        .eq('person_id', personId)
        .gte('business_date', from)
        .lte('business_date', to)
        .order('business_date', { ascending: false })
      if (error) throw toActionError(error)
      return (data as unknown as JoinedRow[]).map(toRecord)
    },

    async listOutletDay(outletIds, businessDate) {
      if (outletIds.length === 0) return []
      const { data, error } = await table()
        .select(COLUMNS)
        .in('outlet_id', outletIds as string[])
        .eq('business_date', businessDate)
      if (error) throw toActionError(error)
      return (data as unknown as JoinedRow[])
        .map(toRecord)
        .sort((a, b) => a.personName.localeCompare(b.personName))
    },

    /**
     * The one bit that crosses the outlet boundary, asked of the database
     * because RLS means the client cannot work it out (design D3). The function
     * intersects the named set with what the caller may actually see, so this
     * widens nothing that selecting an outlet did not already.
     */
    async listElsewhere(outletIds, businessDate) {
      if (outletIds.length === 0) return []
      const { data, error } = await client.rpc('attendance_elsewhere', {
        p_outlets: outletIds as string[],
        p_business_date: businessDate,
      })
      if (error) throw toActionError(error)
      return data ?? []
    },

    /**
     * The waiting shape asked for directly rather than derived from a day read:
     * a stranded day can be any date, so counting it means asking the database
     * for exactly the rows that carry an arrival nobody has settled. RLS scopes
     * the answer, so a Franchise Admin gets their own outlets and the owner gets
     * all of them, with no policy added here.
     */
    async countWaitingByOutlet() {
      const { data, error } = await table()
        .select('outlet_id, business_date, outlets!attendance_outlet_id_fkey(name)')
        .not('current_attempt_id', 'is', null)
        .order('business_date', { ascending: true })
        .limit(2000)
      if (error) throw toActionError(error)

      const byOutlet = new Map<string, WaitingCount>()
      for (const row of data as unknown as {
        outlet_id: string
        business_date: string
        outlets: { name: string } | null
      }[]) {
        const seen = byOutlet.get(row.outlet_id)
        if (seen) {
          seen.waiting += 1
          // Ascending by date, so the last row seen for an outlet is its newest.
          seen.newest = row.business_date
        } else {
          byOutlet.set(row.outlet_id, {
            outletId: row.outlet_id,
            outletName: row.outlets?.name ?? null,
            waiting: 1,
            // Ascending by date, so the first row for an outlet is its oldest.
            oldest: row.business_date,
            // An outlet with one waiting day is its own oldest and newest.
            newest: row.business_date,
          })
        }
      }
      return [...byOutlet.values()].sort((a, b) =>
        (a.outletName ?? '').localeCompare(b.outletName ?? ''),
      )
    },

    async checkIn({
      personId: _personId,
      outletId,
      businessDate,
      reading,
      attemptId = crypto.randomUUID(),
      expectedVersion = null,
    }) {
      const { data, error } = await client.rpc('attendance_submit_attempt', {
        p_attempt_id: attemptId,
        p_outlet_id: outletId,
        p_business_date: businessDate,
        p_attempted_at: reading?.at ?? new Date().toISOString(),
        p_lat: reading?.latitude as number,
        p_lng: reading?.longitude as number,
        p_accuracy_m: reading?.accuracyMetres as number,
        ...(expectedVersion == null ? {} : { p_expected_version: expectedVersion }),
      })
      if (error) throw toActionError(error)
      return readOne(data.id)
    },

    /**
     * A manual event carries no coordinates — the admin was not standing where
     * the person was, and the database refuses fabricated evidence anyway. The
     * enterer and approval columns are not sent at all: the guard stamps the
     * writing session for both and would overwrite anything supplied.
     */
    async recordManualEntry({ personId, outletId, businessDate, at }) {
      const { data, error } = await client.rpc('attendance_record_manual', {
        p_attempt_id: crypto.randomUUID(),
        p_decision_id: crypto.randomUUID(),
        p_person_id: personId,
        p_outlet_id: outletId,
        p_business_date: businessDate,
        p_attempted_at: at,
      })
      if (error) throw toActionError(error)
      return readOne(data.id)
    },

    /**
     * One statement over the selected ids, so a morning is settled together or
     * not at all. The trigger stamps each row's approver name, computes each
     * row's own approver distance from the one reading sent, and applies the
     * reason rule per row — which matters, because a batch can span a day that
     * has closed and a day that has not.
     *
     * `approved_at` is deliberately not sent: when the approval was made is the
     * database's fact, and it stamps it.
     */
    async approve(attendanceIds, { reason, reading, approverId: _approverId }) {
      if (attendanceIds.length === 0) return []
      const trimmed = reason?.trim() ?? ''
      const current = await readMany(attendanceIds)
      for (const record of current) {
        if (!record.currentAttemptId) {
          throw new AttendanceActionError(
            'nothing_to_approve',
            'There is no current check-in to approve.',
          )
        }
        const { error } = await client.rpc('attendance_approve_attempt', {
          p_decision_id: crypto.randomUUID(),
          p_attendance_id: record.id,
          p_expected_attempt_id: record.currentAttemptId,
          p_expected_version: record.stateVersion,
          p_reason: (trimmed || null) as string,
          p_manager_lat: reading?.latitude as number,
          p_manager_lng: reading?.longitude as number,
          p_manager_accuracy_m: reading?.accuracyMetres as number,
        })
        if (error) throw toActionError(error)
      }
      return readMany(attendanceIds)
    },

    async deny({
      attendanceId,
      expectedAttemptId,
      expectedVersion,
      reason,
      preventRetry,
      decisionId = crypto.randomUUID(),
    }) {
      const { data, error } = await client.rpc('attendance_deny_attempt', {
        p_decision_id: decisionId,
        p_attendance_id: attendanceId,
        p_expected_attempt_id: expectedAttemptId,
        p_expected_version: expectedVersion,
        p_reason: reason,
        p_prevent_retry: preventRetry,
      })
      if (error) throw toActionError(error)
      return readOne(data.id)
    },

    async correct({
      attendanceId,
      expectedVersion,
      action,
      reason,
      reading,
      decisionId = crypto.randomUUID(),
    }) {
      const { data, error } = await client.rpc('attendance_correct', {
        p_decision_id: decisionId,
        p_attendance_id: attendanceId,
        p_expected_version: expectedVersion,
        p_action: action,
        p_reason: reason,
        ...(reading
          ? {
              p_manager_lat: reading.latitude,
              p_manager_lng: reading.longitude,
              p_manager_accuracy_m: reading.accuracyMetres,
            }
          : {}),
      })
      if (error) throw toActionError(error)
      return readOne(data.id)
    },
  }
}
